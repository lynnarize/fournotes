import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_PATH, cookieOptions, emailFromIdToken, googleTokenRequest, publicOrigin, redirectUri, seal, STATE_COOKIE,
  TOKEN_COOKIE, unseal, type GoogleSession,
} from "@/lib/google-server";

export const runtime = "nodejs";

// Google redirects here after consent. Exchange the code, keep the refresh token
// in an encrypted httpOnly cookie, then send the user back to the app.
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/?${query}`, origin));
    res.cookies.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back(`google=error&reason=${params.get("error") === "access_denied" ? "denied" : "google"}`);

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== req.cookies.get(STATE_COOKIE)?.value) return back("google=error&reason=state");

  try {
    const token = await googleTokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(req) });
    if (!token.scope?.includes("https://www.googleapis.com/auth/drive.appdata")) return back("google=error&reason=drive");

    const previous = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
    const refreshToken = token.refresh_token ?? previous?.refreshToken;
    if (!refreshToken) return back("google=error&reason=offline");

    const session: GoogleSession = { refreshToken, email: emailFromIdToken(token.id_token) ?? previous?.email ?? null };
    const res = back("google=connected");
    res.cookies.set(TOKEN_COOKIE, seal(session), cookieOptions(60 * 60 * 24 * 180));
    return res;
  } catch (e) {
    console.error("[google/callback]", e instanceof Error ? e.message : e);
    return back("google=error&reason=google");
  }
}
