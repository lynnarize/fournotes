// Tiny subset of RFC 5545 RRULE: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY) + INTERVAL.
// Same format calendars use, so it can be passed to Google Calendar later.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export function parseRrule(rrule?: string | null): { freq: Freq; interval: number } | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(
    rrule.replace(/^RRULE:/i, "").split(";").map((p) => p.split("=").map((s) => s.trim().toUpperCase())),
  );
  const freq = parts.FREQ as Freq;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? "1") || 1);
  return { freq, interval };
}

export const makeRrule = (freq: Freq, interval = 1) => `FREQ=${freq};INTERVAL=${interval}`;

/** Next occurrence of `iso` (local time), clamping month ends (Jan 31 -> Feb 28). */
export function nextOccurrence(iso: string, rrule: string): string {
  const r = parseRrule(rrule);
  const d = new Date(iso);
  if (!r) return iso;
  if (r.freq === "DAILY") d.setDate(d.getDate() + r.interval);
  else if (r.freq === "WEEKLY") d.setDate(d.getDate() + 7 * r.interval);
  else {
    const months = r.freq === "MONTHLY" ? r.interval : 12 * r.interval;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  return d.toISOString();
}

export function rruleLabel(rrule?: string | null) {
  const r = parseRrule(rrule);
  if (!r) return "";
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[r.freq];
  return r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
}
