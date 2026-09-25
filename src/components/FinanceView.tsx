"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { baseAmount, myShare, spendByCategory } from "@/lib/insights";
import { useFiledFlash } from "@/lib/highlight";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { fingerprint } from "@/lib/fingerprint";
import { useOnline } from "@/lib/hooks";
import { composeReview, isComposedReview } from "@/lib/monthlyReview";
import { alive, formatMoney, localDate, localMonth, parseAmount, useStore } from "@/lib/store";
import { CURRENCIES, type Tab } from "@/lib/types";
import { parseWalletNotification } from "@/lib/wallet";
import { useAssistant } from "./assistant";
import BudgetEditor from "./BudgetEditor";
import CategoryEditor from "./CategoryEditor";
import CategorySelect from "./CategorySelect";
import ReportModal from "./ReportModal";
import SplitEditor from "./SplitEditor";
import EmptyStart from "./EmptyStart";
import Dashboard, { FCARD } from "./finance/Dashboard";
import { Dropdown, MenuItem } from "./notes/Dropdown";
import { Icon, inputBox, Modal, SectionTitle, useToast } from "./ui";

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
/** The toolbar's controls and the add bar: pills, as the macOS app has them. */
const PILL = "flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[var(--bg)]";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** Narrows the transaction table. */
  const [query, setQuery] = useState("");
  const online = useOnline();

  useOpenItem("transaction", (f) => {
    const t = transactions.find((x) => x.id === f.id);
    if (!t) return;
    setMonth(t.date.slice(0, 7));
    setOpenId(t.id);
    scrollToId(`tx-${t.id}`);
  });
  // Budgets live in Finance settings (the gear); the dashboard doesn't show them.
  useOpenItem("budget", () => setSettingsOpen(true));

  const live = useMemo(() => alive(transactions), [transactions]);
  const txs = useMemo(
    () => live.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [live, month],
  );
  const total = txs.filter((t) => t.amount > 0).reduce((s, t) => s + myShare(t, cur), 0);
  const byCat = spendByCategory(txs, cur);
  const summary = summaries.find((s) => s.month === month);

  /** `asked`: the button was pressed. Written on its own, a failure stays quiet. */
  const summarize = async (asked = true) => {
    setLoading(true);
    try {
      const { text } = await api.monthlySummary(month, cur, txs.map((t) => ({ merchant: t.merchant, amount: myShare(t, cur), category: t.category, date: t.date })));
      // The figures are the app's own; the model keeps what needs judgement.
      saveSummary({ month, total, currency: cur, byCategory: byCat as Record<string, number>, text: composeReview(text, total, byCat as Record<string, number>, cur), createdAt: new Date().toISOString() });
    } catch (e) {
      if (asked) toast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // The review is rewritten each time Finance opens after the month's spending changed, or on a new day.
  const reviewBasis = fingerprint(`${month}#${localDate()}#${txs.map((t) => `${t.id}|${t.amount}|${t.category}`).join(";")}`);
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (month !== localMonth() || !txs.length || !online || requested.current === reviewBasis) return;
    // Up to date: written today, over the same total, by the app (not an older one straight from a model).
    if (summary && localDate(new Date(summary.createdAt)) === localDate() && Math.abs(summary.total - total) < 1 && isComposedReview(summary.text, summary.total, cur)) return;
    // Let a burst of edits settle; a newer change cancels this one.
    const t = setTimeout(() => { requested.current = reviewBasis; summarize(false); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewBasis, online]);

  /** The table, narrowed by the search box. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return txs;
    return txs.filter((t) => t.merchant.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.items.some((i) => i.name.toLowerCase().includes(q)));
  }, [txs, query]);

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
      {/* Toolbar: search on the left; the month and one menu of actions on the right. */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className={`${PILL} min-w-0 flex-1 gap-2.5 px-4 max-sm:basis-full sm:max-w-[420px]`}>
          <Icon name="search" size={17} className="shrink-0 text-[var(--faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            onFocus={() => scrollToId("finance-transactions", "start")}
            placeholder="Search transactions, categories or items"
            aria-label="Search transactions"
            className="input-plain min-w-0 flex-1 text-sm"
          />
          {query && <button type="button" className="grid h-6 w-6 place-items-center rounded-full text-[var(--faint)] hover:bg-[var(--hover)]" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="x" size={13} /></button>}
        </label>
        <div className="ml-auto flex items-center gap-2.5">
          <div className={`${PILL} gap-0.5 px-1.5`}>
            <button className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <Icon name="chevronLeft" size={16} />
            </button>
            <h2 key={month} className="fn-note-in min-w-[7.5rem] text-center text-sm font-medium">{monthLabel(month)}</h2>
            <button className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <Dropdown label="Actions" title="Report, paste a notification" width={250} align="right" className={`${PILL} gap-1.5 px-4 text-sm font-medium hover:bg-[var(--hover)]`} button={<>Actions</>}>
            {(close) => (
              <>
                <MenuItem icon="download" label="Monthly report…" onSelect={() => { close(); setReportOpen(true); }} />
                <MenuItem icon="clipboard" label="Paste a payment notification…" onSelect={() => { close(); setPasteOpen(true); }} />
              </>
            )}
          </Dropdown>
          <button
            className={`${PILL} w-10 shrink-0 justify-center text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]`}
            onClick={() => setSettingsOpen(true)}
            aria-label="Finance settings"
            title="Finance settings: budgets and categories"
          >
            <Icon name="settings" size={17} />
          </button>
        </div>
      </div>

      <Dashboard
        month={month}
        setTab={setTab}
        summary={summary}
        summarizing={loading}
        onSummarize={() => summarize(true)}
        onReport={() => setReportOpen(true)}
        onBudgets={() => setSettingsOpen(true)}
        onOpenTransactions={() => scrollToId("finance-transactions", "start")}
        onOpenTransaction={(id) => { setOpenId(id); scrollToId(`tx-${id}`); }}
      />

      <section id="finance-transactions" className="mt-6 scroll-mt-20 space-y-4">
      {/* One line to add a transaction. */}
      <form
        className={`${PILL} flex-wrap gap-x-3 gap-y-1 py-1 pl-5 pr-1.5 text-sm max-sm:rounded-2xl max-sm:py-2`}
        onSubmit={(e) => {
          e.preventDefault();
          const amount = parseAmount(form.amount);
          if (!form.merchant.trim() || !amount) return;
          addTransaction({
            merchant: form.merchant, amount, currency: form.currency, fxRate: null, category: form.category,
            date: month === localMonth() ? localDate() : `${month}-01`,
          });
          setForm({ ...form, merchant: "", amount: "" });
        }}
      >
        <Icon name="plus" size={16} className="shrink-0 text-[var(--accent)]" />
        <input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} placeholder="Add a transaction — merchant" aria-label="Merchant" className="input-plain h-9 min-w-[9rem] flex-1 font-medium" />
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount (25k)" aria-label="Amount" inputMode="decimal" className="input-plain h-9 w-28 tabular-nums" />
        <CategorySelect value={form.category} onChange={(category) => setForm({ ...form, category })} className="h-9 max-w-[10rem] cursor-pointer rounded-lg bg-transparent px-1 text-[var(--muted)] hover:bg-[var(--hover)]" />
        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} aria-label="Currency" className="h-9 cursor-pointer rounded-lg bg-transparent px-1 text-[var(--muted)] hover:bg-[var(--hover)]">
          {[...new Set([cur, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="fn-press ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white hover:brightness-110" aria-label="Add transaction" title="Add">
          <Icon name="arrowRight" size={15} />
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 className="fn-serif text-[1.45rem]">Transactions</h3>
        <span className="flex min-h-[34px] items-center rounded-full border border-[var(--line)] px-3.5 text-sm tabular-nums text-[var(--muted)]">
          {monthLabel(month)}: {formatMoney(total, cur)}
        </span>
      </div>

      {txs.length > 0 && shown.length === 0 && <p className="py-5 text-center text-sm text-[var(--faint)]">Nothing matches “{query}”.</p>}
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
              {shown.map((t) => {
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

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Finance settings">
        <div className="space-y-6 p-4 text-sm">
          <section aria-labelledby="finance-budgets" className="space-y-2">
            <h3 id="finance-budgets" className="flex items-center gap-2 font-medium"><Icon name="target" size={16} className="text-[var(--muted)]" /> Monthly budgets</h3>
            <BudgetEditor />
          </section>
          <section aria-labelledby="finance-categories" className="space-y-2 border-t border-[var(--line)] pt-5">
            <h3 id="finance-categories" className="flex items-center gap-2 font-medium"><Icon name="finance" size={16} className="text-[var(--muted)]" /> Categories</h3>
            <CategoryEditor />
          </section>
          <button className="w-full rounded-md bg-[var(--text)] py-2 text-sm font-medium text-[var(--bg)]" onClick={() => setSettingsOpen(false)}>Done</button>
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
