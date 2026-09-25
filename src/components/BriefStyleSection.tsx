"use client";
// Settings → Today: how the daily brief reads — one short paragraph, or point by point.
import { BRIEF_STYLES, useBriefStyle } from "@/lib/briefParagraph";
import { Icon } from "./ui";

export default function BriefStyleSection() {
  const [style, setStyle] = useBriefStyle();
  return (
    <section>
      <p className="mb-2 text-xs text-[var(--muted)]">How the daily brief reads</p>
      <div role="radiogroup" aria-label="How the daily brief reads" className="grid gap-2 sm:grid-cols-2">
        {BRIEF_STYLES.map((o) => {
          const active = style === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setStyle(o.id)}
              className={`fn-press rounded-[10px] border p-3 text-left transition-colors ${
                active ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-[var(--line)] hover:bg-[var(--hover)]"
              }`}
            >
              <span className={`flex items-center gap-1.5 font-medium ${active ? "text-[var(--accent)]" : ""}`}>
                <Icon name={o.icon} size={15} /> {o.label}
                {o.id === "paragraph" && <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--accent)]">Compact</span>}
              </span>
              <span className="mt-1.5 block text-xs text-[var(--muted)]">{o.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
