"use client";
// Meetings from Google Calendar: recorded in one click from Today's card or the Meetings
// page, today's listed above the talks with a Now line through them, and the calendar's
// place in Settings. As the Mac app has them, from the Mac's own calendars there.
import { Fragment, useEffect, useState } from "react";
import { connectCalendar, disconnectCalendar, prepareRecording, useCalendar } from "@/lib/calendar";
import { useNow } from "@/lib/hooks";
import { clockTime, eventOf, meetingDetail, talkFor, type CalendarMeeting } from "@/lib/meetings";
import { openItem } from "@/lib/nav";
import { useTalks } from "@/lib/talks/db";
import { canRecordCalls, preferredLang } from "@/lib/talks/prefs";
import { startRecording, useRecorder } from "@/lib/talks/recorder";
import { GoogleButton, useGoogleSync } from "./googleSync";
import { Icon, useToast } from "./ui";

/** Read once, after the page is up: a flag in this browser ("Not now" on a connect prompt). */
export function useStoredFlag(key: string): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(key) === "1"); } catch { /* storage blocked */ } }, [key]);
  return [on, () => { setOn(true); try { localStorage.setItem(key, "1"); } catch { /* storage blocked */ } }];
}

/**
 * Records a meeting: a call when it has a link and this browser can share a call's sound,
 * otherwise in person. "Join and record" opens the call in a new tab first, and the
 * Meetings page waits with the meeting filled in, to pick that tab once it's there.
 */
export function useRecordMeeting() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const record = async (m: CalendarMeeting, join: boolean) => {
    if (join && m.link) {
      window.open(m.link.url, "_blank", "noopener,noreferrer");
      prepareRecording(m, true);
      return;
    }
    setBusy(m.id);
    try {
      const id = await startRecording({ mode: m.link && canRecordCalls() ? "call" : "room", lang: preferredLang(), title: m.title, event: eventOf(m) });
      openItem("talk", id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start recording.", "error");
    } finally {
      setBusy(null);
    }
  };
  return { record, busy };
}

// ---- The Meetings page: today's, above the talks ----------------------------------------

const CONNECT_DISMISSED = "four-notes:meetings-connect-dismissed";

export function TodaysMeetings({ onOpen }: { onOpen: (talkId: string) => void }) {
  const cal = useCalendar();
  const talks = useTalks();
  const rec = useRecorder();
  useNow(30_000);
  const now = new Date();
  const { record, busy } = useRecordMeeting();
  const [dismissed, dismiss] = useStoredFlag(CONNECT_DISMISSED);

  if (cal.status === "unavailable" || cal.status === "checking") return null;
  if (cal.status === "disconnected") {
    if (dismissed) return null;
    return (
      <div className="mx-1 mb-3 flex items-start gap-2.5 rounded-[var(--radius-control)] bg-[var(--surface-muted)] p-3">
        <Icon name="calendar" size={16} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <div>
            <p className="text-[13px] font-medium">See your meetings here</p>
            <p className="text-[13px] leading-snug text-[var(--text-muted)]">Record one with its name and who&apos;s invited, from your Google Calendar.</p>
          </div>
          <button className="btn btn-secondary btn-sm max-md:h-11" onClick={connectCalendar}>Connect calendar</button>
        </div>
        <button className="btn btn-plain btn-sm btn-icon -mr-1 -mt-1 shrink-0" aria-label="Not now" onClick={dismiss}>
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }

  const today = cal.meetings.filter((m) => new Date(m.start).toDateString() === now.toDateString());
  const line = today.filter((m) => new Date(m.start) <= now).length;
  const nowLine = (
    <li aria-hidden className="flex items-center gap-2 px-1 py-1">
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span className="badge badge-dot fn-num">Now · {clockTime(now)}</span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </li>
  );
  return (
    <section aria-label="Today's meetings" className="pb-2">
      <p className="group-label px-3 pb-1">Today</p>
      {today.length === 0 && <p className="px-3 pb-2 text-[13px] text-[var(--text-muted)]">Nothing on your calendar today.</p>}
      <ul className="flex flex-col gap-0.5">
        {today.map((m, i) => {
          const talk = talkFor(m, talks);
          const recording = Boolean(talk && rec.talkId === talk.id && rec.status !== "idle");
          const past = new Date(m.end) <= now;
          return (
            <Fragment key={m.id}>
              {i === line && line > 0 && nowLine}
              <li className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5">
                <span className="fn-num flex w-[60px] shrink-0 flex-col text-[12px] leading-snug text-[var(--text-muted)]">
                  <span className={past ? "" : "text-[var(--foreground)]"}>{clockTime(new Date(m.start))}</span>
                  <span>{clockTime(new Date(m.end))}</span>
                </span>
                <button
                  type="button"
                  disabled={!talk}
                  onClick={() => talk && onOpen(talk.id)}
                  className={`flex min-w-0 flex-1 flex-col text-left ${past ? "text-[var(--text-secondary)]" : ""}`}
                >
                  <span className="truncate text-[14px] font-medium">{m.title}</span>
                  {meetingDetail(m) && <span className="truncate text-[12px] text-[var(--text-muted)]">{meetingDetail(m)}</span>}
                </button>
                {recording ? (
                  <span className="badge badge-danger badge-dot shrink-0">Recording</span>
                ) : talk ? (
                  <span className="badge shrink-0">Recorded</span>
                ) : !past && (
                  <span className="flex shrink-0 gap-1">
                    {m.link && (
                      <button className="btn btn-secondary btn-sm btn-icon" title={`Join ${m.link.service} and record`} aria-label={`Join ${m.link.service} and record`}
                        disabled={rec.status !== "idle"} onClick={() => void record(m, true)}>
                        <Icon name="arrowUpRight" size={15} />
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm btn-icon" title="Record" aria-label={`Record ${m.title}`}
                      disabled={rec.status !== "idle" || busy === m.id} onClick={() => void record(m, false)}>
                      <Icon name="mic" size={15} />
                    </button>
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
        {line > 0 && line === today.length && nowLine}
      </ul>
      <p className="group-label px-3 pb-1 pt-3">Talks</p>
    </section>
  );
}

// ---- Settings ------------------------------------------------------------------------

export function CalendarPanel() {
  const cal = useCalendar();
  const google = useGoogleSync();
  if (cal.status === "unavailable") return null;

  if (cal.status !== "connected") {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Google Calendar</p>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            See your next meeting on Today and today&apos;s on the Meetings page, and record one in a click with its name and who&apos;s invited.
            Four Notes only reads your calendar&apos;s events.
          </p>
        </div>
        <GoogleButton onClick={connectCalendar} label="Connect calendar" disabled={cal.status === "checking"} />
        {cal.error && <p className="text-[13px] text-[var(--danger)]" role="alert">{cal.error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon name="calendar" size={18} />
        <span className="font-medium">Google Calendar</span>
        <span className="badge badge-dot badge-success">Connected</span>
        {cal.email && <span className="min-w-0 truncate text-[13px] text-[var(--text-muted)]">{cal.email}</span>}
      </div>
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Your primary calendar&apos;s meetings, read when Today or Meetings shows, at most every five minutes. Nothing from it is kept on
        Four Notes&apos; server.
      </p>
      {cal.error && <p className="text-[13px] text-[var(--danger)]" role="alert">{cal.error}</p>}
      <div className="flex flex-wrap gap-2">
        {/* Signed in only for the calendar: sign out of Google too. Syncing: sync keeps going. */}
        <button className="btn btn-secondary max-md:h-11" onClick={() => void disconnectCalendar(!google.email)}>
          Disconnect calendar
        </button>
      </div>
    </div>
  );
}
