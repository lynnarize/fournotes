"use client";
// Search across notes, tasks and spending.
// - Keyword ranking (BM25) always works, offline too.
// - Meaning-based search: when a Voyage key is available (Settings or VOYAGE_API_KEY), notes are embedded
//   once (cached in localStorage by updatedAt) and ranked by cosine similarity,
//   blended with BM25. The Supabase version of this is pgvector (see GUIDE.md).
import { authHeaders } from "./byok";
import type { Note, Todo, Transaction } from "./types";

export type SearchHit =
  | { kind: "note"; item: Note; score: number }
  | { kind: "todo"; item: Todo; score: number }
  | { kind: "transaction"; item: Transaction; score: number };

const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

function bm25(docs: string[], query: string): number[] {
  const q = tokenize(query);
  if (!q.length) return docs.map(() => 0);
  const toks = docs.map(tokenize);
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, toks.length);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return toks.map((t) => {
    let score = 0;
    for (const term of q) {
      // Prefix match so "bal" finds "bali"
      const tf = t.filter((w) => w === term || (term.length >= 3 && w.startsWith(term))).length;
      if (!tf) continue;
      const n = [...df.entries()].filter(([w]) => w === term || (term.length >= 3 && w.startsWith(term))).reduce((s, [, c]) => s + c, 0);
      const idf = Math.log(1 + (toks.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (t.length / avg))));
    }
    return score;
  });
}

export function keywordSearch(data: { notes: Note[]; todos: Todo[]; transactions: Transaction[] }, query: string, limit = 12): SearchHit[] {
  const notes = data.notes.filter((x) => !x.deletedAt);
  const todos = data.todos.filter((x) => !x.deletedAt);
  const txs = data.transactions.filter((x) => !x.deletedAt);
  const docs = [
    ...notes.map((n) => `${n.title} ${n.title} ${n.tags.join(" ")} ${n.content}`),
    ...todos.map((t) => `${t.title} ${t.notes ?? ""}`),
    ...txs.map((t) => `${t.merchant} ${t.category} ${t.items.map((i) => i.name).join(" ")}`),
  ];
  const scores = bm25(docs, query);
  const hits: SearchHit[] = [
    ...notes.map((item, i) => ({ kind: "note" as const, item, score: scores[i] })),
    ...todos.map((item, i) => ({ kind: "todo" as const, item, score: scores[notes.length + i] })),
    ...txs.map((item, i) => ({ kind: "transaction" as const, item, score: scores[notes.length + todos.length + i] })),
  ];
  return hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---- Embeddings -----------------------------------------------------------------
const EMB_KEY = "four-notes:embeddings";
type EmbCache = Record<string, { v: string; e: number[] }>; // noteId -> { version (updatedAt), embedding }
let semanticAvailable: boolean | null = null;

function loadCache(): EmbCache {
  try { return JSON.parse(localStorage.getItem(EMB_KEY) ?? "{}"); } catch { return {}; }
}
function saveCache(c: EmbCache) {
  try { localStorage.setItem(EMB_KEY, JSON.stringify(c)); } catch { /* storage full: skip caching */ }
}

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][] | null> {
  if (semanticAvailable === false || !texts.length || (typeof navigator !== "undefined" && !navigator.onLine)) return null;
  try {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ texts, inputType }),
    });
    if (!res.ok) return null;
    const { embeddings } = (await res.json()) as { embeddings: number[][] | null };
    semanticAvailable = embeddings !== null;
    return embeddings;
  } catch {
    return null;
  }
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
};

/** Notes ranked by meaning (if embeddings are configured) blended with keywords. */
export async function semanticNotes(notes: Note[], query: string, limit = 5): Promise<{ note: Note; score: number }[]> {
  const live = notes.filter((n) => !n.deletedAt && (n.title || n.content));
  const kw = bm25(live.map((n) => `${n.title} ${n.title} ${n.content}`), query);
  const maxKw = Math.max(...kw, 1e-9);

  let sem: number[] | null = null;
  const cache = loadCache();
  const stale = live.filter((n) => cache[n.id]?.v !== n.updatedAt);
  if (semanticAvailable !== false) {
    // Embed changed notes in batches (most recently edited first, capped per search).
    const batch = stale.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 64);
    const [docVecs, qVec] = await Promise.all([
      embed(batch.map((n) => `${n.title}\n${n.content}`.slice(0, 4000)), "document"),
      embed([query], "query"),
    ]);
    if (docVecs) batch.forEach((n, i) => (cache[n.id] = { v: n.updatedAt, e: docVecs[i] }));
    if (docVecs || batch.length === 0) {
      const liveIds = new Set(live.map((n) => n.id));
      for (const id of Object.keys(cache)) if (!liveIds.has(id)) delete cache[id];
      saveCache(cache);
    }
    if (qVec?.[0]) sem = live.map((n) => (cache[n.id] ? cosine(cache[n.id].e, qVec[0]) : 0));
  }

  return live
    .map((note, i) => ({ note, score: sem ? 0.7 * sem[i] + 0.3 * (kw[i] / maxKw) : kw[i] / maxKw }))
    .filter((x) => x.score > (sem ? 0.25 : 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
