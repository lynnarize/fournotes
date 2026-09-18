"use client";
// Finance overview, laid out like an operations dashboard:
//   row 1  three stat cards: spent · income · transactions (each vs last month)
//   left   spending chart (month by day · year by month · categories), upcoming payments
//   right  budget progress bar, monthly review (AI), heads-up alerts with actions
// Everything but the review is computed on the device.
import { useMemo, useRef, useState } from "react";
import { baseAmount, budgetStatus, detectSubscriptions, myShare, owedToMe, spendByCategory, type Subscription } from "@/lib/insights";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import type { MonthlySummary, Tab, Transaction } from "@/lib/types";
import { Icon, useToast } from "../ui";

/** Finance cards: a soft panel with white tiles inside (the reference's look). */
export const FCARD = "rounded-2xl border border-[var(--line)] bg-[var(--panel)]";
const TILE = "rounded-xl border border-[var(--line)] bg-[var(--bg)]";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CATEGORY_ICON: Record<string, string> = {
  "Food & Drink": "coffee", Groceries: "cart", Transport: "car", Shopping: "bag", "Bills & Utilities": "bill",
  Health: "heart", Entertainment: "film", Education: "book", Income: "download",
};
export const categoryIcon = (c: string) => CATEGORY_ICON[c] ?? "wallet";

/** A money amount with its cents (if any) smaller and dimmed: $12,521.15 */
export function Money({ amount, currency, className = "" }: { amount: number; currency: string; className?: string }) {
  const text = formatMoney(amount, currency);
  const m = text.match(/^(.*?)([.,]\d{2})(\D*)$/);
  return (
    <span className={`tabular-nums tracking-tight ${className}`}>
      {m ? <>{m[1]}<span className="text-[0.55em] font-medium text-[var(--faint)]">{m[2]}</span>{m[3]}</> : text}
    </span>
  );
}

/** "↗ 12%" pill. For spending, going up is bad; for income, good. */
function Delta({ pct, upIsGood = false }: { pct: number | null; upIsGood?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={`fin-delta ${up === upIsGood ? "fin-good" : "fin-bad"}`}>
      <Icon name="arrowUpRight" size={12} className={up ? "" : "rotate-90"} />
      {Math.abs(pct * 100) >= 10 ? Math.round(Math.abs(pct * 100)) : Math.abs(pct * 100).toFixed(1)}%
    </span>
  );
}

function CardTitle({ icon, title, hint, children }: { icon: string; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-2">
      <Icon name={icon} size={18} className="shrink-0 text-[var(--accent)]" />
      <h3 className="text-[17px] font-medium tracking-tight">{title}</h3>
      {hint && <span title={hint} className="text-[var(--faint)]"><Icon name="info" size={14} /></span>}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

const spendOf = (txs: Transaction[], cur: string) => txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
const incomeOf = (txs: Transaction[], cur: string) => txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(baseAmount(t, cur)), 0);
const pct = (now: number, before: number) => (before > 0 ? (now - before) / before : null);
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" });
const daysFromToday = (iso: string) => {
  const a = new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${localDate()}T00:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
};
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : n === -1 ? "1 day late" : `${-n} days late`);

type ChartView = "month" | "year" | "category";
const VIEW_KEY = "four-notes:finance-view";
const DISMISSED_KEY = "four-notes:finance-dismissed";

export default function Dashboard({ month, setTab, summary, summarizing, onSummarize, onBudgets, onOpenTransactions, onOpenTransaction }: {
  month: string;
  setTab: (t: Tab) => void;
  summary?: MonthlySummary;
  summarizing: boolean;
  onSummarize: () => void;
  onBudgets: () => void;
  onOpenTransactions: () => void;
  onOpenTransaction: (id: string) => void;
}) {
  const { transactions, todos, settings, addTodo, toggleTodo, remove } = useStore();
  const toast = useToast();
  const cur = settings.currency;
  const live = useMemo(() => alive(transactions), [transactions]);
  const today = localDate();
  const isCurrent = month === localMonth();
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const dayOfMonth = isCurrent ? new Date().getDate() : days;
  const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;

  const monthTxs = useMemo(() => live.filter((t) => t.date.startsWith(month)), [live, month]);
  // Compare like with like: this month so far against the same days of last month.
  const prevTxs = useMemo(
    () => live.filter((t) => t.date.startsWith(lastMonth) && Number(t.date.slice(8, 10)) <= dayOfMonth),
    [live, lastMonth, dayOfMonth],
  );
  const spent = spendOf(monthTxs, cur);
  const prevSpent = spendOf(prevTxs, cur);
  const income = incomeOf(monthTxs, cur);
  const prevIncome = incomeOf(prevTxs, cur);

  // ---- Chart ----
  const [view, setViewState] = useState<ChartView>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "year" || v === "category" ? v : "month";
    } catch { return "month"; }
  });
  const setView = (v: ChartView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  };
  const daily = useMemo(() => {
    const out = Array<number>(days).fill(0);
    for (const t of monthTxs) if (t.amount > 0) out[Number(t.date.slice(8, 10)) - 1] += myShare(t, cur);
    return out.slice(0, dayOfMonth);
  }, [monthTxs, days, dayOfMonth, cur]);
  const yearly = useMemo(() => {
    const out = Array<number>(12).fill(0);
    for (const t of live) if (t.amount > 0 && t.date.startsWith(String(y))) out[Number(t.date.slice(5, 7)) - 1] += myShare(t, cur);
    return out;
  }, [live, y, cur]);
  const lastYear = useMemo(
    () => spendOf(live.filter((t) => t.date.startsWith(String(y - 1)) && t.date.slice(5, 7) <= String(m).padStart(2, "0")), cur),
    [live, y, m, cur],
  );
  const yearToDate = yearly.slice(0, m).reduce((s, v) => s + v, 0);
  const byCat = Object.entries(spendByCategory(monthTxs, cur) as Record<string, number>).sort((a, b) => b[1] - a[1]);

  // ---- Budget progress ----
  const budgetTotal = Object.values(settings.budgets).reduce<number>((s, v) => s + (v ?? 0), 0);
  const budgets = budgetStatus(monthTxs, settings);

  // ---- Upcoming payments: bills on the to-do list, then likely subscription charges ----
  const upcoming = useMemo(() => {
    const soon = Date.now() + 35 * 86_400_000;
    const bills = alive(todos)
      .filter((t) => !t.done && t.bill && t.dueAt && Date.parse(t.dueAt) <= soon)
      .map((t) => ({ key: t.id, todoId: t.id as string | undefined, date: t.dueAt!.slice(0, 10), title: t.title, sub: t.rrule ? "Repeating bill" : "Bill", category: t.bill!.category, amount: t.bill!.amount, currency: t.bill!.currency || cur, sub_: undefined as Subscription | undefined }));
    const tracked = (name: string) => bills.some((b) => b.title.toLowerCase().includes(name.toLowerCase()));
    const subs = detectSubscriptions(live)
      .filter((s) => Date.parse(s.nextDate) <= soon && !tracked(s.merchant))
      .map((s) => ({ key: `sub:${s.merchant}`, todoId: undefined, date: s.nextDate, title: s.merchant, sub: "Likely subscription", category: s.category, amount: s.amount, currency: s.currency, sub_: s }));
    return [...bills, ...subs].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [todos, live, cur]);
  const trackSub = (s: Subscription) => {
    const due = new Date(`${s.nextDate}T09:00:00`).toISOString();
    addTodo({ title: `Pay ${s.merchant}`, dueAt: due, remindAt: due, rrule: "FREQ=MONTHLY;INTERVAL=1", bill: { amount: s.amount, currency: s.currency, category: s.category } });
    toast(`🔁 Monthly bill added: ${s.merchant}`);
  };

  // ---- Heads-up ----
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); } catch { return []; }
  });
  const dismiss = (id: string) => {
    const next = [...dismissed, `${month}:${id}`].slice(-100);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const alerts = useMemo(() => {
    type Alert = { id: string; critical?: boolean; title: string; place: string; detail: string; when: string; action?: { label: string; run: () => void } };
    const out: Alert[] = [];
    for (const b of budgets.sort((a, b) => b.ratio - a.ratio)) {
      if (b.ratio < 0.8) continue;
      out.push({
        id: `budget:${b.category}`, critical: b.ratio >= 1,
        title: b.ratio >= 1 ? `${b.category} budget exceeded` : `${b.category} budget almost used`,
        place: `${Math.round(b.ratio * 100)}% used`, detail: `${formatMoney(b.spent, cur, true)} of ${formatMoney(b.limit, cur, true)}`,
        when: "this month", action: { label: "Adjust budget", run: onBudgets },
      });
    }
    if (isCurrent) {
      const spentToday = spendOf(live.filter((t) => t.date === today), cur);
      const avg = spendOf(monthTxs.filter((t) => t.date < today), cur) / Math.max(1, dayOfMonth - 1);
      if (avg > 0 && spentToday > avg * 2) {
        out.push({
          id: `spike:${today}`, title: "Spending spike today", place: formatMoney(spentToday, cur, true),
          detail: `usual day ${formatMoney(avg, cur, true)}`, when: "today", action: { label: "See transactions", run: onOpenTransactions },
        });
      }
    }
    for (const [name, amount] of owedToMe(live, cur).slice(0, 3)) {
      const tx = live.find((t) => t.splits?.some((s) => s.name === name && !s.settled));
      out.push({
        id: `owed:${name}`, title: `${name} still owes you`, place: formatMoney(amount, cur, true), detail: tx?.merchant ?? "Split bill",
        when: tx ? shortDate(tx.date) : "", action: tx ? { label: "Open bill", run: () => onOpenTransaction(tx.id) } : undefined,
      });
    }
    return out.filter((a) => !dismissed.includes(`${month}:${a.id}`));
  }, [budgets, cur, onBudgets, isCurrent, live, today, monthTxs, dayOfMonth, onOpenTransactions, onOpenTransaction, dismissed, month]);
  const critical = alerts.filter((a) => a.critical).length;
  const [openTx, setOpenTx] = useState<string | null>(null);
  const recent = useMemo(
    () => [...monthTxs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [monthTxs],
  );
  const todayCount = monthTxs.filter((t) => t.date === today).length;
  const [panel, setPanelState] = useState<Panel>(() => {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === "alerts" ? v : "upcoming";
    } catch { return "upcoming"; }
  });
  const setPanel = (v: Panel) => {
    setPanelState(v);
    try { localStorage.setItem(PANEL_KEY, v); } catch { /* storage blocked */ }
  };

  const stats = [
    {
      label: isCurrent ? "Spent so far" : "Spent", icon: "wallet", value: <Money amount={spent} currency={cur} />, delta: <Delta pct={pct(spent, prevSpent)} />,
      diff: `${spent >= prevSpent ? "+" : "−"}${formatMoney(Math.abs(spent - prevSpent), cur, true)}`, open: () => setView("category"), openLabel: "Spending by category",
    },
    {
      label: "Income", icon: "download", value: <Money amount={income} currency={cur} />, delta: <Delta pct={pct(income, prevIncome)} upIsGood />,
      diff: `${income >= prevIncome ? "+" : "−"}${formatMoney(Math.abs(income - prevIncome), cur, true)}`, open: onOpenTransactions, openLabel: "Show transactions",
    },
    {
      label: "Transactions", icon: "bill", value: <span className="tabular-nums">{monthTxs.length}</span>, delta: <Delta pct={pct(monthTxs.length, prevTxs.length)} upIsGood />,
      diff: `${monthTxs.length >= prevTxs.length ? "+" : "−"}${Math.abs(monthTxs.length - prevTxs.length)}`, open: onOpenTransactions, openLabel: "Show transactions",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Row 1: stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s) => (
          <section key={s.label} className={`${FCARD} p-4`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--muted)]">{s.label}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-semibold leading-tight xl:text-[1.9rem]">{s.value}</span>
                  {s.delta}
                </div>
              </div>
              <span className={`${TILE} grid h-10 w-10 shrink-0 place-items-center text-[var(--accent)] xl:h-12 xl:w-12`}><Icon name={s.icon} size={20} /></span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
              <span className="font-medium tabular-nums">{s.diff}</span>
              <span className="truncate text-[var(--muted)]">from last month{isCurrent ? " (same days)" : ""}</span>
              <button className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={s.open} aria-label={s.openLabel} title={s.openLabel}>
                <Icon name="arrowUpRight" size={17} />
              </button>
            </div>
          </section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5 xl:grid-cols-3">
        {/* Left column: spending chart, then payments / heads-up / review */}
        <div className="flex min-w-0 flex-col gap-4 md:col-span-3 xl:col-span-2">
          <section className={`${FCARD} p-5`}>
            <CardTitle icon="chart" title="Spending" hint="Your share of each expense, in your main currency">
              <Tabs
                label="Chart"
                value={view}
                onChange={(v) => setView(v as ChartView)}
                items={[["month", "Month"], ["year", "Year"], ["category", "Categories"]]}
              />
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[1.8rem] font-semibold leading-tight">
                <Money amount={view === "year" ? yearToDate : spent} currency={cur} />
              </span>
              {view === "year" ? <Delta pct={pct(yearToDate, lastYear)} /> : <Delta pct={pct(spent, prevSpent)} />}
              <span className="text-xs text-[var(--muted)]">{view === "year" ? `vs ${y - 1}` : "vs last month"}</span>
            </div>
            <div key={view} className="fn-note-in mt-3">
              {view === "month" && (
                <LineChart
                  values={daily}
                  total={days}
                  currency={cur}
                  label={(i) => `${i + 1} ${MONTHS[m - 1]}`}
                  ticks={[1, 5, 10, 15, 20, 25, days].filter((d, i, a) => a.indexOf(d) === i).map((d) => ({ at: d - 1, text: String(d) }))}
                />
              )}
              {view === "year" && (
                <LineChart
                  values={yearly.slice(0, y === new Date().getFullYear() ? new Date().getMonth() + 1 : 12)}
                  total={12}
                  currency={cur}
                  label={(i) => `${MONTHS[i]} ${y}`}
                  ticks={MONTHS.map((t, i) => ({ at: i, text: t }))}
                  pill={m - 1}
                />
              )}
              {view === "category" && (
                <ul className="scroll-thin h-[11.5rem] space-y-1.5 overflow-y-auto xl:h-[13.5rem]">
                  {byCat.length === 0 && <li className="py-10 text-center text-sm text-[var(--faint)]">No spending this month.</li>}
                  {byCat.map(([c, v]) => (
                    <li key={c} className={`${TILE} flex items-center gap-3 px-3 py-2`}>
                      <span className="fin-tab-on grid h-8 w-8 shrink-0 place-items-center rounded-lg"><Icon name={categoryIcon(c)} size={16} /></span>
                      <span className="w-28 shrink-0 truncate text-sm font-medium sm:w-32">{c}</span>
                      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                        <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${(v / byCat[0][1]) * 100}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right text-sm tabular-nums sm:w-20">{formatMoney(v, cur, true)}</span>
                      <span className="hidden w-9 shrink-0 text-right text-xs tabular-nums text-[var(--faint)] sm:block">{spent ? Math.round((v / spent) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={`${FCARD} flex-1 p-5`}>
            <CardTitle icon={panel === "upcoming" ? "calendar" : "warning"} title={PANELS[panel]}>
              <Tabs
                label="Show"
                value={panel}
                onChange={(v) => setPanel(v as Panel)}
                items={[["upcoming", "Payments"], ["alerts", alerts.length ? `Heads-up · ${alerts.length}` : "Heads-up"]]}
                alert={critical > 0 ? "alerts" : undefined}
              />
            </CardTitle>

            <div key={panel} className="fn-note-in mt-3">
              {panel === "upcoming" && (upcoming.length === 0 ? (
                <p className="py-4 text-sm text-[var(--faint)]">No bills due soon. Repeating bills you add to To-Do show up here.</p>
              ) : (
                <ul>
                  {upcoming.map((p) => {
                    const n = daysFromToday(p.date);
                    const status = !p.todoId ? { text: "Likely", cls: "fin-pill-muted" }
                      : n < 0 ? { text: "Overdue", cls: "fin-pill-bad" }
                      : n <= 3 ? { text: "Due soon", cls: "fin-pill-warn" }
                      : { text: "Scheduled", cls: "fin-pill-good" };
                    return (
                      <li key={p.key} className="flex items-center gap-3 py-2">
                        {p.todoId ? (
                          <input
                            type="checkbox"
                            className="h-[18px] w-[18px] shrink-0 accent-[var(--accent)]"
                            aria-label={`Mark ${p.title} as paid`}
                            onChange={() => { const extra = toggleTodo(p.todoId!, true); toast([`☑️ Paid: ${p.title}`, ...extra].join("\n")); }}
                          />
                        ) : (
                          <span className="w-[18px] shrink-0" />
                        )}
                        <span className="hidden w-12 shrink-0 text-xs tabular-nums text-[var(--muted)] sm:block">{shortDate(p.date)}</span>
                        <span className="hidden h-10 w-px shrink-0 bg-[var(--line)] sm:block" aria-hidden />
                        <span className={`${TILE} grid h-11 w-11 shrink-0 place-items-center text-[var(--accent)]`}><Icon name={categoryIcon(p.category)} size={19} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{p.title}</span>
                          <span className="block truncate text-xs text-[var(--muted)]">
                            <span className="sm:hidden">{shortDate(p.date)} · </span>{p.sub} · <Money amount={p.amount} currency={p.currency} />
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:block">{inDays(n)}</span>
                        {p.sub_ ? (
                          <button className="fin-pill fin-pill-muted hover:brightness-95" onClick={() => trackSub(p.sub_!)}>Track</button>
                        ) : (
                          <span className={`fin-pill ${status.cls}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status.text}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}

              {panel === "alerts" && (alerts.length === 0 ? (
                <p className="flex items-center gap-3 py-3 text-sm">
                  <span className="fin-pill-good grid h-10 w-10 place-items-center rounded-lg"><Icon name="check" size={18} /></span>
                  All clear: budgets on track, nobody owes you.
                </p>
              ) : (
                <ul>
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2">
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${a.critical ? "fin-pill-bad" : "fin-pill-warn"}`}><Icon name="warning" size={19} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{a.title}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs">
                          <span className="shrink-0 text-[var(--accent)]">{a.place}</span>
                          <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--faint)]" />
                          <span className="truncate text-[var(--muted)]">{a.detail}</span>
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:block">{a.when}</span>
                      {a.action && <button className="fin-pill fin-tab-on border-transparent hover:brightness-95" onClick={a.action.run}>{a.action.label}</button>}
                      <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => dismiss(a.id)} aria-label={`Dismiss: ${a.title}`} title="Dismiss for this month">
                        <Icon name="x" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              ))}

            </div>
          </section>
        </div>

        {/* Right column: daily brief, then recent transactions */}
        <div className="flex min-w-0 flex-col gap-4 md:col-span-2 xl:col-span-1">
          <DailyBrief
            live={live}
            monthTxs={monthTxs}
            isCurrent={isCurrent}
            days={days}
            dayOfMonth={dayOfMonth}
            budget={budgetTotal}
            currency={cur}
            summary={summary}
            summarizing={summarizing}
            onSummarize={onSummarize}
            onBudgets={onBudgets}
          />

          <section className={`${FCARD} flex-1 p-5`}>
            <CardTitle icon="bill" title="Transactions">
              {todayCount > 0 && <span className="fin-pill fin-pill-good"><span className="h-1.5 w-1.5 rounded-full bg-current" />{todayCount} today</span>}
              <button className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={onOpenTransactions} aria-label="Show all transactions" title="Show all transactions">
                <Icon name="arrowUpRight" size={17} />
              </button>
            </CardTitle>
            {recent.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--faint)]">Nothing logged this month yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recent.map((t) => {
                  const open = openTx === t.id;
                  const inc = t.amount < 0;
                  return (
                    <li key={t.id} className={`${TILE} overflow-hidden`}>
                      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpenTx(open ? null : t.id)} aria-expanded={open}>
                        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${inc ? "fin-pill-good" : "fin-tab-on"}`}><Icon name={categoryIcon(t.category)} size={19} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{t.merchant}</span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs">
                            <span className={`shrink-0 font-medium ${inc ? "text-[var(--ok)]" : "text-[var(--accent)]"}`}>
                              {inc ? "+" : ""}{formatMoney(inc ? Math.abs(baseAmount(t, cur)) : myShare(t, cur), cur, true)}
                            </span>
                            <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--faint)]" />
                            <span className="truncate text-[var(--muted)]">{t.category}{t.splits?.length ? " · split" : ""}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--muted)]">{ago(t.date)}</span>
                      </button>
                      <div className="fn-collapse" data-open={open}>
                        <div>
                          <div className="mx-3 flex gap-2 border-t border-[var(--line)] py-3">
                            <button className="min-h-10 flex-1 rounded-lg bg-[var(--accent)] text-sm font-medium text-white hover:brightness-110" onClick={() => onOpenTransaction(t.id)}>
                              Edit / split
                            </button>
                            <button className="min-h-10 flex-1 rounded-lg border border-[var(--line)] text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--danger)]" onClick={() => { remove("transactions", t.id); toast("Transaction deleted"); }}>
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type Panel = "upcoming" | "alerts";
const PANELS: Record<Panel, string> = { upcoming: "Upcoming payments", alerts: "Heads-up" };
const PANEL_KEY = "four-notes:finance-panel";

/** Small segmented control used in card headers. */
function Tabs({ label, value, onChange, items, alert }: {
  label: string; value: string; onChange: (v: string) => void; items: readonly (readonly [string, string])[]; alert?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-lg border border-[var(--line)] bg-[var(--bg)] p-0.5 text-xs">
      {items.map(([id, text]) => (
        <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`relative min-h-8 whitespace-nowrap rounded-md px-2.5 ${value === id ? "fin-tab-on font-semibold" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>
          {text}
          {alert === id && value !== id && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--danger)]" aria-label="needs attention" />}
        </button>
      ))}
    </div>
  );
}

const ago = (date: string) => {
  const n = -daysFromToday(date);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? `${n}d ago` : shortDate(date);
};

/**
 * The AI's review of the month, headed by today's numbers: spent today and what the
 * day can still take (the budget left spread over the days left, or your usual day).
 */
function DailyBrief({ live, monthTxs, isCurrent, days, dayOfMonth, budget, currency, summary, summarizing, onSummarize, onBudgets }: {
  live: Transaction[]; monthTxs: Transaction[]; isCurrent: boolean; days: number; dayOfMonth: number; budget: number; currency: string;
  summary?: MonthlySummary; summarizing: boolean; onSummarize: () => void; onBudgets: () => void;
}) {
  const today = localDate();
  const spentToday = spendOf(live.filter((t) => t.date === today && t.amount > 0), currency);
  const before = spendOf(monthTxs.filter((t) => t.date < today), currency);
  const daysLeft = days - dayOfMonth + 1;
  const allowance = budget > 0 ? Math.max(0, (budget - before) / daysLeft) : before / Math.max(1, dayOfMonth - 1);
  const left = allowance - spentToday;

  return (
    <section className={`${FCARD} p-5`}>
      <CardTitle icon="sparkle" title="Daily brief" hint="The AI's review of this month's spending">
        {monthTxs.length > 0 && (
          <button className="min-h-8 rounded-lg px-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-40" onClick={onSummarize} disabled={summarizing}>
            {summarizing ? "Writing…" : summary ? "Refresh" : "Generate"}
          </button>
        )}
      </CardTitle>
      {isCurrent && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className={`${TILE} min-w-0 px-3 py-2`}>
            <div className="truncate text-xs text-[var(--muted)]">Spent today</div>
            <div className="truncate font-semibold tabular-nums">{formatMoney(spentToday, currency, true)}</div>
          </div>
          <div className={`${TILE} min-w-0 px-3 py-2`}>
            <div className="truncate text-xs text-[var(--muted)]">{left >= 0 ? "Left today" : "Over today"}</div>
            {allowance > 0 || budget > 0 ? (
              <div className={`truncate font-semibold tabular-nums ${left < 0 ? "text-[var(--danger)]" : ""}`}>{formatMoney(Math.abs(left), currency, true)}</div>
            ) : (
              <button className="text-sm font-medium text-[var(--accent)] hover:underline" onClick={onBudgets}>Set a budget</button>
            )}
          </div>
        </div>
      )}
      <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">
        {summarizing ? (
          <span className="text-[var(--muted)]">Reading this month&apos;s spending…</span>
        ) : summary?.text ?? (
          <span className="text-[var(--muted)]">
            {monthTxs.length ? "Tap Generate for a short AI review of this month, with suggestions. It's also written automatically when the month ends." : "Log some spending first; the review is written from it."}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Line chart with a soft fill, a dotted average line and a hover tooltip.
 * `values` may be shorter than `total` (the rest of the month hasn't happened yet).
 */
function LineChart({ values, total, currency, label, ticks, pill }: {
  values: number[]; total: number; currency: string; label: (i: number) => string; ticks: { at: number; text: string }[]; pill?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...values) * 1.15;
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const X = (i: number) => (total > 1 ? (i / (total - 1)) * 1000 : 500);
  const Y = (v: number) => 300 - (v / max) * 300;
  const line = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = values.length ? `${line} L${X(values.length - 1)},300 L0,300 Z` : "";
  const active = hover ?? (values.length ? values.length - 1 : null);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => max * f);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !values.length) return;
    const i = Math.round(((e.clientX - r.left) / r.width) * (total - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };

  return (
    <div className="flex gap-3">
      <div className="flex h-36 shrink-0 flex-col xl:h-44 justify-between pb-0 text-right text-[11px] tabular-nums text-[var(--faint)]">
        {yTicks.map((t, i) => <span key={i} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{formatMoney(t, currency, true)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div ref={box} className="relative h-36 touch-none xl:h-44" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="fin-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#fin-area)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {values.length > 0 && (
              <line x1={0} x2={1000} y1={Y(avg)} y2={Y(avg)} stroke="var(--text)" strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.55} />
            )}
          </svg>
          {values.length > 0 && (
            <span className="fin-avg absolute left-0 -translate-y-1/2" style={{ top: `${(Y(avg) / 300) * 100}%` }}>
              Avg {formatMoney(avg, currency, true)}
            </span>
          )}
          {active !== null && (
            <>
              <span
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg)] bg-[var(--accent)]"
                style={{ left: `${X(active) / 10}%`, top: `${(Y(values[active]) / 300) * 100}%` }}
              />
              <div
                className={`${TILE} pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap px-3 py-1.5 shadow-[var(--shadow)] ${X(active) > 700 ? "-translate-x-full" : X(active) > 300 ? "-translate-x-1/2" : ""}`}
                style={{ left: `${X(active) / 10}%`, top: `calc(${(Y(values[active]) / 300) * 100}% - 10px)` }}
              >
                <div className="text-xs text-[var(--muted)]">{label(active)}</div>
                <div className="text-base font-semibold"><Money amount={values[active]} currency={currency} /></div>
              </div>
            </>
          )}
        </div>
        <div className="relative mt-2 h-7 text-xs text-[var(--muted)]">
          {ticks.map((t) => (
            <span
              key={t.at}
              className={`absolute top-0 -translate-x-1/2 rounded-full px-2.5 py-1 ${t.at === (hover ?? pill) ? "fin-tab-on font-medium" : ""}`}
              style={{ left: `${X(t.at) / 10}%` }}
            >
              {t.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
