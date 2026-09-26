import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { isWritingTask, MAX_WRITING_INPUT } from "@/lib/ai/writing";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { task, text, title } -> { text } : the Notes editor's AI menu.
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { task, text, title } = (await req.json()) as { task?: unknown; text?: unknown; title?: unknown };
    if (!isWritingTask(task)) return NextResponse.json({ error: "Unknown writing task" }, { status: 400 });
    if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "Write something first." }, { status: 400 });
    const provider = await getProvider(keys);
    const out = await provider.write(task, text.slice(0, MAX_WRITING_INPUT), typeof title === "string" ? title : "");
    return NextResponse.json({ text: out });
  } catch (e) {
    return aiError(e, "ai/write", activeSource(keys));
  }
}
