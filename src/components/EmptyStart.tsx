"use client";
// Empty state that teaches: tap an example and the assistant does it, so the
// first item in the app is the user's own rather than seeded demo data.
import type { ReactNode } from "react";
import { useAssistant } from "./assistant";
import { SampleDataButton } from "./SampleData";

export default function EmptyStart({ title, hint, prompts, extra, showSample = true }: {
  title: string;
  hint: string;
  prompts: string[];
  extra?: ReactNode;
  showSample?: boolean;
}) {
  const { send, busy } = useAssistant();
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] px-5 py-8 text-center">
      <div className="text-base font-medium">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">{hint}</p>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            disabled={!!busy}
            onClick={() => send(p)}
            className="fn-press rounded-full border border-[var(--line)] px-3.5 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
          >
            “{p}”
          </button>
        ))}
      </div>

      {(extra || showSample) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
          {extra}
          {showSample && <SampleDataButton />}
        </div>
      )}
    </div>
  );
}
