import "server-only";
import { NextResponse } from "next/server";

// In-memory sliding-window limiter so nobody can run up the AI bill.
// Good for a single server; use Upstash Ratelimit (Redis) when you scale out.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.AI_RATE_LIMIT_PER_MIN || 30);

export function rateLimit(req: Request, bucket: string): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    return NextResponse.json(
      { error: "Too many requests, please wait a minute." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)) } },
    );
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  return null;
}
