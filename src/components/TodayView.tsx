"use client";
// Daily brief: today's tasks, yesterday's spending, pinned stickies, heads-up
// alerts (budgets, subscriptions, money owed) and a 3-line AI summary.
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { api, fmtDateTime } from "@/lib/client";
import { useOnline } from "@/lib/hooks";
import { budgetStatus, detectSubscriptions, myShare, owedToMe } from "@/lib/insights";
import { openItem } from "@/lib/nav";
import { rruleLabel } from "@/lib/recurrence";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import type { BriefInput, Tab } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Icon, SectionTitle, useToast } from "./ui";

export default function TodayView({ setTab }: { setTab: (t: Tab) => void }) {
  const { todos, transactions, stickies, notes, settings, briefs, saveBrief, toggleTodo, updateSticky } = useStore();
  const toast = useToast();
  const online = useOnline();
  const [loading, setLoading] = useState(false);
  const cur = settings.currency;
  const today = localDate();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d); })();

  const tasks = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return alive(todos)
      .filter((t) => !t.done && t.dueAt && new Date(t.dueAt) <= end)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  }, [todos]);
  const focus = useMemo(
    () => (tasks.length ? [] : alive(todos).filter((t) => !t.done && !t.dueAt && t.priority === "high").slice(0, 3)),
    [todos, tasks.length],
  );
  const ySpend = useMemo(() => alive(transactions).filter((t) => t.date === yesterday && t.amount > 0), [transactions, yesterday]);
  const yTotal = ySpend.reduce((s, t) => s + myShare(t, cur), 0);
  const pinned = alive(stickies).filter((s) => s.pinned);

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

  const generate = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const input: BriefInput = {
        now: now.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: cur,
        name: settings.name,
        tasksToday: tasks.slice(0, 15).map((t) => ({ title: t.title, dueAt: t.dueAt, overdue: new Date(t.dueAt!) < now })),
        yesterdaySpend: ySpend.slice(0, 30).map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category })),
        stickies: pinned.map((s) => s.text).slice(0, 5),
        alerts,
      };
      const { text } = await api.brief(input);
      saveBrief({ date: today, text });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not write the brief", "error");
    } finally {
      setLoading(false);
    }
  };

  // Write today's brief automatically the first time the app opens each day.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!brief && online && !autoRan.current) {
      autoRan.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, online]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <p className="-mt-4 text-sm text-[var(--muted)]">
        {greeting}{settings.name ? `, ${settings.name}` : ""} · {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
      </p>

      {alive(todos).length === 0 && alive(transactions).length === 0 && alive(notes).length === 0 && (
        <EmptyStart
          title="Your day starts here"
          hint="Nothing has been added yet. Tell the assistant what you need, or load sample data to look around first."
          prompts={["Remind me to pay the electricity bill tomorrow 9am", "Spent 45k on lunch at Warteg"]}
        />
      )}

      <section className="rounded-lg border border-[var(--line)] p-4">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="sparkle" className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">Daily brief</h3>
          <button className="btn-ghost ml-auto text-xs" onClick={generate} disabled={loading || !online}>
            {loading ? "Writing…" : brief ? "Refresh" : "Generate"}
          </button>
        </div>
        <p className="whitespace-pre-wrap text-[15px] leading-7">
          {brief?.text ?? (online ? (loading ? "Reading your day…" : "Tap Generate for a 3-line summary of your day.") : "The AI brief will be written when you're back online.")}
        </p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <SectionTitle className="flex items-center">
            {tasks.length ? "Due today & overdue" : "Focus"}
            <button className="btn-ghost ml-auto normal-case tracking-normal" onClick={() => setTab("todo")}>All tasks →</button>
          </SectionTitle>
          {tasks.length === 0 && focus.length === 0 && <p className="text-sm text-[var(--faint)]">Nothing due today. 🎉</p>}
          <ul>
            {[...tasks, ...focus].map((t) => {
              const overdue = t.dueAt && new Date(t.dueAt) < new Date();
              return (
                <li key={t.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--hover)]">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label={`Complete ${t.title}`}
                    onChange={() => { const extra = toggleTodo(t.id, true); toast([`☑️ ${t.title}`, ...extra].join("\n")); }} />
                  <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => openItem("todo", t.id)}>{t.title}</button>
                  {t.rrule && <span className="chip" title={rruleLabel(t.rrule)}><Icon name="repeat" size={11} /></span>}
                  {t.dueAt && <span className={`chip ${overdue ? "text-[var(--danger)]" : ""}`}>{fmtDateTime(t.dueAt)}</span>}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <SectionTitle className="flex items-center">
            Yesterday&apos;s spending
            <button className="btn-ghost ml-auto normal-case tracking-normal" onClick={() => setTab("finance")}>Finance →</button>
          </SectionTitle>
          <div className="mb-2 text-2xl font-semibold tabular-nums">{formatMoney(yTotal, cur)}</div>
          {ySpend.length === 0 ? (
            <p className="text-sm text-[var(--faint)]">No spending logged yesterday.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {ySpend.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <button className="flex w-full justify-between gap-2 rounded px-1 hover:bg-[var(--hover)]" onClick={() => openItem("transaction", t.id)}>
                    <span className="truncate">{t.merchant} <span className="text-[var(--faint)]">· {t.category}</span></span>
                    <span className="tabular-nums text-[var(--muted)]">{formatMoney(myShare(t, cur), cur)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Pinned stickies</SectionTitle>
          {pinned.length === 0 ? (
            <p className="text-sm text-[var(--faint)]">Pin a sticky (📌 on hover) to see it here.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pinned.map((s) => (
                <div key={s.id} className="group relative w-40 rounded-md p-2 text-[13px] leading-snug shadow-[var(--shadow)]" style={{ background: `var(--sticky-${s.color})` }}>
                  {s.text || <span className="text-[var(--faint)]">Empty</span>}
                  <button className="absolute right-1 top-1 opacity-0 group-hover:opacity-100" onClick={() => updateSticky(s.id, { pinned: false })} aria-label="Unpin">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Heads-up</SectionTitle>
          {alerts.length === 0 ? (
            <p className="text-sm text-[var(--faint)]">All clear: budgets on track, no charges coming up.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {alerts.map((a) => (
                <li key={a} className="flex gap-2"><Icon name="bell" size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />{a}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
