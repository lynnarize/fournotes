"use client";
// Annual / tax report: month × category table, CSV for Excel, and a print view for PDF.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { downloadFile, toCsv } from "@/lib/client";
import { baseAmount, myShare } from "@/lib/insights";
import { alive, formatMoney, useStore } from "@/lib/store";
import { Icon, Modal } from "./ui";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const monthName = (m: string) => new Date(2000, Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short" });

export default function ReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { transactions, settings, spaces, currentSpaceId, categories } = useStore();
  const cur = settings.currency;
  const live = useMemo(() => alive(transactions), [transactions]);
  const years = useMemo(() => {
    const ys = new Set(live.map((t) => t.date.slice(0, 4)));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [live]);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

  const data = useMemo(() => {
    const txs = live.filter((t) => t.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
    const cats = categories.filter((c) => c !== "Income");
    const grid: Record<string, Record<string, number>> = {};
    const income: Record<string, number> = {};
    for (const m of MONTHS) { grid[m] = {}; income[m] = 0; }
    for (const t of txs) {
      const m = t.date.slice(5, 7);
      if (t.amount < 0) income[m] += Math.abs(baseAmount(t, cur));
      else grid[m][t.category] = (grid[m][t.category] ?? 0) + myShare(t, cur);
    }
    const usedCats = cats.filter((c) => MONTHS.some((m) => grid[m][c]));
    const catTotal = Object.fromEntries(usedCats.map((c) => [c, MONTHS.reduce((s, m) => s + (grid[m][c] ?? 0), 0)]));
    const monthSpend = Object.fromEntries(MONTHS.map((m) => [m, Object.values(grid[m]).reduce((s, v) => s + v, 0)]));
    const spent = Object.values(monthSpend).reduce((s, v) => s + v, 0);
    const earned = Object.values(income).reduce((s, v) => s + v, 0);
    return { txs, grid, income, usedCats, catTotal, monthSpend, spent, earned };
  }, [live, year, cur, categories]);

  const spaceName = spaces.find((s) => s.id === currentSpaceId)?.name ?? "Personal";

  const exportTransactions = () =>
    downloadFile(
      `four-notes-transactions-${year}.csv`,
      toCsv([
        ["Date", "Merchant", "Category", "Amount", "Currency", "FX rate", `Amount (${cur})`, `Your share (${cur})`, "Split with", "Items", "Source"],
        ...data.txs.map((t) => [
          t.date, t.merchant, t.category, t.amount, t.currency, t.currency === cur ? "" : t.fxRate ?? "",
          Math.round(baseAmount(t, cur) * 100) / 100, Math.round(myShare(t, cur) * 100) / 100,
          (t.splits ?? []).map((s) => `${s.name} ${s.amount}${s.settled ? " (paid)" : ""}`).join("; "),
          t.items.map((i) => i.name).join("; "), t.source,
        ]),
      ]),
      "text/csv;charset=utf-8",
    );

  const exportSummary = () =>
    downloadFile(
      `four-notes-summary-${year}.csv`,
      toCsv([
        ["Category", ...MONTHS.map(monthName), "Total"],
        ...data.usedCats.map((c) => [c, ...MONTHS.map((m) => Math.round(data.grid[m][c] ?? 0)), Math.round(data.catTotal[c])]),
        ["Total spent", ...MONTHS.map((m) => Math.round(data.monthSpend[m])), Math.round(data.spent)],
        ["Income", ...MONTHS.map((m) => Math.round(data.income[m])), Math.round(data.earned)],
        ["Net", ...MONTHS.map((m) => Math.round(data.income[m] - data.monthSpend[m])), Math.round(data.earned - data.spent)],
      ]),
      "text/csv;charset=utf-8",
    );

  const report = (
    <div className="report text-sm">
      <h1 className="text-2xl font-bold">Four Notes · {year} financial report</h1>
      <p className="mb-4 text-[var(--muted)]">{spaceName} · amounts in {cur} · generated {new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div><div className="text-xs text-[var(--muted)]">Spent (your share)</div><div className="text-lg font-semibold">{formatMoney(data.spent, cur)}</div></div>
        <div><div className="text-xs text-[var(--muted)]">Income</div><div className="text-lg font-semibold">{formatMoney(data.earned, cur)}</div></div>
        <div><div className="text-xs text-[var(--muted)]">Net</div><div className="text-lg font-semibold">{formatMoney(data.earned - data.spent, cur)}</div></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="border-b border-[var(--line)] text-left">
              <th className="py-1 pr-2">Category</th>
              {MONTHS.map((m) => <th key={m} className="px-1 py-1 text-right">{monthName(m)}</th>)}
              <th className="py-1 pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.usedCats.map((c) => (
              <tr key={c} className="border-b border-[var(--line)]">
                <td className="py-1 pr-2">{c}</td>
                {MONTHS.map((m) => <td key={m} className="px-1 py-1 text-right">{data.grid[m][c] ? formatMoney(data.grid[m][c], cur, true) : ""}</td>)}
                <td className="py-1 pl-2 text-right font-medium">{formatMoney(data.catTotal[c], cur, true)}</td>
              </tr>
            ))}
            <tr className="border-b border-[var(--line)] font-semibold">
              <td className="py-1 pr-2">Total spent</td>
              {MONTHS.map((m) => <td key={m} className="px-1 py-1 text-right">{data.monthSpend[m] ? formatMoney(data.monthSpend[m], cur, true) : ""}</td>)}
              <td className="py-1 pl-2 text-right">{formatMoney(data.spent, cur, true)}</td>
            </tr>
            <tr>
              <td className="py-1 pr-2">Income</td>
              {MONTHS.map((m) => <td key={m} className="px-1 py-1 text-right">{data.income[m] ? formatMoney(data.income[m], cur, true) : ""}</td>)}
              <td className="py-1 pl-2 text-right">{formatMoney(data.earned, cur, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-[var(--faint)]">{data.txs.length} transactions. Shares of split bills paid by others are excluded from spending.</p>
    </div>
  );

  return (
    <>
      <Modal open={open} onClose={onClose} title="Annual report" wide>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-sm">
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost flex items-center gap-1 border border-[var(--line)] text-sm" onClick={exportTransactions} disabled={!data.txs.length}>
                <Icon name="download" size={14} /> Transactions (Excel CSV)
              </button>
              <button className="btn-ghost flex items-center gap-1 border border-[var(--line)] text-sm" onClick={exportSummary} disabled={!data.txs.length}>
                <Icon name="download" size={14} /> Summary (Excel CSV)
              </button>
              <button className="flex items-center gap-1 rounded-md bg-[var(--text)] px-3 py-1 text-sm text-[var(--bg)] disabled:opacity-30" onClick={() => window.print()} disabled={!data.txs.length}>
                Print / Save as PDF
              </button>
            </div>
          </div>
          {report}
        </div>
      </Modal>
      {open && typeof document !== "undefined" && createPortal(<div className="print-only p-8">{report}</div>, document.body)}
    </>
  );
}
