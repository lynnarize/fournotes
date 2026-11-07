// Small subset of RFC 5545 RRULE: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL and
// BYMONTHDAY. Same format calendars use, so it can be passed to Google Calendar unchanged.
//
// BYMONTHDAY stops month-end bills drifting. Advancing from January 31st has to clamp
// to February 28th, but the *next* step must return to the 31st — so the day the user
// chose is kept in the rule rather than re-read from the last occurrence.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Rule = { freq: Freq; interval: number; monthDay?: number };

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
/** Nobody repeats something every thousand months, and a huge value overflows the date maths. */
const MAX_INTERVAL = 1000;

export function parseRrule(rrule?: string | null): Rule | null {
  if (!rrule) return null;
  const body = rrule.replace(/^RRULE:/i, "").trim();
  // A bare frequency ("MONTHLY", "monthly") is what small models write.
  if (FREQS.includes(body.toUpperCase() as Freq)) return { freq: body.toUpperCase() as Freq, interval: 1 };
  const parts = Object.fromEntries(body.split(";").map((p) => p.split("=").map((s) => s.trim().toUpperCase())));
  const freq = parts.FREQ as Freq;
  if (!FREQS.includes(freq)) return null;
  const interval = Math.min(MAX_INTERVAL, Math.max(1, parseInt(parts.INTERVAL ?? "1") || 1));
  const day = parseInt(parts.BYMONTHDAY ?? "");
  return { freq, interval, ...(day >= 1 && day <= 31 ? { monthDay: day } : {}) };
}

export const makeRrule = (freq: Freq, interval = 1, monthDay?: number) =>
  `FREQ=${freq};INTERVAL=${Math.min(MAX_INTERVAL, Math.max(1, interval))}${monthDay && monthDay >= 1 && monthDay <= 31 ? `;BYMONTHDAY=${monthDay}` : ""}`;

/**
 * The canonical form of whatever a model or an older backup contained. Pass the task's
 * date so a month-end day (29–31, which some months lack) is anchored.
 */
export function normaliseRrule(rrule?: string | null, anchor?: string | Date | null): string | null {
  const r = parseRrule(rrule);
  if (!r) return null;
  let monthDay = r.monthDay;
  if (!monthDay && (r.freq === "MONTHLY" || r.freq === "YEARLY") && anchor) {
    const day = new Date(anchor).getDate();
    if (day >= 29) monthDay = day;
  }
  return makeRrule(r.freq, r.interval, monthDay);
}

/** Next occurrence of `iso` (local time), exactly one interval later, clamping month ends (Jan 31 -> Feb 28). */
export function nextOccurrence(iso: string, rrule: string): string {
  const r = parseRrule(rrule);
  const d = new Date(iso);
  if (!r || Number.isNaN(d.getTime())) return iso;
  if (r.freq === "DAILY") d.setDate(d.getDate() + r.interval);
  else if (r.freq === "WEEKLY") d.setDate(d.getDate() + 7 * r.interval);
  else {
    const months = r.freq === "MONTHLY" ? r.interval : 12 * r.interval;
    const day = r.monthDay ?? d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  return d.toISOString();
}

/** The first occurrence at or after `notBefore`: a task due months ago must not come back in the past. */
export function nextNotBefore(iso: string, rrule: string, notBefore = new Date()): string {
  if (!parseRrule(rrule)) return iso;
  let current = iso;
  // Bounded: a daily rule three years behind still settles well inside this.
  for (let i = 0; i < 2000 && new Date(current) < notBefore; i++) {
    const next = nextOccurrence(current, rrule);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * The occurrence after the one just completed. One finished early still moves past its
 * own (future) date; one finished late skips the dates already gone.
 */
export const nextAfterCompleting = (iso: string, rrule: string, notBefore = new Date()) =>
  nextNotBefore(nextOccurrence(iso, rrule), rrule, notBefore);

export function rruleLabel(rrule?: string | null) {
  const r = parseRrule(rrule);
  if (!r) return "";
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[r.freq];
  return r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
}
