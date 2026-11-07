// Meetings from Google Calendar: which events count, who's in them and their call link.
// Read by the server route (app/api/google/calendar), shown by components/meetings.tsx.
// The same rules as the Mac app's, which reads the Mac's own calendars.
import { findCallLink, type CallLink } from "./callLink";
import type { Talk, TalkEvent } from "./types";

/** One occurrence of an event: a repeating meeting's occurrences each have their own id. */
export interface CalendarMeeting {
  id: string;
  title: string;
  /** ISO 8601. */
  start: string;
  end: string;
  /** Everyone invited but you, by name (or address when there's no name). */
  attendees: string[];
  link: CallLink | null;
}

/** What Google Calendar's events.list returns, the parts read here. */
export interface GoogleEvent {
  id?: string;
  status?: string;
  eventType?: string;
  summary?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

/** Out-of-office and working-location blocks are on the calendar, but nobody meets in them. */
const NOT_MEETINGS = new Set(["outOfOffice", "workingLocation", "birthday"]);

/** The events that are meetings: timed (not all-day), not cancelled, not declined. */
export function meetingsFrom(items: GoogleEvent[]): CalendarMeeting[] {
  const out: CalendarMeeting[] = [];
  for (const e of items) {
    if (!e.id || e.status === "cancelled" || NOT_MEETINGS.has(e.eventType ?? "")) continue;
    const start = e.start?.dateTime, end = e.end?.dateTime;
    if (!start || !end) continue; // all-day
    const people = e.attendees ?? [];
    if (people.some((a) => a.self && a.responseStatus === "declined")) continue;
    const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
    out.push({
      id: e.id,
      title: e.summary?.trim() || "Meeting",
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      attendees: people.filter((a) => !a.self && !a.resource).map((a) => a.displayName?.trim() || a.email || "").filter(Boolean),
      link: findCallLink([e.hangoutLink, video], e.location, e.description),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** As a talk keeps it. */
export const eventOf = (m: CalendarMeeting): TalkEvent => ({
  id: m.id, title: m.title, start: m.start, end: m.end, attendees: m.attendees, url: m.link?.url ?? null,
});

/** The talk recorded for this occurrence of a meeting, if there is one. */
export const talkFor = (m: CalendarMeeting, talks: Talk[]) =>
  talks.find((t) => !t.deletedAt && t.event?.id === m.id && Math.abs(Date.parse(t.event.start) - Date.parse(m.start)) < 60_000);

/** "Zoom · 4 people", "Sari", "". */
export function meetingDetail(m: CalendarMeeting) {
  const parts: string[] = [];
  if (m.link) parts.push(m.link.service);
  if (m.attendees.length) parts.push(m.attendees.length === 1 ? m.attendees[0] : `${m.attendees.length} people`);
  return parts.join(" · ");
}

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "3:30 – 4:00 PM", "11:30 AM – 12:15 PM". */
export function timeRange(m: CalendarMeeting) {
  const s = new Date(m.start), e = new Date(m.end);
  const a = time(s), b = time(e);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} – ${b}`;
}

export const clockTime = time;
