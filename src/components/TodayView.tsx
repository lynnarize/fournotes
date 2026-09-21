"use client";
// Daily brief: today's tasks, yesterday's spending, quick notes, heads-up
// alerts (budgets, subscriptions, money owed) and a 3-line AI summary.
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeThinking } from "@/lib/ai/text";
import { api, localIso } from "@/lib/client";
import { greetingFor, useNow, useOnline } from "@/lib/hooks";
import { budgetStatus, detectSubscriptions, myShare, owedToMe } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { openItem } from "@/lib/nav";
import { alive, formatMoney, localDate, localMonth, useStore } from "@/lib/store";
import { isQuick, quickNote } from "@/lib/quickNote";
import type { BriefInput, Tab } from "@/lib/types";
import EmptyStart from "./EmptyStart";
import { Icon, useToast } from "./ui";

export default function TodayView({ setTab }: { setTab: (t: Tab) => void }) {
  const { todos, transactions, stickies, notes, settings, briefs, saveBrief, toggleTodo, addNote, remove } = useStore();
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
  // Quick notes (they replaced stickies): newest first; today's go into the brief.
  const quick = useMemo(() => alive(notes).filter(isQuick).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [notes]);

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
        now: localIso(now),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: cur,
        name: settings.name,
        tasksToday: tasks.slice(0, 15).map((t) => ({ title: t.title, dueAt: t.dueAt, overdue: new Date(t.dueAt!) < now })),
        yesterdaySpend: ySpend.slice(0, 30).map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category })),
        stickies: quick.filter((n) => localDate(new Date(n.createdAt)) === today).map((n) => n.content).slice(0, 5),
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

  // Updates on its own while the app stays open (see useNow).
  const greeting = greetingFor(useNow());
  const firstName = settings.name?.trim().split(/\s+/)[0];

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

  const briefLines = (brief?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const [draft, setDraft] = useState("");
  const saveQuick = () => {
    if (!draft.trim()) return;
    addNote(quickNote(draft));
    setDraft("");
    toast("📝 Quick note saved");
  };

  const section = "border-t border-[var(--line)] pt-4";
  const label = "text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
  const link = "text-sm text-[var(--muted)] hover:text-[var(--text)]";

  return (
    <div className="space-y-10 pt-5 md:pt-7">
      {/* Greeting, with the daily brief underneath */}
      <div>
        <p className="text-[2.2rem] font-light leading-tight tracking-tight md:text-5xl">Hello{firstName ? ` ${firstName}` : ""}!</p>
        <h2 className="mt-1 text-[2.6rem] font-semibold leading-tight tracking-tight md:text-6xl">{greeting}</h2>
        <div className="mt-5 max-w-2xl text-base leading-snug text-[var(--muted)] md:text-lg">
          {briefLines.length ? (
            briefLines.map((l, i) => <p key={i} className={i ? "mt-2" : ""}>{l}</p>)
          ) : (
            <p>{online ? (loading ? "Reading your day…" : "Your daily brief will appear here.") : "The brief will be written when you're back online."}</p>
          )}
        </div>
        <button className="-ml-3 mt-3 flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40" onClick={generate} disabled={loading || !online}>
          <Icon name="sparkle" size={14} /> {loading ? "Writing…" : brief ? "Refresh brief" : "Write today's brief"}
        </button>
      </div>

      {alive(todos).length === 0 && alive(transactions).length === 0 && alive(notes).length === 0 && (
        <EmptyStart
          title="Your day starts here"
          hint="Nothing has been added yet. Tell the assistant what you need, or load sample data to look around first."
          prompts={["Remind me to pay the electricity bill tomorrow 9am", "Spent 45k on lunch at Warteg"]}
        />
      )}

      {/* Four quiet sections */}
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
        <section className={section}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={label}>{tasks.length ? "Due today & overdue" : "Focus"}</h3>
            <button className={link} onClick={() => setTab("todo")}>All tasks →</button>
          </div>
          {tasks.length === 0 && focus.length === 0 && <p className="text-[var(--faint)]">Nothing due today.</p>}
          <ul className="-mx-2">
            {[...tasks, ...focus].map((t) => {
              const overdue = t.dueAt && new Date(t.dueAt) < new Date();
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--hover)]">
                  <button
                    className="relative h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-[var(--faint)] before:absolute before:-inset-3 hover:border-[var(--accent)]"
                    aria-label={`Complete ${t.title}`}
                    onClick={() => { const extra = toggleTodo(t.id, true); toast([`☑️ ${t.title}`, ...extra].join("\n")); }}
                  />
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => openItem("todo", t.id)}>{t.title}</button>
                  {t.dueAt && (
                    <span className={`shrink-0 text-sm tabular-nums ${overdue ? "text-[var(--danger)]" : "text-[var(--faint)]"}`}>
                      {new Date(t.dueAt).toDateString() === new Date().toDateString()
                        ? new Date(t.dueAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                        : new Date(t.dueAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className={section}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={label}>Yesterday&apos;s spending</h3>
            <button className={link} onClick={() => setTab("finance")}>Finance →</button>
          </div>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(yTotal, cur)}</div>
          {ySpend.length === 0 ? (
            <p className="mt-1 text-[var(--faint)]">Nothing logged yesterday.</p>
          ) : (
            <ul className="-mx-2 mt-2">
              {ySpend.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <button className="flex w-full justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]" onClick={() => openItem("transaction", t.id)}>
                    <span className="truncate">{t.merchant} <span className="text-[var(--faint)]">· {t.category}</span></span>
                    <span className="shrink-0 tabular-nums text-[var(--muted)]">{formatMoney(myShare(t, cur), cur)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={section}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={label}>Quick notes</h3>
            {quick.length > 0 && <button className={link} onClick={() => setTab("notes")}>All notes →</button>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); saveQuick(); }}>
            <textarea
              id="quick-note-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveQuick(); } }}
              rows={1}
              placeholder="Write something down…"
              aria-label="Quick note"
              className="input-plain w-full resize-none border-b border-[var(--line)] pb-2 text-base [field-sizing:content] placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-xs text-[var(--faint)]">Enter to save · Shift+Enter for a new line. Today&apos;s notes go into the brief.</p>
          </form>
          {quick.length > 0 && (
            <ul className="-mx-2 mt-3">
              {quick.slice(0, 4).map((n) => (
                <QuickRow key={n.id} id={n.id}>
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => openItem("note", n.id)}>{n.title || n.content}</button>
                  <span className="shrink-0 text-sm text-[var(--faint)]">{ago(n.createdAt)}</span>
                  <button
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--faint)] opacity-0 hover:bg-[var(--hover)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100"
                    onClick={() => remove("notes", n.id)}
                    aria-label={`Delete “${n.title}”`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </QuickRow>
              ))}
            </ul>
          )}
        </section>

        <section className={section}>
          <div className="mb-3">
            <h3 className={label}>Heads-up</h3>
          </div>
          {alerts.length === 0 ? (
            <p className="text-[var(--faint)]">All clear: budgets on track, no charges coming up.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => <li key={a} className="leading-snug">{a}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function QuickRow({ id, children }: { id: string; children: React.ReactNode }) {
  const flash = useFiledFlash(id);
  return <li className={`group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)] ${flash ? "fn-flash" : ""}`}>{children}</li>;
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
