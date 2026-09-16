"use client";
import { Fragment, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { baseAmount, budgetStatus, detectSubscriptions, myShare, owedToMe, spendByCategory } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { useOpenItem } from "@/lib/nav";
import { alive, formatMoney, localDate, localMonth, parseAmount, useStore } from "@/lib/store";
import { CURRENCIES } from "@/lib/types";
import { parseWalletNotification } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import BudgetEditor from "./BudgetEditor";
import CategorySelect from "./CategorySelect";
import ReportModal from "./ReportModal";
import SplitEditor from "./SplitEditor";
import EmptyStart from "./EmptyStart";
import { Icon, inputBox, Modal, SectionTitle, useToast } from "./ui";

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
// Filled fields stay readable and tappable on small screens.
const FIELD = "h-9 rounded-md bg-[var(--hover)] px-2.5 outline-none placeholder:text-[var(--faint)] focus:ring-1 focus:ring-[var(--accent)]";

const shiftMonth = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function FinanceView() {
  const { transactions, todos, notes, summaries, settings, addTransaction, updateTransaction, remove, saveSummary, setBudget, addTodo } = useStore();
  const { send } = useAssistant();
  const toast = useToast();
  const cur = settings.currency;
  const [month, setMonth] = useState(() => localMonth());
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ merchant: "", amount: "", currency: cur, category: "Food & Drink" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useOpenItem("transaction", (f) => {
    const t = transactions.find((x) => x.id === f.id);
    if (!t) return;
    setMonth(t.date.slice(0, 7));
    setOpenId(t.id);
    requestAnimationFrame(() => document.getElementById(`tx-${t.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  });

  const live = useMemo(() => alive(transactions), [transactions]);
  const txs = useMemo(
    () => live.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [live, month],
  );
  const total = txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
  const income = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(baseAmount(t, cur)), 0);
  const byCat = spendByCategory(txs, cur);
  const budgets = budgetStatus(txs, settings);
  const categoryRows = [...new Set([...budgets.map((b) => b.category), ...Object.keys(byCat)])]
    .filter((c) => c !== "Income")
    .map((c) => ({ category: c, spent: byCat[c] ?? 0, limit: settings.budgets[c] ?? 0 }))
    .sort((a, b) => b.spent - a.spent);
  const owed = useMemo(() => owedToMe(live, cur), [live, cur]);
  const owedTotal = owed.reduce((s, [, v]) => s + v, 0);
  const subs = useMemo(() => detectSubscriptions(live), [live]);
  const summary = summaries.find((s) => s.month === month);

  const summarize = async () => {
    setLoading(true);
    try {
      const { text } = await api.monthlySummary(month, cur, txs.map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category, date: t.date })));
      saveSummary({ month, total, currency: cur, byCategory: byCat as Record<string, number>, text, createdAt: new Date().toISOString() });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const makeBill = (s: (typeof subs)[number]) => {
    const due = new Date(`${s.nextDate}T09:00:00`).toISOString();
    addTodo({
      title: `Pay ${s.merchant}`, dueAt: due, remindAt: due, rrule: "FREQ=MONTHLY;INTERVAL=1",
      bill: { amount: s.amount, currency: s.currency, category: s.category },
    });
    toast(`🔁 Monthly bill added: ${s.merchant}`);
  };
  const hasBill = (merchant: string) =>
    alive(todos).some((t) => t.rrule && !t.done && t.title.toLowerCase().includes(merchant.toLowerCase()));

  const submitPaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    const parsed = parseWalletNotification(text);
    if (parsed) {
      addTransaction({ merchant: parsed.merchant, amount: parsed.amount, category: parsed.category, date: localDate() });
      toast(`💸 ${parsed.wallet ?? "Payment"}: ${parsed.merchant} ${formatMoney(Math.abs(parsed.amount), cur)}`);
    } else if (navigator.onLine) {
      send(text);
      toast("Sent to the assistant to read.");
    } else {
      return toast("Couldn't read that offline. Try again when you're connected.", "error");
    }
    setPasteText("");
    setPasteOpen(false);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
          <Icon name="chevron" className="rotate-180" />
        </button>
        <h2 className="min-w-40 text-center font-semibold">{monthLabel(month)}</h2>
        <button className="btn-ghost" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
          <Icon name="chevron" />
        </button>
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost flex items-center gap-1 text-sm" onClick={() => setPasteOpen(true)}>
            <Icon name="clipboard" size={14} /> App / receipt notification
          </button>
          <button className="btn-ghost flex items-center gap-1 text-sm" onClick={() => setReportOpen(true)}>
            <Icon name="download" size={14} /> Report
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Spent (your share)" value={formatMoney(total, cur)} />
        <Stat label="Income" value={formatMoney(income, cur)} />
        {owedTotal > 0 ? <Stat label="Others owe you" value={formatMoney(owedTotal, cur)} /> : <Stat label="Transactions" value={String(txs.length)} />}
      </div>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Budgets & categories</h3>
            <button className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--hover)]" onClick={() => setBudgetsOpen(true)}>
              <Icon name="target" size={14} /> Set budgets
            </button>
          </div>
          {categoryRows.length === 0 && (
            <p className="text-sm text-[var(--faint)]">
              No spending this month.{" "}
              {Object.keys(settings.budgets).length === 0 && <button className="text-[var(--accent)]" onClick={() => setBudgetsOpen(true)}>Set your first budget</button>}
            </p>
          )}
          <ul className="space-y-2.5">
            {categoryRows.map(({ category, spent, limit }) => {
              const ratio = limit ? spent / limit : total ? spent / total : 0;
              const color = !limit ? "var(--accent)" : ratio >= 1 ? "var(--danger)" : ratio >= 0.8 ? "#d9730d" : "var(--ok)";
              return (
                <li key={category} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>{category}</span>
                    {editingBudget === category ? (
                      <input
                        autoFocus
                        defaultValue={limit || ""}
                        placeholder="Monthly budget"
                        aria-label={`${category} budget`}
                        onBlur={(e) => { setBudget(category, parseAmount(e.target.value)); setEditingBudget(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingBudget(null); }}
                        className={`${inputBox} w-32 text-right`}
                      />
                    ) : (
                      <button className="tabular-nums text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setEditingBudget(category)} title="Set budget">
                        {formatMoney(spent, cur, true)}{limit ? ` / ${formatMoney(limit, cur, true)}` : ""}
                        {!limit && <Icon name="target" size={12} className="ml-1 inline opacity-50" />}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--hover)]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, ratio * 100)}%`, background: color, opacity: limit ? 1 : 0.6 }} />
                  </div>
                  {limit > 0 && ratio >= 1 && <div className="mt-0.5 text-xs text-[var(--danger)]">Over by {formatMoney(spent - limit, cur)}</div>}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-4">
          <section className="rounded-lg border border-[var(--line)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="sparkle" className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold">Monthly review</h3>
              <button className="btn-ghost ml-auto text-xs" onClick={summarize} disabled={loading || txs.length === 0}>
                {loading ? "Writing…" : summary ? "Refresh" : "Generate"}
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">
              {summary?.text ?? "Generated automatically when a month ends, or tap Generate now."}
            </p>
          </section>

          {subs.length > 0 && (
            <section className="rounded-lg border border-[var(--line)] p-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="repeat" /> Subscriptions detected</h3>
              <ul className="space-y-1.5 text-sm">
                {subs.map((s) => (
                  <li key={s.merchant} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{s.merchant}</span>
                    <span className="tabular-nums text-[var(--muted)]">{formatMoney(s.amount, s.currency)}/mo</span>
                    <span className="text-xs text-[var(--faint)]">next ~{new Date(`${s.nextDate}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</span>
                    {hasBill(s.merchant) ? (
                      <span className="chip">tracked</span>
                    ) : (
                      <button className="btn-ghost text-xs text-[var(--accent)]" onClick={() => makeBill(s)}>Track as bill</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {owed.length > 0 && (
            <section className="rounded-lg border border-[var(--line)] p-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="users" /> Owed to you</h3>
              <ul className="space-y-1 text-sm">
                {owed.map(([name, v]) => (
                  <li key={name} className="flex justify-between"><span>{name}</span><span className="tabular-nums">{formatMoney(v, cur)}</span></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <form
        className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--line)] pb-3 text-sm lg:flex lg:flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = parseAmount(form.amount);
          if (!form.merchant || !amount) return;
          addTransaction({
            merchant: form.merchant, amount, currency: form.currency, fxRate: null, category: form.category,
            date: month === localMonth() ? localDate() : `${month}-01`,
          });
          setForm({ ...form, merchant: "", amount: "" });
        }}
      >
        <div className="col-span-2 flex min-w-0 items-center gap-2 lg:flex-1">
          <Icon name="plus" className="shrink-0 text-[var(--faint)]" />
          <input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} placeholder="Merchant" aria-label="Merchant" className={`${FIELD} w-full min-w-0`} />
        </div>
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount (25k)" aria-label="Amount" inputMode="decimal" className={`${FIELD} w-full min-w-0 lg:w-32`} />
        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} aria-label="Currency" className={`${FIELD} text-[var(--muted)]`}>
          {[...new Set([cur, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
        </select>
        <CategorySelect value={form.category} onChange={(category) => setForm({ ...form, category })} className={`${FIELD} w-full min-w-0 text-[var(--muted)] lg:w-auto`} />
        <button className="h-9 rounded-md border border-[var(--line)] px-4 font-medium hover:bg-[var(--hover)]">Add</button>
      </form>

      {txs.length === 0 ? (
        <EmptyStart
          title="No spending logged yet"
          hint="Add one above, scan a receipt, paste a payment notification — or just say what you spent."
          prompts={["Spent 25k on coffee at Starbucks", "Set my food budget to 1.5M a month"]}
          extra={<button className="fn-press rounded-lg border border-[var(--line)] px-3.5 py-1.5 text-sm hover:bg-[var(--hover)]" onClick={() => setPasteOpen(true)}>Paste a notification</button>}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {txs.map((t) => {
                const foreign = t.currency !== cur;
                const isOpen = openId === t.id;
                const unsettled = (t.splits ?? []).filter((s) => !s.settled).length;
                return (
                  <Fragment key={t.id}>
                    <TransactionRow id={t.id} open={isOpen}>
                      <td className="whitespace-nowrap py-2 pr-2 align-top text-xs text-[var(--muted)] sm:pr-3 sm:align-middle sm:text-sm">{new Date(`${t.date}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</td>
                      <td className="py-2 pr-3">
                        <button className="flex items-center gap-2 text-left" onClick={() => setOpenId(isOpen ? null : t.id)} aria-expanded={isOpen}>
                          {t.imageDataUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.imageDataUrl} alt="" className="h-7 w-7 rounded object-cover" />
                          )}
                          <div>
                            <div className="font-medium">
                              {t.merchant}
                              {t.splits?.length ? <span className="chip ml-2"><Icon name="users" size={11} />{t.splits.length + 1}{unsettled ? ` · ${unsettled} unpaid` : ""}</span> : null}
                              {t.noteId && <Icon name="link" size={11} className="ml-1 inline text-[var(--faint)]" />}
                            </div>
                            <div className="text-xs text-[var(--muted)] sm:hidden">{t.category}</div>
                            {t.items.length > 0 && <div className="text-xs text-[var(--muted)]">{t.items.map((i) => i.name).join(", ").slice(0, 60)}</div>}
                          </div>
                        </button>
                      </td>
                      <td className="hidden py-2 pr-3 sm:table-cell">
                        <CategorySelect value={t.category} onChange={(category) => updateTransaction(t.id, { category })} className="chip cursor-pointer border-0" />
                      </td>
                      <td className={`whitespace-nowrap py-2 text-right tabular-nums ${t.amount < 0 ? "text-[var(--ok)]" : ""}`}>
                        {formatMoney(Math.abs(t.amount), t.currency)}
                        {foreign && (
                          <div className="text-xs text-[var(--faint)]">{t.fxRate ? `≈ ${formatMoney(Math.abs(baseAmount(t, cur)), cur)}` : "fetching rate…"}</div>
                        )}
                      </td>
                      <td className="hidden w-8 text-right sm:table-cell">
                        <button className="btn-ghost opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => remove("transactions", t.id)} aria-label="Delete">
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </TransactionRow>
                    {isOpen && (
                      <tr className="border-b border-[var(--line)] bg-[var(--hover)]">
                        <td colSpan={5} className="px-3 pb-4 pt-1">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                              <label className="col-span-2 flex flex-col gap-1 sm:hidden">Category
                                <CategorySelect value={t.category} onChange={(category) => updateTransaction(t.id, { category })} className={inputBox} />
                              </label>
                              <label className="flex flex-col gap-1">Merchant
                                <input value={t.merchant} onChange={(e) => updateTransaction(t.id, { merchant: e.target.value })} className={inputBox} />
                              </label>
                              <label className="flex flex-col gap-1">Date
                                <input type="date" value={t.date} onChange={(e) => e.target.value && updateTransaction(t.id, { date: e.target.value })} className={inputBox} />
                              </label>
                              <label className="flex flex-col gap-1">Amount
                                <input key={t.amount} defaultValue={t.amount} inputMode="decimal"
                                  onBlur={(e) => { const n = parseAmount(e.target.value.replace(/^-/, "")); if (n != null) updateTransaction(t.id, { amount: e.target.value.trim().startsWith("-") ? -n : n }); }}
                                  className={inputBox} />
                              </label>
                              <label className="flex flex-col gap-1">Currency
                                <select value={t.currency} onChange={(e) => updateTransaction(t.id, { currency: e.target.value, fxRate: null })} className={inputBox}>
                                  {[...new Set([cur, t.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                                </select>
                              </label>
                              {foreign && (
                                <label className="col-span-2 flex flex-col gap-1">Rate: 1 {t.currency} = ? {cur}
                                  <input key={t.fxRate ?? "none"} defaultValue={t.fxRate ?? ""} inputMode="decimal" placeholder="Fetched automatically when online"
                                    onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); if (n > 0) updateTransaction(t.id, { fxRate: n }); }}
                                    className={inputBox} />
                                </label>
                              )}
                              <label className="col-span-2 flex flex-col gap-1">Linked note
                                <select value={t.noteId ?? ""} onChange={(e) => updateTransaction(t.id, { noteId: e.target.value || null })} className={inputBox}>
                                  <option value="">None</option>
                                  {alive(notes).map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
                                </select>
                              </label>
                              <button className="col-span-2 justify-self-start rounded-md px-2 py-1 text-sm text-[var(--danger)] hover:bg-[var(--hover)]" onClick={() => remove("transactions", t.id)}>
                                Delete transaction
                              </button>
                            </div>
                            <div>
                              <SectionTitle>Split bill</SectionTitle>
                              <SplitEditor txId={t.id} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="App / receipt notification">
        <div className="space-y-3 p-4">
          <p className="text-sm text-[var(--muted)]">
            Paste a payment notification from any app — GoPay, OVO, DANA, ShopeePay, QRIS, a bank app — or the text of a receipt. For screenshots
            and photos, use the scan button instead.
          </p>
          <textarea
            autoFocus
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Payment to Kopi Kenangan of Rp28,000 was successful"
            className={`${inputBox} w-full`}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setPasteOpen(false)}>Cancel</button>
            <button className="rounded-md bg-[var(--text)] px-3 py-1 text-sm text-[var(--bg)] disabled:opacity-30" disabled={!pasteText.trim()} onClick={submitPaste}>Add</button>
          </div>
        </div>
      </Modal>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />

      <Modal open={budgetsOpen} onClose={() => setBudgetsOpen(false)} title="Monthly budgets">
        <div className="p-4">
          <BudgetEditor />
          <button className="mt-4 w-full rounded-md bg-[var(--text)] py-2 text-sm font-medium text-[var(--bg)]" onClick={() => setBudgetsOpen(false)}>Done</button>
        </div>
      </Modal>
    </div>
  );
}

/** Table row that flashes when the assistant has just filed this transaction. */
function TransactionRow({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  const justFiled = useFiledFlash(id);
  return (
    <tr id={`tx-${id}`} className={`group border-b border-[var(--line)] hover:bg-[var(--hover)] ${open ? "bg-[var(--hover)]" : ""} ${justFiled ? "fn-flash" : ""}`}>
      {children}
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
