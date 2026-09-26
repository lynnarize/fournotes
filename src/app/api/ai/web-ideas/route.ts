import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { title, content, question } -> { text, sources } : "Ideas from the web" for a note.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "web-ideas");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { title, content, question } = (await req.json()) as { title?: unknown; content?: unknown; question?: unknown };
    if (typeof content !== "string") return NextResponse.json({ error: "Note content required" }, { status: 400 });
    const provider = await getProvider(keys);
    if (!provider.webIdeas) {
      return NextResponse.json({ error: "Searching the web needs an Anthropic key. Add one in Settings → AI & API keys." }, { status: 400 });
    }
    return NextResponse.json(await provider.webIdeas(typeof title === "string" ? title : "", content, typeof question === "string" ? question : ""));
  } catch (e) {
    return aiError(e, "ai/web-ideas", activeSource(keys));
  }
}
