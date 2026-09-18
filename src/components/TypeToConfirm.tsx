"use client";
// Confirmation for actions that permanently delete data: the button stays disabled
// until the user types the confirmation word, so it can't be done by a stray tap.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, inputBox, Modal } from "./ui";

export default function TypeToConfirm({ open, onClose, title, children, word = "delete", confirmLabel, onConfirm }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What will be deleted and what is kept. */
  children: ReactNode;
  word?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = typed.trim().toLowerCase() === word.toLowerCase();

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setWorking(false);
    const t = setTimeout(() => inputRef.current?.focus(), 250); // after the open animation
    return () => clearTimeout(t);
  }, [open]);

  const confirm = async () => {
    if (!ready || working) return;
    setWorking(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !working && onClose()} title={title}>
      <form
        className="space-y-4 p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <div className="flex gap-3 rounded-lg p-3" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
          <Icon name="trash" size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <div className="space-y-1.5 leading-relaxed">{children}</div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[var(--muted)]">
            Type <strong className="font-semibold text-[var(--text)]">{word}</strong> to confirm
          </span>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`Type ${word} to confirm`}
            className={`${inputBox} h-11 w-full`}
          />
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="min-h-11 rounded-md border border-[var(--line)] px-4 hover:bg-[var(--hover)] sm:min-h-9" onClick={onClose} disabled={working}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || working}
            className="min-h-11 rounded-md bg-[var(--danger)] px-4 font-medium text-white transition-opacity disabled:opacity-40 sm:min-h-9"
          >
            {working ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
