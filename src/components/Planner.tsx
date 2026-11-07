"use client";
// The Planner's two reading views. Day: a strip of dates, then tasks, calendar meetings and bills
// on one timeline with a line at the present moment. List: everything open, under Overdue, Today,
// This week and Later. Both use the one row: a ring, a title and a meta line. The board is in
// TodoView.tsx, and details open in the side sheet there.
import { useMemo, useState } from "react";
import { useCalendar } from "@/lib/calendar";
import { useFiledFlash } from "@/lib/highlight";
import { clockTime, meetingDetail, timeRange, type CalendarMeeting } from "@/lib/meetings";
import { rruleLabel } from "@/lib/recurrence";
import { formatMoney, useStore } from "@/lib/store";
import type { Todo } from "@/lib/types";
import { useRecordMeeting } from "./meetings";
import { Icon } from "./ui";

const DAY = 86_400_000;
const START = 3; // Days shown before today in the strip.
const STRIP = 14;

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const dayAt = (now: Date, offset: number) => { const x = dayStart(now); x.setDate(x.getDate() + offset); return x; };
const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const timed = (d: Date) => d.getHours() !== 0 || d.getMinutes() !== 0;

export function dayLabel(d: Date, now: Date) {
  const long = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return same(d, now) ? `Today, ${long}` : long;
}

type RowProps = { selected: boolean; onOpen: () => void; onToggle: () => void };

/** The one row, for a task. */
function TaskRow({ todo, meta, overdue, selected, onOpen, onToggle }: RowProps & { todo: Todo; meta?: string; overdue?: boolean }) {
  const { notes, settings } = useStore();
  const flash = useFiledFlash(todo.id);
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const tone = todo.done ? undefined : todo.doing ? "doing" : todo.priority === "high" ? "hi" : undefined;
  return (
    <li id={`todo-${todo.id}`} className={`row ${selected ? "row-selected" : ""} ${flash ? "fn-flash" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={`${todo.done ? "Mark not done" : "Complete"} ${todo.title || "Untitled task"}`}
        data-tone={tone}
        className={`check relative mt-px before:absolute before:-inset-3 before:content-[''] ${overdue ? "!border-[var(--danger)]" : ""}`}
        onClick={onToggle}
      >
        {todo.done && <Icon name="check" size={13} />}
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className={`row-title ${todo.done ? "text-[var(--text-muted)] line-through" : ""}`}>{todo.title || "Untitled task"}</span>
        {(meta || todo.rrule || note) && (
          <span className="row-meta">
            {meta && <span className={`tm fn-num ${overdue ? "!text-[var(--danger)]" : ""}`}>{meta}</span>}
            {todo.rrule && <span className="flex items-center gap-1"><Icon name="repeat" size={13} />{rruleLabel(todo.rrule)}</span>}
            {note && <span className="flex min-w-0 items-center gap-1"><Icon name="link" size={13} /><span className="truncate">{note.title || "Note"}</span></span>}
          </span>
        )}
      </button>
      {todo.bill && todo.bill.amount > 0 && (
        <span className="fn-num shrink-0 pt-px text-[15px] font-semibold">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency)}</span>
      )}
    </li>
  );
}

function MeetingRow({ meeting, today }: { meeting: CalendarMeeting; today: boolean }) {
  const { record, busy } = useRecordMeeting();
  const detail = meetingDetail(meeting);
  return (
    <li className="row items-center">
      <span className="mark" aria-hidden><i className="mark-event" /></span>
      <span className="min-w-0 flex-1">
        <span className="row-title truncate">{meeting.title}</span>
        <span className="row-meta"><span className="tm fn-num">{timeRange(meeting)}</span>{detail && <span>{detail}</span>}</span>
      </span>
      {today && (
        <button type="button" className="btn btn-primary btn-sm max-md:h-11" disabled={busy === meeting.id} onClick={() => void record(meeting, false)}>
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--spark)]" aria-hidden /> Record
        </button>
      )}
    </li>
  );
}

const SectionHead = ({ children, late }: { children: React.ReactNode; late?: boolean }) => (
  <h3 className={`pb-1.5 pt-[22px] text-[13px] font-semibold first:pt-3 ${late ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>{children}</h3>
);

export function PlannerDay({ todos, now, offset, setOffset, openId, onOpen, onToggle }: {
  todos: Todo[]; now: Date; offset: number; setOffset: (n: number) => void; openId: string | null;
  onOpen: (id: string) => void; onToggle: (t: Todo) => void;
}) {
  const cal = useCalendar();
  const [only, setOnly] = useState<"tasks" | "meetings" | "overdue" | null>(null);
  const day = dayAt(now, offset);
  const isToday = offset === 0;

  const tasksOn = (d: Date) => todos.filter((t) => t.dueAt && same(new Date(t.dueAt), d));
  const meetingsOn = (d: Date) => (cal.status === "connected" ? cal.meetings.filter((m) => same(new Date(m.start), d)) : []);

  const strip = useMemo(() => Array.from({ length: STRIP }, (_, i) => {
    const d = dayAt(now, i - START);
    return { d, offset: i - START, busy: tasksOn(d).some((t) => !t.done) || meetingsOn(d).length > 0 };
  }), [now.toDateString(), todos, cal.meetings]); // eslint-disable-line react-hooks/exhaustive-deps

  const overdue = isToday ? todos.filter((t) => !t.done && t.dueAt && new Date(t.dueAt) < dayStart(now)).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)) : [];
  const tasks = tasksOn(day);
  const meetings = meetingsOn(day);
  const open = tasks.filter((t) => !t.done);
  const floating = tasks.filter((t) => !timed(new Date(t.dueAt!)));
  // Tasks with a time and meetings, on one line through the day.
  const line = [
    ...tasks.filter((t) => timed(new Date(t.dueAt!))).map((t) => ({ at: new Date(t.dueAt!).getTime(), key: t.id, todo: t as Todo | null, meeting: null as CalendarMeeting | null })),
    ...meetings.map((m) => ({ at: new Date(m.start).getTime(), key: m.id, todo: null as Todo | null, meeting: m as CalendarMeeting | null })),
  ].sort((a, b) => a.at - b.at);
  const nowAt = isToday ? line.findIndex((x) => x.at > now.getTime()) : -1;

  const showTasks = only === null || only === "tasks";
  const showMeetings = only === null || only === "meetings";
  const shown = line.filter((x) => (x.todo ? showTasks : showMeetings));
  const pick = (k: NonNullable<typeof only>) => setOnly(only === k ? null : k);
  const row = (t: Todo, meta?: string, late?: boolean) => (
    <TaskRow key={t.id} todo={t} meta={meta} overdue={late} selected={openId === t.id} onOpen={() => onOpen(t.id)} onToggle={() => onToggle(t)} />
  );

  return (
    <>
      <div className="scroll-thin -mx-1.5 flex gap-0.5 overflow-x-auto px-1.5 pb-1.5 pt-0.5 [scrollbar-width:none]" role="group" aria-label="Pick a day">
        {strip.map((s) => (
          <button
            key={s.offset}
            type="button"
            onClick={() => { setOffset(s.offset); setOnly(null); }}
            aria-pressed={s.offset === offset}
            aria-label={s.d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            className="day"
            data-today={s.offset === 0 || undefined}
          >
            <span>{s.d.toLocaleDateString("en-US", { weekday: "short" })}</span>
            <b className="fn-num">{s.d.getDate()}</b>
            {s.busy && <i aria-hidden />}
          </button>
        ))}
      </div>

      <div className="sumbar">
        <span>{isToday ? "Today you have" : "That day has"}</span>
        <button type="button" className="chip-count" aria-pressed={only === "tasks"} onClick={() => pick("tasks")}>
          {open.length} {open.length === 1 ? "task" : "tasks"}
        </button>
        {meetings.length > 0 && (
          <button type="button" className="chip-count chip-red" aria-pressed={only === "meetings"} onClick={() => pick("meetings")}>
            <i aria-hidden /> {meetings.length} {meetings.length === 1 ? "meeting" : "meetings"}
          </button>
        )}
        {overdue.length > 0 && (
          <button type="button" className="chip-count chip-red" aria-pressed={only === "overdue"} onClick={() => pick("overdue")}>
            {overdue.length} overdue
          </button>
        )}
      </div>

      {overdue.length > 0 && (only === null || only === "overdue") && (
        <section aria-label="Overdue">
          <SectionHead late>Overdue</SectionHead>
          <ul className="flex flex-col">{overdue.map((t) => row(t, new Date(t.dueAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" }), true))}</ul>
        </section>
      )}

      {only !== "overdue" && (
        <section aria-label={isToday ? "Today" : "This day"}>
          <SectionHead>{isToday ? "Today" : day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</SectionHead>
          {shown.length === 0 && (showTasks ? floating.length === 0 : true) && <p className="py-3 text-[15px] text-[var(--text-muted)]">Nothing planned.</p>}
          <ul className="flex flex-col">
            {shown.map((x) => {
              const here = isToday && only === null && line[nowAt]?.key === x.key;
              return (
                <div key={x.key} className="contents">
                  {here && <NowLine now={now} />}
                  {x.todo ? row(x.todo, clockTime(new Date(x.at))) : <MeetingRow meeting={x.meeting!} today={isToday} />}
                </div>
              );
            })}
            {isToday && only === null && nowAt === -1 && line.length > 0 && <NowLine now={now} />}
          </ul>
        </section>
      )}

      {only !== "overdue" && only !== "meetings" && floating.length > 0 && (
        <section aria-label="Anytime">
          <SectionHead>Anytime</SectionHead>
          <ul className="flex flex-col">{floating.map((t) => row(t))}</ul>
        </section>
      )}
    </>
  );
}

const NowLine = ({ now }: { now: Date }) => (
  <li className="now-line" aria-label={`Now, ${clockTime(now)}`}><b className="fn-num">{clockTime(now)}</b><i aria-hidden /></li>
);

export function PlannerList({ todos, now, openId, onOpen, onToggle }: {
  todos: Todo[]; now: Date; openId: string | null; onOpen: (id: string) => void; onToggle: (t: Todo) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const today = dayStart(now).getTime();
  const open = todos.filter((t) => !t.done).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  const inGroup = (t: Todo) => {
    if (!t.dueAt) return "Later";
    const at = new Date(t.dueAt).getTime();
    if (at < today) return "Overdue";
    if (at < today + DAY) return "Today";
    return at < today + 7 * DAY ? "This week" : "Later";
  };
  const done = todos.filter((t) => t.done && t.completedAt && now.getTime() - Date.parse(t.completedAt) < 7 * DAY)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const whenOf = (t: Todo) => {
    if (!t.dueAt) return undefined;
    const d = new Date(t.dueAt);
    if (same(d, now)) return timed(d) ? clockTime(d) : undefined;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const row = (t: Todo, late = false) => (
    <TaskRow key={t.id} todo={t} meta={whenOf(t)} overdue={late} selected={openId === t.id} onOpen={() => onOpen(t.id)} onToggle={() => onToggle(t)} />
  );

  return (
    <>
      {(["Overdue", "Today", "This week", "Later"] as const).map((g) => {
        const items = open.filter((t) => inGroup(t) === g);
        if (!items.length) return null;
        return (
          <section key={g} aria-label={g}>
            <SectionHead late={g === "Overdue"}>{g}</SectionHead>
            <ul className="flex flex-col">{items.map((t) => row(t, g === "Overdue"))}</ul>
          </section>
        );
      })}
      {open.length === 0 && <p className="py-6 text-[15px] text-[var(--text-muted)]">Nothing open. Well done.</p>}
      {done.length > 0 && (
        <section aria-label="Done this week">
          <button type="button" className="flex items-center gap-1 pb-1.5 pt-[22px] text-[13px] font-semibold text-[var(--text-muted)]" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            Done this week · {done.length}
            <Icon name="chevronDown" size={14} className={`transition-transform ${showDone ? "rotate-180" : ""}`} />
          </button>
          {showDone && <ul className="flex flex-col">{done.map((t) => row(t))}</ul>}
        </section>
      )}
    </>
  );
}
