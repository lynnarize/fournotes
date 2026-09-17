"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fmtDateTime } from "@/lib/client";
import { useFiledFlash } from "@/lib/highlight";
import { openItem, scrollToId, useOpenItem } from "@/lib/nav";
import { semanticNotes } from "@/lib/search";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import { guessCategory } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import EmptyStart from "./EmptyStart";
import { Icon, SectionTitle, useToast } from "./ui";

const SOURCE_LABEL = { manual: "", chat: "via chat", ocr: "scanned", recording: "recording", share: "shared" } as const;

// "/" commands inside the editor: quick-add from wherever you are typing.
const COMMANDS = [
  { id: "todo", label: "To-do", hint: "Turn this line into a linked task", icon: "todo" },
  { id: "remind", label: "Remind me tomorrow", hint: "Linked task, reminder 9:00", icon: "bell" },
  { id: "expense", label: "Expense", hint: "Log this line, e.g. “coffee 25k”", icon: "finance" },
  { id: "sticky", label: "Sticky", hint: "Pin this line to the top bar", icon: "pin" },
  { id: "ask", label: "Ask AI", hint: "Send this line to the assistant", icon: "sparkle" },
  { id: "checklist", label: "Checklist", hint: "☐ item (click the box to tick)", icon: "todo" },
  { id: "bullet", label: "Bullet", hint: "• item", icon: "menu" },
  { id: "heading", label: "Heading", hint: "# Heading", icon: "note" },
  { id: "date", label: "Today's date", hint: "Insert date", icon: "calendar" },
  { id: "time", label: "Time", hint: "Insert current time", icon: "calendar" },
  { id: "divider", label: "Divider", hint: "---", icon: "menu" },
] as const;
type CommandId = (typeof COMMANDS)[number]["id"];

const MIRROR_PROPS = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding-top", "padding-left", "padding-right", "border-top-width", "border-left-width", "box-sizing", "width"];

/** Pixel position of the caret inside a textarea (mirror-div technique). */
function caretPosition(ta: HTMLTextAreaElement, pos: number) {
  const cs = getComputedStyle(ta);
  const div = document.createElement("div");
  for (const p of MIRROR_PROPS) div.style.setProperty(p, cs.getPropertyValue(p));
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  div.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  div.appendChild(marker);
  document.body.appendChild(div);
  const top = marker.offsetTop - ta.scrollTop + (parseFloat(cs.lineHeight) || 24);
  const left = marker.offsetLeft;
  div.remove();
  return { top, left };
}

/** List row that flashes when the assistant has just filed this note. */
function NoteRow({ id, children }: { id: string; children: React.ReactNode }) {
  const justFiled = useFiledFlash(id);
  return <li id={`note-row-${id}`} className={justFiled ? "fn-flash" : ""}>{children}</li>;
}

export default function NotesView() {
  const { notes, todos, transactions, addNote, updateNote, remove, addTodo, addTransaction, addSticky, toggleTodo } = useStore();
  const { send } = useAssistant();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ranked, setRanked] = useState<{ q: string; ids: string[] } | null>(null);
  const [slash, setSlash] = useState<{ start: number; query: string; top: number; left: number; active: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useOpenItem("note", (f) => {
    setQuery("");
    setSelectedId(f.id);
    scrollToId(`note-row-${f.id}`, "nearest");
    // On phones the editor sits below the list: bring it into view.
    if (window.matchMedia("(max-width: 767px)").matches) scrollToId("note-editor", "start");
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
    const q = query.trim().toLowerCase();
    const live = alive(notes);
    if (!q) return live.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const substring = live.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    if (ranked?.q.toLowerCase() !== q) return substring;
    const byId = new Map(live.map((n) => [n.id, n]));
    const out = ranked.ids.map((id) => byId.get(id)!).filter(Boolean);
    for (const n of substring) if (!out.includes(n)) out.push(n);
    return out;
  }, [notes, query, ranked]);

  const selected = list.find((n) => n.id === selectedId) ?? (selectedId ? alive(notes).find((n) => n.id === selectedId) : undefined) ?? list[0];
  const linkedTodos = selected ? alive(todos).filter((t) => t.noteId === selected.id) : [];
  const linkedTxs = selected ? alive(transactions).filter((t) => t.noteId === selected.id) : [];
  const commands = slash ? COMMANDS.filter((c) => c.id.startsWith(slash.query.toLowerCase()) || c.label.toLowerCase().includes(slash.query.toLowerCase())) : [];

  const detectSlash = (ta: HTMLTextAreaElement) => {
    const caret = ta.selectionStart;
    const m = ta.value.slice(0, caret).match(/(^|\s)\/([\w-]{0,12})$/);
    if (!m || ta.selectionEnd !== caret) return setSlash(null);
    const { top, left } = caretPosition(ta, caret);
    setSlash((s) => ({ start: caret - m[2].length - 1, query: m[2], top: ta.offsetTop + top, left: Math.min(left, ta.clientWidth - 260), active: s?.query === m[2] ? s.active : 0 }));
  };

  const runCommand = (id: CommandId) => {
    const ta = taRef.current;
    if (!ta || !slash || !selected) return;
    const value = ta.value;
    const without = value.slice(0, slash.start) + value.slice(ta.selectionStart);
    const start = slash.start;
    const lineStart = without.lastIndexOf("\n", start - 1) + 1;
    const lineEndRaw = without.indexOf("\n", start);
    const lineEnd = lineEndRaw === -1 ? without.length : lineEndRaw;
    const line = without.slice(lineStart, lineEnd).replace(/^(☐|☑|•|-|#+)\s*/, "").trim();
    let next = without;
    let caret = start;
    const replaceLine = (s: string) => { next = without.slice(0, lineStart) + s + without.slice(lineEnd); caret = lineStart + s.length; };
    const insert = (s: string) => { next = without.slice(0, start) + s + without.slice(start); caret = start + s.length; };
    const needLine = () => { toast("Type something on this line first, then use the command.", "error"); return false; };

    switch (id) {
      case "todo":
        if (!line) { needLine(); break; }
        addTodo({ title: line, noteId: selected.id });
        replaceLine(`☐ ${line}`);
        toast(`✅ Task added and linked: ${line}`);
        break;
      case "remind": {
        if (!line) { needLine(); break; }
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
        addTodo({ title: line, noteId: selected.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
        replaceLine(`☐ ${line} ⏰`);
        toast(`⏰ Reminder ${fmtDateTime(at.toISOString())}: ${line}`);
        break;
      }
      case "expense": {
        const amount = line ? parseAmount(line) : null;
        if (!amount) { toast("Add an amount on the line, e.g. “lunch 45k”.", "error"); break; }
        const merchant = line.replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/gi, "").replace(/\s{2,}/g, " ").trim() || "Expense";
        const tx = addTransaction({ merchant, amount, category: guessCategory(line), noteId: selected.id });
        replaceLine(`💸 ${line}`);
        toast(`💸 Logged ${formatMoney(amount, tx.currency)} (${tx.category})`);
        break;
      }
      case "sticky":
        if (!line) { needLine(); break; }
        addSticky({ text: line });
        toast("📌 Pinned to the sticky bar");
        break;
      case "ask":
        if (!line) { needLine(); break; }
        send(`${line}\n\n(Context: from my note “${selected.title}”)`);
        break;
      case "checklist": replaceLine(`☐ ${line}`); break;
      case "bullet": replaceLine(`• ${line}`); break;
      case "heading": replaceLine(`# ${line}`); break;
      case "date": insert(new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })); break;
      case "time": insert(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })); break;
      case "divider": insert("---\n"); break;
    }
    updateNote(selected.id, { content: next });
    setSlash(null);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(caret, caret); });
  };

  const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slash || commands.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setSlash({ ...slash, active: (slash.active + d + commands.length) % commands.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      runCommand(commands[Math.min(slash.active, commands.length - 1)].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSlash(null);
    }
  };

  /** Clicking a ☐ / ☑ at the start of a line ticks it, and the linked task too. */
  const onEditorClick = (ta: HTMLTextAreaElement) => {
    if (!selected) return;
    const pos = ta.selectionStart;
    const ls = ta.value.lastIndexOf("\n", pos - 1) + 1;
    const ch = ta.value[ls];
    if (pos - ls > 1 || (ch !== "☐" && ch !== "☑")) return detectSlash(ta);
    const checking = ch === "☐";
    const lineEnd = ta.value.indexOf("\n", ls);
    const title = ta.value.slice(ls + 1, lineEnd === -1 ? undefined : lineEnd).replace(/⏰/g, "").trim();
    updateNote(selected.id, { content: ta.value.slice(0, ls) + (checking ? "☑" : "☐") + ta.value.slice(ls + 1) });
    const linked = linkedTodos.find((t) => t.title.trim() === title);
    if (linked) {
      const extra = toggleTodo(linked.id, checking);
      if (extra.length) toast(extra.join("\n"));
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <aside className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by words or meaning"
            aria-label="Search notes"
            className="input-plain w-full rounded-md bg-[var(--hover)] px-2 py-1.5 text-sm"
          />
          <button className="btn-ghost" onClick={() => { setQuery(""); setSelectedId(addNote({}).id); }} aria-label="New note">
            <Icon name="plus" />
          </button>
        </div>
        {query.trim().length >= 3 && ranked?.q.toLowerCase() === query.trim().toLowerCase() && (
          <div className="mb-1 px-2 text-xs text-[var(--faint)]">Best matches first</div>
        )}
        <ul className="scroll-thin max-h-[40vh] space-y-0.5 overflow-y-auto md:max-h-[60vh]">
          {list.map((n) => (
            <NoteRow key={n.id} id={n.id}>
              <button
                onClick={() => setSelectedId(n.id)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  selected?.id === n.id ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
                }`}
              >
                <div className="truncate font-medium">{n.title || "Untitled"}</div>
                <div className="truncate text-xs text-[var(--muted)]">
                  {SOURCE_LABEL[n.source] && <span className="mr-1">{SOURCE_LABEL[n.source]} ·</span>}
                  {n.content.replace(/\n/g, " ").slice(0, 60) || "Empty"}
                </div>
              </button>
            </NoteRow>
          ))}
          {query && list.length === 0 && <li className="px-2 py-3 text-sm text-[var(--faint)]">No matching notes.</li>}
        </ul>
      </aside>

      {selected ? (
        <article id="note-editor" className="min-w-0 scroll-mt-20">
          <div className="mb-1 flex items-center gap-2 text-xs text-[var(--muted)]">
            <span>Edited {new Date(selected.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
            {selected.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            <button className="btn-ghost ml-auto" onClick={() => { remove("notes", selected.id); setSelectedId(null); }} aria-label="Delete note">
              <Icon name="trash" size={14} />
            </button>
          </div>
          <input
            value={selected.title}
            onChange={(e) => updateNote(selected.id, { title: e.target.value })}
            placeholder="Untitled"
            aria-label="Note title"
            className="input-plain w-full text-3xl font-bold"
          />
          {selected.imageDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.imageDataUrl} alt="Scanned source" className="my-3 max-h-48 rounded-md border border-[var(--line)]" />
          )}
          <div className="relative">
            <textarea
              ref={taRef}
              value={selected.content}
              onChange={(e) => { updateNote(selected.id, { content: e.target.value }); detectSlash(e.target); }}
              onKeyDown={onEditorKey}
              onClick={(e) => onEditorClick(e.currentTarget)}
              onBlur={() => setTimeout(() => setSlash(null), 150)}
              placeholder="Start writing… type / for commands"
              aria-label="Note content"
              className="input-plain mt-3 min-h-[45vh] w-full resize-none text-[15px] leading-7"
            />
            {slash && commands.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-30 w-64 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg)] py-1 text-sm shadow-[var(--shadow)]"
                style={{ top: slash.top + 4, left: Math.max(0, slash.left) }}
              >
                {commands.map((c, i) => (
                  <li key={c.id} role="option" aria-selected={i === slash.active}>
                    <button
                      onMouseDown={(e) => { e.preventDefault(); runCommand(c.id); }}
                      onMouseEnter={() => setSlash({ ...slash, active: i })}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === slash.active ? "bg-[var(--hover)]" : ""}`}
                    >
                      <Icon name={c.icon} size={14} className="text-[var(--muted)]" />
                      <span className="whitespace-nowrap font-medium">{c.label}</span>
                      <span className="ml-auto truncate text-xs text-[var(--faint)]">{c.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(linkedTodos.length > 0 || linkedTxs.length > 0) && (
            <section className="mt-4 border-t border-[var(--line)] pt-3">
              <SectionTitle className="flex items-center gap-1"><Icon name="link" size={12} /> Linked</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {linkedTodos.map((t) => (
                  <button key={t.id} className={`chip hover:bg-[var(--line)] ${t.done ? "line-through" : ""}`} onClick={() => openItem("todo", t.id)}>
                    <Icon name="todo" size={11} />{t.title}
                  </button>
                ))}
                {linkedTxs.map((t) => (
                  <button key={t.id} className="chip hover:bg-[var(--line)]" onClick={() => openItem("transaction", t.id)}>
                    <Icon name="finance" size={11} />{t.merchant} · {formatMoney(t.amount, t.currency)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </article>
      ) : (
        <EmptyStart
          title="No notes yet"
          hint="Write one with the + button, photograph handwriting, record a voice note — or ask the assistant."
          prompts={["Note: weekend trip ideas", "Summarize this: standup notes, ship Friday, Andi on QA"]}
        />
      )}
    </div>
  );
}
