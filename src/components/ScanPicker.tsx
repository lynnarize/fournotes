"use client";
// Scan button behaviour: on phones and tablets, ask whether to take a photo with
// the camera or pick an existing image; on desktop, open the file picker directly.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

function useTouchDevice() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return touch;
}

export default function ScanPicker({ onFile, children }: { onFile: (file: File) => void; children: (open: () => void) => ReactNode }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const touch = useTouchDevice();

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const open = () => (touch ? setSheet(true) : filesRef.current?.click());
  const choose = (input: HTMLInputElement | null) => {
    setSheet(false);
    input?.click();
  };
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  };

  const option = (icon: string, title: string, hint: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--hover)] active:bg-[var(--hover)]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--hover)] text-[var(--text)]">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      </span>
    </button>
  );

  return (
    <>
      {children(open)}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={filesRef} type="file" accept="image/*" hidden onChange={picked} />
      {sheet && typeof document !== "undefined" &&
        createPortal(
          <div className="no-print fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={() => setSheet(false)}>
            <div
              role="dialog"
              aria-modal
              aria-label="Scan"
              className="w-full max-w-md rounded-t-2xl border border-b-0 border-[var(--line)] bg-[var(--bg)] px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 shadow-[var(--shadow)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line)]" />
              <p className="px-3 pb-1 text-sm font-semibold">Scan</p>
              <p className="px-3 pb-2 text-xs text-[var(--muted)]">A receipt, a handwritten note, or an e-wallet screenshot</p>
              {option("camera", "Take a photo", "Open the camera", () => choose(cameraRef.current))}
              {option("image", "Choose from files", "Gallery, photos or file manager", () => choose(filesRef.current))}
              <button type="button" onClick={() => setSheet(false)} className="mt-1 w-full rounded-xl py-3 text-[15px] font-medium text-[var(--muted)] hover:bg-[var(--hover)]">
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
