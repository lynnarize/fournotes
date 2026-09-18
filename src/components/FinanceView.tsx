"use client";
import { Fragment, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { baseAmount, myShare, spendByCategory } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { alive, formatMoney, localDate, localMonth, parseAmount, useStore } from "@/lib/store";
import { CURRENCIES, type Tab } from "@/lib/types";
import { parseWalletNotification } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import BudgetEditor from "./BudgetEditor";
import CategorySelect from "./CategorySelect";
import ReportModal from "./ReportModal";
import SplitEditor from "./SplitEditor";
import EmptyStart from "./EmptyStart";
import Dashboard, { FCARD } from "./finance/Dashboard";
import { CARD, CardHead, Icon, inputBox, Modal, SectionTitle, useToast } from "./ui";

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
// Filled fields stay readable and tappable on small screens.
const FIELD = "h-10 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 outline-none placeholder:text-[var(--faint)] focus:ring-1 focus:ring-[var(--accent)]";
const ICON_BTN = "fn-press grid h-11 w-11 place-items-center rounded-xl border border-[var(--line)] bg-[var(--bg)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]";

const shiftMonth = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function FinanceView({ setTab }: { setTab: (t: Tab) => void }) {
  const { transactions, notes, summaries, settings, addTransaction, updateTransaction, remove, saveSummary } = useStore();
  const { send } = useAssistant();
  const toast = useToast();
  const cur = settings.currency;
  const [month, setMonth] = useState(() => localMonth());
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ merchant: "", amount: "", currency: cur, category: "Food & Drink" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useOpenItem("transaction", (f) => {
    const t = transactions.find((x) => x.id === f.id);
    if (!t) return;
    setMonth(t.date.slice(0, 7));
    setOpenId(t.id);
    scrollToId(`tx-${t.id}`);
  });
  // Budgets live in a window (and in Settings); the dashboard doesn't show them.
  useOpenItem("budget", () => setBudgetsOpen(true));

  const live = useMemo(() => alive(transactions), [transactions]);
  const txs = useMemo(
    () => live.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [live, month],
  );
  const total = txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
  const byCat = spendByCategory(txs, cur);
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
      {/* Toolbar: month picker, quick actions, and the report as the main button */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-h-11 items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-1">
          <button className="grid h-9 w-9 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
            <Icon name="chevronLeft" size={17} />
          </button>
          <Icon name="calendar" size={16} className="text-[var(--muted)]" />
          <h2 className="min-w-32 px-1 text-center text-sm font-medium">{monthLabel(month)}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
            <Icon name="chevron" size={17} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className={ICON_BTN} onClick={() => setPasteOpen(true)} aria-label="Paste a payment notification" title="Paste a payment notification">
            <Icon name="clipboard" size={18} />
          </button>
          <button className={ICON_BTN} onClick={() => setBudgetsOpen(true)} aria-label="Budgets" title="Budgets">
            <Icon name="target" size={18} />
          </button>
          <button className="fn-press flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white hover:brightness-110" onClick={() => setReportOpen(true)}>
            <Icon name="download" size={16} /> Report
          </button>
        </div>
      </div>

      <Dashboard
        month={month}
        setTab={setTab}
        summary={summary}
        summarizing={loading}
        onSummarize={summarize}
        onBudgets={() => setBudgetsOpen(true)}
        onOpenTransactions={() => scrollToId("finance-transactions", "start")}
        onOpenTransaction={(id) => { setOpenId(id); scrollToId(`tx-${id}`); }}
      />

      <section id="finance-transactions" className={`${FCARD} mt-4 scroll-mt-20 pb-2`}>
      <div className="px-5 pt-5">
        <CardHead title="Transactions">
          <span className="text-sm text-[var(--faint)]">{txs.length}</span>
        </CardHead>
      </div>
      <form
        className="mx-5 mb-2 mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--line)] pb-3 text-sm lg:flex lg:flex-wrap"
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
        <button className="h-10 rounded-lg bg-[var(--accent)] px-4 font-medium text-white hover:brightness-110">Add</button>
      </form>

      {txs.length === 0 ? (
        <EmptyStart
          title="No spending logged yet"
          hint="Add one above, scan a receipt, paste a payment notification — or just say what you spent."
          prompts={["Spent 25k on coffee at Starbucks", "Set my food budget to 1.5M a month"]}
          extra={<button className="fn-press rounded-lg border border-[var(--line)] px-3.5 py-1.5 text-sm hover:bg-[var(--hover)]" onClick={() => setPasteOpen(true)}>Paste a notification</button>}
        />
      ) : (
        <div className="overflow-x-auto px-2">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <tbody>
              {txs.map((t) => {
                const foreign = t.currency !== cur;
                const isOpen = openId === t.id;
                const unsettled = (t.splits ?? []).filter((s) => !s.settled).length;
                return (
                  <Fragment key={t.id}>
                    <TransactionRow id={t.id} open={isOpen}>
                      <td className="whitespace-nowrap rounded-l-xl py-2.5 pl-2 pr-2 align-top text-xs text-[var(--muted)] sm:pr-3 sm:align-middle sm:text-sm">{new Date(`${t.date}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</td>
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
                      <td className="hidden w-10 rounded-r-xl pr-1 text-right sm:table-cell">
                        <button className="btn-ghost opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => remove("transactions", t.id)} aria-label="Delete">
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </TransactionRow>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="rounded-b-xl bg-[var(--hover)] px-3 pb-4 pt-1">
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

      </section>

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
    <tr id={`tx-${id}`} data-open={open} className={`tx-row group ${justFiled ? "fn-flash" : ""}`}>
      {children}
    </tr>
  );
}
