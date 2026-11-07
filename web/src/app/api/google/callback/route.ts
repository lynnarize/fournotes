import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_SCOPE, COOKIE_PATH, cookieOptions, DRIVE_SCOPE, googleTokenRequest, profileFromIdToken, publicOrigin, purposeOf,
  redirectUri, seal, STATE_COOKIE, TOKEN_COOKIE, unseal, type GoogleSession,
} from "@/lib/google-server";

export const runtime = "nodejs";

// Google redirects here after consent. Exchange the code, keep the refresh token
// in an encrypted httpOnly cookie, then send the user back to the app: with
// ?google=… after Drive sync's sign-in, ?calendar=… after "Connect calendar".
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const purpose = purposeOf(state);
  const key = purpose === "calendar" ? "calendar" : "google";
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/?${query}`, origin));
    res.cookies.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
    return res;
  };

  if (params.get("error")) return back(`${key}=error&reason=${params.get("error") === "access_denied" ? "denied" : "google"}`);

  const code = params.get("code");
  if (!code || !state || state !== req.cookies.get(STATE_COOKIE)?.value) return back(`${key}=error&reason=state`);

  try {
    const token = await googleTokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(req) });
    const granted = token.scope?.split(" ") ?? [];
    // Google lets people untick a permission on its consent screen.
    if (purpose === "sync" && !granted.includes(DRIVE_SCOPE)) return back("google=error&reason=drive");
    if (purpose === "calendar" && !granted.includes(CALENDAR_SCOPE)) return back("calendar=error&reason=scope");

    const previous = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
    const profile = profileFromIdToken(token.id_token);
    // Another account's calendar would take this device's sign-in away from the account it syncs with.
    if (purpose === "calendar" && previous?.email && profile.email && profile.email !== previous.email) {
      return back(`calendar=error&reason=account`);
    }
    const refreshToken = token.refresh_token ?? previous?.refreshToken;
    if (!refreshToken) return back(`${key}=error&reason=offline`);

    const session: GoogleSession = {
      refreshToken,
      email: profile.email ?? previous?.email ?? null,
      name: profile.name ?? previous?.name ?? null,
      calendar: purpose === "calendar" || (Boolean(previous?.calendar) && granted.includes(CALENDAR_SCOPE)),
    };
    const res = back(purpose === "calendar" ? "calendar=connected" : "google=connected");
    res.cookies.set(TOKEN_COOKIE, seal(session), cookieOptions(60 * 60 * 24 * 180));
    return res;
  } catch (e) {
    console.error("[google/callback]", e instanceof Error ? e.message : e);
    return back(`${key}=error&reason=google`);
  }
}
