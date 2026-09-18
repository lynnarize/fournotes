"use client";
// Notes: a list of note cards beside a large editor. On phones the list comes
// first and a note opens full screen (back returns to the list).
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeNoteHasText } from "@/lib/activeNote";
import { useBackDismiss } from "@/lib/backstack";
import { useFiledFlash } from "@/lib/highlight";
import { usePresence } from "@/lib/hooks";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { snippet } from "@/lib/noteText";
import { semanticNotes } from "@/lib/search";
import { alive, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Dropdown, MenuItem } from "./notes/Dropdown";
import { Icon } from "./ui";

// The editor (and its library) loads only when Notes is opened.
const NoteEditor = dynamic(() => import("./notes/NoteEditor"), {
  ssr: false,
  loading: () => <div className="flex-1 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--panel)]" aria-label="Loading editor" />,
});

const SOURCE_LABEL: Record<Note["source"], string> = { manual: "", chat: "From chat", ocr: "Scanned", recording: "Recording", share: "Shared" };
const SORTS = { updated: "Last edited", created: "Date created", title: "Title (A–Z)" } as const;
type Sort = keyof typeof SORTS;
const PREFS = "four-notes:notes-view";

function timeAgo(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function NoteCard({ note, selected, linked, onOpen }: { note: Note; selected: boolean; linked: number; onOpen: () => void }) {
  const flash = useFiledFlash(note.id);
  const preview = snippet(note.content);
  return (
    <li id={`note-row-${note.id}`} className={flash ? "fn-flash" : ""}>
      <button
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-[8.5rem] w-full flex-col rounded-xl border px-4 py-3.5 text-left transition-colors ${
          selected ? "border-[var(--accent)] bg-[var(--bg)] shadow-[var(--shadow)]" : "border-transparent hover:bg-[var(--hover)]"
        }`}
      >
        <span className="line-clamp-1 text-[15px] font-semibold">{note.title || "Untitled"}</span>
        <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">{preview || <span className="text-[var(--faint)]">No text yet</span>}</span>
        <span className="mt-auto flex items-center gap-2 pt-3 text-xs text-[var(--faint)]">
          {timeAgo(note.updatedAt)}
          {SOURCE_LABEL[note.source] && <span className="chip">{SOURCE_LABEL[note.source]}</span>}
          {linked > 0 && <span className="flex items-center gap-0.5"><Icon name="link" size={11} />{linked}</span>}
          {note.tags.slice(0, 2).map((t) => <span key={t}>#{t}</span>)}
        </span>
      </button>
    </li>
  );
}

/** A note that was opened but never written in: no title, no text, no scan, nothing linked. */
const isBlank = (n: Note, todos: { noteId?: string | null; deletedAt?: string | null }[], txs: { noteId?: string | null; deletedAt?: string | null }[]) =>
  !n.deletedAt && (!n.title.trim() || n.title === "Untitled") && !n.content.trim() && !n.imageDataUrl &&
  !todos.some((t) => t.noteId === n.id && !t.deletedAt) && !txs.some((t) => t.noteId === n.id && !t.deletedAt);

export default function NotesView() {
  const { notes, todos, transactions, addNote, remove } = useStore();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [ranked, setRanked] = useState<{ q: string; ids: string[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("updated");
  const [listHidden, setListHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // Which transition the editor card plays: into / out of focus mode, or sliding in on phones.
  const [anim, setAnim] = useState<"focus-in" | "focus-out" | "settle" | undefined>();
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enterFocus = () => { clearTimeout(exitTimer.current); setFocusMode(true); setAnim("focus-in"); };
  const exitFocus = () => {
    if (!focusMode) return;
    setAnim("focus-out");
    clearTimeout(exitTimer.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = setTimeout(() => { setFocusMode(false); setAnim("settle"); }, reduce ? 0 : 170);
  };
  useEffect(() => () => clearTimeout(exitTimer.current), []);
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: the list folds away instead of vanishing.
  const listPresence = usePresence(!listHidden, 240);
  // Phones: the list slides back in when you return from a note (not on first load).
  const [returned, setReturned] = useState(false);

  // Remembered view preferences.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as { sort?: Sort; listHidden?: boolean };
      if (p.sort && p.sort in SORTS) setSort(p.sort);
      if (p.listHidden) setListHidden(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFS, JSON.stringify({ sort, listHidden })); } catch { /* storage blocked */ }
  }, [sort, listHidden]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  /** Leaving a note you never wrote in discards it, so "New note" doesn't pile up blanks. */
  const leave = (nextId: string | null) => {
    const current = selectedId && notes.find((n) => n.id === selectedId);
    if (!current || current.id === nextId) return;
    // Ask the open editor first: its latest typing may not be saved yet.
    if (activeNoteHasText(current.id) === true) return;
    if (isBlank(current, todos, transactions)) remove("notes", current.id);
  };
  const open = (id: string) => {
    leave(id);
    setSelectedId(id);
    setMobileOpen(true);
  };

  // Back closes the open note on phones, and leaves focus mode everywhere.
  useBackDismiss(mobile && mobileOpen && !focusMode, () => { leave(null); setMobileOpen(false); setReturned(true); setAnim(undefined); });
  useBackDismiss(focusMode && anim !== "focus-out", exitFocus);

  // Blanks left behind earlier (e.g. by switching tabs): clean them up when Notes opens.
  // Only ones older than a few seconds, and never the open note, so a note that was just
  // created (or React's development re-mount) is never touched.
  useEffect(() => {
    const cutoff = Date.now() - 10_000;
    for (const n of notes) {
      if (n.id !== selectedId && isBlank(n, todos, transactions) && new Date(n.updatedAt).getTime() < cutoff) remove("notes", n.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useOpenItem("note", (f) => {
    setQuery("");
    setSearching(false);
    open(f.id);
    scrollToId(`note-row-${f.id}`, "nearest");
  });

  // Search: instant substring filter, then ranking by meaning (or BM25) after a pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const h = setTimeout(() => {
      semanticNotes(notes, q, 30).then((r) => setRanked({ q, ids: r.map((x) => x.note.id) })).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
  }, [query, notes]);

  const list = useMemo(() => {
    const live = alive(notes);
    const q = query.trim().toLowerCase();
    if (!q) {
      const by = {
        updated: (a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt),
        created: (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt),
        title: (a: Note, b: Note) => (a.title || "Untitled").localeCompare(b.title || "Untitled"),
      }[sort];
      return [...live].sort(by);
    }
    const substring = live.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    if (ranked?.q.toLowerCase() !== q) return substring;
    const byId = new Map(live.map((n) => [n.id, n]));
    const out = ranked.ids.map((id) => byId.get(id)!).filter(Boolean);
    for (const n of substring) if (!out.includes(n)) out.push(n);
    return out;
  }, [notes, query, ranked, sort]);

  const liveCount = alive(notes).length;
  const selected =
    (selectedId && alive(notes).find((n) => n.id === selectedId)) || (!mobile ? list[0] : undefined) || undefined;
  const linkedCount = (id: string) =>
    alive(todos).filter((t) => t.noteId === id).length + alive(transactions).filter((t) => t.noteId === id).length;

  const newNote = () => {
    setQuery("");
    setSearching(false);
    leave(null);
    const n = addNote({ title: "" }); // empty, so the "Untitled" placeholder doesn't need deleting
    setSelectedId(n.id);
    setMobileOpen(true);
    requestAnimationFrame(() => setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Note title']")?.focus(), 150));
  };

  if (liveCount === 0) {
    return (
      <div className="mx-auto max-w-3xl pt-2">
        <EmptyStart
          title="No notes yet"
          hint="Start a note, photograph handwriting, record a voice note — or ask the assistant to write one."
          prompts={["Note: weekend trip ideas", "Summarize this: standup notes, ship Friday, Andi on QA"]}
        />
        <div className="mt-4 flex justify-center">
          <button onClick={newNote} className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 font-medium text-white">
            <Icon name="noteAdd" size={18} /> New note
          </button>
        </div>
      </div>
    );
  }

  const showList = mobile ? !mobileOpen : !listHidden;
  const showEditor = !!selected && (mobile ? mobileOpen : true);

  return (
    // Fills the space below the header exactly: the list and the note each scroll on
    // their own, so headers, toolbar and footer stay in place.
    <div className="flex min-h-0 flex-1 gap-4 md:gap-5">
      {(mobile ? showList : listPresence.mounted) && (
        <aside
          className={`fn-aside flex min-h-0 w-full shrink-0 flex-col md:w-[340px] ${mobile && returned ? "fn-list-back" : ""}`}
          data-state={mobile ? undefined : listPresence.state}
          inert={!mobile && listHidden ? true : undefined}
        >
          {/* Fixed width inside, so the cards don't reflow while the list folds. */}
          <div className="flex min-h-0 w-full flex-1 flex-col md:w-[340px]">
          {/* The page title ("Notes") sits above, like every tab; this row counts and acts. */}
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <span className="text-sm text-[var(--muted)]">{liveCount} note{liveCount === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-0.5">
              <button className="tb-btn" onClick={newNote} aria-label="New note" title="New note"><Icon name="noteAdd" size={20} /></button>
              <Dropdown label="Sort notes" button={<Icon name="sort" size={20} />} width={200}>
                {(close) => (Object.keys(SORTS) as Sort[]).map((s) => (
                  <MenuItem key={s} label={SORTS[s]} active={sort === s} onSelect={() => { close(); setSort(s); }} />
                ))}
              </Dropdown>
              <button className={`tb-btn ${searching ? "bg-[var(--hover)] text-[var(--text)]" : ""}`} onClick={() => { setSearching((v) => !v); if (searching) setQuery(""); }} aria-label="Search notes" aria-pressed={searching}>
                <Icon name="search" size={19} />
              </button>
            </div>
          </div>
          {searching && (
            <div className="fn-rise px-1 pb-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by words or meaning"
                aria-label="Search notes"
                className="h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 text-sm outline-none focus:border-[var(--accent)]"
              />
              {query.trim().length >= 3 && ranked?.q.toLowerCase() === query.trim().toLowerCase() && (
                <p className="px-1 pt-1 text-xs text-[var(--faint)]">Best matches first</p>
              )}
            </div>
          )}
          <ul className="scroll-thin -mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-4">
            {list.map((n) => (
              <NoteCard key={n.id} note={n} selected={!mobile && selected?.id === n.id} linked={linkedCount(n.id)} onOpen={() => open(n.id)} />
            ))}
            {query && list.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--faint)]">No matching notes.</li>}
          </ul>
          </div>
        </aside>
      )}

      {showEditor && selected && (
        <NoteEditor
          key={selected.id}
          note={selected}
          onBack={mobile ? () => { leave(null); setMobileOpen(false); setReturned(true); setAnim(undefined); } : undefined}
          listHidden={listHidden}
          onToggleList={mobile ? undefined : () => setListHidden((v) => !v)}
          focusMode={focusMode}
          onToggleFocus={() => (focusMode ? exitFocus() : enterFocus())}
          anim={anim ?? (mobile ? "push" : undefined)}
          // Phones keep the last value, so clearing it can't replay the slide-in.
          onAnimDone={() => setAnim((a) => (a === "focus-out" || mobile ? a : undefined))}
        />
      )}
    </div>
  );
}
