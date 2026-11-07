import { NextResponse } from "next/server";
import type { PaidModel } from "@/lib/ai/models";

export const runtime = "nodejs";

type Listed = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
};

// GET -> { models: PaidModel[] } : OpenRouter's paid models that can call tools
// (the app files to-dos and transactions through tool calls). Public list, no key needed.
export async function GET() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ models: [], error: `OpenRouter returned ${res.status}` }, { status: 502 });
    const { data = [] } = (await res.json()) as { data?: Listed[] };
    const models: PaidModel[] = data
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        vision: Boolean(m.architecture?.input_modalities?.includes("image")),
        context: m.context_length ?? 0,
        prompt: Number(m.pricing?.prompt ?? 0),
        completion: Number(m.pricing?.completion ?? 0),
        tools: Boolean(m.supported_parameters?.includes("tools")),
      }))
      // Negative prices mark routers with variable pricing; ":free" is the free tier, ":batch" isn't for live replies.
      .filter((m) => m.tools && !/:(free|batch)$/.test(m.id) && m.prompt >= 0 && m.completion >= 0 && m.prompt + m.completion > 0)
      .map(({ tools: _tools, ...m }) => m)
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ models }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ models: [], error: "Couldn't reach OpenRouter" }, { status: 502 });
  }
}
