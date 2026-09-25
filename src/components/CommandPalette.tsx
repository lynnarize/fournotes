"use client";
// ⌘K / Ctrl+K: search everything (by words or meaning) and quick-add in one step.
//   t pay rent          -> task          n trip ideas   -> note
//   $ coffee 25k        -> expense       s call mom     -> quick note
//   ? how much on food  -> ask the assistant
import { useEffect, useMemo, useRef, useState } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { fmtDateTime } from "@/lib/client";
import { usePresence } from "@/lib/hooks";
import { openItem } from "@/lib/nav";
import { keywordSearch, semanticNotes } from "@/lib/search";
import { useTheme } from "@/lib/theme";
import { formatMoney, parseAmount, useStore } from "@/lib/store";
import type { Note, Tab } from "@/lib/types";
import { guessCategory } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import { Icon, useToast } from "./ui";
import { quickNote } from "@/lib/quickNote";

type Item = { key: string; group: string; label: string; hint?: string; icon: string; run: () => void };

export default function CommandPalette({ open, onClose, setTab, onSettings }: {
  open: boolean; onClose: () => void; setTab: (t: Tab) => void; onSettings: () => void;
}) {
  const presence = usePresence(open);
  useBackDismiss(open, onClose);
  const store = useStore();
  const { send, toggleVoice } = useAssistant();
  const theme = useTheme();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [semantic, setSemantic] = useState<{ q: string; notes: Note[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 3 || /^(t|todo|task|n|note|\$|spent|s|sticky|\?|ask)\s/i.test(query)) return;
    const h = setTimeout(() => {
      semanticNotes(store.notes, query, 5).then((r) => setSemantic({ q: query, notes: r.map((x) => x.note) })).catch(() => {});
    }, 350);
    return () => clearTimeout(h);
  }, [q, open, store.notes]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const out: Item[] = [];
    const quick = query.match(/^(t|todo|task|n|note|\$|spent|s|sticky|\?|ask)\s+(.+)$/i);

    if (quick) {
      const kind = quick[1].toLowerCase();
      const text = quick[2].trim();
      if (["t", "todo", "task"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "todo", label: `Add task “${text}”`, run: () => { const t = store.addTodo({ title: text }); toast(`✅ ${t.title}`); } });
        out.push({ key: "qa-ai", group: "Quick add", icon: "sparkle", label: "Let the assistant set the date & repeat", hint: text, run: () => send(`Add a task: ${text}`) });
      } else if (["n", "note"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "note", label: `New note “${text}”`, run: () => { const n = store.addNote({ title: text }); setTab("notes"); openItem("note", n.id); } });
      } else if (["$", "spent"].includes(kind)) {
        const amount = parseAmount(text);
        const merchant = text.replace(/(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b/gi, "").replace(/\b(di|at)\b/gi, "").replace(/\s{2,}/g, " ").trim() || "Expense";
        out.push(amount
          ? { key: "qa", group: "Quick add", icon: "finance", label: `Log ${formatMoney(amount, store.settings.currency)} at ${merchant}`, hint: guessCategory(text), run: () => { store.addTransaction({ merchant, amount, category: guessCategory(text) }); toast(`💸 ${merchant}`); } }
          : { key: "qa", group: "Quick add", icon: "finance", label: "Add an amount, e.g. “$ coffee 25k”", run: () => {} });
      } else if (["s", "sticky"].includes(kind)) {
        out.push({ key: "qa", group: "Quick add", icon: "note", label: `Quick note “${text}”`, run: () => { store.addNote(quickNote(text)); toast("📝 Quick note saved"); } });
      } else {
        out.push({ key: "qa", group: "Ask", icon: "sparkle", label: `Ask: ${text}`, run: () => send(text) });
      }
      return out;
    }

    if (query) {
      const hits = keywordSearch(store, query, 8);
      const seen = new Set(hits.map((h) => h.item.id));
      for (const h of hits) {
        if (h.kind === "note") out.push({ key: h.item.id, group: "Notes", icon: "note", label: h.item.title || "Untitled", hint: h.item.content.slice(0, 60), run: () => openItem("note", h.item.id) });
        if (h.kind === "todo") out.push({ key: h.item.id, group: "Tasks", icon: "todo", label: h.item.title, hint: h.item.done ? "done" : fmtDateTime(h.item.dueAt), run: () => openItem("todo", h.item.id) });
        if (h.kind === "transaction") out.push({ key: h.item.id, group: "Spending", icon: "finance", label: h.item.merchant, hint: `${formatMoney(h.item.amount, h.item.currency)} · ${h.item.date}`, run: () => openItem("transaction", h.item.id) });
      }
      if (semantic?.q === query) {
        for (const n of semantic.notes) {
          if (seen.has(n.id)) continue;
          out.push({ key: `sem-${n.id}`, group: "Related notes", icon: "sparkle", label: n.title || "Untitled", hint: n.content.slice(0, 60), run: () => openItem("note", n.id) });
        }
      }
      out.push({ key: "ask", group: "Ask", icon: "sparkle", label: `Ask the assistant: “${query}”`, run: () => send(query) });
    }

    const commands: Item[] = [
      { key: "go-today", group: "Go to", icon: "today", label: "Today", run: () => setTab("today") },
      { key: "go-notes", group: "Go to", icon: "note", label: "Notes", run: () => setTab("notes") },
      { key: "go-todo", group: "Go to", icon: "todo", label: "To-Do", run: () => setTab("todo") },
      { key: "go-finance", group: "Go to", icon: "finance", label: "Finance", run: () => setTab("finance") },
      { key: "new-note", group: "Create", icon: "plus", label: "New note", hint: "n …", run: () => { const n = store.addNote({ title: "" }); setTab("notes"); openItem("note", n.id); } },
      { key: "new-quick", group: "Create", icon: "note", label: "Quick note", hint: "s …", run: () => { setTab("today"); setTimeout(() => document.getElementById("quick-note-input")?.focus(), 350); } },
      theme.resolved === "dark"
        ? { key: "theme", group: "Actions", icon: "today", label: "Switch to light mode", hint: "theme", run: () => theme.setPref("light") }
        : { key: "theme", group: "Actions", icon: "moon", label: "Switch to dark mode", hint: "theme", run: () => theme.setPref("dark") },
      { key: "voice", group: "Actions", icon: "wave", label: "Voice assistant", run: toggleVoice },
      { key: "settings", group: "Actions", icon: "settings", label: "Settings & sync", run: onSettings },
    ];
    const lower = query.toLowerCase();
    out.push(...commands.filter((c) => !query || c.label.toLowerCase().includes(lower) || (c.hint ?? "").toLowerCase().includes(lower)));
    return out;
  }, [q, store, semantic, send, toggleVoice, toast, setTab, onSettings, theme]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);

  const run = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  if (!presence.mounted) return null;
  let lastGroup = "";

  return (
    <div className={`no-print fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] ${open ? "" : "pointer-events-none"}`}>
      <div className="fn-backdrop absolute inset-0 bg-black/30" data-state={presence.state} onMouseDown={onClose} aria-hidden />
      <div role="dialog" aria-modal aria-label="Search and quick add" data-state={presence.state}
        className="fn-dialog relative w-full max-w-xl overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow)]">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-3">
          <Icon name="search" className="text-[var(--faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % Math.max(1, items.length)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % Math.max(1, items.length)); }
              else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); run(items[active]); }
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search, or: t task · n note · $ coffee 25k · s quick note · ? question"
            aria-label="Search or quick add"
            className="input-plain w-full py-3 text-[15px]"
          />
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-[var(--faint)]">No results</li>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.key} role="option" aria-selected={i === active}>
                {header && <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">{header}</div>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${i === active ? "bg-[var(--hover)]" : ""}`}
                >
                  <Icon name={item.icon} size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="ml-auto truncate pl-3 text-xs text-[var(--faint)]">{item.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
