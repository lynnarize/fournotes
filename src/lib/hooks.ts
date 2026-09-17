"use client";
import { useEffect, useReducer, useState } from "react";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// ---- "Install app" prompt (Chrome/Edge/Android) ----------------------------
type InstallEvent = Event & { prompt(): Promise<void> };
let deferred: InstallEvent | null = null;
const subscribers = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    subscribers.forEach((f) => f());
  });
}

/** Returns a function that shows the install prompt, or null when unavailable. */
export function useInstallPrompt() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(rerender);
    return () => { subscribers.delete(rerender); };
  }, []);
  if (!deferred) return null;
  return async () => {
    await deferred?.prompt();
    deferred = null;
    subscribers.forEach((f) => f());
  };
}

/**
 * Keeps a pop-up mounted for `ms` after it's closed so it can animate out.
 * `state` goes on the element as data-state ("open" | "closing") for the CSS.
 */
export function usePresence(open: boolean, ms = 200) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    if (!mounted) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setMounted(false), reduce ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, mounted, ms]);
  return { mounted: open || mounted, state: (open ? "open" : "closing") as "open" | "closing" };
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
