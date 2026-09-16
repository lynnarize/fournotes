// Optional sample data ("Explore with sample data").
// Every item is tagged `sample: true`, so it can be removed in one click and is
// never uploaded to cloud sync. A fresh install has none of this.
import type { Note, Sticky, Todo, Transaction } from "./types";

export const SAMPLE_BUDGETS: Record<string, number> = { "Food & Drink": 1_500_000, Transport: 600_000 };

export function buildSamples(id: () => string, currency: string) {
  const now = new Date();
  const shift = (days: number, hour?: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    if (hour != null) d.setHours(hour, 0, 0, 0);
    return d;
  };
  const iso = (days: number, hour?: number) => shift(days, hour).toISOString();
  const ymd = (days: number) => {
    const d = shift(days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const base = (days: number) => ({ id: id(), createdAt: iso(days), updatedAt: iso(days), deletedAt: null, sample: true as const });

  const note: Note = {
    ...base(-6),
    title: "Weekend trip ideas",
    content:
      "Places to consider\n• Bandung — short drive, good coffee\n• Bali — flights are cheaper midweek\n\nBudget roughly 2jt for two nights.\n\nTip: type / on a line for commands like /todo.",
    source: "manual",
    tags: ["sample"],
  };

  const todos: Todo[] = [
    {
      ...base(-4), title: "Pay internet bill", done: false, priority: "medium", source: "manual",
      dueAt: iso(3, 9), remindAt: iso(3, 8), rrule: "FREQ=MONTHLY;INTERVAL=1",
      bill: { amount: 350_000, category: "Bills & Utilities" },
    },
    { ...base(-2), title: "Buy groceries", done: false, priority: "medium", source: "manual", dueAt: iso(0, 18), remindAt: null, noteId: note.id },
    { ...base(-9), title: "Book dentist appointment", done: true, completedAt: iso(-1, 9), priority: "low", source: "manual", dueAt: iso(-1, 10), remindAt: null },
  ];

  const tx = (days: number, merchant: string, amount: number, category: string, extra: Partial<Transaction> = {}): Transaction => ({
    ...base(days), merchant, amount, currency, category, date: ymd(days), items: [], source: "manual", ...extra,
  });

  const transactions: Transaction[] = [
    tx(0, "Kopi Kenangan", 28_000, "Food & Drink", { items: [{ name: "Kopi Susu", qty: 1, price: 28_000 }] }),
    tx(0, "Gojek", 35_000, "Transport"),
    tx(-2, "Indomaret", 87_500, "Groceries"),
    tx(-5, "Warteg Bahari", 90_000, "Food & Drink", {
      splits: [
        { name: "Andi", amount: 30_000, settled: false },
        { name: "Budi", amount: 30_000, settled: true },
      ],
    }),
    // Two months of the same charge, so the subscription detector has something to find.
    tx(-8, "Netflix", 186_000, "Entertainment"),
    tx(-38, "Netflix", 186_000, "Entertainment"),
  ];

  const stickies: Sticky[] = [
    { ...base(-3), text: "Andi still owes 30k for Warteg", color: "yellow", pinned: true },
  ];

  return { notes: [note], todos, transactions, stickies, budgets: SAMPLE_BUDGETS };
}
