"use client";
// Jump to a specific note, task or transaction from anywhere (search, backlinks,
// daily brief). The page switches tab; the view selects the item when it mounts.
import { useEffect, useRef } from "react";

export type FocusKind = "note" | "todo" | "transaction";
export type Focus = { kind: FocusKind; id: string };

const EVT = "four-notes:open";
let pending: Focus | null = null;

export function openItem(kind: FocusKind, id: string) {
  pending = { kind, id };
  window.dispatchEvent(new CustomEvent<Focus>(EVT, { detail: pending }));
}

/** Views pass their kind; the page shell passes "any" to switch tabs. */
export function useOpenItem(kind: FocusKind | "any", cb: (f: Focus) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const take = (f: Focus | null) => {
      if (!f) return;
      if (kind === "any") return ref.current(f);
      if (f.kind === kind) {
        pending = null;
        ref.current(f);
      }
    };
    if (kind !== "any") take(pending);
    const onOpen = (e: Event) => take((e as CustomEvent<Focus>).detail);
    window.addEventListener(EVT, onOpen);
    return () => window.removeEventListener(EVT, onOpen);
  }, [kind]);
}
