import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST (from browsers) -> 204 : Content Security Policy violations (see src/middleware.ts),
// logged so a blocked script or connection shows up in the deployment logs.
export async function POST(req: Request) {
  const limited = rateLimit(req, "csp-report");
  if (limited) return new NextResponse(null, { status: 204 });
  const body = (await req.text().catch(() => "")).slice(0, 4000);
  try {
    const report = (JSON.parse(body) as { "csp-report"?: Record<string, unknown> })["csp-report"] ?? {};
    const pick = (k: string) => String(report[k] ?? "").slice(0, 200);
    // Origins and paths only: a blocked request's query string could hold the very key it tried to send.
    const where = (u: string) => {
      try {
        const url = new URL(u);
        return `${url.origin}${url.pathname}`;
      } catch {
        return u.split(/[?#]/)[0]; // "inline", "eval", "data" and the like
      }
    };
    console.warn(
      `[csp] blocked ${pick("effective-directive") || pick("violated-directive")} ${where(pick("blocked-uri"))} on ${where(pick("document-uri"))}`,
    );
  } catch {
    /* not a CSP report */
  }
  return new NextResponse(null, { status: 204 });
}
