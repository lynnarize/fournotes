import { NextResponse } from "next/server";
import { DEFAULT_OPENROUTER_FAST_MODEL, DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/models";
import { sharedKeyUsage } from "@/lib/ai/shared";

export const runtime = "nodejs";

// GET -> which AI services the server already has keys for (booleans only, never the keys).
export async function GET() {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const usage = sharedKeyUsage();
  return NextResponse.json({
    anthropic,
    openrouter,
    shared: anthropic || openrouter,
    sharedPerVisitorDaily: usage.anonLimit,
    sharedSignedInDaily: usage.signedInLimit,
    sharedDailyLimit: usage.dailyLimit,
    sharedRequiresSignIn: usage.requireSignIn,
    provider: anthropic ? "anthropic" : openrouter ? "openrouter" : "demo",
    voyage: Boolean(process.env.VOYAGE_API_KEY),
    stt: Boolean(process.env.STT_API_KEY),
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    fastModel: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5",
    openrouterModel: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouterFastModel: process.env.OPENROUTER_FAST_MODEL || DEFAULT_OPENROUTER_FAST_MODEL,
  });
}
