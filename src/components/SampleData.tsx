"use client";
// Banner + button for the optional sample data.
import { useStore } from "@/lib/store";
import { Icon, useToast } from "./ui";

export function SampleDataButton({ label = "Explore with sample data", className }: { label?: string; className?: string }) {
  const { loadSamples, hasSamples } = useStore();
  const toast = useToast();
  if (hasSamples) return null;
  return (
    <button
      type="button"
      className={className ?? "fn-press rounded-lg border border-[var(--line)] px-3.5 py-1.5 text-sm hover:bg-[var(--hover)]"}
      onClick={() => {
        loadSamples();
        toast("Sample data added. Remove it any time from the banner at the top or in Settings.");
      }}
    >
      {label}
    </button>
  );
}

export function RemoveSamplesButton({ className }: { className?: string }) {
  const { clearSamples, hasSamples } = useStore();
  const toast = useToast();
  if (!hasSamples) return null;
  return (
    <button
      type="button"
      className={className ?? "fn-press rounded-lg border border-[var(--line)] px-3.5 py-1.5 text-sm hover:bg-[var(--hover)]"}
      onClick={() => {
        clearSamples();
        toast("Sample data removed. Only your own items are left.");
      }}
    >
      Remove sample data
    </button>
  );
}

/** Thin strip shown while sample data is present, so it's never mistaken for real data. */
export default function SampleBanner() {
  const { hasSamples, clearSamples } = useStore();
  const toast = useToast();
  if (!hasSamples) return null;
  return (
    <div className="no-print flex items-center justify-center gap-2 bg-[var(--sticky-blue)] px-4 py-1.5 text-xs" role="status">
      <Icon name="sparkle" size={13} />
      <span>You&apos;re looking at sample data — it isn&apos;t saved to the cloud.</span>
      <button
        className="fn-press font-medium text-[var(--accent)]"
        onClick={() => {
          clearSamples();
          toast("Sample data removed.");
        }}
      >
        Remove
      </button>
    </div>
  );
}
