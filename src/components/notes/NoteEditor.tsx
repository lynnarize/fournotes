"use client";
// The Notes editor: a big, clean writing surface with a formatting toolbar.
// Rich text lives in note.html (TipTap); every change also writes note.content, the
// plain-text form that search, the assistant and the daily brief read.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setActiveNote } from "@/lib/activeNote";
import { api, downloadFile, fmtDateTime } from "@/lib/client";
import { openAssistant, openItem } from "@/lib/nav";
import { docToPlain, plainToHtml, taskStates, type DocNode } from "@/lib/noteText";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import type { Note } from "@/lib/types";
import { guessCategory } from "@/lib/wallet";
import { useAssistant } from "../assistant";
import { Icon, SectionTitle, useToast } from "../ui";
import { Dropdown, MenuItem, MenuLabel, MenuSep } from "./Dropdown";

// ---- Options ------------------------------------------------------------------------
const FONTS = [
  { label: "Sans Serif", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  { label: "Rounded", value: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif" },
];
const SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40];
const DEFAULT_SIZE = 16;
const TEXT_COLORS = [
  { label: "Default", value: "" }, { label: "Gray", value: "#787774" }, { label: "Red", value: "#d4351c" },
  { label: "Orange", value: "#b85c00" }, { label: "Yellow", value: "#946b00" }, { label: "Green", value: "#0f7b6c" },
  { label: "Blue", value: "#2f6fdd" }, { label: "Purple", value: "#9065b0" }, { label: "Pink", value: "#c14c8a" },
];
const HIGHLIGHTS = [
  { label: "None", value: "" }, { label: "Yellow", value: "#fde68a" }, { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" }, { label: "Pink", value: "#fbcfe8" }, { label: "Purple", value: "#ddd6fe" },
  { label: "Orange", value: "#fed7aa" },
];

const TEMPLATES: { label: string; icon: string; body: () => string; title?: string }[] = [
  {
    label: "Meeting notes", icon: "users", title: "Meeting notes",
    body: () => `**Date:** ${today()}\n**Attendees:** \n\n## Agenda\n- \n\n## Notes\n\n## Action items\n☐ `,
  },
  { label: "To-do list", icon: "checklist", title: "To-do", body: () => "☐ \n☐ \n☐ " },
  {
    label: "Daily journal", icon: "today", title: today(),
    body: () => "## Grateful for\n- \n\n## Today's focus\n- \n\n## Notes\n",
  },
  {
    label: "Trip plan", icon: "calendar", title: "Trip to …",
    body: () => "**Dates:** \n**Budget:** \n\n## Itinerary\n- Day 1: \n\n## Packing\n☐ Passport / ID\n☐ Charger\n☐ ",
  },
  {
    label: "Budget plan", icon: "finance", title: `Budget ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    body: () => "## Income\n- Salary: \n\n## Spending\n- Rent: \n- Food: \n- Transport: \n- Bills: \n\n## Saving\n- ",
  },
  {
    label: "Study notes", icon: "note", title: "Study notes",
    body: () => "## Topic\n\n## Key ideas\n- \n\n## Questions\n- \n\n## Summary\n",
  },
];

const ASK_PROMPTS = [
  "Write a note: agenda for a meeting about ",
  "Write a note: packing list for a trip to ",
  "Write a note: weekly meal plan on a budget of ",
];

const SLASH = [
  { id: "todo", label: "To-do", hint: "Linked task", icon: "todo" },
  { id: "remind", label: "Remind me tomorrow", hint: "Task, 9:00", icon: "bell" },
  { id: "expense", label: "Expense", hint: "“lunch 45k”", icon: "finance" },
  { id: "sticky", label: "Sticky", hint: "Pin to the top", icon: "pin" },
  { id: "ask", label: "Ask AI", hint: "Send this line", icon: "sparkle" },
  { id: "checklist", label: "Checklist", hint: "☐", icon: "checklist" },
  { id: "bullet", label: "Bulleted list", hint: "•", icon: "listBullet" },
  { id: "numbered", label: "Numbered list", hint: "1.", icon: "listOrdered" },
  { id: "heading", label: "Heading", hint: "H2", icon: "textSize" },
  { id: "quote", label: "Quote", hint: "❝", icon: "quote" },
  { id: "divider", label: "Divider", hint: "—", icon: "divider" },
  { id: "date", label: "Today's date", hint: "", icon: "calendar" },
  { id: "time", label: "Time", hint: "", icon: "calendar" },
] as const;
type SlashId = (typeof SLASH)[number]["id"];

const AI_TASKS = [
  { id: "summarize", label: "Summarize", icon: "listBullet", result: "Summary" },
  { id: "improve", label: "Improve writing", icon: "sparkle", result: "Improved" },
  { id: "fix", label: "Fix spelling & grammar", icon: "check", result: "Corrected" },
  { id: "shorter", label: "Make shorter", icon: "shrink", result: "Shorter version" },
  { id: "continue", label: "Continue writing", icon: "arrowRight", result: "Continuation" },
] as const;
type AiTask = (typeof AI_TASKS)[number]["id"];

function today() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keep = (e: React.MouseEvent) => e.preventDefault();

/** A plain toolbar button that doesn't steal the editor's selection. */
function TB({ icon, label, onClick, active, disabled, className = "" }: {
  icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={keep}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`tb-btn ${active ? "bg-[var(--hover)] text-[var(--text)]" : ""} ${className}`}
    >
      <Icon name={icon} size={19} />
    </button>
  );
}

/** Where a note came from, when it wasn't typed here. */
const SOURCE_NAME: Partial<Record<Note["source"], string>> = {
  chat: "Written by the assistant", ocr: "Scanned", recording: "Voice recording", share: "Shared",
};

/** A hairline between the editor's sections, inset to the content. */
const Rule = () => <div className="mx-5 h-px shrink-0 bg-[var(--line)] md:mx-9" aria-hidden />;

/** A run of related tools that wraps as one piece. */
const Group = ({ children }: { children: React.ReactNode }) => <div className="flex shrink-0 items-center gap-0.5">{children}</div>;

const TOOLBAR_KEY = "four-notes:toolbar-expanded";

/**
 * The formatting tools on one line; the chevron at its end shows the rest on lines below,
 * and hides them again. It is only there when they don't all fit.
 */
function Toolbar({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { setExpanded(localStorage.getItem(TOOLBAR_KEY) === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Wrapped onto a second line means some tools are out of sight while collapsed.
    const check = () => {
      const kids = [...el.children] as HTMLElement[];
      setOverflows(kids.some((k) => k.offsetTop > kids[0].offsetTop + 4));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const toggle = () => {
    setExpanded((v) => {
      try { localStorage.setItem(TOOLBAR_KEY, v ? "0" : "1"); } catch { /* storage blocked */ }
      return !v;
    });
  };
  return (
    <div className="relative shrink-0 px-2 py-1 md:px-5">
      <div
        ref={ref}
        className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden transition-[max-height] duration-300 ${overflows ? "pr-11" : ""}`}
        style={{ maxHeight: expanded ? 400 : 44 }}
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          onMouseDown={keep}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer tools" : "Show all tools"}
          title={expanded ? "Show fewer tools" : "Show all tools"}
          className="tb-btn absolute right-2 top-1 bg-[var(--bg)] md:right-5"
        >
          <Icon name="chevronDown" size={16} className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

export default function NoteEditor({ note, onBack, listHidden, onToggleList, focusMode, onToggleFocus, anim, onAnimDone }: {
  note: Note;
  /** Phones: back to the list. */
  onBack?: () => void;
  listHidden?: boolean;
  onToggleList?: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  /** The card's transition (see .note-card[data-anim] in globals.css). */
  anim?: string;
  onAnimDone?: () => void;
}) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const { send } = useAssistant();
  const toast = useToast();
  const noteRef = useRef(note);
  noteRef.current = note;

  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [slash, setSlash] = useState<{ from: number; query: string; x: number; y: number; active: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const [aiBusy, setAiBusy] = useState<AiTask | null>(null);
  const [ai, setAi] = useState<{ task: AiTask; text: string; range: { from: number; to: number } | null } | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop(): void } | null>(null);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // ---- Saving (debounced) ---------------------------------------------------------
  const initialHtml = useRef(note.html ?? plainToHtml(note.content));
  const lastSaved = useRef(initialHtml.current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const tasksRef = useRef<Map<string, boolean>>(new Map());

  const persist = useCallback(() => {
    timer.current = null;
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const html = ed.getHTML();
    lastSaved.current = html;
    storeRef.current.updateNote(noteRef.current.id, { html, content: docToPlain(ed.getJSON() as DocNode) });
    setStatus("saved");
  }, []);

  /** Ticking a checklist item ticks the to-do linked to this note with the same title. */
  const syncTicks = useCallback((ed: Editor) => {
    const next = taskStates(ed.getJSON() as DocNode);
    for (const [title, checked] of next) {
      if (tasksRef.current.get(title) === undefined || tasksRef.current.get(title) === checked) continue;
      const linked = alive(storeRef.current.todos).find((t) => t.noteId === noteRef.current.id && t.title.trim() === title);
      if (linked && linked.done !== checked) {
        const extra = storeRef.current.toggleTodo(linked.id, checked);
        if (extra.length) toast(extra.join("\n"));
      }
    }
    tasksRef.current = next;
  }, [toast]);

  const detectSlash = useCallback((ed: Editor) => {
    const { $from, empty } = ed.state.selection;
    if (!empty || !$from.parent.isTextblock) return setSlash(null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const m = before.match(/(^|\s)\/([\w-]{0,14})$/);
    if (!m) return setSlash(null);
    const c = ed.view.coordsAtPos($from.pos);
    setSlash((s) => ({
      from: $from.pos - m[2].length - 1,
      query: m[2],
      x: Math.min(c.left, window.innerWidth - 290),
      y: Math.min(c.bottom + 6, window.innerHeight - 320),
      active: s?.query === m[2] ? s.active : 0,
    }));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TextStyleKit.configure({ lineHeight: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Superscript,
      Subscript,
      CharacterCount,
      Placeholder.configure({ placeholder: "Start writing… type / for commands" }),
    ],
    content: initialHtml.current,
    editorProps: {
      attributes: { class: "fn-editor", "aria-label": "Note content", spellcheck: "true" },
      handleKeyDown: (_view, e) => {
        const s = slashRef.current;
        if (!s) return false;
        const items = filtered(s.query);
        if (!items.length) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const d = e.key === "ArrowDown" ? 1 : -1;
          setSlash({ ...s, active: (s.active + d + items.length) % items.length });
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          runSlashRef.current(items[Math.min(s.active, items.length - 1)].id);
          return true;
        }
        if (e.key === "Escape") {
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      tasksRef.current = taskStates(ed.getJSON() as DocNode);
      // An empty transaction so the toolbar and the template picker read the initial state.
      queueMicrotask(() => { if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta("addToHistory", false)); });
    },
    onUpdate: ({ editor: ed }) => {
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(persist, 400);
      syncTicks(ed);
      detectSlash(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => detectSlash(ed),
    onBlur: () => setTimeout(() => setSlash(null), 150),
  });

  // Let the notes list ask whether this note has text, even before the save lands.
  useEffect(() => {
    const id = note.id;
    setActiveNote({ id, hasText: () => Boolean(editorRef.current && !editorRef.current.isDestroyed && !editorRef.current.isEmpty) });
    return () => setActiveNote(null, id);
  }, [note.id]);

  // Save anything pending when switching notes or leaving the tab.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      persist();
    }
    recRef.current?.stop();
  }, [persist]);

  // Another device changed this note (sync): show it, unless you're typing in it.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const incoming = note.html ?? plainToHtml(note.content);
    if (incoming !== lastSaved.current) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastSaved.current = incoming;
      tasksRef.current = taskStates(editor.getJSON() as DocNode);
    }
  }, [editor, note.html, note.content]);

  // Title grows onto more lines instead of scrolling sideways.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [note.title, focusMode, listHidden]);

  const ui = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null;
      const ts = ed.getAttributes("textStyle") as { fontFamily?: string; fontSize?: string; color?: string };
      return {
        bold: ed.isActive("bold"), italic: ed.isActive("italic"), underline: ed.isActive("underline"), strike: ed.isActive("strike"),
        superscript: ed.isActive("superscript"), subscript: ed.isActive("subscript"),
        bullet: ed.isActive("bulletList"), ordered: ed.isActive("orderedList"), task: ed.isActive("taskList"),
        quote: ed.isActive("blockquote"), code: ed.isActive("codeBlock"),
        heading: ([1, 2, 3] as const).find((l) => ed.isActive("heading", { level: l })) ?? 0,
        align: (["center", "right"] as const).find((a) => ed.isActive({ textAlign: a })) ?? "left",
        font: ts.fontFamily ?? "",
        size: ts.fontSize ? parseInt(ts.fontSize, 10) : DEFAULT_SIZE,
        color: ts.color ?? "",
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
        inList: ed.isActive("listItem") || ed.isActive("taskItem"),
        empty: ed.isEmpty,
        words: ed.storage.characterCount?.words?.() ?? 0,
      };
    },
  });

  // ---- "/" commands -------------------------------------------------------------------
  const filtered = (q: string) =>
    SLASH.filter((c) => c.id.startsWith(q.toLowerCase()) || c.label.toLowerCase().includes(q.toLowerCase()));

  const runSlash = (id: SlashId) => {
    const ed = editorRef.current;
    const s = slashRef.current;
    if (!ed || !s) return;
    setSlash(null);
    ed.chain().focus().deleteRange({ from: s.from, to: ed.state.selection.from }).run();
    const { $from } = ed.state.selection;
    const line = $from.parent.textContent.replace(/⏰/g, "").trim();
    const blockStart = $from.start();
    const blockEnd = $from.end();
    const needLine = () => toast("Type something on this line first, then use the command.", "error");
    const { addTodo, addTransaction, addSticky } = storeRef.current;
    const n = noteRef.current;
    const asTask = () => { if (!ed.isActive("taskList")) ed.chain().focus().toggleTaskList().run(); };

    switch (id) {
      case "todo":
        if (!line) return needLine();
        addTodo({ title: line, noteId: n.id });
        asTask();
        toast(`✅ Task added and linked: ${line}`);
        break;
      case "remind": {
        if (!line) return needLine();
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
        addTodo({ title: line, noteId: n.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
        ed.chain().focus().insertContentAt(blockEnd, " ⏰").run();
        asTask();
        toast(`⏰ Reminder ${fmtDateTime(at.toISOString())}: ${line}`);
        break;
      }
      case "expense": {
        const amount = line ? parseAmount(line) : null;
        if (!amount) return toast("Add an amount on the line, e.g. “lunch 45k”.", "error");
        const merchant = line.replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/gi, "").replace(/\s{2,}/g, " ").trim() || "Expense";
        const tx = addTransaction({ merchant, amount, category: guessCategory(line), noteId: n.id });
        ed.chain().focus().insertContentAt(blockStart, "💸 ").run();
        toast(`💸 Logged ${formatMoney(amount, tx.currency)} (${tx.category})`);
        break;
      }
      case "sticky":
        if (!line) return needLine();
        addSticky({ text: line });
        toast("📌 Pinned to the sticky bar");
        break;
      case "ask":
        if (!line) return needLine();
        send(`${line}\n\n(Context: from my note “${n.title || "Untitled"}”)`);
        break;
      case "checklist": ed.chain().focus().toggleTaskList().run(); break;
      case "bullet": ed.chain().focus().toggleBulletList().run(); break;
      case "numbered": ed.chain().focus().toggleOrderedList().run(); break;
      case "heading": ed.chain().focus().toggleHeading({ level: 2 }).run(); break;
      case "quote": ed.chain().focus().toggleBlockquote().run(); break;
      case "divider": ed.chain().focus().setHorizontalRule().run(); break;
      case "date": ed.chain().focus().insertContent(today()).run(); break;
      case "time": ed.chain().focus().insertContent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).run(); break;
    }
  };
  const runSlashRef = useRef(runSlash);
  runSlashRef.current = runSlash;

  // ---- Toolbar actions ------------------------------------------------------------------
  const chain = () => editor!.chain().focus();

  const insertLink = () => {
    const prev = (editor?.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link address", prev || "https://");
    if (url === null) return;
    if (!url.trim()) return chain().extendMarkRange("link").unsetLink().run();
    const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    chain().extendMarkRange("link").setLink({ href }).run();
  };

  const dictate = () => {
    if (listening) return recRef.current?.stop();
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return toast("Dictation uses your browser's speech recognition. Try Chrome, Edge or Safari.", "error");
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) editorRef.current?.chain().focus().insertContent(e.results[i][0].transcript.trim() + " ").run();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      toast(e.error === "not-allowed" || e.error === "audio-capture" ? "Microphone access is blocked for this site." : `Dictation stopped (${e.error}).`, "error");
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    rec.start();
    setListening(true);
    editor?.commands.focus();
  };

  const runAi = async (task: AiTask) => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const useSelection = !empty && task !== "continue";
    const text = useSelection ? editor.state.doc.textBetween(from, to, "\n") : docToPlain(editor.getJSON() as DocNode);
    if (!text.trim()) return toast("Write something first, or select the text you want help with.", "error");
    setAiBusy(task);
    setAi(null);
    try {
      const res = await api.write(task, text, note.title);
      setAi({ task, text: res.text, range: useSelection ? { from, to } : null });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The AI couldn't do that right now.", "error");
    } finally {
      setAiBusy(null);
    }
  };

  const applyAi = (mode: "replace" | "below") => {
    if (!editor || !ai) return;
    const html = plainToHtml(ai.text);
    if (mode === "replace") {
      if (ai.range) chain().insertContentAt(ai.range, html).run();
      else editor.commands.setContent(html, { emitUpdate: true });
    } else {
      chain().insertContentAt(ai.range ? ai.range.to : editor.state.doc.content.size, html).run();
    }
    setAi(null);
    toast("✨ Added to your note. Undo with ⌘Z / Ctrl+Z if it's not right.");
  };

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    if (!editor) return;
    editor.commands.setContent(plainToHtml(t.body()), { emitUpdate: true });
    if ((!note.title.trim() || note.title === "Untitled") && t.title) store.updateNote(note.id, { title: t.title });
    chain().focus("end").run();
  };

  const plain = () => (editor ? docToPlain(editor.getJSON() as DocNode) : note.content);

  const share = async () => {
    const text = `${note.title || "Untitled"}\n\n${plain()}`;
    if (navigator.share) {
      try { await navigator.share({ title: note.title || "Note", text }); } catch { /* cancelled */ }
      return;
    }
    await navigator.clipboard.writeText(text).catch(() => {});
    toast("Copied the note — paste it anywhere to share.");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(`${note.title || "Untitled"}\n\n${plain()}`).catch(() => {});
    toast("Note copied");
  };

  const print = () => {
    const w = window.open("", "_blank", "noopener=no");
    if (!w || !editor) return toast("Allow pop-ups to print.", "error");
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>${esc(note.title || "Note")}</title>` +
        `<style>body{font-family:'Open Sans',system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.65;color:#111}` +
        `h1{font-size:30px}ul[data-type=taskList]{list-style:none;padding-left:4px}li[data-checked=true]>div{text-decoration:line-through;color:#888}` +
        `blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:14px;color:#555}</style>` +
        `<h1>${esc(note.title || "Untitled")}</h1>${editor.getHTML()}`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const duplicate = () => {
    const copyNote = store.addNote({ title: note.title.trim() ? `${note.title} copy` : "Untitled copy", content: plain(), html: editor?.getHTML(), tags: [...note.tags], source: note.source, imageDataUrl: note.imageDataUrl });
    openItem("note", copyNote.id);
    toast("Note duplicated");
  };

  // No "are you sure?": the toast offers Undo instead, as the macOS app does.
  const del = () => {
    const id = note.id;
    if (focusMode) onToggleFocus();
    store.remove("notes", id);
    toast("Note deleted", "ok", { label: "Undo", run: () => { storeRef.current.updateNote(id, { deletedAt: null }); openItem("note", id); } });
    onBack?.();
  };

  const addTag = (raw: string) => {
    const tag = raw.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
    if (tag && !note.tags.includes(tag)) store.updateNote(note.id, { tags: [...note.tags, tag] });
    setTagDraft(null);
  };

  const setReminder = (at: Date) => {
    if (Number.isNaN(at.getTime())) return;
    store.addTodo({ title: note.title || "Look at this note", noteId: note.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
    toast(`⏰ Reminder set for ${fmtDateTime(at.toISOString())}`);
  };
  /** In an hour; or a day or a week from now, at 9:00. */
  const remindIn = (hours: number) => {
    const at = new Date(Date.now() + hours * 3_600_000);
    if (hours >= 24) at.setHours(9, 0, 0, 0);
    setReminder(at);
  };
  const [pickReminder, setPickReminder] = useState(false);

  const linkedTodos = alive(store.todos).filter((t) => t.noteId === note.id);
  const linkedTxs = alive(store.transactions).filter((t) => t.noteId === note.id);
  const slashItems = slash ? filtered(slash.query) : [];
  const tomorrow9 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  })();
  const fontLabel = FONTS.find((f) => f.value === (ui?.font ?? ""))?.label ?? "Custom";
  const textStyleLabel = ui?.heading ? `Heading ${ui.heading}` : ui?.quote ? "Quote" : ui?.code ? "Code" : "Normal text";
  const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const column = `mx-auto w-full ${focusMode ? "max-w-[800px]" : "max-w-[760px] md:mx-0"}`;

  return (
    <div
      data-anim={anim}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimDone?.(); }}
      className={`note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)] ${
        focusMode ? "fixed inset-0 z-[45] pt-[env(safe-area-inset-top)]" : ""
      }`}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-2 md:px-6 md:pt-3">
        {onBack ? (
          <button className="tb-btn gap-1 pr-2" onClick={onBack} aria-label="Back to notes">
            <Icon name="chevronLeft" size={20} /> <span className="text-sm">Notes</span>
          </button>
        ) : (
          onToggleList && !focusMode && <TB icon={listHidden ? "collapseRight" : "collapseLeft"} label={listHidden ? "Show note list" : "Hide note list"} onClick={onToggleList} />
        )}
        <TB icon={focusMode ? "shrink" : "expand"} label={focusMode ? "Exit focus mode (Esc)" : "Focus mode"} onClick={onToggleFocus} />
        <span className="mx-1 hidden h-6 w-px bg-[var(--line)] sm:block" aria-hidden />
        <nav className="hidden min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-[var(--muted)] sm:flex" aria-label="Breadcrumb">
          <span>Notes</span>
          <Icon name="chevron" size={13} />
          <span className="truncate text-[var(--text)]">{note.title || "Untitled"}</span>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex overflow-hidden rounded-[10px] bg-[var(--accent)] text-white">
            <button className="flex min-h-8 items-center gap-1.5 px-3 text-sm font-medium hover:brightness-110" onClick={share}>
              <Icon name="share" size={15} /> Share
            </button>
            <button className="grid min-h-8 w-8 place-items-center border-l border-white/25 hover:brightness-110" onClick={copy} aria-label="Copy note text" title="Copy note text">
              <Icon name="copy" size={15} />
            </button>
          </div>
          <Dropdown label="More actions" button={<Icon name="more" size={20} />} width={220} align="right" chevron={false}>
            {(close) => (
              <>
                <MenuItem icon="copy" label="Duplicate" onSelect={() => { close(); duplicate(); }} />
                <MenuItem icon="download" label="Download as text" onSelect={() => {
                  close();
                  downloadFile(`${(note.title || "note").replace(/[^\w\- ]+/g, "").trim() || "note"}.txt`, `${note.title}\n\n${plain()}\n`, "text/plain");
                }} />
                <MenuItem icon="print" label="Print" onSelect={() => { close(); print(); }} />
                <MenuSep />
                <MenuItem icon="trash" label="Delete note" danger onSelect={() => { close(); del(); }} />
              </>
            )}
          </Dropdown>
        </div>
      </div>
      <Rule />

      {/* Toolbar: the groups run from the most used to the least, on one line unless expanded. */}
      <Toolbar>
        <Dropdown label="Insert" chevron={false} button={<span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-white"><Icon name="plus" size={15} /></span>} width={230}>
          {(close) => (
            <>
              <MenuItem icon="checklist" label="Checklist" onSelect={() => { close(); chain().toggleTaskList().run(); }} />
              <MenuItem icon="listBullet" label="Bulleted list" onSelect={() => { close(); chain().toggleBulletList().run(); }} />
              <MenuItem icon="listOrdered" label="Numbered list" onSelect={() => { close(); chain().toggleOrderedList().run(); }} />
              <MenuItem icon="quote" label="Quote" onSelect={() => { close(); chain().toggleBlockquote().run(); }} />
              <MenuItem icon="code" label="Code block" onSelect={() => { close(); chain().toggleCodeBlock().run(); }} />
              <MenuItem icon="divider" label="Divider" onSelect={() => { close(); chain().setHorizontalRule().run(); }} />
              <MenuSep />
              <MenuItem icon="link" label="Link…" onSelect={() => { close(); insertLink(); }} />
              <MenuItem icon="calendar" label="Today's date" onSelect={() => { close(); chain().insertContent(today()).run(); }} />
              <MenuItem icon="clock" label="Current time" onSelect={() => { close(); chain().insertContent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).run(); }} />
            </>
          )}
        </Dropdown>
        <Group>
          <Dropdown label="Text style" title={textStyleLabel} button={<Icon name="textSize" size={19} />} width={210} chevron={false}>
            {(close) => (
              <>
                <MenuItem label="Normal text" active={textStyleLabel === "Normal text"} onSelect={() => { close(); chain().setParagraph().run(); }} />
                {([1, 2, 3] as const).map((l) => (
                  <MenuItem key={l} label={`Heading ${l}`} active={ui?.heading === l} onSelect={() => { close(); chain().toggleHeading({ level: l }).run(); }} />
                ))}
                <MenuItem label="Quote" active={ui?.quote} onSelect={() => { close(); chain().toggleBlockquote().run(); }} />
                <MenuItem label="Code" active={ui?.code} onSelect={() => { close(); chain().toggleCodeBlock().run(); }} />
              </>
            )}
          </Dropdown>
          <Dropdown label="Font" button={<span className="w-[4.6rem] truncate text-left text-sm">{fontLabel}</span>} width={210}>
            {(close) => FONTS.map((f) => (
              <MenuItem key={f.label} label={f.label} active={(ui?.font ?? "") === f.value} onSelect={() => {
                close();
                if (f.value) chain().setFontFamily(f.value).run();
                else chain().unsetFontFamily().run();
              }} />
            ))}
          </Dropdown>
          <Dropdown label="Font size" button={<span className="w-6 text-sm tabular-nums">{ui?.size ?? DEFAULT_SIZE}</span>} width={130}>
            {(close) => SIZES.map((sz) => (
              <MenuItem key={sz} label={String(sz)} active={(ui?.size ?? DEFAULT_SIZE) === sz} onSelect={() => {
                close();
                if (sz === DEFAULT_SIZE) chain().unsetFontSize().run();
                else chain().setFontSize(`${sz}px`).run();
              }} />
            ))}
          </Dropdown>
        </Group>
        <Group>
          <TB icon="bold" label="Bold (⌘B)" onClick={() => chain().toggleBold().run()} active={ui?.bold} />
          <TB icon="italic" label="Italic (⌘I)" onClick={() => chain().toggleItalic().run()} active={ui?.italic} />
          <TB icon="underline" label="Underline (⌘U)" onClick={() => chain().toggleUnderline().run()} active={ui?.underline} />
          <TB icon="strike" label="Strikethrough" onClick={() => chain().toggleStrike().run()} active={ui?.strike} />
        </Group>
        <Group>
          <TB icon="listBullet" label="Bulleted list" onClick={() => chain().toggleBulletList().run()} active={ui?.bullet} />
          <TB icon="listOrdered" label="Numbered list" onClick={() => chain().toggleOrderedList().run()} active={ui?.ordered} />
          <TB icon="checklist" label="Checklist" onClick={() => chain().toggleTaskList().run()} active={ui?.task} />
        </Group>
        <Dropdown label="AI" title="AI writing help" chevron={false} button={<>{aiBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" /> : <Icon name="sparkle" size={18} className="text-[var(--accent)]" />}<span className="text-sm font-medium text-[var(--text)]">AI</span></>} width={250}>
          {(close) => (
            <>
              <MenuLabel>{editor && !editor.state.selection.empty ? "For the selected text" : "For this note"}</MenuLabel>
              {AI_TASKS.map((t) => (
                <MenuItem key={t.id} icon={t.icon} label={t.label} onSelect={() => { close(); void runAi(t.id); }} />
              ))}
              <MenuSep />
              <MenuItem icon="todo" label="Turn into to-dos…" onSelect={() => {
                close();
                if (!plain().trim()) return toast("Write something first.", "error");
                // Filled in, not sent: the user reviews (or adds to) the request first.
                openAssistant(`Turn the action items in my note “${note.title.trim() || "Untitled"}” into to-dos`);
              }} />
              <MenuItem icon="sparkle" label="Ask the assistant…" onSelect={() => { close(); openAssistant(`About my note “${note.title || "Untitled"}”: `); }} />
            </>
          )}
        </Dropdown>
        <Group>
          {/* Left is lit only once chosen, not on every ordinary paragraph. */}
          <TB icon="alignLeft" label="Left-align" onClick={() => chain().setTextAlign("left").run()} active={editor?.isActive({ textAlign: "left" })} />
          <TB icon="alignCenter" label="Center-align" onClick={() => chain().setTextAlign("center").run()} active={ui?.align === "center"} />
          <TB icon="alignRight" label="Right-align" onClick={() => chain().setTextAlign("right").run()} active={ui?.align === "right"} />
        </Group>
        <Group>
          <TB icon="link" label="Insert link" onClick={insertLink} />
          <TB icon="calendar" label="Insert today's date" onClick={() => chain().insertContent(today()).run()} />
          <TB icon="mic" label={listening ? "Stop dictation" : "Dictate"} onClick={dictate} active={listening} className={listening ? "recording text-[var(--danger)]" : ""} />
        </Group>
        <Group>
          <TB icon="undo" label="Undo (⌘Z)" onClick={() => chain().undo().run()} disabled={!ui?.canUndo} />
          <TB icon="redo" label="Redo (⇧⌘Z)" onClick={() => chain().redo().run()} disabled={!ui?.canRedo} />
        </Group>
        <Group>
          <TB icon="indent" label="Indent (Tab)" disabled={!ui?.inList} onClick={() => chain().sinkListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run()} />
          <TB icon="outdent" label="Outdent (⇧Tab)" disabled={!ui?.inList} onClick={() => chain().liftListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run()} />
        </Group>
        <Group>
          <TB icon="superscript" label="Superscript" onClick={() => chain().toggleSuperscript().run()} active={ui?.superscript} />
          <TB icon="subscript" label="Subscript" onClick={() => chain().toggleSubscript().run()} active={ui?.subscript} />
        </Group>
        <Group>
          <Dropdown label="Font colour" chevron={false} button={<Icon name="palette" size={19} className={ui?.color ? "" : undefined} />} width={244}>
            {(close) => (
              <div className="flex flex-wrap gap-1.5 p-1.5">
                {TEXT_COLORS.map((c) => (
                  <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Text color ${c.label}`}
                    onClick={() => { close(); if (c.value) chain().setColor(c.value).run(); else chain().unsetColor().run(); }}
                    className={`grid h-8 w-8 place-items-center rounded-lg border hover:scale-105 ${(ui?.color ?? "") === c.value ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
                  >
                    <span className="text-[15px] font-semibold" style={{ color: c.value || "var(--text)" }}>A</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <Dropdown label="Highlight" chevron={false} button={<Icon name="highlight" size={19} />} width={214}>
            {(close) => (
              <div className="flex flex-wrap gap-1.5 p-1.5">
                {HIGHLIGHTS.map((c) => (
                  <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Highlight ${c.label}`}
                    onClick={() => { close(); if (c.value) chain().setHighlight({ color: c.value }).run(); else chain().unsetHighlight().run(); }}
                    className="h-8 w-8 rounded-lg border border-[var(--line)] hover:scale-105"
                    style={{ background: c.value || "linear-gradient(135deg, transparent 45%, var(--danger) 47%, var(--danger) 53%, transparent 55%)" }}
                  />
                ))}
              </div>
            )}
          </Dropdown>
          <TB icon="eraser" label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()} />
        </Group>
      </Toolbar>
      <Rule />

      {/* Writing area: the title, the note's properties and the text scroll as one. */}
      <div className={`scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 ${focusMode ? "md:px-12" : "md:px-9"}`}>
        <div className={`fn-note-in ${column}`}>
          <textarea
            ref={titleRef}
            rows={1}
            value={note.title}
            onChange={(e) => store.updateNote(note.id, { title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            placeholder="Untitled"
            aria-label="Note title"
            className="input-plain fn-serif block w-full resize-none overflow-hidden text-[2.15rem] leading-tight"
          />

          {/* Properties: focus mode keeps only what you might still change. */}
          <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 text-sm">
            {!focusMode && (
              <>
                <dt className="text-[var(--faint)]">Created</dt>
                <dd>{stamp(note.createdAt)}</dd>
                <dt className="text-[var(--faint)]">Last modified</dt>
                <dd>{status === "saving" ? "Saving…" : stamp(note.updatedAt)}</dd>
                {SOURCE_NAME[note.source] && (
                  <>
                    <dt className="text-[var(--faint)]">Source</dt>
                    <dd>{SOURCE_NAME[note.source]}</dd>
                  </>
                )}
              </>
            )}
            <dt className="self-center text-[var(--faint)]">Tags</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {note.tags.map((t) => (
                <span key={t} className="fn-pop flex h-7 items-center gap-1 rounded-[5px] border border-[var(--line)] bg-[var(--panel)] pl-2.5 pr-1 text-xs font-medium tracking-[0.02em] text-[var(--muted)]">
                  {t[0]?.toUpperCase() + t.slice(1)}
                  <button onClick={() => store.updateNote(note.id, { tags: note.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`} title="Remove tag" className="grid h-5 w-5 place-items-center rounded opacity-60 hover:bg-[var(--hover)] hover:opacity-100">
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
              {tagDraft === null ? (
                <button
                  className="flex h-7 items-center gap-1.5 rounded-[5px] border border-dashed border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_60%,transparent)] px-2.5 text-xs font-medium tracking-[0.02em] text-[var(--muted)] hover:text-[var(--text)]"
                  onClick={() => setTagDraft("")}
                  aria-label="Add tag"
                >
                  <Icon name="plus" size={12} /> Add new tag
                </button>
              ) : (
                <input
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
                    if (e.key === "Escape") { e.stopPropagation(); setTagDraft(null); }
                  }}
                  onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                  placeholder="tag name"
                  aria-label="New tag"
                  className="h-7 w-32 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
                />
              )}
            </dd>
          </dl>

          {note.imageDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={note.imageDataUrl} alt="Scanned source" className="mt-4 max-h-56 rounded-lg border border-[var(--line)]" />
          )}

          {aiBusy && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]" role="status">
              <Icon name="sparkle" size={16} className="fn-dot text-[var(--accent)]" />
              {AI_TASKS.find((t) => t.id === aiBusy)?.label}…
            </div>
          )}
          {ai && (
            <section className="fn-rise mt-5 overflow-hidden rounded-xl border border-[var(--accent)]/40 bg-[var(--panel)]" aria-label="AI suggestion">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2 text-sm font-medium">
                <Icon name="sparkle" size={15} className="text-[var(--accent)]" />
                {AI_TASKS.find((t) => t.id === ai.task)?.result}
                <span className="ml-1 text-xs font-normal text-[var(--faint)]">{ai.range ? "of the selected text" : "of this note"}</span>
              </div>
              <div className="fn-editor fn-editor-preview max-h-72 overflow-y-auto px-4 py-3" dangerouslySetInnerHTML={{ __html: plainToHtml(ai.text) }} />
              <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-4 py-2.5">
                {ai.task === "summarize" || ai.task === "continue" ? (
                  <>
                    <button className="min-h-9 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white" onClick={() => applyAi("below")}>
                      {ai.task === "continue" ? "Add to note" : "Insert below"}
                    </button>
                    {ai.task === "summarize" && <button className="min-h-9 rounded-md border border-[var(--line)] px-3 text-sm hover:bg-[var(--hover)]" onClick={() => applyAi("replace")}>Replace</button>}
                  </>
                ) : (
                  <>
                    <button className="min-h-9 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white" onClick={() => applyAi("replace")}>Replace</button>
                    <button className="min-h-9 rounded-md border border-[var(--line)] px-3 text-sm hover:bg-[var(--hover)]" onClick={() => applyAi("below")}>Insert below</button>
                  </>
                )}
                <button className="min-h-9 rounded-md px-3 text-sm text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => { void navigator.clipboard.writeText(ai.text); toast("Copied"); }}>Copy</button>
                <button className="ml-auto min-h-9 rounded-md px-3 text-sm text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => setAi(null)}>Discard</button>
              </div>
            </section>
          )}

          <EditorContent editor={editor} className="mt-4" />

          {ui?.empty && (
            <div className="fn-rise mt-8 space-y-6">
              <div>
                <p className="mb-2.5 text-sm font-medium text-[var(--muted)]">Start from a template</p>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <button key={t.label} onClick={() => applyTemplate(t)} className="flex min-h-10 items-center gap-2 rounded-full bg-[var(--hover)] px-4 text-sm font-medium hover:brightness-95">
                      <Icon name={t.icon} size={16} className="text-[var(--muted)]" /> {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2.5 text-sm font-medium text-[var(--muted)]">Or let the assistant write it</p>
                <div className="flex flex-wrap gap-2">
                  {ASK_PROMPTS.map((p) => (
                    <button key={p} onClick={() => openAssistant(p)} className="flex min-h-10 items-center gap-2 rounded-full border border-[var(--line)] px-4 text-sm hover:bg-[var(--hover)]">
                      <Icon name="sparkle" size={15} className="text-[var(--accent)]" /> {p.replace(/^Write a note: /, "").replace(/ (of|to|about)? ?$/, "…")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(linkedTodos.length > 0 || linkedTxs.length > 0) && (
            <section className="mt-10 border-t border-[var(--line)] pt-4">
              <SectionTitle className="flex items-center gap-1"><Icon name="link" size={12} /> Linked</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {linkedTodos.map((t) => (
                  <button key={t.id} className={`chip min-h-8 hover:bg-[var(--line)] ${t.done ? "line-through" : ""}`} onClick={() => openItem("todo", t.id)}>
                    <Icon name="todo" size={11} />{t.title}
                  </button>
                ))}
                {linkedTxs.map((t) => (
                  <button key={t.id} className="chip min-h-8 hover:bg-[var(--line)]" onClick={() => openItem("transaction", t.id)}>
                    <Icon name="finance" size={11} />{t.merchant} · {formatMoney(t.amount, t.currency)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Footer */}
      <Rule />
      <div className={`flex shrink-0 items-center gap-1 py-1 pl-2 pr-44 md:pl-6 ${focusMode ? "pb-[calc(env(safe-area-inset-bottom)+4px)]" : ""}`}>
        <Dropdown label="Set a reminder" chevron={false} button={<Icon name="bell" size={17} />} width={260}>
          {(close) =>
            pickReminder ? (
              <form
                className="space-y-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (e.currentTarget.elements.namedItem("when") as HTMLInputElement).value;
                  close();
                  setPickReminder(false);
                  setReminder(new Date(v));
                }}
              >
                <p className="text-sm font-medium">Remind me about this note</p>
                <input name="when" type="datetime-local" defaultValue={tomorrow9} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 text-sm" />
                <div className="flex justify-end gap-1.5">
                  <button type="button" className="min-h-9 rounded-md px-3 text-sm text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => setPickReminder(false)}>Back</button>
                  <button className="min-h-9 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white">Set reminder</button>
                </div>
              </form>
            ) : (
              <>
                <MenuLabel>Remind me about this note</MenuLabel>
                <MenuItem icon="clock" label="In an hour" onSelect={() => { close(); remindIn(1); }} />
                <MenuItem icon="today" label="Tomorrow at 9:00" onSelect={() => { close(); remindIn(24); }} />
                <MenuItem icon="calendar" label="Next week" onSelect={() => { close(); remindIn(24 * 7); }} />
                <MenuSep />
                <MenuItem icon="bell" label="Pick a date and time…" onSelect={() => setPickReminder(true)} />
              </>
            )
          }
        </Dropdown>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--faint)]" role="status">
          {ui?.words ? <span className="tabular-nums">{`${ui.words} word${ui.words === 1 ? "" : "s"} ·`}</span> : null}
          {status === "saving" ? "Saving…" : <><Icon name="check" size={13} /> All changes saved</>}
        </span>
      </div>

      {/* "/" menu */}
      {slash && slashItems.length > 0 && (
        <ul
          role="listbox"
          aria-label="Commands"
          className="fn-pop fixed z-[80] w-72 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] p-1 text-sm shadow-[var(--shadow)]"
          style={{ top: slash.y, left: Math.max(8, slash.x) }}
        >
          {slashItems.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === slash.active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); runSlash(c.id); }}
                onMouseEnter={() => setSlash({ ...slash, active: i })}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left ${i === slash.active ? "bg-[var(--hover)]" : ""}`}
              >
                <Icon name={c.icon} size={16} className="text-[var(--muted)]" />
                <span className="font-medium">{c.label}</span>
                <span className="ml-auto text-xs text-[var(--faint)]">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Minimal typing for the Web Speech API used by dictation.
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: (e: { error?: string }) => void; onend: () => void; start(): void; stop(): void;
};
