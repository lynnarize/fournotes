"use client";
import { useState } from "react";
import { equalSplit, myShare } from "@/lib/insights";
import { formatMoney, parseAmount, useStore } from "@/lib/store";
import type { Split } from "@/lib/types";
import { Icon } from "./ui";

/** Split a bill: equal split in one step, then fine-tune amounts and mark people as paid. */
export default function SplitEditor({ txId }: { txId: string }) {
  const { transactions, updateTransaction, settings } = useStore();
  const [names, setNames] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return <p className="text-sm text-[var(--muted)]">Transaction not found.</p>;

  const splits = tx.splits ?? [];
  const setSplits = (next: Split[]) => updateTransaction(tx.id, { splits: next });
  const others = splits.reduce((s, x) => s + x.amount, 0);

  const addPeople = () => {
    const people = names.split(/\s*(?:,|\band\b|\bdan\b|&)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (!people.length) return;
    const everyone = [...splits.map((s) => s.name), ...people.filter((p) => !splits.some((s) => s.name.toLowerCase() === p.toLowerCase()))];
    const settled = new Map(splits.map((s) => [s.name, s.settled]));
    setSplits(equalSplit(tx.amount, everyone, includeMe).map((s) => ({ ...s, settled: settled.get(s.name) ?? false })));
    setNames("");
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{tx.merchant}</span>
        <span className="tabular-nums">{formatMoney(tx.amount, tx.currency)}</span>
      </div>

      {splits.length > 0 && (
        <ul className="space-y-1">
          {splits.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <input type="checkbox" checked={s.settled} aria-label={`${s.name} paid`}
                onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, settled: e.target.checked } : x)))}
                className="h-4 w-4 accent-[var(--ok)]" />
              <input value={s.name} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`input-plain min-w-0 flex-1 ${s.settled ? "text-[var(--faint)] line-through" : ""}`} />
              <input defaultValue={s.amount} inputMode="decimal" aria-label={`${s.name} amount`}
                onBlur={(e) => { const n = parseAmount(e.target.value); if (n != null) setSplits(splits.map((x, j) => (j === i ? { ...x, amount: n } : x))); }}
                className="input-plain w-28 text-right tabular-nums" />
              <button className="btn-ghost" onClick={() => setSplits(splits.filter((_, j) => j !== i))} aria-label={`Remove ${s.name}`}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); addPeople(); }}>
        <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Split with… (Andi, Budi)"
          className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1" />
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} /> incl. me
        </label>
        <button className="btn-ghost border border-[var(--line)]">Split equally</button>
      </form>

      <div className="flex justify-between border-t border-[var(--line)] pt-2 text-xs text-[var(--muted)]">
        <span>Others owe {formatMoney(splits.filter((s) => !s.settled).reduce((a, s) => a + s.amount, 0), tx.currency)}</span>
        <span>Your share {formatMoney(myShare(tx, settings.currency), settings.currency)}{others > tx.amount ? " ⚠️ more than total" : ""}</span>
      </div>
    </div>
  );
}
