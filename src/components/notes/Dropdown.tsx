"use client";
// Toolbar menus for the Notes editor. Rendered in a portal with fixed positioning,
// so they aren't clipped by the toolbar's horizontal scroll on phones, and every
// control prevents mousedown so the editor keeps its text selection.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";

const keep = (e: React.MouseEvent) => e.preventDefault();

export function Dropdown({ label, button, children, width = 240, title }: {
  label: string;
  button: ReactNode;
  /** Receives `close` so items can dismiss the menu. */
  children: (close: () => void) => ReactNode;
  width?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const top = r.bottom + 6;
    setPos({ top, left, maxHeight: Math.max(160, window.innerHeight - top - 12) });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={keep}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        className={`tb-btn gap-1 px-2 ${open ? "bg-[var(--hover)] text-[var(--text)]" : ""}`}
      >
        {button}
        <Icon name="chevronDown" size={14} className="opacity-60" />
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onMouseDown={keep}
            className="fn-pop scroll-thin fixed z-[80] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] p-1.5 text-sm shadow-[var(--shadow)]"
            style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({ icon, label, hint, active, danger, onSelect }: {
  icon?: string; label: string; hint?: string; active?: boolean; danger?: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={keep}
      onClick={onSelect}
      className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left hover:bg-[var(--hover)] ${danger ? "text-[var(--danger)]" : ""}`}
    >
      {icon && <Icon name={icon} size={17} className={danger ? "" : "text-[var(--muted)]"} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-[var(--faint)]">{hint}</span>}
      {active && <Icon name="check" size={15} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}

export const MenuSep = () => <div className="my-1 h-px bg-[var(--line)]" role="separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">{children}</div>
);
