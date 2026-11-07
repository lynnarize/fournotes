import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE_PATH, cookieOptions, googleConfigured, GoogleTokenError, googleTokenRequest, seal, TOKEN_COOKIE, unseal, type GoogleSession,
} from "@/lib/google-server";
import { meetingsFrom, type GoogleEvent } from "@/lib/meetings";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET -> { connected, email, meetings }: the primary calendar's meetings from three hours
// ago to a day and a half ahead, read when Today or Meetings asks. Read-only, and not kept
// here: each request goes to Google with the refresh token in the cookie.
// DELETE -> stop reading the calendar. ?google=1 (nothing else uses Google on this device)
// also signs out of Google; otherwise Drive sync keeps going.
// Like the other Google routes, no BotID: it spends no AI allowance (see lib/botidRoutes.ts).

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "google");
  if (limited) return limited;
  if (!googleConfigured()) return NextResponse.json({ connected: false, available: false }, { headers: NO_STORE });

  const session = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
  if (!session?.calendar) return NextResponse.json({ connected: false, available: true }, { headers: NO_STORE });

  let accessToken: string;
  try {
    accessToken = (await googleTokenRequest({ refresh_token: session.refreshToken, grant_type: "refresh_token" })).access_token;
  } catch (e) {
    if (e instanceof GoogleTokenError && e.code === "invalid_grant") {
      const res = NextResponse.json({ connected: false, available: true, error: "Google access was removed or has expired. Connect again." }, { headers: NO_STORE });
      res.cookies.delete({ name: TOKEN_COOKIE, path: COOKIE_PATH });
      return res;
    }
    console.error("[google/calendar]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't reach Google. Your meetings will show again soon." }, { status: 502, headers: NO_STORE });
  }

  const now = Date.now();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.search = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: new Date(now - 3 * 3600_000).toISOString(),
    timeMax: new Date(now + 36 * 3600_000).toISOString(),
    maxResults: "50",
    fields: "items(id,status,eventType,summary,location,description,hangoutLink,start,end,attendees(email,displayName,self,resource,responseStatus),conferenceData/entryPoints(entryPointType,uri))",
  }).toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }).catch(() => null);
  if (!res) return NextResponse.json({ error: "Couldn't reach Google Calendar. Your meetings will show again soon." }, { status: 502, headers: NO_STORE });

  // The calendar permission was taken back (in the Google account), though sync's is still there.
  if (res.status === 401 || res.status === 403) {
    const out = NextResponse.json({ connected: false, available: true, error: "Calendar access was removed. Connect it again to see your meetings." }, { headers: NO_STORE });
    out.cookies.set(TOKEN_COOKIE, seal({ ...session, calendar: false }), cookieOptions(60 * 60 * 24 * 180));
    return out;
  }
  if (!res.ok) {
    console.error("[google/calendar]", res.status);
    return NextResponse.json({ error: "Google Calendar didn't answer. Your meetings will show again soon." }, { status: 502, headers: NO_STORE });
  }
  const json = (await res.json().catch(() => ({}))) as { items?: GoogleEvent[] };
  return NextResponse.json({ connected: true, email: session.email, meetings: meetingsFrom(json.items ?? []) }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const session = unseal<GoogleSession>(req.cookies.get(TOKEN_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  if (!session) return res;
  if (req.nextUrl.searchParams.get("google") === "1") {
    // Google keeps a permission until the token is revoked: this device was only using it for the calendar.
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken }),
    }).catch(() => {});
    res.cookies.delete({ name: TOKEN_COOKIE, path: COOKIE_PATH });
  } else {
    res.cookies.set(TOKEN_COOKIE, seal({ ...session, calendar: false }), cookieOptions(60 * 60 * 24 * 180));
  }
  return res;
}
