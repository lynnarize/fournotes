"use client";
// Android's back gesture/button (and iOS's swipe back) is browser history. Without
// entries of our own, the first back leaves the page — and an installed PWA just
// closes. So each open layer (drawer, dialog, palette, chat panel) adds a history
// entry, and each tab switch adds one too. Back then closes the top layer, walks
// back through tabs, and only leaves the app at the first screen.
//
// history.back() is asynchronous, so a back and a push that start in the same React
// commit (closing the drawer while switching tab) would interleave and leave history
// out of step with the UI. Every history change therefore goes through one queue.
import { useEffect, useRef } from "react";

/** `close` returns true when it handled back but the layer is still open (e.g. a
 *  wizard stepping back), so a fresh entry is pushed for the next press. */
type Layer = { id: string; close: () => boolean | void };

const layers: Layer[] = [];
let seq = 0;
/** Set when we call history.back() ourselves, so the handler ignores that event. */
let ignoreNextPop = false;
let tabHandler: ((tab: string) => void) | null = null;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", (e) => {
    if (ignoreNextPop) {
      ignoreNextPop = false;
      return;
    }
    const top = layers.pop();
    if (top) {
      if (top.close() === true) {
        layers.push(top);
        enqueue(() => history.pushState({ fnLayer: top.id }, ""));
      }
      return;
    }
    const tab = (e.state as { fnTab?: string } | null)?.fnTab;
    if (tab) tabHandler?.(tab);
  });
}

// ---- One-at-a-time history changes -------------------------------------------
let chain: Promise<void> = Promise.resolve();
const enqueue = (op: () => void | Promise<void>) => {
  chain = chain.then(op).catch(() => {});
};

/** Go back one entry and wait for it to land, so the next change starts after it. */
function backAndWait(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", finish);
      resolve();
    };
    window.addEventListener("popstate", finish);
    ignoreNextPop = true;
    history.back();
    // Nothing to go back to (or the browser ignored it): don't block the queue.
    setTimeout(() => {
      ignoreNextPop = false;
      finish();
    }, 600);
  });
}

/**
 * While `open`, back closes this layer instead of leaving the app.
 * Closing it from the UI removes the entry again, so back never needs two presses.
 */
export function useBackDismiss(open: boolean, close: () => boolean | void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    install();
    const layer: Layer = { id: `layer-${++seq}`, close: () => closeRef.current() };
    layers.push(layer);
    enqueue(() => history.pushState({ fnLayer: layer.id }, ""));

    return () => {
      const i = layers.indexOf(layer);
      if (i === -1) return; // a back press already removed it
      layers.splice(i, 1);
      enqueue(() => {
        if ((history.state as { fnLayer?: string } | null)?.fnLayer !== layer.id) return;
        return backAndWait();
      });
    };
  }, [open]);
}

/** Keeps the current tab in history, so back returns to the previous tab. */
export function useTabHistory(tab: string, setTab: (tab: string) => void) {
  const setRef = useRef(setTab);
  setRef.current = setTab;
  // What history believes is showing; stops a back-driven change from pushing again.
  const shown = useRef(tab);

  useEffect(() => {
    install();
    tabHandler = (t) => {
      shown.current = t;
      setRef.current(t);
    };
    enqueue(() => {
      const state = history.state as { fnTab?: string } | null;
      if (!state?.fnTab) history.replaceState({ ...(state ?? {}), fnTab: shown.current }, "");
    });
    return () => { tabHandler = null; };
  }, []);

  useEffect(() => {
    if (tab === shown.current) return;
    shown.current = tab;
    enqueue(() => history.pushState({ fnTab: tab }, ""));
  }, [tab]);
}
