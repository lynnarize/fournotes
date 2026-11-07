import { NextResponse } from "next/server";
import { resolveKeys } from "@/lib/ai/keys";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { texts: string[], inputType: "document" | "query" } -> { embeddings: number[][] | null }
// Voyage AI embeddings (Anthropic's recommended embedding provider), using the
// user's key from Settings or VOYAGE_API_KEY. Returns { embeddings: null } when
// neither is set; the client then falls back to keyword search.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const { voyage } = resolveKeys(req);
  if (!voyage.apiKey) {
    return NextResponse.json({ embeddings: null, reason: "No Voyage API key" });
  }
  const limited = rateLimit(req, "embed");
  if (limited) return limited;
  try {
    const { texts, inputType } = (await req.json()) as { texts: string[]; inputType?: "document" | "query" };
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 128) {
      return NextResponse.json({ error: "texts must be 1-128 strings" }, { status: 400 });
    }
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${voyage.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: texts.map((t) => String(t).slice(0, 8000)),
        model: voyage.model,
        input_type: inputType === "query" ? "query" : "document",
      }),
    });
    if (!res.ok) throw new Error(`Embedding failed (${res.status})`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const embeddings = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return NextResponse.json({ embeddings });
  } catch (e) {
    console.error("[embed]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Embedding failed" }, { status: 500 });
  }
}
