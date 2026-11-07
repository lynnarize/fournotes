import "server-only";
import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

type Bypass = "HUMAN" | "BAD-BOT" | "GOOD-BOT";

// Vercel BotID for the AI routes (see botidRoutes.ts), so scripted clients
// can't run up the AI bill. Real verification only happens on Vercel; anywhere
// else (next dev, next start) everyone passes, unless BOTID_DEV_BYPASS=BAD-BOT
// is set to try the blocked path. If Vercel can't be reached the request goes
// through: an outage shouldn't take the assistant down with it.
export async function blockBots(): Promise<NextResponse | null> {
  try {
    const { isBot } = await checkBotId({
      developmentOptions: {
        isDevelopment: !process.env.VERCEL,
        bypass: (process.env.BOTID_DEV_BYPASS || "HUMAN") as Bypass,
      },
    });
    if (!isBot) return null;
  } catch (e) {
    console.error("[botid]", e instanceof Error ? e.message : e);
    return null;
  }
  return NextResponse.json(
    { error: "We couldn't confirm this request came from the app. Reload the page and try again." },
    { status: 403 },
  );
}
