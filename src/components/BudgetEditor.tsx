"use client";
// Monthly budget per category, with this month's spending for context.
// Used in Finance → "Set budgets" and in Settings.
import { useMemo } from "react";
import { spendByCategory } from "@/lib/insights";
import { alive, formatMoney, localMonth, parseAmount, useStore } from "@/lib/store";

export default function BudgetEditor() {
  const { settings, setBudget, transactions, categories } = useStore();
  const budgetable = categories.filter((c) => c !== "Income");
  const cur = settings.currency;
  const month = localMonth();
  const spent = useMemo(
    () => spendByCategory(alive(transactions).filter((t) => t.date.startsWith(month)), cur),
    [transactions, month, cur],
  );
  const total = budgetable.reduce((s, c) => s + (settings.budgets[c] ?? 0), 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Set a monthly limit for each category in {cur}. Type amounts like <b>1.5M</b> or <b>600k</b>. Leave a field empty for no budget.
      </p>
      <ul className="divide-y divide-[var(--line)]">
        {budgetable.map((c) => {
          const limit = settings.budgets[c] ?? 0;
          const used = spent[c] ?? 0;
          const ratio = limit ? used / limit : 0;
          const color = ratio >= 1 ? "var(--danger)" : ratio >= 0.8 ? "#d9730d" : "var(--ok)";
          return (
            <li key={c} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c}</div>
                <div className="text-xs text-[var(--muted)]">
                  {formatMoney(used, cur, true)} spent this month{limit ? ` · ${Math.round(ratio * 100)}% of budget` : ""}
                </div>
                {limit > 0 && (
                  <div className="mt-1.5 h-1 rounded-full bg-[var(--hover)]">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }} />
                  </div>
                )}
              </div>
              <input
                key={`${c}-${limit}`}
                defaultValue={limit || ""}
                placeholder="No budget"
                inputMode="decimal"
                aria-label={`${c} monthly budget`}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  const amount = value ? parseAmount(value) : null;
                  if ((amount ?? 0) !== limit) setBudget(c, amount);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="h-9 w-28 shrink-0 rounded-md bg-[var(--hover)] px-2.5 text-right tabular-nums outline-none placeholder:text-[var(--faint)] focus:ring-1 focus:ring-[var(--accent)] sm:w-32"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
        <span className="text-[var(--muted)]">Total monthly budget</span>
        <span className="font-semibold tabular-nums">{formatMoney(total, cur)}</span>
      </div>
    </div>
  );
}
