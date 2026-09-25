// Reading what a chat message asks for, before and after a model sees it.
// Ported from the macOS app (AI/AppleTools.swift, enum Intent). A question is
// answered, never filed; "save that" saves the reply as shown; and amounts are
// checked against what the user actually typed, whichever model answered.
import { parseAmount } from "./money";
import type { AIAction } from "./types";

const SAVE_WORDS =
  "remind|reminder|add|save|log|set|create|record|track|split|schedule|put|make|" +
  "spent|paid|bought|got|received|ingatkan|catat|tambah|simpan|buat|bayar|beli";
const saveWords = new RegExp(`\\b(${SAVE_WORDS})\\b`, "i");

/**
 * What the note editor's "Ask the assistant…" puts in the box:
 * `About my note “Title”: <question>`. The question may be empty.
 */
export function noteQuestion(message: string): { title: string; ask: string } | null {
  const m = message.match(/^\s*About my note [“"](.+?)[”"]\s*:?\s*([\s\S]*)$/);
  return m ? { title: m[1], ask: m[2].trim() } : null;
}

export function isQuestion(message: string): boolean {
  // "About my note “X”: …" asks about a note that exists; sent as it stands, models filed a second copy.
  const about = noteQuestion(message);
  if (about) return !saveWords.test(about.ask);
  const t = message.trim().toLowerCase();
  if (!t) return false;
  // "Can you remind me…?" is a request, whatever its punctuation.
  if (saveWords.test(t)) return false;
  if (t.endsWith("?")) return true;
  return /^(what|what's|whats|how|which|when|where|who|why|show|list|tell me|do i|did i|am i|apa|berapa|kapan|dimana|di mana|siapa|kenapa|mengapa|gimana|bagaimana)\b/.test(t);
}

/** Asking for what the world knows rather than what the user saved: recommendations, ideas, "what's the best…". */
export const wantsWorldKnowledge = (message: string) =>
  /\b(recommend\w*|suggest\w*|ideas?|best|tips?|advice|where (should|can|to)|what should i|which (one|is better)|worth (it|buying|visiting)|rekomendasi|saran|ide|terbaik|sebaiknya|bagusnya)\b/i.test(message);

export const asksToSave = (message: string) => saveWords.test(message);

/**
 * A message to answer, not to file: a question, or a request for recommendations, with
 * no word asking to save anything. Such a turn is sent with no tools at all — asked for a
 * Bandung itinerary, a model declined, then filed an empty "Bandung itinerary" note.
 */
export function answerOnly(message: string): boolean {
  const t = message.trim();
  // "note: …", "task: …" are requests however they are worded.
  if (/^(quick note|note|notes|task|to-?do|reminder|catatan|tugas)\s*:/i.test(t)) return false;
  if (asksToSave(t)) return false;
  return isQuestion(t) || wantsWorldKnowledge(t);
}

/**
 * "yea save that", "save it as a note", "simpan itu": the reply just shown, kept as it is.
 * Short on purpose — "save a note: …" with its own content is an ordinary request.
 */
export function savesPreviousReply(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (t.includes(":") || t.split(/\s+/).length > 10 || !/\b(save|keep|store|note down|simpan|catat)\b/.test(t)) return false;
  return /\b(that|this|it|them|those|itu|ini|as a note|to (my )?notes|in (my )?notes|jadi catatan|ke catatan|the (itinerary|list|plan|recommendations?|ideas?|answer|reply|table|tips))\b/.test(t);
}

/** "yes", "sure, go ahead", "iya": agreeing to what the last reply offered. */
export function agrees(message: string): boolean {
  const t = message.trim().toLowerCase();
  return t.split(/\s+/).length <= 5 && /^\W*(yes|yeah|yea|yep|yup|sure|ok|okay|please|please do|go ahead|do it|sounds good|iya|ya|boleh|oke|mau|silakan)\b/.test(t);
}

// ---- Amounts ---------------------------------------------------------------------------

/** Every amount the message states, as positive values. */
export function amounts(message: string): number[] {
  const re = /(?:rp\.?\s*|idr\s*)-?\d[\d.,]*(?:\s*(?:k|rb|ribu|jt|juta|m)\b)?|-?\d[\d.,]*\s*(?:k|rb|ribu|jt|juta|m)\b|\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{5,}\b/gi;
  return [...message.matchAll(re)].map((m) => parseAmount(m[0])).filter((n): n is number => n != null).map(Math.abs);
}

/** The one amount a message mentions; null when there is none, or several and it's unclear which. */
export function singleAmount(message: string): number | null {
  const distinct = [...new Set(amounts(message))];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Amounts a model filed, checked against what the user typed. Small models read "25k"
 * as 25 and "2.5jt" as 25,000,000; when the message states one amount and the model's
 * isn't among those it states, the message wins. Nothing changes when the message names
 * no amount, or the model picked one it does name.
 */
export function groundAmounts(actions: AIAction[], message: string): AIAction[] {
  const stated = amounts(message);
  const single = singleAmount(message);
  if (!stated.length || single == null) return actions;
  const fix = (v: number) => (stated.includes(Math.abs(v)) ? v : v < 0 ? -single : single);
  return actions.map((a) => {
    if (a.type === "add_transaction" || a.type === "set_budget") return { ...a, amount: fix(a.amount) };
    if (a.type === "create_todo" && a.bill) return { ...a, bill: { ...a.bill, amount: fix(a.bill.amount) } };
    return a;
  });
}
