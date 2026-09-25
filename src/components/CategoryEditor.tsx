"use client";
// Finance → settings (gear) → Categories: add your own spending categories, remove the ones you added.
import { useMemo, useState } from "react";
import { alive, useStore } from "@/lib/store";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import { Icon, useToast } from "./ui";

export default function CategoryEditor() {
  const { categories, addCategory, removeCategory, transactions } = useStore();
  const toast = useToast();
  const [name, setName] = useState("");

  const used = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of alive(transactions)) counts[t.category] = (counts[t.category] ?? 0) + 1;
    return counts;
  }, [transactions]);

  const builtIn = new Set<string>(EXPENSE_CATEGORIES);

  const add = () => {
    const created = addCategory(name);
    if (!created) return toast("That category already exists, or the name is empty.", "error");
    setName("");
    toast(`🏷️ Category added: ${created}`);
  };

  const remove = (category: string) => {
    const count = used[category] ?? 0;
    const message = count
      ? `Remove “${category}”? ${count} transaction${count === 1 ? "" : "s"} already use it and will keep the name, but you won't be able to pick it again.`
      : `Remove “${category}”?`;
    if (!window.confirm(message)) return;
    removeCategory(category);
    toast(`Category removed: ${category}`);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Categories are used for spending, budgets and reports. The built-in ones can&apos;t be removed; your own can.
      </p>

      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c} className={`chip ${builtIn.has(c) ? "" : "pr-1"}`}>
            {c}
            {used[c] ? <span className="text-[var(--faint)]">· {used[c]}</span> : null}
            {!builtIn.has(c) && (
              <button className="ml-0.5 rounded p-0.5 hover:text-[var(--danger)]" onClick={() => remove(c)} aria-label={`Remove ${c}`}>
                <Icon name="x" size={11} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New category (e.g. Pets)"
          aria-label="New category name"
          className="h-9 min-w-0 flex-1 rounded-md bg-[var(--hover)] px-2.5 text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button className="h-9 rounded-md border border-[var(--line)] px-4 font-medium hover:bg-[var(--hover)] disabled:opacity-40" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
