import { NextResponse } from "next/server";
import { blockedReply, enforceReplyScope, GuardError, needsOwnKey, OWN_KEY_REQUIRED, sanitizeChat, type Scope } from "@/lib/ai/guard";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "chat");
  if (limited) return limited;
  const keys = resolveKeys(req);
  // The deployment's own key is shared by every visitor: it only runs the app's own jobs.
  // A user's own key gets general help, but never code or anything harmful (see guard.ts).
  const scope: Scope | null = keys.provider === "demo" ? null : activeSource(keys) === "server" ? "shared" : "own";
  try {
    const body = (await req.json().catch(() => ({}))) as { messages?: unknown; context?: unknown; tools?: boolean };
    const { messages, context } = sanitizeChat(body.messages, body.context, scope ?? "own");
    // Plainly out-of-scope requests are refused before any model call (and any quota) is spent.
    const last = messages[messages.length - 1].content;
    const refused = scope && (blockedReply(last, scope) ?? (scope === "shared" && needsOwnKey(last, context) ? OWN_KEY_REQUIRED : null));
    if (refused) return NextResponse.json({ reply: refused, actions: [], refused: true });
    const blocked = guardSharedKey(req, keys);
    if (blocked) return blocked;
    const provider = await getProvider(keys);
    const res = await provider.chat(messages, context, { tools: body.tools !== false, scope: scope ?? undefined });
    const reply = scope ? enforceReplyScope(res.reply, scope) : res.reply;
    // A question is answered, never filed — whichever provider answered (demo mode files by rule).
    return NextResponse.json({ ...res, reply, actions: body.tools === false ? [] : res.actions, ...(reply !== res.reply ? { refused: true } : {}) });
  } catch (e) {
    if (e instanceof GuardError) return NextResponse.json({ error: e.message }, { status: e.status });
    return aiError(e, "chat", activeSource(keys));
  }
}
