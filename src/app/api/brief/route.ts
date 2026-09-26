import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { blockBots } from "@/lib/botid";
import { rateLimit } from "@/lib/ratelimit";
import type { BriefInput } from "@/lib/types";

export const runtime = "nodejs";

// POST BriefInput -> { text } : 3-line morning summary for the Today tab
export async function POST(req: Request) {
  const bot = await blockBots();
  if (bot) return bot;
  const limited = rateLimit(req, "brief");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const input = (await req.json()) as BriefInput;
    const provider = await getProvider(keys);
    return NextResponse.json({ text: await provider.dailyBrief(input) });
  } catch (e) {
    return aiError(e, "brief", activeSource(keys));
  }
}
