"use client";
// Collapsible settings group. Open/closed state is remembered per section.
import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon } from "./ui";

const STORE = "four-notes:settings-open";
const EVT = "four-notes:settings-toggle-all";

const readOpen = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { return {}; }
};
const persist = (id: string, open: boolean) => {
  try { localStorage.setItem(STORE, JSON.stringify({ ...readOpen(), [id]: open })); } catch { /* storage blocked */ }
};

export const setAllSettingsSections = (open: boolean) => window.dispatchEvent(new CustomEvent<boolean>(EVT, { detail: open }));

export default function SettingsSection({ id, title, icon, summary, defaultOpen = false, children }: {
  id: string;
  title: string;
  icon: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  useEffect(() => {
    const saved = readOpen();
    if (id in saved) setOpen(saved[id]);
    const onToggleAll = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setOpen(next);
      persist(id, next);
    };
    window.addEventListener(EVT, onToggleAll);
    return () => window.removeEventListener(EVT, onToggleAll);
  }, [id]);

  const toggle = () => {
    setOpen((o) => {
      persist(id, !o);
      return !o;
    });
  };

  return (
    <section className="rounded-xl border border-[var(--line)]">
      <h3>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--hover)] ${open ? "rounded-t-xl" : "rounded-xl"}`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--hover)] text-[var(--muted)]">
            <Icon name={icon} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-[var(--text)]">{title}</span>
            {summary && <span className="block truncate text-xs text-[var(--muted)]">{summary}</span>}
          </span>
          <Icon name="chevron" size={16} className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </h3>
      {open && (
        <div id={contentId} className="border-t border-[var(--line)] px-3.5 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
