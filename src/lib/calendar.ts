"use client";
// Your meetings from Google Calendar, in this tab: read from /api/google/calendar when Today
// or Meetings shows, at most every five minutes, and kept only in memory. "Connect
// calendar" signs in for the calendar alone; Drive sync is its own sign-in.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { googleEnabled } from "./gdrive";
import type { CalendarMeeting } from "./meetings";
import { openTab } from "./nav";

export type CalendarStatus = "checking" | "unavailable" | "disconnected" | "connected";

export interface CalendarState {
  status: CalendarStatus;
  meetings: CalendarMeeting[];
  email: string | null;
  /** Why the last read didn't work, in words. The meetings from before stay. */
  error: string | null;
}

const REFRESH_MS = 5 * 60_000;
let state: CalendarState = { status: googleEnabled ? "checking" : "unavailable", meetings: [], email: null, error: null };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<CalendarState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Reads the calendar again, unless it was read in the last five minutes (`force` skips that). */
export function refreshCalendar(force = false): Promise<void> {
  if (!googleEnabled) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < REFRESH_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch("/api/google/calendar", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        connected?: boolean; available?: boolean; email?: string | null; meetings?: CalendarMeeting[]; error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Couldn't load your meetings.");
      fetchedAt = Date.now();
      if (json.connected) set({ status: "connected", meetings: json.meetings ?? [], email: json.email ?? null, error: null });
      else set({ status: json.available === false ? "unavailable" : "disconnected", meetings: [], email: null, error: json.error ?? null });
    } catch (e) {
      // Try again in a minute rather than five.
      fetchedAt = Date.now() - REFRESH_MS + 60_000;
      set({ status: state.status === "checking" ? "disconnected" : state.status, error: e instanceof Error ? e.message : "Couldn't load your meetings." });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The calendar's state; reads it when first shown, when the tab comes back, and then every five minutes. */
export function useCalendar(): CalendarState {
  const s = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
    () => state,
  );
  useEffect(() => {
    void refreshCalendar();
    const onShow = () => { if (document.visibilityState === "visible") void refreshCalendar(); };
    document.addEventListener("visibilitychange", onShow);
    const id = setInterval(() => void refreshCalendar(), 60_000);
    return () => { document.removeEventListener("visibilitychange", onShow); clearInterval(id); };
  }, []);
  return s;
}

export const connectCalendar = () => window.location.assign("/api/google/start?for=calendar");

/** Stops reading the calendar. `signOut`: nothing else uses Google here, so sign out of it too. */
export async function disconnectCalendar(signOut: boolean) {
  await fetch(`/api/google/calendar${signOut ? "?google=1" : ""}`, { method: "DELETE" }).catch(() => {});
  fetchedAt = Date.now();
  set({ status: "disconnected", meetings: [], email: null, error: null });
}

const RETURN_ERRORS: Record<string, string> = {
  denied: "Connecting the calendar was cancelled.",
  scope: "Four Notes needs permission to see your calendar's events. Connect again and allow it.",
  account: "Connect the calendar of the Google account this device syncs with.",
  state: "The sign-in link expired. Please try again.",
  offline: "Google didn't allow ongoing access. Please try connecting again.",
  config: "Google Calendar isn't set up on this server yet.",
  google: "Google sign-in failed. Please try again.",
};

/** Back from Google's consent screen (?calendar=connected or ?calendar=error): says how it went. Once, in the page shell. */
export function useCalendarReturn(toast: (text: string, tone?: "error") => void) {
  const ref = useRef(toast);
  ref.current = toast;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    const reason = params.get("reason") ?? "google";
    params.delete("calendar");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (result === "connected") {
      void refreshCalendar(true);
      ref.current("Calendar connected. Your next meeting is on Today.");
    } else {
      ref.current(RETURN_ERRORS[reason] ?? RETURN_ERRORS.google, "error");
    }
  }, []);
}

// ---- Recording a meeting from Today ------------------------------------------------------
// "Join and record" opens the call in a new tab, then the Meetings page's new-recording
// form waits with the meeting filled in: sharing the call's tab needs a click of its own,
// once that tab is there.

export type MeetingSetup = { meeting: CalendarMeeting; joined: boolean };

const SETUP_EVT = "four-notes:record-meeting";
let pendingSetup: MeetingSetup | null = null;

export function prepareRecording(meeting: CalendarMeeting, joined: boolean) {
  pendingSetup = { meeting, joined };
  openTab("transcribe");
  window.dispatchEvent(new Event(SETUP_EVT));
}

/** The Meetings page takes a meeting to record, when it mounts or when one arrives. */
export function useMeetingSetup(cb: (setup: MeetingSetup) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const take = () => {
      if (!pendingSetup) return;
      const s = pendingSetup;
      pendingSetup = null;
      ref.current(s);
    };
    take();
    window.addEventListener(SETUP_EVT, take);
    return () => window.removeEventListener(SETUP_EVT, take);
  }, []);
}
