// Pure, synchronous analysis over local data: currency conversion, budgets,
// subscription detection, bill splits and smart reminder timing.
import type { ExpenseCategory, Settings, Todo, Transaction } from "./types";

/** Amount in the base currency. */
export const baseAmount = (t: Transaction, base: string) =>
  t.currency === base ? t.amount : t.amount * (t.fxRate ?? 1);

/** What the user actually paid, after other people's shares. */
export const myShare = (t: Transaction, base: string) => {
  const others = (t.splits ?? []).reduce((s, x) => s + x.amount, 0);
  return baseAmount({ ...t, amount: t.amount - others }, base);
};

export function spendByCategory(txs: Transaction[], base: string) {
  const out: Partial<Record<ExpenseCategory, number>> = {};
  for (const t of txs) if (t.amount > 0) out[t.category] = (out[t.category] ?? 0) + myShare(t, base);
  return out;
}

export interface BudgetStatus {
  category: ExpenseCategory;
  spent: number;
  limit: number;
  ratio: number;
}

export function budgetStatus(monthTxs: Transaction[], settings: Settings): BudgetStatus[] {
  const spent = spendByCategory(monthTxs, settings.currency);
  return (Object.entries(settings.budgets) as [ExpenseCategory, number][])
    .filter(([, limit]) => limit > 0)
    .map(([category, limit]) => ({ category, limit, spent: spent[category] ?? 0, ratio: (spent[category] ?? 0) / limit }))
    .sort((a, b) => b.ratio - a.ratio);
}

// ---- Subscriptions -----------------------------------------------------------
export interface Subscription {
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  lastDate: string;
  nextDate: string;
  count: number;
}

const normMerchant = (m: string) =>
  m.toLowerCase().replace(/\b(pt|tbk|inc|ltd|id|indonesia|com)\b|[^a-z0-9]/g, "").slice(0, 20);
const dayMs = 86_400_000;

/** Same merchant, similar amount (±15%), roughly monthly (25–35 days apart), at least twice. */
export function detectSubscriptions(txs: Transaction[]): Subscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amount <= 0 || t.deletedAt) continue;
    const k = normMerchant(t.merchant);
    if (k) groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const subs: Subscription[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    // Walk back from the latest charge while the pattern holds.
    let run = [list[list.length - 1]];
    for (let i = list.length - 2; i >= 0; i--) {
      const newer = run[0], older = list[i];
      const gap = (Date.parse(newer.date) - Date.parse(older.date)) / dayMs;
      const similar = Math.abs(newer.amount - older.amount) <= 0.15 * newer.amount;
      if (gap < 1) continue; // duplicate on the same day
      if (gap >= 25 && gap <= 35 && similar) run = [older, ...run];
      else break;
    }
    if (run.length < 2) continue;
    const last = run[run.length - 1];
    const next = new Date(`${last.date}T00:00:00`);
    next.setMonth(next.getMonth() + 1);
    // Ignore patterns that stopped more than ~2 months ago.
    if (Date.now() - Date.parse(last.date) > 70 * dayMs) continue;
    subs.push({
      merchant: last.merchant, amount: last.amount, currency: last.currency, category: last.category,
      lastDate: last.date, nextDate: next.toISOString().slice(0, 10), count: run.length,
    });
  }
  return subs.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

// ---- Bill splits ---------------------------------------------------------------
export function equalSplit(total: number, people: string[], includeMe = true): { name: string; amount: number; settled: boolean }[] {
  const n = people.length + (includeMe ? 1 : 0);
  if (!n || !people.length) return [];
  const share = Math.round((total / n) * 100) / 100;
  return people.map((name) => ({ name, amount: share, settled: false }));
}

/** Unsettled amounts owed to the user, per person, in the base currency. */
export function owedToMe(txs: Transaction[], base: string) {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (t.deletedAt) continue;
    for (const s of t.splits ?? []) {
      if (s.settled) continue;
      out[s.name] = (out[s.name] ?? 0) + baseAmount({ ...t, amount: s.amount }, base);
    }
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

// ---- Smart reminder timing -------------------------------------------------------
const words = (s: string) =>
  new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

/**
 * Suggest a reminder time from when the user usually finishes similar tasks:
 * take done tasks sharing words with this one, find their typical hour of
 * completion, and pick the next such hour (before the due time if there is one).
 */
export function suggestReminder(todo: Todo, all: Todo[], now = new Date()): { at: string; reason: string } | null {
  const mine = words(todo.title);
  const done = all.filter((t) => t.id !== todo.id && t.done && t.completedAt && !t.deletedAt);
  let pool = done.filter((t) => [...words(t.title)].some((w) => mine.has(w)));
  let basis = "similar tasks";
  if (pool.length < 2) { pool = done; basis = "tasks"; }
  if (pool.length < 3 && basis === "tasks") return null;

  // Circular mean isn't needed for day-time habits; median hour is robust enough.
  const minutes = pool.map((t) => { const d = new Date(t.completedAt!); return d.getHours() * 60 + d.getMinutes(); }).sort((a, b) => a - b);
  const median = minutes[Math.floor(minutes.length / 2)];
  const hour = Math.floor(median / 60), minute = Math.round((median % 60) / 15) * 15;

  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  at.setMinutes(minute);
  if (at <= now) at.setDate(at.getDate() + 1);
  if (todo.dueAt) {
    const due = new Date(todo.dueAt);
    if (at >= due) {
      // Same habit hour on an earlier day, or 1 hour before due as a fallback.
      const earlier = new Date(due);
      earlier.setHours(hour, minute, 0, 0);
      if (earlier >= due) earlier.setDate(earlier.getDate() - 1);
      at.setTime(earlier > now ? earlier.getTime() : Math.max(now.getTime() + 5 * 60_000, due.getTime() - 3_600_000));
    }
  }
  const hh = `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return { at: at.toISOString(), reason: `You usually finish ${basis} around ${hh}` };
}
