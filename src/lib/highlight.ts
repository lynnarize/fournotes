"use client";
// Briefly highlights whatever the assistant just created, so it's obvious where
// a chat message, photo or recording ended up.
import { useEffect, useState } from "react";

const DURATION = 2200;
const until = new Map<string, number>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((f) => f());

/** Called after the assistant files items; ids are note/task/transaction/sticky ids. */
export function markFiled(ids: string[]) {
  if (!ids.length) return;
  const expiry = Date.now() + DURATION;
  for (const id of ids) until.set(id, expiry);
  notify();
  setTimeout(() => {
    const now = Date.now();
    for (const [id, expires] of until) if (expires <= now) until.delete(id);
    notify();
  }, DURATION + 50);
}

/** True while this item should show the "just filed" highlight. */
export function useFiledFlash(id: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const update = () => setOn((until.get(id) ?? 0) > Date.now());
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [id]);
  return on;
}

// ---- Tabs that just received something (a dot pulses on them for a few seconds) ----
const TAB_PULSE = 6000;
const tabUntil = new Map<string, number>();
const tabListeners = new Set<() => void>();

export function pulseTabs(tabs: string[]) {
  if (!tabs.length) return;
  const expiry = Date.now() + TAB_PULSE;
  for (const t of tabs) tabUntil.set(t, expiry);
  tabListeners.forEach((f) => f());
  setTimeout(() => tabListeners.forEach((f) => f()), TAB_PULSE + 50);
}

/** Tabs currently pulsing ("today" | "notes" | "todo" | "finance"). */
export function usePulsingTabs() {
  const [tabs, setTabs] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setTabs([...tabUntil].filter(([, t]) => t > Date.now()).map(([k]) => k));
    update();
    tabListeners.add(update);
    return () => { tabListeners.delete(update); };
  }, []);
  return tabs;
}

/** Class to add to a row that was just filed (empty string when it wasn't). */
export const flashClass = (on: boolean) => (on ? "fn-flash" : "");
