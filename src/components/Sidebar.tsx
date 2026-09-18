"use client";
import { usePulsingTabs } from "@/lib/highlight";
import { isMac } from "@/lib/hooks";
import { alive, localMonth, useStore } from "@/lib/store";
import type { Tab } from "@/lib/types";
import { useAssistant } from "./assistant";
import { useCloud } from "./cloud";
import { GOOGLE_STATUS_LABEL, useGoogleSync } from "./googleSync";
import ScanPicker from "./ScanPicker";
import Logo from "./Logo";
import { Icon } from "./ui";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "today" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "todo", label: "To-Do", icon: "todo" },
  { id: "finance", label: "Finance", icon: "finance" },
];

const STATUS_LABEL = { off: "", "signed-out": "Not synced", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error" } as const;

export default function Sidebar({ tab, setTab, onClose, onSearch, onSettings }: {
  tab: Tab; setTab: (t: Tab) => void; onClose?: () => void; onSearch: () => void; onSettings: () => void;
}) {
  const { notes, todos, transactions, spaces, currentSpaceId, switchSpace } = useStore();
  const { scan, recording, startRecording, stopRecording, busy, voice, toggleVoice } = useAssistant();
  const cloud = useCloud();
  const google = useGoogleSync();
  const syncState = google.email ? google.status : cloud.enabled ? cloud.status : null;
  const syncTone = syncState === "error" ? "text-[var(--danger)]" : syncState === "synced" ? "text-[var(--ok)]" : "";
  const month = localMonth();
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const counts: Record<Tab, number> = {
    today: alive(todos).filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= endToday).length,
    notes: alive(notes).length,
    todo: alive(todos).filter((t) => !t.done).length,
    finance: alive(transactions).filter((t) => t.date.startsWith(month)).length,
  };
  const go = (t: Tab) => { setTab(t); onClose?.(); };
  const pulsing = usePulsingTabs();
  // In the phone drawer, rows follow the slide-in one after another.
  const enter = (i: number) => (onClose ? { animationDelay: `${90 + i * 35}ms` } : undefined);

  return (
    <nav className={`flex h-full flex-col bg-[var(--panel)] px-2 py-3 text-sm ${onClose ? "w-72 max-w-[85vw] pt-[calc(env(safe-area-inset-top)+12px)]" : "w-60"}`}>
      <div className="mb-4 flex items-center justify-between px-1 py-1">
        <button className="flex items-center gap-2.5 rounded-lg p-1 hover:bg-[var(--hover)]" onClick={() => go("today")} aria-label="Four Notes, go to Today">
          <Logo size={48} className="shrink-0" />
          <span className="whitespace-nowrap text-[22px] font-bold leading-none tracking-tight">Four Notes</span>
        </button>
        {onClose && (
          <button className="tap-target fn-press fn-pop md:hidden" style={{ animationDelay: "120ms" }} onClick={onClose} aria-label="Close menu"><Icon name="x" size={20} /></button>
        )}
      </div>

      {cloud.enabled && (spaces.length > 0 || cloud.email) && (
        <label className="mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]">
          <Icon name="users" size={14} />
          <select value={currentSpaceId ?? ""} onChange={(e) => switchSpace(e.target.value || null)} aria-label="Space"
            className="min-w-0 flex-1 bg-transparent text-[var(--text)]">
            <option value="">Personal</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      <button className="touch-row mb-3 flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-[var(--muted)] hover:text-[var(--text)]"
        onClick={() => { onSearch(); onClose?.(); }}>
        <Icon name="search" size={14} />
        <span className="flex-1 text-left">Search or quick add</span>
        <kbd>{isMac() ? "⌘" : "Ctrl"} K</kbd>
      </button>

      {TABS.map((t, i) => (
        <button
          key={t.id}
          onClick={() => go(t.id)}
          style={enter(i)}
          className={`${onClose ? "fn-rise" : ""} touch-row mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${
            tab === t.id ? "bg-[var(--hover)] font-medium text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"
          }`}
          aria-current={tab === t.id ? "page" : undefined}
        >
          <Icon name={t.icon} />
          <span className="flex-1">{t.label}</span>
          {pulsing.includes(t.id) && tab !== t.id && <span className="fn-ping relative" aria-label="New from the assistant" />}
          <span className="text-xs text-[var(--faint)]">{counts[t.id] || ""}</span>
        </button>
      ))}

      <div className="mt-6 px-2 text-xs font-medium text-[var(--faint)]">Quick capture</div>
      <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
        {(pick) => (
          <button className="touch-row mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={pick} disabled={!!busy}>
            <Icon name="scan" /> Scan receipt / note
          </button>
        )}
      </ScanPicker>
      <button className="touch-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"
        onClick={recording ? stopRecording : startRecording} disabled={(!!busy && !recording) || voice !== "off"}>
        <Icon name={recording ? "stop" : "mic"} className={recording ? "text-[var(--danger)]" : ""} />
        {recording ? "Stop recording" : "Record to note"}
      </button>
      <button className="touch-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"
        onClick={toggleVoice} disabled={recording}>
        <Icon name="wave" className={voice !== "off" ? "text-[var(--accent)]" : ""} />
        {voice !== "off" ? "End voice mode" : "Voice assistant"}
      </button>

      <div className="mt-auto space-y-1">
        {(google.enabled || cloud.enabled) && (
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--faint)] hover:bg-[var(--hover)]" onClick={() => { onSettings(); onClose?.(); }}
            title={(google.email ? google.error : cloud.error) ?? undefined}>
            <Icon name="cloud" size={13} className={`shrink-0 ${syncTone}`} />
            <span className="truncate">
              {google.email
                ? `${GOOGLE_STATUS_LABEL[google.status]} · Google Drive`
                : cloud.enabled && cloud.email
                  ? `${STATUS_LABEL[cloud.status]} · ${cloud.email}`
                  : "Turn on sync"}
            </span>
          </button>
        )}
        <button className="touch-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => { onSettings(); onClose?.(); }}>
          <Icon name="settings" /> Settings
        </button>
        <div className="flex gap-3 px-2 pt-1 text-[11px] text-[var(--faint)]">
          <a href="/privacy" className="hover:text-[var(--text)] hover:underline">Privacy</a>
          <a href="/terms" className="hover:text-[var(--text)] hover:underline">Terms</a>
        </div>
      </div>
    </nav>
  );
}
