"use client";
// Short hints for new users. These are guidance, not data: they live in a
// dismissible strip instead of being written into the user's notes.
import { useEffect, useState } from "react";
import { alive, useStore } from "@/lib/store";
import { Icon } from "./ui";

const KEY = "four-notes:tips-dismissed";

const TIPS: { icon: string; text: string }[] = [
  { icon: "sparkle", text: "Ask below: “remind me to pay rent every month on the 5th”" },
  { icon: "scan", text: "Tap Scan to photograph a receipt — it lands in Finance" },
  { icon: "search", text: "⌘K / Ctrl+K to search everything or quick-add" },
  { icon: "note", text: "Type / inside a note for commands like /todo" },
];

export default function TipStrip() {
  const { notes, todos, transactions, ready } = useStore();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY) === "1"); } catch { setDismissed(false); }
  }, []);

  // Once someone is using the app, the tips stop showing on their own.
  const items = alive(notes).length + alive(todos).length + alive(transactions).length;
  if (!ready || dismissed || items >= 6) return null;

  return (
    <div className="no-print flex items-start gap-2 px-4 pt-3 md:px-10">
      <div className="scroll-thin flex flex-1 gap-2 overflow-x-auto pb-1">
        {TIPS.map((t) => (
          <span key={t.text} className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">
            <Icon name={t.icon} size={12} />
            {t.text}
          </span>
        ))}
      </div>
      <button
        className="btn-ghost shrink-0"
        aria-label="Hide tips"
        onClick={() => {
          setDismissed(true);
          try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
