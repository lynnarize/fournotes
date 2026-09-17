// Summaries written from the data alone, with no AI. Used in demo mode and as
// the fallback when a free model's answer isn't usable.
import { formatMoney } from "../money";
import type { BriefInput, Transaction } from "../types";

export function localBrief(input: BriefInput): string {
  const overdue = input.tasksToday.filter((t) => t.overdue).length;
  const first = input.tasksToday[0]?.title;
  const spent = input.yesterdaySpend.reduce((s, t) => s + Math.max(0, t.amount), 0);
  const count = input.yesterdaySpend.length;
  return [
    `🎯 ${input.tasksToday.length ? `${input.tasksToday.length} task${input.tasksToday.length === 1 ? "" : "s"} today${overdue ? `, ${overdue} overdue` : ""}. Start with “${first}”.` : "No tasks due today. A good day to plan ahead."}`,
    `💸 ${count ? `Yesterday you spent ${formatMoney(spent, input.currency)} across ${count} transaction${count === 1 ? "" : "s"}.` : "No spending recorded yesterday."}`,
    `📌 ${input.alerts[0] ?? input.stickies[0] ?? "Nothing urgent. Have a good day!"}`,
  ].join("\n");
}

export function localMonthly(month: string, txs: Pick<Transaction, "amount" | "category">[], currency: string): string {
  const total = txs.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const by: Record<string, number> = {};
  for (const t of txs) if (t.amount > 0) by[t.category] = (by[t.category] ?? 0) + t.amount;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `${month}: spent ${formatMoney(total, currency)}.\nTop: ${top.map(([c, v]) => `${c} ${formatMoney(v, currency)}`).join(", ") || "—"}.`;
}
