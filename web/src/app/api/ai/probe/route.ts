import { NextResponse } from "next/server";
import { ProviderError } from "@/lib/ai/errors";
import { OpenRouterProvider } from "@/lib/ai/openrouter";
import type { ClientContext } from "@/lib/types";

export const runtime = "nodejs";

// Development only: tests ONE free OpenRouter model through the app's real
// pipeline (tools, validation, capture), with no fallbacks. Used by
// `npm run probe:models`. Returns 404 in production builds.
//
// POST { model, test: "chat" | "capture" | "vision" | "brief", image?: base64 jpeg }
//   header x-openrouter-key: the tester's own key

const CONTEXT: ClientContext = {
  now: "2026-09-16T08:00:00+07:00",
  timezone: "Asia/Jakarta",
  currency: "IDR",
  categories: ["Food & Drink", "Transport", "Shopping", "Bills", "Other"],
  notes: [],
  todos: [],
  transactions: [],
  budgets: {},
};

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });

  const apiKey = req.headers.get("x-openrouter-key")?.trim();
  const { model, test, image } = (await req.json().catch(() => ({}))) as { model?: string; test?: string; image?: string };
  if (!apiKey) return NextResponse.json({ ok: false, error: "x-openrouter-key header required" }, { status: 400 });
  // Free models only, so probing can never spend credits.
  if (!model || !/^[\w.-]+\/[\w.:-]+:free$/.test(model)) {
    return NextResponse.json({ ok: false, error: "model must be a :free OpenRouter id" }, { status: 400 });
  }

  const provider = new OpenRouterProvider({ apiKey, model, fastModel: model, visionModel: model, strict: true });
  const started = Date.now();
  try {
    if (test === "chat") {
      const out = await provider.chat(
        [{ role: "user", content: "Remind me to bring an umbrella to the office tomorrow at 8am. Also I spent 45k on lunch at Warteg today." }],
        CONTEXT,
      );
      return NextResponse.json({ ok: true, ms: Date.now() - started, ...out });
    }
    if (test === "capture") {
      const out = await provider.summarizeRecording(
        "Okay team, quick sync. The landing page ships Friday. Budi will fix the checkout bug by Thursday. " +
          "Sari needs to email the vendor about the invoice tomorrow morning.",
        CONTEXT,
      );
      return NextResponse.json({ ok: true, ms: Date.now() - started, ...out });
    }
    if (test === "vision") {
      if (!image) return NextResponse.json({ ok: false, error: "image required" }, { status: 400 });
      const out = await provider.captureImage(image, "image/jpeg", CONTEXT);
      return NextResponse.json({ ok: true, ms: Date.now() - started, ...out });
    }
    if (test === "brief") {
      const text = await provider.dailyBrief({
        now: CONTEXT.now,
        timezone: CONTEXT.timezone,
        currency: "IDR",
        tasksToday: [{ title: "Pay electricity bill", dueAt: "2026-09-16T09:00:00+07:00", overdue: false }],
        yesterdaySpend: [{ merchant: "Warteg", amount: 45000, category: "Food & Drink" }],
        stickies: ["Call mom on Sunday"],
        alerts: ["Food & Drink is at 92% of its budget"],
      });
      return NextResponse.json({ ok: true, ms: Date.now() - started, reply: text, actions: [] });
    }
    return NextResponse.json({ ok: false, error: "test must be chat, capture, vision or brief" }, { status: 400 });
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    return NextResponse.json({ ok: false, ms: Date.now() - started, status, error: e instanceof Error ? e.message : String(e) });
  }
}
