"use client";
// The sidebar sits on the frame and holds places only: the five tabs, recent notes and spaces,
// with Settings and sync in the footer. Starting something lives in the toolbar's omnibar.
// On phones the same sidebar is a drawer behind the header's mark.
import { useEffect, useState } from "react";
import { usePulsingTabs } from "@/lib/highlight";
import { isMac } from "@/lib/hooks";
import { openItem, openSettings as openSettingsAt } from "@/lib/nav";
import { alive, localMonth, useStore } from "@/lib/store";
import { useTalks } from "@/lib/talks/db";
import { useRecordingLabel } from "@/lib/talks/recorder";
import type { Tab } from "@/lib/types";
import { wipeThisDevice } from "@/lib/wipe";
import { useAssistant } from "./assistant";
import { useCloud } from "./cloud";
import { GOOGLE_STATUS_LABEL, useGoogleSync } from "./googleSync";
import { Dropdown, MenuItem, MenuLabel, MenuSep } from "./notes/Dropdown";
import ScanPicker from "./ScanPicker";
import Logo from "./Logo";
import TypeToConfirm from "./TypeToConfirm";
import { Icon, useToast } from "./ui";

// Today, then calendar and tasks together, then meetings, notes and money. The ids stay the
// pages' old names ("todo", "transcribe", "finance"), as they're kept in storage and links.
export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "today" },
  { id: "todo", label: "Planner", icon: "planner" },
  { id: "transcribe", label: "Meetings", icon: "wave" },
  { id: "notes", label: "Notes", icon: "lines" },
  { id: "finance", label: "Money", icon: "wallet" },
];

const STATUS_LABEL = { off: "", "signed-out": "Not synced", syncing: "Syncing…", synced: "Synced", offline: "Offline", error: "Sync error" } as const;

/** Up and down chevrons: this opens a list to switch between. */
export const ChevronsUpDown = ({ size = 16, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </svg>
);

/** Kit nav row; 44px tall in the phone drawer. */
const ROW = "nav-row w-full text-left disabled:opacity-45 disabled:hover:bg-transparent max-md:h-11";

export default function Sidebar({ tab, setTab, onClose, onSearch, onSettings }: {
  tab: Tab; setTab: (t: Tab) => void; onClose?: () => void; onSearch: () => void; onSettings: () => void;
}) {
  const store = useStore();
  const { notes, todos, transactions, spaces, currentSpaceId, switchSpace } = store;
  const talks = useTalks();
  const { scan, recording, startRecording, stopRecording } = useAssistant();
  const cloud = useCloud();
  const google = useGoogleSync();
  const month = localMonth();
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const counts: Record<Tab, number> = {
    today: alive(todos).filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= endToday).length,
    notes: alive(notes).length,
    todo: alive(todos).filter((t) => !t.done).length,
    finance: alive(transactions).filter((t) => t.date.startsWith(month)).length,
    transcribe: talks.filter((t) => !t.deletedAt && (t.spaceId ?? null) === currentSpaceId).length,
  };
  const recordingFor = useRecordingLabel();
  const go = (t: Tab) => { setTab(t); onClose?.(); };
  const search = () => { onSearch(); onClose?.(); };
  const openSettings = () => { onSettings(); onClose?.(); };
  const syncSettings = () => { onClose?.(); openSettingsAt("sync"); };
  const pulsing = usePulsingTabs();
  // Shortcut labels depend on the platform, which the server can't know: set after mount.
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);
  // In the phone drawer, rows follow the slide-in one after another.
  const enter = (i: number) => (onClose ? { animationDelay: `${90 + i * 35}ms` } : undefined);

  const spaceLabel = spaces.find((s) => s.id === currentSpaceId)?.name ?? "Personal";

  // Making something from outside its own tab: each one opens what it made.
  const newNote = () => { const n = store.addNote({ title: "" }); setTab("notes"); openItem("note", n.id); onClose?.(); };
  const newTask = () => { const t = store.addTodo({ title: "" }); setTab("todo"); openItem("todo", t.id); onClose?.(); };
  const newTransaction = () => { const t = store.addTransaction({ merchant: "" }); setTab("finance"); openItem("transaction", t.id); onClose?.(); };
  const record = () => { recording ? stopRecording() : startRecording(); onClose?.(); };

  // Signed in means Google Drive sync or a Supabase account; sign-out ends both, and keeps what's on this device.
  const signedInAs = google.email ?? cloud.email ?? null;
  const syncAvailable = google.enabled || cloud.enabled;
  const toast = useToast();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const accountSync = google.email ? google.status : cloud.status;
  /** Sign out, then erase this browser's copy. The synced copy stays and comes back on the next sign-in. */
  const signOutAndWipe = async () => {
    if (google.email) await google.disconnect(false);
    if (cloud.email) await cloud.signOut();
    await wipeThisDevice();
  };
  const signOut = async () => {
    if (google.email) await google.disconnect(false);
    if (cloud.email) {
      await cloud.signOut();
      toast("Signed out. Your data stays on this device.");
    }
    onClose?.();
  };

  const identity = (
    <>
      <Logo size={30} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-[var(--foreground)]">Four Notes</span>
        <span className="truncate text-xs text-[var(--text-muted)]">{spaceLabel}</span>
      </span>
    </>
  );

  // Where the data lives, and how to change that.
  const syncState = google.email ? google.status : cloud.email ? cloud.status : null;
  const syncTone = syncState === "error" ? "text-[var(--spark)]" : syncState === "synced" ? "text-[#5fb97f]" : "";
  const syncText = google.email
    ? `${GOOGLE_STATUS_LABEL[google.status]} · Google Drive`
    : cloud.email
      ? `${STATUS_LABEL[cloud.status]} · ${cloud.email}`
      : "Saved on this device";
  const syncShort = google.email ? GOOGLE_STATUS_LABEL[google.status] : cloud.email ? STATUS_LABEL[cloud.status] : "Not synced";

  // The newest notes, one click from anywhere.
  const recent = alive(notes).filter((n) => n.title.trim()).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 3);
  const openNote = (id: string) => { setTab("notes"); openItem("note", id); onClose?.(); };

  return (
    <nav
      aria-label={onClose ? "Menu" : "Main"}
      className={`on-frame scroll-thin flex h-full flex-col gap-0.5 overflow-y-auto text-sm ${
        onClose ? "w-[86vw] max-w-[22rem] bg-[var(--frame)] px-3 pb-4 pt-[calc(env(safe-area-inset-top)+14px)]" : "w-[236px] pt-0.5"
      }`}
    >
      {/* The phone drawer has no toolbar above it: the mark and the way out go here. */}
      {onClose && (
        <div className="mb-3 flex items-center gap-1">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 pl-1.5 pr-2.5">{identity}</div>
          <button className="rnd fn-pop" style={{ animationDelay: "120ms" }} onClick={onClose} aria-label="Close menu">
            <Icon name="x" size={20} />
          </button>
        </div>
      )}

      {/* The places. The count gives way to a menu of quick actions while a row is in use. */}
      <ul className="flex flex-col gap-0.5">
        {TABS.map((t, i) => {
          const selected = tab === t.id;
          const pulse = pulsing.includes(t.id) && !selected;
          // In the phone drawer there's no hover: the open tab keeps its menu showing.
          const menuAlways = selected && !!onClose;
          return (
            <li key={t.id} style={enter(i)} className={`${onClose ? "fn-rise" : ""} group relative`}>
              <button type="button" onClick={() => go(t.id)} aria-current={selected ? "page" : undefined} className={ROW}>
                <Icon name={t.icon} size={18} className="shrink-0" />
                <span className="truncate">{t.label}</span>
                <span className="flex-1" />
                {t.id === "transcribe" && recordingFor && (
                  <span className="fn-num flex items-center gap-1.5 pr-0.5 text-xs text-[var(--spark)]">
                    <span className="recording h-1.5 w-1.5 rounded-full bg-[var(--spark)]" aria-hidden />
                    {recordingFor}<span className="sr-only">, recording</span>
                  </span>
                )}
                {pulse && (
                  <span className="relative grid h-4 w-4 shrink-0 place-items-center">
                    <span className="fn-ping relative" aria-hidden />
                    <span className="sr-only">, new from the assistant</span>
                  </span>
                )}
                {counts[t.id] > 0 && !(t.id === "transcribe" && recordingFor) && (
                  <span
                    className={`fn-num pr-0.5 text-xs font-normal text-[var(--frame-label)] ${
                      menuAlways ? "invisible" : "group-hover:invisible group-has-[:focus-visible]:invisible group-has-[[aria-expanded=true]]:invisible"
                    }`}
                  >
                    {counts[t.id]}
                  </span>
                )}
              </button>
              <span
                className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity ${
                  menuAlways ? "" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-has-[[aria-expanded=true]]:opacity-100"
                }`}
              >
                <Dropdown
                  label={`${t.label} actions`}
                  width={230}
                  align="right"
                  chevron={false}
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--frame-muted)] hover:bg-[var(--frame-3)] hover:text-[var(--frame-text)] max-md:h-9 max-md:w-9"
                  button={<Icon name="more" size={18} />}
                >
                  {(close) => (
                    <>
                      {t.id === "today" && (
                        <>
                          <MenuItem icon="today" label="Open Today" onSelect={() => { close(); go("today"); }} />
                          <MenuItem icon="search" label="Search or quick add…" onSelect={() => { close(); search(); }} />
                        </>
                      )}
                      {t.id === "notes" && (
                        <>
                          <MenuItem icon="noteAdd" label="New note" onSelect={() => { close(); newNote(); }} />
                          <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
                            {(pick) => <MenuItem icon="scan" label="Scan a note…" onSelect={() => { close(); pick(); }} />}
                          </ScanPicker>
                          <MenuItem icon={recording ? "stop" : "mic"} label={recording ? "Stop recording" : "Record to note"} onSelect={() => { close(); record(); }} />
                        </>
                      )}
                      {t.id === "todo" && <MenuItem icon="todo" label="New task" onSelect={() => { close(); newTask(); }} />}
                      {t.id === "transcribe" && <MenuItem icon="mic" label="Record a talk" onSelect={() => { close(); go("transcribe"); }} />}
                      {t.id === "finance" && (
                        <>
                          <MenuItem icon="finance" label="New transaction" onSelect={() => { close(); newTransaction(); }} />
                          <ScanPicker onFile={(f) => { onClose?.(); scan(f); }}>
                            {(pick) => <MenuItem icon="scan" label="Scan a receipt…" onSelect={() => { close(); pick(); }} />}
                          </ScanPicker>
                        </>
                      )}
                    </>
                  )}
                </Dropdown>
              </span>
            </li>
          );
        })}
      </ul>

      {recent.length > 0 && (
        <>
          <p className="frame-label">Recent</p>
          <ul className="flex flex-col gap-0.5">
            {recent.map((n) => (
              <li key={n.id}>
                <button type="button" className={ROW} onClick={() => openNote(n.id)}>
                  <Icon name="note" size={18} className="shrink-0" />
                  <span className="truncate">{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Shared spaces (Supabase) are only there once signed in. */}
      {spaces.length > 0 && (
        <>
          <p className="frame-label">Spaces</p>
          <ul className="flex flex-col gap-0.5">
            {[{ id: null as string | null, name: "Personal" }, ...spaces].map((s) => (
              <li key={s.id ?? "personal"}>
                <button type="button" className={ROW} aria-current={currentSpaceId === s.id ? "true" : undefined} onClick={() => { switchSpace(s.id); onClose?.(); }}>
                  <Icon name="users" size={18} className="shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <span className="min-h-4 flex-1" aria-hidden />

      {/* Settings, and where the data lives. Signed in, the status opens the account menu. */}
      <div className="flex items-center gap-1">
        <button type="button" className={`${ROW} !h-8 w-auto flex-1 !text-[13px] !text-[var(--frame-muted)]`} onClick={openSettings} aria-keyshortcuts={mac ? "Meta+Comma" : "Control+Comma"}>
          <Icon name="settings" size={16} className="shrink-0" />
          Settings
        </button>
        {signedInAs || syncAvailable ? (
          <Dropdown
            label={signedInAs ? `Account, ${signedInAs}` : "Sync"}
            title={(google.email ? google.error : cloud.error) ?? syncText}
            width={260}
            align="right"
            chevron={false}
            className="flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-[var(--frame-muted)] transition-colors hover:bg-[var(--frame-2)] max-md:h-11"
            button={<><Icon name="cloud" size={15} className={`shrink-0 ${syncTone}`} /><span className="truncate">{syncShort}</span></>}
          >
            {(close) => (
              <>
                {signedInAs ? (
                  <>
                    <MenuLabel>{signedInAs}</MenuLabel>
                    <MenuItem icon="cloud" label="Sync settings" onSelect={() => { close(); syncSettings(); }} />
                    <MenuSep />
                    <MenuItem icon="logout" label="Sign out" onSelect={() => { close(); void signOut(); }} />
                    {/* Someone else's or a shared computer: leave nothing behind. */}
                    <MenuItem icon="trash" label="Sign out and remove data…" danger onSelect={() => { close(); setConfirmWipe(true); }} />
                  </>
                ) : (
                  <MenuItem icon="cloud" label="Sign in to sync and share" onSelect={() => { close(); syncSettings(); }} />
                )}
              </>
            )}
          </Dropdown>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 text-[13px] text-[var(--frame-muted)]"><Icon name="cloud" size={15} className="shrink-0" />On this device</span>
        )}
      </div>

      <TypeToConfirm
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Sign out and remove data?"
        confirmLabel="Sign out and remove"
        onConfirm={signOutAndWipe}
      >
        <p>
          For a shared or public computer: this signs <strong className="font-medium">{signedInAs}</strong> out and erases everything Four Notes keeps in this
          browser: notes, tasks, spending, settings and saved API keys.
        </p>
        <p className="text-[var(--text-secondary)]">
          The synced copy in your account is kept, and comes back when you sign in again.
          {accountSync !== "synced" && (
            <> <strong className="font-medium text-[var(--danger)]">Some changes may not have synced yet</strong> ({accountSync}); they would be lost. Sync first if you can.</>
          )}
        </p>
      </TypeToConfirm>
    </nav>
  );
}
