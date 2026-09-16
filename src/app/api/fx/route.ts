import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/fx?from=USD&to=IDR -> { rate }  (1 `from` = rate `to`)
// Uses the free open.er-api.com feed (no key, daily rates), cached for 12 hours.
// Set FX_API_URL to use another provider with the same response shape.
const cache = new Map<string, { at: number; rates: Record<string, number> }>();
const TTL = 12 * 3600_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").toUpperCase();
  const to = (url.searchParams.get("to") || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return NextResponse.json({ error: "from and to must be ISO 4217 codes" }, { status: 400 });
  }
  if (from === to) return NextResponse.json({ rate: 1 });

  try {
    let entry = cache.get(from);
    if (!entry || Date.now() - entry.at > TTL) {
      const base = process.env.FX_API_URL || "https://open.er-api.com/v6/latest";
      const res = await fetch(`${base}/${from}`, { cache: "no-store" });
      const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (!res.ok || !json.rates) throw new Error("Rate service unavailable");
      entry = { at: Date.now(), rates: json.rates };
      cache.set(from, entry);
    }
    const rate = entry.rates[to];
    if (!rate) return NextResponse.json({ error: `No rate for ${from}→${to}` }, { status: 404 });
    return NextResponse.json({ rate, asOf: new Date(entry.at).toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "FX failed" }, { status: 502 });
  }
}
