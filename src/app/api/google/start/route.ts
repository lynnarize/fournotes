import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_SCOPES, cookieOptions, googleConfigured, publicOrigin, redirectUri, SCOPES, STATE_COOKIE, TOKEN_COOKIE, unseal,
  type GoogleSession,
} from "@/lib/google-server";

export const runtime = "nodejs";

// GET -> redirect to Google's consent screen. prompt=consent + access_type=offline
// makes Google return a refresh token every time, so each device can sync on its own.
// ?for=calendar asks for the calendar alone (read-only), never as part of Drive sync's
// sign-in; include_granted_scopes keeps Drive working for someone who already syncs.
export async function GET(req: NextRequest) {
  const calendar = req.nextUrl.searchParams.get("for") === "calendar";
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL(calendar ? "/?calendar=error&reason=config" : "/?google=error&reason=config", publicOrigin(req)));
  }
  const state = `${randomBytes(24).toString("base64url")}.${calendar ? "calendar" : "sync"}`;
  // The calendar of the account this device already signs in with, so sync keeps its account.
  const signedIn = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: (calendar ? CALENDAR_SCOPES : SCOPES).join(" "),
    access_type: "offline",
    prompt: calendar && signedIn?.email ? "consent" : "consent select_account",
    include_granted_scopes: "true",
    ...(calendar && signedIn?.email ? { login_hint: signedIn.email } : {}),
    state,
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
