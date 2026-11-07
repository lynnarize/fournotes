// The link to join a meeting's call, found in a calendar event, and the service it's on.
// The same rules as the Mac app's (FourNotes/Services/MeetingCalendar.swift, CallLink).

export interface CallLink {
  url: string;
  /** "Zoom", "Google Meet"… */
  service: string;
}

/** A link to a call, or null for any other page (a doc, the calendar's own page). */
export function classifyCallLink(raw: string): CallLink | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const link = (service: string): CallLink => ({ url: url.toString(), service });

  if (on("zoom.us") || on("zoomgov.com")) {
    // Meetings and webinars; not the site's own pages.
    return ["/j/", "/my/", "/w/", "/s/", "/wc/"].some((p) => path.startsWith(p)) ? link("Zoom") : null;
  }
  // "/abc-defg-hij" (or "/lookup/…"): a room, not the landing page.
  if (host === "meet.google.com") return path.length > 1 ? link("Google Meet") : null;
  if (on("teams.microsoft.com") || on("teams.live.com")) {
    return path.includes("meetup-join") || path.startsWith("/meet/") || path.startsWith("/l/meet") ? link("Microsoft Teams") : null;
  }
  if (on("webex.com")) return path.length > 1 ? link("Webex") : null;
  if (host === "call.whatsapp.com") return link("WhatsApp");
  if (host === "facetime.apple.com") return link("FaceTime");
  if (host === "app.slack.com" && path.includes("/huddle/")) return link("Slack");
  if (host === "meet.jit.si") return path.length > 1 ? link("Jitsi Meet") : null;
  if (on("whereby.com")) return path.length > 1 ? link("Whereby") : null;
  return null;
}

/** The links in a piece of text, plain or HTML (Google Calendar's descriptions are either). */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/&amp;/g, "&").matchAll(/https?:\/\/[^\s<>"'()[\]{}]+/gi)) {
    out.push(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return out;
}

/** The call in an event: its own link first, then where it is, then its notes. */
export function findCallLink(links: (string | null | undefined)[], location?: string | null, notes?: string | null): CallLink | null {
  for (const l of links) {
    const found = l ? classifyCallLink(l) : null;
    if (found) return found;
  }
  for (const text of [location, notes]) {
    if (!text) continue;
    for (const l of linksIn(text)) {
      const found = classifyCallLink(l);
      if (found) return found;
    }
  }
  return null;
}
