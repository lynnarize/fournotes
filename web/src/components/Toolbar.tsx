"use client";
// The toolbar on the frame: the mark, the sidebar toggle, new, back and forward on the left,
// and the omnibar in the middle. The omnibar is the one way in: it searches, asks and captures
// (⌘K), and Scan and Record live inside it.
import { useEffect, useState } from "react";
import { isMac } from "@/lib/hooks";
import { useAssistant } from "./assistant";
import Logo from "./Logo";
import ScanPicker from "./ScanPicker";
import { Icon } from "./ui";

export default function Toolbar({ sidebarOpen, onToggleSidebar, onOmni, onNew }: {
  sidebarOpen: boolean; onToggleSidebar: () => void; onOmni: () => void; onNew: () => void;
}) {
  const { scan, recording, startRecording, stopRecording, busy, voice } = useAssistant();
  // The shortcut's label depends on the platform, which the server can't know: set after mount.
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);

  return (
    <header className="on-frame hidden h-[66px] shrink-0 grid-cols-[1fr_minmax(0,600px)_1fr] items-center gap-3 px-4 md:grid">
      <div className="flex items-center gap-2">
        <Logo size={30} className="mx-1.5 shrink-0" />
        <button type="button" className="rnd" onClick={onToggleSidebar} aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarOpen}>
          <Icon name="sidebar" size={18} />
        </button>
        <button type="button" className="rnd" onClick={onNew} aria-label="New">
          <Icon name="compose" size={18} />
        </button>
        <button type="button" className="rnd" onClick={() => history.back()} aria-label="Back">
          <Icon name="chevronLeft" size={18} />
        </button>
        <button type="button" className="rnd" onClick={() => history.forward()} aria-label="Forward">
          <Icon name="chevron" size={18} />
        </button>
      </div>

      <div className="omni">
        <button type="button" onClick={onOmni} className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left" aria-label="Search, ask or capture anything">
          <Icon name="search" size={18} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[15px]">Search, ask or capture anything…</span>
        </button>
        <ScanPicker onFile={scan}>
          {(pick) => (
            <button type="button" className="omni-mini" onClick={pick} disabled={!!busy} aria-label="Scan" title="Scan a receipt, note, e-wallet screenshot or chat">
              <Icon name="scan" size={18} />
            </button>
          )}
        </ScanPicker>
        <button
          type="button"
          className={`omni-mini ${recording ? "!text-[var(--spark)]" : ""}`}
          onClick={() => (recording ? stopRecording() : startRecording())}
          disabled={(!!busy && !recording) || voice !== "off"}
          aria-label={recording ? "Stop recording" : "Record a voice note"}
          title={recording ? "Stop recording" : "Record a voice note"}
        >
          <Icon name={recording ? "stop" : "mic"} size={18} />
        </button>
        <span className="omni-kbd" aria-hidden>{mac ? "⌘K" : "Ctrl K"}</span>
      </div>

      <span aria-hidden />
    </header>
  );
}
