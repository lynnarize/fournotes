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

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
