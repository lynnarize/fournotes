"use client";
import { useFiledFlash } from "@/lib/highlight";
import { scrollToId, useOpenItem } from "@/lib/nav";
import { alive, useStore } from "@/lib/store";
import type { StickyColor } from "@/lib/types";
import { Icon } from "./ui";

const COLORS: StickyColor[] = ["yellow", "pink", "blue", "green"];

/** Sticky wrapper that flashes when the assistant just pinned it. */
function Sticky({ id, color, children }: { id: string; color: string; children: React.ReactNode }) {
  const justFiled = useFiledFlash(id);
  return (
    <div
      id={`sticky-${id}`}
      className={`group relative flex h-28 w-44 shrink-0 flex-col rounded-md p-2.5 shadow-[var(--shadow)] ${justFiled ? "fn-flash" : ""}`}
      style={{ background: `var(--sticky-${color})` }}
    >
      {children}
    </div>
  );
}

export default function StickyBar() {
  const { stickies, addSticky, updateSticky, remove } = useStore();
  const list = alive(stickies);
  useOpenItem("sticky", (f) => scrollToId(`sticky-${f.id}`, "nearest"));

  return (
    <div className="scroll-thin flex gap-3 overflow-x-auto px-4 pb-3 pt-2 md:px-10">
      {list.map((s) => (
        <Sticky key={s.id} id={s.id} color={s.color}>
          {s.pinned && <Icon name="pin" size={12} className="absolute right-2 top-2 text-[var(--muted)]" />}
          <textarea
            value={s.text}
            onChange={(e) => updateSticky(s.id, { text: e.target.value })}
            placeholder="Write something…"
            className="input-plain flex-1 resize-none text-[13px] leading-snug"
            aria-label="Sticky note"
          />
          <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateSticky(s.id, { color: c })}
                aria-label={`${c} color`}
                className={`h-3.5 w-3.5 rounded-full border ${s.color === c ? "border-[var(--text)]" : "border-[var(--line)]"}`}
                style={{ background: `var(--sticky-${c})` }}
              />
            ))}
            <button
              className={`ml-auto ${s.pinned ? "text-[var(--text)]" : "text-[var(--muted)]"} hover:text-[var(--text)]`}
              onClick={() => updateSticky(s.id, { pinned: !s.pinned })}
              aria-label={s.pinned ? "Unpin from daily brief" : "Pin to daily brief"}
              title={s.pinned ? "Unpin from daily brief" : "Pin to daily brief"}
            >
              <Icon name="pin" size={13} />
            </button>
            <button className="text-[var(--muted)] hover:text-[var(--danger)]" onClick={() => remove("stickies", s.id)} aria-label="Delete sticky">
              <Icon name="trash" size={13} />
            </button>
          </div>
        </Sticky>
      ))}
      <button
        onClick={() => addSticky({ color: COLORS[list.length % COLORS.length] })}
        className="grid h-28 w-16 shrink-0 place-items-center rounded-md border border-dashed border-[var(--line)] text-[var(--faint)] hover:bg-[var(--hover)]"
        aria-label="Add sticky note"
      >
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
