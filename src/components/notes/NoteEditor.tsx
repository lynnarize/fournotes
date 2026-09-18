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

const Divider = () => <span className="mx-1 h-6 w-px shrink-0 bg-[var(--line)]" aria-hidden />;

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
    const copyNote = store.addNote({ title: `${note.title || "Untitled"} (copy)`, content: plain(), html: editor?.getHTML(), tags: [...note.tags] });
    openItem("note", copyNote.id);
    toast("Duplicated");
  };

  const del = () => {
    if (!window.confirm(`Delete “${note.title || "Untitled"}”?`)) return;
    store.remove("notes", note.id);
    toast("Note deleted");
    onBack?.();
  };

  const addTag = (raw: string) => {
    const tag = raw.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
    if (tag && !note.tags.includes(tag)) store.updateNote(note.id, { tags: [...note.tags, tag] });
    setTagDraft(null);
  };

  const setReminder = (value: string) => {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return;
    store.addTodo({ title: note.title || "Look at this note", noteId: note.id, dueAt: at.toISOString(), remindAt: at.toISOString() });
    toast(`⏰ Reminder set for ${fmtDateTime(at.toISOString())}`);
  };

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

  return (
    <div
      data-anim={anim}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) onAnimDone?.(); }}
      className={`note-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg)] ${
        focusMode ? "fixed inset-0 z-[45] pt-[env(safe-area-inset-top)]" : "rounded-2xl border border-[var(--line)] md:shadow-[var(--shadow)]"
      }`}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 md:px-4 md:pt-3">
        {onBack ? (
          <button className="tb-btn gap-1 pr-2" onClick={onBack} aria-label="Back to notes">
            <Icon name="chevronLeft" size={20} /> <span className="text-sm">Notes</span>
          </button>
        ) : (
          onToggleList && <TB icon={listHidden ? "collapseRight" : "collapseLeft"} label={listHidden ? "Show note list" : "Hide note list"} onClick={onToggleList} />
        )}
        <TB icon={focusMode ? "shrink" : "expand"} label={focusMode ? "Exit focus mode" : "Focus mode"} onClick={onToggleFocus} />
        <span className="mx-1 hidden h-6 w-px bg-[var(--line)] sm:block" aria-hidden />
        <nav className="hidden min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-[var(--muted)] sm:flex" aria-label="Breadcrumb">
          <span>Notes</span>
          <Icon name="chevron" size={13} />
          <span className="truncate text-[var(--text)]">{note.title || "Untitled"}</span>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex overflow-hidden rounded-lg bg-[var(--accent)] text-white">
            <button className="flex min-h-9 items-center gap-1.5 px-3 text-sm font-medium hover:brightness-110" onClick={share}>
              <Icon name="share" size={15} /> Share
            </button>
            <button className="grid min-h-9 w-9 place-items-center border-l border-white/25 hover:brightness-110" onClick={copy} aria-label="Copy note text" title="Copy note text">
              <Icon name="copy" size={15} />
            </button>
          </div>
          <Dropdown label="More actions" button={<Icon name="more" size={20} />} width={220}>
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

      {/* Toolbar */}
      <div className="note-toolbar scroll-thin flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 md:px-4">
        <Dropdown label="Insert" button={<span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-white"><Icon name="plus" size={15} /></span>} width={230}>
          {(close) => (
            <>
              <MenuItem icon="checklist" label="Checklist" onSelect={() => { close(); chain().toggleTaskList().run(); }} />
              <MenuItem icon="listBullet" label="Bulleted list" onSelect={() => { close(); chain().toggleBulletList().run(); }} />
              <MenuItem icon="listOrdered" label="Numbered list" onSelect={() => { close(); chain().toggleOrderedList().run(); }} />
              <MenuItem icon="quote" label="Quote" onSelect={() => { close(); chain().toggleBlockquote().run(); }} />
              <MenuItem icon="code" label="Code block" onSelect={() => { close(); chain().toggleCodeBlock().run(); }} />
              <MenuItem icon="divider" label="Divider" onSelect={() => { close(); chain().setHorizontalRule().run(); }} />
              <MenuSep />
              <MenuItem icon="link" label="Link" onSelect={() => { close(); insertLink(); }} />
              <MenuItem icon="calendar" label="Today's date" onSelect={() => { close(); chain().insertContent(today()).run(); }} />
              <MenuItem icon="calendar" label="Current time" onSelect={() => { close(); chain().insertContent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })).run(); }} />
            </>
          )}
        </Dropdown>
        <TB icon="mic" label={listening ? "Stop dictation" : "Dictate"} onClick={dictate} active={listening} className={listening ? "recording text-[var(--danger)]" : ""} />
        <TB icon="checklist" label="Checklist" onClick={() => chain().toggleTaskList().run()} active={ui?.task} />
        <TB icon="calendar" label="Insert today's date" onClick={() => chain().insertContent(today()).run()} />
        <Divider />
        <TB icon="undo" label="Undo" onClick={() => chain().undo().run()} disabled={!ui?.canUndo} />
        <TB icon="redo" label="Redo" onClick={() => chain().redo().run()} disabled={!ui?.canRedo} />
        <Divider />
        <Dropdown label="AI" title="AI writing help" button={<><Icon name="sparkle" size={18} className="text-[var(--accent)]" /><span className="text-sm font-medium">AI</span></>} width={250}>
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
        <Divider />
        <Dropdown label="Text style" button={<Icon name="textSize" size={19} />} width={210}>
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
        <Dropdown label="Font" button={<span className="max-w-[7.5rem] truncate text-sm">{fontLabel}</span>} width={210}>
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
        <TB icon="bold" label="Bold (⌘B)" onClick={() => chain().toggleBold().run()} active={ui?.bold} />
        <TB icon="italic" label="Italic (⌘I)" onClick={() => chain().toggleItalic().run()} active={ui?.italic} />
        <TB icon="underline" label="Underline (⌘U)" onClick={() => chain().toggleUnderline().run()} active={ui?.underline} />
        <Dropdown label="More formatting" button={<span className="text-sm">More</span>} width={260}>
          {(close) => (
            <>
              <MenuLabel>Font color</MenuLabel>
              <div className="flex flex-wrap gap-1.5 px-2.5 pb-1">
                {TEXT_COLORS.map((c) => (
                  <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Text color ${c.label}`}
                    onClick={() => { close(); if (c.value) chain().setColor(c.value).run(); else chain().unsetColor().run(); }}
                    className={`grid h-8 w-8 place-items-center rounded-lg border hover:scale-105 ${(ui?.color ?? "") === c.value ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
                  >
                    <span className="text-[15px] font-semibold" style={{ color: c.value || "var(--text)" }}>A</span>
                  </button>
                ))}
              </div>
              <MenuLabel>Highlight</MenuLabel>
              <div className="flex flex-wrap gap-1.5 px-2.5 pb-1">
                {HIGHLIGHTS.map((c) => (
                  <button key={c.label} type="button" onMouseDown={keep} title={c.label} aria-label={`Highlight ${c.label}`}
                    onClick={() => { close(); if (c.value) chain().setHighlight({ color: c.value }).run(); else chain().unsetHighlight().run(); }}
                    className="h-8 w-8 rounded-lg border border-[var(--line)] hover:scale-105"
                    style={{ background: c.value || "linear-gradient(135deg, transparent 45%, var(--danger) 47%, var(--danger) 53%, transparent 55%)" }}
                  />
                ))}
              </div>
              <MenuSep />
              <MenuItem icon="strike" label="Strikethrough" active={ui?.strike} onSelect={() => chain().toggleStrike().run()} />
              <MenuItem icon="superscript" label="Superscript" active={ui?.superscript} onSelect={() => chain().toggleSuperscript().run()} />
              <MenuItem icon="subscript" label="Subscript" active={ui?.subscript} onSelect={() => chain().toggleSubscript().run()} />
              <MenuSep />
              <MenuItem icon="listBullet" label="Bulleted list" active={ui?.bullet} onSelect={() => { close(); chain().toggleBulletList().run(); }} />
              <MenuItem icon="listOrdered" label="Numbered list" active={ui?.ordered} onSelect={() => { close(); chain().toggleOrderedList().run(); }} />
              <MenuItem icon="checklist" label="Checklist" active={ui?.task} onSelect={() => { close(); chain().toggleTaskList().run(); }} />
              <MenuItem icon="link" label="Insert link" onSelect={() => { close(); insertLink(); }} />
              <MenuSep />
              <MenuItem icon="alignLeft" label="Left-align" active={ui?.align === "left"} onSelect={() => chain().setTextAlign("left").run()} />
              <MenuItem icon="alignCenter" label="Center-align" active={ui?.align === "center"} onSelect={() => chain().setTextAlign("center").run()} />
              <MenuItem icon="alignRight" label="Right-align" active={ui?.align === "right"} onSelect={() => chain().setTextAlign("right").run()} />
              <MenuItem icon="indent" label="Indent" onSelect={() => {
                if (!ui?.inList) return toast("Indent works inside lists and checklists.");
                chain().sinkListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run();
              }} />
              <MenuItem icon="outdent" label="Outdent" onSelect={() => {
                if (!ui?.inList) return;
                chain().liftListItem(editor!.isActive("taskItem") ? "taskItem" : "listItem").run();
              }} />
              <MenuSep />
              <MenuItem icon="eraser" label="Clear formatting" onSelect={() => { close(); chain().unsetAllMarks().clearNodes().run(); }} />
            </>
          )}
        </Dropdown>
      </div>

      {/* Writing area: the only part that scrolls. */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 md:px-12 md:pt-10">
        <div className={`fn-note-in mx-auto ${focusMode ? "max-w-3xl" : "max-w-[46rem]"}`}>
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
            className="input-plain block w-full resize-none overflow-hidden text-[2.25rem] font-bold leading-tight tracking-tight md:text-[2.6rem]"
          />

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
      <div className={`flex shrink-0 flex-wrap items-center gap-1 border-t border-[var(--line)] px-2 py-1.5 pr-20 md:pl-4 md:pr-24 ${focusMode ? "pb-[calc(env(safe-area-inset-bottom)+6px)]" : "rounded-b-2xl"}`}>
        <Dropdown label="Set a reminder" button={<Icon name="bell" size={18} />} width={250}>
          {(close) => (
            <form
              className="space-y-2 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = (e.currentTarget.elements.namedItem("when") as HTMLInputElement).value;
                close();
                setReminder(v);
              }}
            >
              <p className="text-sm font-medium">Remind me about this note</p>
              <input name="when" type="datetime-local" defaultValue={tomorrow9} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 text-sm" />
              <button className="min-h-9 w-full rounded-md bg-[var(--accent)] text-sm font-medium text-white">Set reminder</button>
            </form>
          )}
        </Dropdown>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {note.tags.map((t) => (
            <span key={t} className="chip min-h-7 gap-1">
              #{t}
              <button onClick={() => store.updateNote(note.id, { tags: note.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`} className="opacity-60 hover:opacity-100">
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          {tagDraft === null ? (
            <button className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => setTagDraft("")}>
              <Icon name="tag" size={15} /> Add tag
            </button>
          ) : (
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
                if (e.key === "Escape") setTagDraft(null);
              }}
              onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
              placeholder="tag name"
              aria-label="New tag"
              className="h-8 w-28 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 text-sm"
            />
          )}
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--faint)]" role="status">
          {ui?.words ? `${ui.words} word${ui.words === 1 ? "" : "s"} · ` : ""}
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
