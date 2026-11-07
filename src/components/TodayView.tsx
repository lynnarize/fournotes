"use client";
// Today, on two sheets. The main one: the greeting, the summary (one line, then only what needs
// you, each with one button) and the assistant under it. The side one, at a glance: the next
// meeting (record it in one click), what's due (tick it off right here), what you've spent today
// and quick notes. Phones stack it all, with the assistant docked above the tab bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { useBriefStyle } from "@/lib/briefParagraph";
import { connectCalendar, useCalendar } from "@/lib/calendar";
import { api, localIso } from "@/lib/client";
import { fingerprint } from "@/lib/fingerprint";
import { useFiledFlash } from "@/lib/highlight";
import { greetingFor, useNow, useOnline } from "@/lib/hooks";
import { budgetStatus, detectSubscriptions, myShare, owedToMe } from "@/lib/insights";
import { clockTime, meetingDetail, talkFor, timeRange, type CalendarMeeting } from "@/lib/meetings";
import { openAssistant, openItem } from "@/lib/nav";
import { isQuick, quickNote } from "@/lib/quickNote";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import { useTalks } from "@/lib/talks/db";
import { stuckTasks } from "@/lib/tasks";
import { useRecorder } from "@/lib/talks/recorder";
import type { BriefInput, Note, Tab, Todo } from "@/lib/types";
import { useAssistant } from "./assistant";
import { Glyph } from "./assistant/icons";
import ChatDock from "./ChatDock";
import { useRecordMeeting, useStoredFlag } from "./meetings";
import { SampleDataButton } from "./SampleData";
import { Icon, useToast } from "./ui";

const QUIET = "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] disabled:opacity-40";
const HEAD_LINK = "flex min-h-8 items-center rounded-full px-1 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--foreground)]";

export default function TodayView({ setTab }: { setTab: (t: Tab) => void }) {
  const { todos, transactions, stickies, notes, settings, briefs, saveBrief, toggleTodo, addNote, remove } = useStore();
  const { todayChat } = useAssistant();
  const toast = useToast();
  const online = useOnline();
  const now = useNow();
  const [style, setStyle] = useBriefStyle();
  const [loading, setLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const cur = settings.currency;
  const today = localDate(now);
  const yesterday = (() => { const d = new Date(now); d.setDate(d.getDate() - 1); return localDate(d); })();

  const tasks = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return alive(todos)
      .filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  }, [todos]);
  /** The next week's tasks, after today. */
  const upcoming = useMemo(() => {
    const start = new Date();
    start.setHours(23, 59, 59, 999);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return alive(todos)
      .filter((t) => !t.done && t.dueAt && new Date(t.dueAt) > start && new Date(t.dueAt) <= end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
      .slice(0, 2);
  }, [todos]);
  const focus = useMemo(
    () => (tasks.length ? [] : alive(todos).filter((t) => !t.done && !t.dueAt && t.priority === "high").slice(0, 3)),
    [todos, tasks.length],
  );
  const ySpend = useMemo(() => alive(transactions).filter((t) => t.date === yesterday && t.amount > 0), [transactions, yesterday]);
  const yTotal = ySpend.reduce((s, t) => s + myShare(t, cur), 0);
  // Quick notes (they replaced stickies): newest first; today's go into the brief.
  const quick = useMemo(() => alive(notes).filter(isQuick).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [notes]);
  const quickToday = quick.filter((n) => localDate(new Date(n.createdAt)) === today);

  const alerts = useMemo(() => {
    const out: string[] = [];
    const live = alive(transactions);
    for (const b of budgetStatus(live.filter((t) => t.date.startsWith(localMonth())), settings)) {
      if (b.ratio >= 0.8) out.push(`${b.category} budget ${Math.round(b.ratio * 100)}% used (${formatMoney(b.spent, cur, true)} of ${formatMoney(b.limit, cur, true)})`);
    }
    const weekAhead = Date.now() + 7 * 86_400_000;
    for (const s of detectSubscriptions(live)) {
      if (Date.parse(s.nextDate) <= weekAhead) {
        out.push(`${s.merchant} will likely charge ${formatMoney(s.amount, s.currency)} around ${new Date(`${s.nextDate}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`);
      }
    }
    for (const [name, amount] of owedToMe(live, cur).slice(0, 3)) out.push(`${name} still owes you ${formatMoney(amount, cur)}`);
    return out;
  }, [transactions, settings, cur]);

  // A brief written by a model thinking out loud is treated as missing, so it's rewritten.
  const brief = briefs.find((b) => b.date === today && !looksLikeThinking(b.text));
  const briefLines = (brief?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const isEmptyApp = !alive(todos).length && !alive(transactions).length && !alive(notes).length;

  /** What the written brief is written from, as a short fingerprint. */
  const basis = fingerprint([
    today,
    tasks.slice(0, 15).map((t) => `${t.title}|${t.dueAt ?? ""}`).join(";"),
    `${ySpend.length}|${Math.round(ySpend.reduce((s, t) => s + t.amount, 0))}`,
    quickToday.slice(0, 5).map((n) => n.content).join(";"),
    alerts.join(";"),
  ].join("#"));

  /** `asked`: Refresh was pressed. The automatic rewrite fails quietly: a busy free model shouldn't put up an error each time. */
  const write = async (asked: boolean) => {
    if (loading) return;
    setLoading(true);
    try {
      const at = new Date();
      const input: BriefInput = {
        now: localIso(at),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: cur,
        name: settings.name,
        tasksToday: tasks.slice(0, 15).map((t) => ({ title: t.title, dueAt: t.dueAt, overdue: new Date(t.dueAt!) < at })),
        yesterdaySpend: ySpend.slice(0, 30).map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category })),
        stickies: quickToday.map((n) => n.content).slice(0, 5),
        alerts,
      };
      const { text } = await api.brief(input);
      saveBrief({ date: today, text, basis });
      setBriefError(null);
    } catch (e) {
      if (asked) setBriefError(`Couldn't write the brief: ${e instanceof Error ? e.message : "try again"}. The last one is still shown.`);
    } finally {
      setLoading(false);
    }
  };

  // Point by point, the written brief is rewritten whenever what it's written from changes:
  // a task done, a quick note, yesterday's spending. The paragraph needs no model at all.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (style !== "points" || !online || brief?.basis === basis || requested.current === basis) return;
    // Let a burst of edits settle; a newer change cancels this one.
    const t = setTimeout(() => { requested.current = basis; write(false); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, online, basis, brief?.basis]);

  // Stickies are gone: any left from before become quick notes, once.
  useEffect(() => {
    const left = alive(stickies);
    if (!left.length) return;
    for (const st of left) {
      // Keep the sample flag, so "Remove sample data" still removes it.
      if (st.text.trim()) addNote({ ...quickNote(st.text), sample: st.sample });
      remove("stickies", st.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickies.length]);

  const complete = (t: Todo) => {
    const extra = toggleTodo(t.id, true);
    toast([`Done: ${t.title}`, ...extra].join("\n"));
  };

  const firstName = settings.name?.trim().split(/\s+/)[0];
  // Only the heads-ups the written brief didn't already say.
  const said = briefLines.map((l) => l.toLowerCase());
  const freshAlerts = alerts.filter((a) => !said.some((l) => l.includes(a.toLowerCase().slice(0, 18))));

  // While you chat, the card takes the brief's place under the greeting; the rest of Today stays.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 max-md:pb-[calc(var(--tabbar-space)+96px)] md:flex-row md:gap-3">
      <section className={`sheet flex min-w-0 flex-[999_1_560px] flex-col gap-6 md:overflow-y-auto md:px-8 md:pt-7 md:pb-8 ${todayChat ? "" : "max-md:pb-10"}`}>
        <div>
          <h2 className="fn-display text-[34px] md:text-[40px]">{greetingFor(now)}{firstName ? `, ${firstName}` : ""}</h2>
          <p className="mt-1.5 text-[15px] text-[var(--text-muted)]">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        </div>

        {!todayChat && (
          <>
          {isEmptyApp ? (
            <div className="fn-rise flex max-w-[600px] flex-col items-start gap-4">
              <p className="text-[16px] leading-[1.6] text-[var(--text-secondary)] md:text-[18px]">
                Nothing here yet. Tell the assistant what you need: a note, a task, or something you spent. Or look around with some sample data first.
              </p>
              <SampleDataButton label="Explore with sample data" className="btn btn-secondary" />
            </div>
          ) : (
            <Summary
              tasks={tasks}
              alerts={alerts}
              written={style === "points" ? briefLines.slice(0, 3) : []}
              freshAlerts={freshAlerts}
              loading={loading}
              onRewrite={style === "points" && online ? () => write(true) : undefined}
              onMoney={() => setTab("finance")}
            />
          )}
          {briefError && style === "points" && <p className="fn-rise -mt-3 text-[13px] text-[var(--text-secondary)]">{briefError}</p>}
          </>
        )}

        <div className="flex flex-col gap-6">
          <ChatDock hero />
        </div>
      </section>

      <aside aria-label="At a glance" className="sheet sheet-side max-md:max-w-none max-md:p-0 md:flex md:flex-col">
        <h2 className="mb-3 text-[24px] font-bold leading-[1.1] tracking-[-0.025em]">At a glance</h2>
        <NextMeeting onAll={() => setTab("transcribe")} />
        <DueToday tasks={tasks} upcoming={upcoming} focus={focus} onDone={complete} onAll={() => setTab("todo")} />
        <SpentToday onOpen={() => setTab("finance")} yTotal={yTotal} />
        <QuickNotes quick={quick} onMore={() => setTab("notes")} />
      </aside>
    </div>
  );
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, one: string, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;
const capitalised = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The summary: one line for the day, then only what needs you, each with one button. Written from
 * your own data, so it's there at once. With "Written by the assistant" in Settings, the
 * assistant's lines take the rows' place.
 */
function Summary({ tasks, alerts, written, freshAlerts, loading, onRewrite, onMoney }: {
  tasks: Todo[]; alerts: string[]; written: string[]; freshAlerts: string[]; loading: boolean;
  onRewrite?: () => void; onMoney: () => void;
}) {
  const { todos } = useStore();
  const cal = useCalendar();
  const now = useNow(60_000);
  const view = cal.status === "connected" ? nextMeeting(cal.meetings, now) : null;
  const meeting = view && new Date(view.meeting.start).toDateString() === now.toDateString() ? view.meeting : null;
  const meetings = cal.status === "connected" ? cal.meetings.filter((m) => new Date(m.start).toDateString() === now.toDateString() && new Date(m.end ?? m.start) >= now).length : 0;

  const stuck = stuckTasks(alive(todos), now.getTime())[0];
  const task = stuck?.todo ?? tasks[0];
  const money = alerts[0]?.match(/^(.*?)\s*\((.*)\)$/);
  const rows: { key: string; icon: string; tone: string; title: string; meta: ReactNode; action: string; run: () => void }[] = [];
  if (meeting) rows.push({
    key: "meeting", icon: "wave", tone: "tile-red", title: `${meeting.title} at ${clockTime(new Date(meeting.start))}`,
    meta: meetingDetail(meeting) || timeRange(meeting), action: "Prepare", run: () => openAssistant(`Prepare me for ${meeting.title}: `),
  });
  if (task) rows.push({
    key: "task", icon: stuck ? "clock" : "todo", tone: stuck ? "tile-amber" : "tile-ink", title: task.title || "Untitled task",
    meta: stuck ? <span className="font-semibold text-[var(--warning)]">{capitalised(stuck.why)}</span> : task.dueAt ? <span className="tm">{dueWord(task, now)}</span> : "",
    action: "Start", run: () => openItem("todo", task.id),
  });
  if (alerts[0]) rows.push({
    key: "money", icon: "wallet", tone: "tile-amber", title: money?.[1] ?? alerts[0], meta: money?.[2] ?? "", action: "Review", run: onMoney,
  });

  const parts = [meetings ? count(meetings, "meeting") : "", tasks.length ? count(tasks.length, "task") : ""].filter(Boolean);
  const load = meetings + tasks.length;
  const line = !load ? "A clear day." : `${load <= 6 ? "A light day" : "A full day"}: ${parts.join(", ")}.`;

  return (
    <section aria-label="Summary of your day" className="fn-rise max-w-[920px]">
      <div className="flex items-center gap-2.5 text-[13px] text-[var(--text-muted)]">
        <span className="ai-chip"><Icon name="sparkle" size={14} /> Summary</span>
        <span className="flex-1" />
        {onRewrite && (
          <button type="button" className="btn btn-secondary btn-icon" onClick={onRewrite} disabled={loading} aria-label={loading ? "Writing…" : "Write the summary again"} title="Write the summary again">
            <Icon name="repeat" size={16} />
          </button>
        )}
      </div>
      <p className="mt-3.5 text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] md:text-[28px]">
        {line}{rows.length > 0 && <span className="text-[var(--text-muted)]"> {capitalised(count(rows.length, "thing"))} {rows.length === 1 ? "needs" : "need"} you.</span>}
      </p>
      {written.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2.5 text-[16px] leading-[1.6] text-[var(--text-secondary)]">
          {written.map((l, i) => {
            const { glyph, text } = leadingEmoji(l);
            return <Row key={i} glyph={glyph}>{text}</Row>;
          })}
          {freshAlerts.slice(0, 2).map((a) => (
            <Row key={a} glyph={<Glyph name="warning" size={16} className="text-[var(--warning)]" />}>{a}</Row>
          ))}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-0.5">
          {rows.map((r) => (
            <li key={r.key} className="row items-center">
              <span className={`tile ${r.tone}`} aria-hidden><Icon name={r.icon} size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="row-title truncate">{r.title}</span>
                {r.meta && <span className="row-meta">{r.meta}</span>}
              </span>
              <button type="button" className="btn btn-secondary btn-sm max-md:h-11" onClick={r.run}>{r.action}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** When a task is due, in a word or two: the time today, otherwise the day. */
function dueWord(t: Todo, now: Date) {
  const due = new Date(t.dueAt!);
  if (due.toDateString() !== now.toDateString()) return `Overdue, ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return due.getHours() || due.getMinutes() ? clockTime(due) : "Today";
}

function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="grid w-[22px] shrink-0 translate-y-[3px] place-items-center self-start text-[var(--foreground)]">{glyph}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

const CARD_HEAD = "flex min-h-[30px] items-center gap-2 pb-1";
const CARD_TITLE = "min-w-0 flex-1 text-[13px] font-semibold text-[var(--text-muted)]";

// ---- Next meeting ------------------------------------------------------------------------
// From Google Calendar, as the Mac app's card is from the Mac's calendars: the meeting on now,
// else the next one in the coming 12 hours, recorded in one click.

const WITHIN_MS = 12 * 3600_000;

/** Which meeting the card shows, what its first line says, and what comes after it. */
export function nextMeeting(meetings: CalendarMeeting[], now: Date): { meeting: CalendarMeeting; when: string; then: CalendarMeeting | null } | null {
  const t = now.getTime();
  const ahead = meetings
    .filter((m) => Date.parse(m.end) > t && Date.parse(m.start) <= t + WITHIN_MS)
    .sort((a, b) => a.start.localeCompare(b.start));
  // Of those under way, the one that began last: the meeting, not the afternoon's focus block.
  const meeting = ahead.filter((m) => Date.parse(m.start) <= t).pop() ?? ahead[0];
  if (!meeting) return null;
  const then = ahead.find((m) => m !== meeting && Date.parse(m.start) > Math.max(t, Date.parse(meeting.start))) ?? null;
  return { meeting, when: whenLine(meeting, now), then };
}

/** "Now · started 5 min ago", "In 12 min", "At 3:30 PM", "Tomorrow at 9:00 AM". */
export function whenLine(m: CalendarMeeting, now: Date) {
  const start = new Date(m.start);
  const diff = start.getTime() - now.getTime();
  if (diff <= 0) {
    const ago = Math.floor(-diff / 60_000);
    return ago < 1 ? "Now · just started" : ago < 60 ? `Now · started ${ago} min ago` : `Now · until ${clockTime(new Date(m.end))}`;
  }
  if (diff < 60 * 60_000) return `In ${Math.max(1, Math.round(diff / 60_000))} min`;
  return `${dayWord(start, now)} ${clockTime(start)}`;
}

/** "At", "Tomorrow at", "Friday at". */
function dayWord(d: Date, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return "At";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow at";
  return `${d.toLocaleDateString("en-US", { weekday: "long" })} at`;
}

function NextMeeting({ onAll }: { onAll: () => void }) {
  const cal = useCalendar();
  const talks = useTalks();
  const rec = useRecorder();
  // The minute's tick draws it again; the time is read as it's drawn, so "started 5 min ago" isn't a minute behind.
  useNow(60_000);
  const now = new Date();
  const { record, busy } = useRecordMeeting();
  const [hidden, hide] = useStoredFlag("four-notes:next-meeting-dismissed");

  if (cal.status === "unavailable" || cal.status === "checking") return null;
  if (cal.status === "disconnected") {
    if (hidden) return null;
    return (
      <section aria-labelledby="today-meeting" className="glance">
        <div className={CARD_HEAD}>
          <h2 id="today-meeting" className={CARD_TITLE}>Next meeting</h2>
          <button type="button" className="btn btn-plain btn-sm btn-icon" aria-label="Not now" title="Not now" onClick={hide}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="flex flex-col items-start gap-3 pb-1 pt-1">
          <p className="text-[14px] text-[var(--text-secondary)]">See your next meeting here, and record it in one click.</p>
          <button type="button" className="btn btn-secondary btn-sm max-md:h-11" onClick={connectCalendar}><Icon name="calendar" size={14} /> Connect calendar</button>
          {cal.error && <p className="text-[13px] text-[var(--danger)]" role="alert">{cal.error}</p>}
        </div>
      </section>
    );
  }

  const view = nextMeeting(cal.meetings, now);
  const m = view?.meeting;
  const talk = m ? talkFor(m, talks) : undefined;
  const recording = Boolean(talk && rec.talkId === talk.id && rec.status !== "idle");
  const blocked = rec.status !== "idle";
  const detail = m ? meetingDetail(m) : "";
  return (
    <section aria-labelledby="today-meeting" className="glance">
      <div className={CARD_HEAD}>
        <h2 id="today-meeting" className={CARD_TITLE}>Next meeting</h2>
        <button type="button" className={HEAD_LINK} onClick={onAll}>All meetings</button>
      </div>
      {!view || !m ? (
        <p className="pb-1 pt-1 text-[14px] text-[var(--text-secondary)]">No more meetings today.</p>
      ) : (
        <div className="flex flex-col gap-1 pb-1 pt-1">
          <p className="fn-num text-[12px] text-[var(--text-muted)]">{view.when}</p>
          <p className="line-clamp-2 text-[15px] font-medium leading-snug">{m.title}</p>
          <p className="fn-num truncate text-[13px] text-[var(--text-secondary)]">{timeRange(m)}{detail ? ` · ${detail}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {recording && talk ? (
              <>
                <span className="badge badge-danger badge-dot">Recording</span>
                <button type="button" className="btn btn-secondary btn-sm max-md:h-11" onClick={() => openItem("talk", talk.id)}>Open</button>
              </>
            ) : talk ? (
              <button type="button" className="btn btn-secondary btn-sm max-md:h-11" onClick={() => openItem("talk", talk.id)}>Open notes</button>
            ) : (
              <>
                {m.link && (
                  <button type="button" className="btn btn-primary btn-sm max-md:h-11" disabled={blocked} title={blocked ? "A recording is already running." : undefined} onClick={() => void record(m, true)}>
                    <Icon name="arrowUpRight" size={14} /> Join and record
                  </button>
                )}
                <button
                  type="button"
                  className={`btn btn-sm max-md:h-11 ${m.link ? "btn-secondary" : "btn-primary"}`}
                  disabled={blocked || busy === m.id}
                  title={blocked ? "A recording is already running." : undefined}
                  onClick={() => void record(m, false)}
                >
                  <Icon name="mic" size={14} /> Record
                </button>
              </>
            )}
          </div>
          {view.then && (
            <p className="mt-2 truncate text-[12px] text-[var(--text-muted)]">
              Then {new Date(view.then.start).toDateString() === now.toDateString() ? "" : "tomorrow "}
              {clockTime(new Date(view.then.start))} · {view.then.title}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DueToday({ tasks, upcoming, focus, onDone, onAll }: {
  tasks: Todo[]; upcoming: Todo[]; focus: Todo[]; onDone: (t: Todo) => void; onAll: () => void;
}) {
  const shown = tasks.slice(0, 5);
  return (
    <section aria-labelledby="today-due" className="glance">
      <div className={CARD_HEAD}>
        <h2 id="today-due" className={CARD_TITLE}>Due today</h2>
        <button type="button" className={HEAD_LINK} onClick={onAll}>Planner</button>
      </div>
      {shown.length ? (
        shown.map((t, i) => (
          <div key={t.id}>
            {i > 0 && <div className="mx-3 h-px bg-[var(--border-subtle)] md:hidden" />}
            <TaskRow todo={t} onDone={() => onDone(t)} />
          </div>
        ))
      ) : (
        <p className="pb-1 pt-1 text-[14px] text-[var(--text-secondary)]">{focus.length ? "Nothing has a date today." : "Nothing due today."}</p>
      )}
      {tasks.length > shown.length && (
        <button type="button" className={`${HEAD_LINK} mb-1`} onClick={onAll}>{tasks.length - shown.length} more due</button>
      )}
      {!tasks.length && focus.length > 0 && (
        <>
          <p className="group-label pb-1 pt-1">High priority, no date</p>
          {focus.map((t) => <TaskRow key={t.id} todo={t} onDone={() => onDone(t)} />)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <p className="group-label pb-1 pt-3">Coming up</p>
          {upcoming.map((t) => <TaskRow key={t.id} todo={t} onDone={() => onDone(t)} />)}
        </>
      )}
    </section>
  );
}

function TaskRow({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const { notes, settings } = useStore();
  const flash = useFiledFlash(todo.id);
  const due = todo.dueAt ? new Date(todo.dueAt) : null;
  const overdue = !!due && due < new Date();
  const sameDay = due?.toDateString() === new Date().toDateString();
  const when = !due
    ? ""
    : sameDay
      ? due.getHours() || due.getMinutes() ? due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Today"
      : due.toLocaleDateString("en-US", overdue ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
  const note = todo.noteId ? notes.find((n) => n.id === todo.noteId && !n.deletedAt) : undefined;
  const freq = todo.rrule?.match(/FREQ=(\w+)/i)?.[1]?.toUpperCase();
  const repeat = freq ? ({ DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" } as Record<string, string>)[freq] : undefined;
  return (
    <div className={`row max-md:min-h-[52px] max-md:items-center ${flash ? "fn-flash" : ""}`}>
      <button
        type="button"
        className={`check relative mt-px before:absolute before:-inset-3 before:content-[''] max-md:h-6 max-md:w-6 ${overdue ? "border-[var(--danger)]" : ""}`}
        aria-label={`Complete ${todo.title}`}
        onClick={onDone}
      />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-1 text-left" onClick={() => openItem("todo", todo.id)}>
        <span className="row-title truncate">{todo.title}</span>
        {(when || note || repeat) && (
          <span className="row-meta !mt-0 flex-nowrap gap-1.5">
            {when && <span className={`fn-num tm shrink-0 ${overdue && !sameDay ? "!text-[var(--danger)]" : ""}`}>{overdue && !sameDay ? `Overdue, ${when}` : when}</span>}
            {when && (note || repeat) && <span aria-hidden>·</span>}
            {note ? (
              <span className="flex min-w-0 items-center gap-1"><Glyph name="link" size={12} /><span className="truncate">{note.title || "Untitled"}</span></span>
            ) : repeat ? (
              <span className="flex items-center gap-1"><Glyph name="repeat" size={12} />{repeat}</span>
            ) : null}
          </span>
        )}
      </button>
      {todo.bill && todo.bill.amount > 0 && (
        <span className="fn-num shrink-0 text-[13px] text-[var(--text-secondary)]">{formatMoney(todo.bill.amount, todo.bill.currency || settings.currency)}</span>
      )}
    </div>
  );
}

/**
 * Today's spending, and, with budgets set, how much of today's share of them is left:
 * what the budgets have left this month, spread over the days that are left.
 */
function SpentToday({ onOpen, yTotal }: { onOpen: () => void; yTotal: number }) {
  const { transactions, settings } = useStore();
  const cur = settings.currency;
  const now = new Date();
  const today = localDate(now);
  const month = today.slice(0, 7);
  const live = alive(transactions).filter((t) => t.amount > 0);
  const todays = live.filter((t) => t.date === today);
  const total = todays.reduce((s, t) => s + myShare(t, cur), 0);
  const merchants = [...new Set(todays.map((t) => t.merchant))].slice(0, 3).join(", ");

  const budgets = Object.entries(settings.budgets).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0);
  const budgeted = new Set(budgets.map(([c]) => c));
  const monthly = budgets.reduce((s, [, v]) => s + v, 0);
  const inBudget = (t: { category: string }) => budgeted.has(t.category);
  const before = live.filter((t) => inBudget(t) && t.date.startsWith(month) && t.date < today).reduce((s, t) => s + myShare(t, cur), 0);
  const todayInBudget = todays.filter(inBudget).reduce((s, t) => s + myShare(t, cur), 0);
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const allowance = monthly > 0 ? Math.max(0, (monthly - before) / daysLeft) : null;
  const left = allowance != null ? allowance - todayInBudget : null;
  const pct = allowance ? Math.min(100, Math.round((todayInBudget / allowance) * 100)) : allowance === 0 ? 100 : 0;
  const over = left != null && left < 0;
  const sub = left != null
    ? over ? `${formatMoney(-left, cur)} over today's share of your budgets` : `${formatMoney(left, cur)} left for today`
    : yTotal > 0 ? `${formatMoney(yTotal, cur)} yesterday` : todays.length ? `${todays.length} ${todays.length === 1 ? "purchase" : "purchases"} today` : "Nothing logged yet today";

  return (
    <section aria-labelledby="today-money" className="glance flex items-center gap-4 md:block">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 id="today-money" className={CARD_TITLE}>Spent today</h2>
          <button type="button" className={`${HEAD_LINK} max-md:hidden`} onClick={onOpen}>Money</button>
        </div>
        <p className="fn-display fn-num mt-1 text-[28px] md:mb-1 md:text-[34px]">{formatMoney(total, cur)}</p>
        <p
          className={`fn-num text-[12px] md:text-[13px] ${over ? "text-[var(--danger)]" : "text-[var(--text-muted)] md:text-[var(--text-secondary)]"}`}
          title={allowance != null ? "What your monthly budgets have left, spread over the days left this month" : undefined}
        >
          {sub}
        </p>
        {allowance != null && (
          <div className="mt-3.5 max-md:hidden">
            <div role="meter" aria-label="Today's share of your budgets used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="meter" data-tone={over ? "danger" : undefined}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-[12px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate">{merchants}</span>
              <span className="fn-num shrink-0">{pct}%</span>
            </div>
          </div>
        )}
        {allowance == null && merchants && <p className="mt-2 truncate text-[12px] text-[var(--text-muted)] max-md:hidden">{merchants}</p>}
      </div>
      {allowance != null && <Ring pct={pct} over={over} />}
      <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--hover)] md:hidden" onClick={onOpen} aria-label="Open Money">
        <Glyph name="arrowRight" size={18} />
      </button>
    </section>
  );
}

/** Phones: the share of today's allowance used, as a ring. */
function Ring({ pct, over }: { pct: number; over: boolean }) {
  const c = 2 * Math.PI * 23;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" role="img" aria-label={`${pct} percent of today's allowance used`} className="shrink-0 -rotate-90 md:hidden">
      <circle cx="28" cy="28" r="23" fill="none" stroke="var(--control-track)" strokeWidth="6" />
      <circle cx="28" cy="28" r="23" fill="none" stroke={over ? "var(--danger)" : "var(--accent)"} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
    </svg>
  );
}

/** Quick notes: a line to jot in, and the newest few. Today's go into the brief. */
function QuickNotes({ quick, onMore }: { quick: Note[]; onMore: () => void }) {
  const { addNote } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const save = () => {
    if (!draft.trim()) return;
    addNote(quickNote(draft));
    setDraft("");
    toast("Quick note saved");
  };
  const shown = quick.slice(0, 3);
  return (
    <section aria-labelledby="today-quick" className="glance">
      <div className={CARD_HEAD}>
        <h2 id="today-quick" className={CARD_TITLE}>Quick notes</h2>
        <span className="text-[12px] text-[var(--text-muted)]">Today&apos;s go into the summary</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label htmlFor="quick-note-input" className="sr-only">Add a quick note. Enter saves it, Shift+Enter starts a new line.</label>
        <textarea
          id="quick-note-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }}
          rows={1}
          placeholder="Jot something down"
          className="block max-h-32 min-h-[42px] w-full resize-none rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[15px] leading-6 outline-none transition-colors [field-sizing:content] placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--border-strong)] max-md:min-h-11 max-md:text-[16px]"
        />
      </form>
      {shown.length > 0 && (
        <ul className="pt-1">
          {shown.map((n) => <QuickRow key={n.id} note={n} />)}
        </ul>
      )}
      {quick.length > shown.length && (
        <button type="button" className={`${HEAD_LINK} mb-1`} onClick={onMore}>All notes</button>
      )}
    </section>
  );
}

function QuickRow({ note }: { note: Note }) {
  const { remove, updateNote } = useStore();
  const toast = useToast();
  const flash = useFiledFlash(note.id);
  const title = note.title || "Untitled";
  return (
    <li className={`group flex items-center gap-3 rounded-[14px] pl-3 pr-1 ${flash ? "fn-flash" : ""}`}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--note-yellow)]" aria-hidden />
      <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-left text-[14px]" onClick={() => openItem("note", note.id)}>{title}</button>
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{ago(note.createdAt)}</span>
      <button
        type="button"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-[var(--foreground)] focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100"
        onClick={() => {
          remove("notes", note.id);
          toast("Quick note deleted", "ok", { label: "Undo", run: () => updateNote(note.id, { deletedAt: null }) });
        }}
        aria-label={`Delete “${title}”`}
        title="Delete"
      >
        <Glyph name="x" size={14} />
      </button>
    </li>
  );
}

/** "☀️ Andi still owes you…" → ("☀️", "Andi still owes you…"), so the glyphs line up in a column; a dot when a line has none. */
function leadingEmoji(line: string) {
  const m = line.match(/^(\p{Extended_Pictographic}️?|\p{Emoji_Presentation})\s*(.*)$/u);
  return m ? { glyph: m[1], text: m[2] } : { glyph: "•", text: line };
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "Yesterday" : `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
