"use client";
import { useMemo, useState } from "react";
import { downloadIcs, fmtDateTime, googleCalendarUrl, toLocalInput } from "@/lib/client";
import { suggestReminder } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { openItem, scrollToId, useOpenItem } from "@/lib/nav";
import { makeRrule, parseRrule, rruleLabel, type Freq } from "@/lib/recurrence";
import { alive, formatMoney, parseAmount, useStore } from "@/lib/store";
import type { ExpenseCategory, Todo } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Icon, inputBox, useToast } from "./ui";

const PRIORITY_DOT = { high: "var(--danger)", medium: "#d9730d", low: "var(--faint)" };

function group(todos: Todo[]) {
  const now = new Date();
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const g: Record<string, Todo[]> = { Overdue: [], Today: [], Upcoming: [], "No date": [], Done: [] };
  for (const t of todos) {
    if (t.done) g.Done.push(t);
    else if (!t.dueAt) g["No date"].push(t);
    else if (new Date(t.dueAt) < now) g.Overdue.push(t);
    else if (new Date(t.dueAt) <= endToday) g.Today.push(t);
    else g.Upcoming.push(t);
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));
  g.Done = g.Done.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)).slice(0, 30);
  return g;
}

export default function TodoView() {
  const { todos, addTodo } = useStore();
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => group(alive(todos)), [todos]);
  const [perm, setPerm] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "denied"));

  useOpenItem("todo", (f) => {
    setOpenId(f.id);
    scrollToId(`todo-${f.id}`);
  });

  return (
    <div>
      {perm === "default" && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-[var(--sticky-blue)] px-3 py-2 text-sm">
          <Icon name="bell" /> Allow notifications so reminders can pop up.
          <button className="ml-auto rounded-md bg-[var(--text)] px-2 py-1 text-xs text-[var(--bg)]"
            onClick={() => Notification.requestPermission().then(setPerm)}>Enable</button>
        </div>
      )}

      <form
        className="mb-6 flex items-center gap-2 border-b border-[var(--line)] pb-2"
        onSubmit={(e) => { e.preventDefault(); if (title.trim()) { addTodo({ title: title.trim() }); setTitle(""); } }}
      >
        <Icon name="plus" className="text-[var(--faint)]" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task — or ask the assistant for a reminder"
          aria-label="New task" className="input-plain flex-1 py-1 text-sm" />
      </form>

      {alive(todos).length === 0 && (
        <EmptyStart
          title="Nothing to do yet"
          hint="Type a task above, or ask the assistant — it understands dates, reminders and repeats."
          prompts={["Remind me to pay rent every month on the 5th at 9am", "Call the dentist tomorrow at 10am"]}
        />
      )}

      {Object.entries(groups).map(([name, items]) =>
        items.length === 0 ? null : (
          <section key={name} className="mb-6">
            <h3 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${name === "Overdue" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
              {name} <span className="font-normal text-[var(--faint)]">{items.length}</span>
            </h3>
            <ul>
              {items.map((t) => (
                <TodoRow key={t.id} todo={t} open={openId === t.id} setOpen={(o) => setOpenId(o ? t.id : null)} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function TodoRow({ todo, open, setOpen }: { todo: Todo; open: boolean; setOpen: (o: boolean) => void }) {
  const { updateTodo, toggleTodo, remove, notes, todos, settings, categories } = useStore();
  const toast = useToast();
  const [suggestion, setSuggestion] = useState<{ at: string; reason: string } | null>(null);
  const justFiled = useFiledFlash(todo.id);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const rule = parseRrule(todo.rrule);

  const autoSuggestion = useMemo(
    () => (open && !todo.done && !todo.remindAt ? suggestReminder(todo, todos) : null),
    [open, todo, todos],
  );
  const shown = suggestion ?? autoSuggestion;

  const toggle = (done: boolean) => {
    const extra = toggleTodo(todo.id, done);
    if (extra.length) toast(extra.join("\n"));
  };

  return (
    <li id={`todo-${todo.id}`} className={`group rounded-md hover:bg-[var(--hover)] ${open ? "bg-[var(--hover)]" : ""} ${justFiled ? "fn-flash" : ""}`}>
      <div className="flex items-start gap-2 px-1 py-1.5">
        <input type="checkbox" checked={todo.done} onChange={(e) => toggle(e.target.checked)}
          className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--accent)]" aria-label="Done" />
        <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[todo.priority] }} />
        {/* Narrow screens: the title gets its own line and chips wrap below it instead of squeezing it. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
          <input value={todo.title} onChange={(e) => updateTodo(todo.id, { title: e.target.value })} aria-label="Task title"
            className={`input-plain w-full min-w-0 text-[15px] leading-[22px] lg:flex-1 lg:text-sm ${todo.done ? "text-[var(--faint)] line-through" : ""}`} />
          {(note || todo.bill || todo.rrule || todo.dueAt || (todo.remindAt && !todo.done)) && (
            <div className="flex flex-wrap items-center gap-1 lg:shrink-0 lg:flex-nowrap">
              {note && (
                <button className="chip max-w-[12rem] hover:bg-[var(--line)]" onClick={() => openItem("note", note.id)} title="Open linked note">
                  <Icon name="link" size={11} /><span className="truncate">{note.title || "Note"}</span>
                </button>
              )}
              {todo.bill && <span className="chip">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency, true)}</span>}
              {todo.rrule && <span className="chip" title={rruleLabel(todo.rrule)}><Icon name="repeat" size={11} />{rruleLabel(todo.rrule).replace("Every ", "")}</span>}
              {todo.dueAt && <span className="chip"><Icon name="calendar" size={11} />{fmtDateTime(todo.dueAt)}</span>}
              {todo.remindAt && !todo.done && <span className="chip" title={`Reminder ${fmtDateTime(todo.remindAt)}`}><Icon name="bell" size={11} /></span>}
            </div>
          )}
        </div>
        <button className="btn-ghost shrink-0" onClick={() => setOpen(!open)} aria-label="Details" aria-expanded={open}>
          <Icon name="chevron" size={14} className={open ? "rotate-90 transition" : "transition"} />
        </button>
      </div>

      {open && (
        <div className="grid gap-3 px-3 pb-3 text-sm sm:grid-cols-2 sm:px-8">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Due
            <input type="datetime-local" value={toLocalInput(todo.dueAt)}
              onChange={(e) => updateTodo(todo.id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className={inputBox} />
          </label>
          <div className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            <label className="flex flex-col gap-1">Remind me
              <input type="datetime-local" value={toLocalInput(todo.remindAt)}
                onChange={(e) => { setSuggestion(null); updateTodo(todo.id, { remindAt: e.target.value ? new Date(e.target.value).toISOString() : null, reminded: false }); }}
                className={inputBox} />
            </label>
            {shown ? (
              <div className="flex items-center gap-2 rounded bg-[var(--sticky-blue)] px-2 py-1 text-[var(--text)]">
                <Icon name="sparkle" size={12} />
                <span className="min-w-0 flex-1"><b>{fmtDateTime(shown.at)}</b> · {shown.reason}</span>
                <button className="font-medium text-[var(--accent)]" onClick={() => { updateTodo(todo.id, { remindAt: shown.at, reminded: false }); setSuggestion(null); }}>Use</button>
              </div>
            ) : (
              !todo.done && (
                <button className="self-start text-[var(--accent)]" onClick={() => {
                  const s = suggestReminder(todo, todos);
                  if (s) setSuggestion(s);
                  else toast("Complete a few tasks first so the app can learn when you usually get things done.");
                }}>✨ Suggest a time</button>
              )
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Priority
            <select value={todo.priority} onChange={(e) => updateTodo(todo.id, { priority: e.target.value as Todo["priority"] })} className={inputBox}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </label>

          <div className="flex flex-col gap-1 text-xs text-[var(--muted)]">Repeat
            <div className="flex gap-2">
              <select
                aria-label="Repeat frequency"
                value={rule?.freq ?? ""}
                onChange={(e) => updateTodo(todo.id, { rrule: e.target.value ? makeRrule(e.target.value as Freq, rule?.interval ?? 1) : null })}
                className={`${inputBox} flex-1`}
              >
                <option value="">Doesn&apos;t repeat</option>
                <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
              </select>
              {rule && (
                <label className="flex items-center gap-1">every
                  <input type="number" min={1} max={99} value={rule.interval} aria-label="Repeat interval"
                    onChange={(e) => updateTodo(todo.id, { rrule: makeRrule(rule.freq, Math.max(1, Number(e.target.value) || 1)) })}
                    className={`${inputBox} w-14`} />
                </label>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 text-xs text-[var(--muted)]">Bill (logs spending when done)
            <div className="flex gap-2">
              <input
                key={todo.bill?.amount ?? "none"}
                defaultValue={todo.bill?.amount ?? ""}
                placeholder="Amount, e.g. 350k"
                inputMode="decimal"
                aria-label="Bill amount"
                onBlur={(e) => {
                  const amount = e.target.value.trim() ? parseAmount(e.target.value) : null;
                  updateTodo(todo.id, { bill: amount ? { amount, category: todo.bill?.category ?? "Bills & Utilities", currency: todo.bill?.currency } : null });
                }}
                className={`${inputBox} min-w-0 flex-1`}
              />
              <select
                aria-label="Bill category"
                value={todo.bill?.category ?? "Bills & Utilities"}
                disabled={!todo.bill}
                onChange={(e) => todo.bill && updateTodo(todo.id, { bill: { ...todo.bill, category: e.target.value as ExpenseCategory } })}
                className={`${inputBox} w-32`}
              >
                {categories.filter((c) => c !== "Income").map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Linked note
            <select value={todo.noteId ?? ""} onChange={(e) => updateTodo(todo.id, { noteId: e.target.value || null })} className={inputBox}>
              <option value="">None</option>
              {alive(notes).map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
            </select>
          </label>

          <textarea value={todo.notes ?? ""} onChange={(e) => updateTodo(todo.id, { notes: e.target.value })} placeholder="Notes"
            aria-label="Task notes" className={`${inputBox} sm:col-span-2`} rows={2} />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <a className="btn-ghost border border-[var(--line)]" href={googleCalendarUrl(todo)} target="_blank" rel="noreferrer">
              + Google Calendar
            </a>
            <button className="btn-ghost border border-[var(--line)]" onClick={() => downloadIcs(todo)}>
              + Apple / Outlook (.ics)
            </button>
            {todo.rrule && <span className="self-center text-xs text-[var(--muted)]">{rruleLabel(todo.rrule)} · completing it schedules the next one</span>}
            <button className="btn-ghost ml-auto text-[var(--danger)]" onClick={() => remove("todos", todo.id)}>Delete</button>
          </div>
        </div>
      )}
    </li>
  );
}
