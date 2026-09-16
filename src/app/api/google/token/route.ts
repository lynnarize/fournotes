import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_PATH, googleConfigured, GoogleTokenError, googleTokenRequest, TOKEN_COOKIE, unseal, type GoogleSession } from "@/lib/google-server";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST -> { accessToken, expiresIn, email } using the refresh token in the cookie.
// Access tokens only allow Drive's private app-data folder and expire in an hour.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "google");
  if (limited) return limited;
  if (!googleConfigured()) return NextResponse.json({ error: "Google sync isn't set up on this server yet." }, { status: 501 });

  const session = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not connected to Google on this device." }, { status: 401 });

  try {
    const token = await googleTokenRequest({ refresh_token: session.refreshToken, grant_type: "refresh_token" });
    return NextResponse.json(
      { accessToken: token.access_token, expiresIn: token.expires_in, email: session.email },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof GoogleTokenError && e.code === "invalid_grant") {
      const res = NextResponse.json({ error: "Google access was removed or has expired. Connect again." }, { status: 401 });
      res.cookies.delete({ name: TOKEN_COOKIE, path: COOKIE_PATH });
      return res;
    }
    console.error("[google/token]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't reach Google. Sync will retry soon." }, { status: 502 });
  }
}
