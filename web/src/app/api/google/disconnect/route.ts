import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_PATH, TOKEN_COOKIE, unseal, type GoogleSession } from "@/lib/google-server";

export const runtime = "nodejs";

// POST -> revoke Google access for this device and forget the refresh token.
export async function POST(req: NextRequest) {
  const session = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
  if (session) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken }),
    }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete({ name: TOKEN_COOKIE, path: COOKIE_PATH });
  return res;
}
