import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, googleConfigured, publicOrigin, redirectUri, SCOPES, STATE_COOKIE } from "@/lib/google-server";

export const runtime = "nodejs";

// GET -> redirect to Google's consent screen. prompt=consent + access_type=offline
// makes Google return a refresh token every time, so each device can sync on its own.
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/?google=error&reason=config", publicOrigin(req)));
  }
  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
