import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { rateLimit } from "@/lib/ratelimit";
import type { ChatMessage, ClientContext } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = rateLimit(req, "chat");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { messages, context, tools } = (await req.json()) as { messages: ChatMessage[]; context: ClientContext; tools?: boolean };
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }
    const provider = await getProvider(keys);
    const res = await provider.chat(messages, context, { tools: tools !== false });
    // A question is answered, never filed — whichever provider answered (demo mode files by rule).
    return NextResponse.json(tools === false ? { ...res, actions: [] } : res);
  } catch (e) {
    return aiError(e, "chat", activeSource(keys));
  }
}
