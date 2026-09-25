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

/** "19 APR", or "19 APR 2025" once it is not this year. */
function cardDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}${sameYear ? "" : ` ${d.getFullYear()}`}`.toUpperCase();
}

function NoteCard({ note, selected, linked, onOpen }: { note: Note; selected: boolean; linked: number; onOpen: () => void }) {
  const flash = useFiledFlash(note.id);
  const preview = snippet(note.content);
  const source = SOURCE_LABEL[note.source];
  const tags = note.tags;
  return (
    <li id={`note-row-${note.id}`} className={flash ? "fn-flash" : ""}>
      <button
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`fn-press flex w-full flex-col rounded-[10px] border px-4 py-4 text-left transition-colors ${
          selected ? "border-[color-mix(in_srgb,var(--faint)_35%,transparent)] bg-[var(--hover)]" : "border-transparent bg-[var(--panel)] hover:bg-[var(--hover)]"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-[var(--faint)]">
          <span>{cardDate(note.updatedAt)}</span>
          {source && <><span>·</span><span className="truncate">{source.toUpperCase()}</span></>}
          {linked > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5" title={`${linked} linked item${linked === 1 ? "" : "s"}`}>
              <Icon name="link" size={11} />{linked}
            </span>
          )}
        </span>
        <span className={`mt-2 line-clamp-1 text-[15px] ${selected ? "font-semibold text-[var(--text)]" : "font-medium text-[color-mix(in_srgb,var(--text)_78%,transparent)]"}`}>
          {note.title || "Untitled"}
        </span>
        <span className={`mt-1.5 line-clamp-2 text-[13px] leading-relaxed ${selected ? "text-[var(--muted)]" : "text-[var(--faint)]"}`}>{preview || "No text yet"}</span>
        {tags.length > 0 && (
          <span className="mt-3.5 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((t) => <TagChip key={t}>{t[0]?.toUpperCase() + t.slice(1)}</TagChip>)}
            {tags.length > 3 && <TagChip>+{tags.length - 3} more</TagChip>}
          </span>
        )}
      </button>
    </li>
  );
}

const TagChip = ({ children }: { children: React.ReactNode }) => (
  <span className="flex h-6 items-center rounded-[5px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] px-2 text-[11px] font-medium tracking-[0.03em] text-[var(--muted)]">{children}</span>
);

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
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="fn-serif mb-5 mt-5 text-[2.1rem] leading-tight md:mt-7">Notes</h2>
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
    <div className="-mx-4 flex min-h-0 flex-1 md:-mx-8">
      {(mobile ? showList : listPresence.mounted) && (
        <aside
          className={`fn-aside flex min-h-0 w-full shrink-0 flex-col md:w-[331px] md:border-r md:border-[var(--line)] ${mobile && returned ? "fn-list-back" : ""}`}
          data-state={mobile ? undefined : listPresence.state}
          inert={!mobile && listHidden ? true : undefined}
        >
          {/* Fixed width inside, so the cards don't reflow while the list folds. */}
          <div className="flex min-h-0 w-full flex-1 flex-col px-4 md:w-[330px] md:px-[18px]">
          {/* The list carries the tab's title, as the macOS app has it. */}
          <div className="flex items-center justify-between gap-2 pb-4 pt-5 md:pt-7">
            <h2 className="fn-serif text-[2.1rem] leading-tight" title={`${liveCount} note${liveCount === 1 ? "" : "s"}`}>Notes</h2>
            <div className="flex items-center gap-0.5">
              <Dropdown label="Sort notes" button={<Icon name="sort" size={19} />} width={200} chevron={false} align="right">
                {(close) => (Object.keys(SORTS) as Sort[]).map((s) => (
                  <MenuItem key={s} label={SORTS[s]} active={sort === s} onSelect={() => { close(); setSort(s); }} />
                ))}
              </Dropdown>
              <button className={`tb-btn ${searching ? "bg-[var(--hover)] text-[var(--text)]" : ""}`} onClick={() => { setSearching((v) => !v); if (searching) setQuery(""); }} aria-label="Search notes" aria-pressed={searching}>
                <Icon name="search" size={18} />
              </button>
            </div>
          </div>
          <button
            onClick={newNote}
            className="fn-press mb-3 flex min-h-12 w-full items-center gap-3 rounded-[10px] bg-[var(--panel)] px-4 text-left text-sm text-[color-mix(in_srgb,var(--text)_85%,transparent)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <Icon name="plus" size={18} /> Add new note
          </button>
          {searching && (
            <div className="fn-rise pb-3">
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
          <ul className="scroll-thin -mx-1 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-24">
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
