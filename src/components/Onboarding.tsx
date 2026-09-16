"use client";
// First-run setup: theme, AI key, Google backup, budgets. Skippable at every step,
// and resumable if the Google sign-in sends the browser away mid-way.
import { useEffect, useState } from "react";
import { saveUserKeys, useUserKeys, OPENROUTER_KEYS_URL } from "@/lib/byok";
import { useStore } from "@/lib/store";
import { CURRENCIES } from "@/lib/types";
import AppearanceSection from "./AppearanceSection";
import BudgetEditor from "./BudgetEditor";
import { GoogleSyncPanel, useGoogleSync } from "./googleSync";
import Logo from "./Logo";
import { SampleDataButton } from "./SampleData";
import { Icon, useToast } from "./ui";

const KEY = "four-notes:onboarding";
const STEP_KEY = "four-notes:onboarding-step";

export const needsOnboarding = () => {
  try { return localStorage.getItem(KEY) === "pending"; } catch { return false; }
};
export const startOnboarding = () => {
  try { localStorage.setItem(KEY, "pending"); localStorage.setItem(STEP_KEY, "0"); } catch { /* storage blocked */ }
};
const finishOnboarding = () => {
  try { localStorage.setItem(KEY, "done"); localStorage.removeItem(STEP_KEY); } catch { /* storage blocked */ }
};

type ServerStatus = { shared?: boolean; provider?: "anthropic" | "openrouter" | "demo"; sharedPerVisitorDaily?: number };

const STEPS = ["Welcome", "Look", "AI", "Backup", "Budget"];

export default function Onboarding() {
  const store = useStore();
  const google = useGoogleSync();
  const { keys } = useUserKeys();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [orKey, setOrKey] = useState("");

  useEffect(() => {
    if (!store.ready || !needsOnboarding()) return;
    setOpen(true);
    const saved = Number(localStorage.getItem(STEP_KEY) ?? "0");
    // Coming back from Google's consent screen lands on the backup step.
    const returned = new URLSearchParams(window.location.search).has("google") || google.email;
    setStep(returned ? 3 : Number.isFinite(saved) ? Math.min(Math.max(saved, 0), STEPS.length - 1) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready]);

  useEffect(() => {
    if (open) fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
  }, [open]);

  const goto = (next: number) => {
    setStep(next);
    try { localStorage.setItem(STEP_KEY, String(next)); } catch { /* storage blocked */ }
  };

  const close = (message?: string) => {
    finishOnboarding();
    setOpen(false);
    if (message) toast(message);
  };

  if (!open) return null;

  const saveKey = () => {
    const value = orKey.trim();
    if (!value) return goto(3);
    saveUserKeys({ ...keys, openrouterKey: value }, true);
    toast("🔑 Key saved. The assistant is ready.");
    goto(3);
  };

  const content = [
    // 0 — welcome
    <div key="welcome" className="space-y-4 text-center">
      <Logo size={72} className="mx-auto" />
      <div>
        <h2 className="text-2xl font-bold">Welcome to Four Notes</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Notes, to-dos and spending in one place, with an assistant that files things for you.</p>
      </div>
      <ul className="mx-auto max-w-sm space-y-2 text-left text-sm">
        {[
          ["camera", "Photograph a receipt and it lands in Finance"],
          ["todo", "“Remind me to pay rent every month” becomes a repeating task"],
          ["finance", "Budgets, split bills and a monthly review"],
        ].map(([icon, text]) => (
          <li key={text} className="flex items-start gap-2.5">
            <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
            {text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--muted)]">Setup takes about a minute. You can skip it and change everything later in Settings.</p>
      <div className="flex justify-center">
        <SampleDataButton label="Explore with sample data first" />
      </div>
    </div>,

    // 1 — appearance
    <div key="look" className="space-y-3">
      <h2 className="text-lg font-semibold">Light or dark?</h2>
      <p className="text-sm text-[var(--muted)]">System follows your device automatically.</p>
      <AppearanceSection />
    </div>,

    // 2 — AI key
    <div key="ai" className="space-y-3">
      <h2 className="text-lg font-semibold">Turn on the assistant</h2>
      {server?.shared ? (
        <p className="text-sm text-[var(--muted)]">
          This app already includes free AI — about {server.sharedPerVisitorDaily ?? 10} requests a day. Add your own free key for your own
          allowance, or carry on and add one later.
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Paste a free OpenRouter key and the assistant can read receipts, write your daily brief and answer questions. Without one, the app
          still works with simple rule-based replies.
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={orKey}
          onChange={(e) => setOrKey(e.target.value)}
          placeholder="sk-or-v1-…"
          aria-label="OpenRouter API key"
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-md bg-[var(--hover)] px-2.5 font-mono text-xs text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="flex h-9 items-center rounded-md border border-[var(--line)] px-3 text-xs hover:bg-[var(--hover)]">
          Get a free key ↗
        </a>
      </div>
      <p className="text-xs text-[var(--muted)]">Keys stay in this browser and are never included in backups or sync.</p>
    </div>,

    // 3 — backup
    <div key="backup" className="space-y-3">
      <h2 className="text-lg font-semibold">Back up and sync</h2>
      {google.enabled ? (
        <GoogleSyncPanel />
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Sync isn&apos;t set up on this app yet, so everything stays in this browser. You can still export a backup file any time from
          Settings → Data &amp; privacy.
        </p>
      )}
    </div>,

    // 4 — budgets
    <div key="budget" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Set a budget (optional)</h2>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">Currency
          <select
            value={store.settings.currency}
            onChange={(e) => store.updateSettings({ currency: e.target.value })}
            className="h-8 rounded-md bg-[var(--hover)] px-2 text-[var(--text)] outline-none"
          >
            {[...new Set([store.settings.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="scroll-thin max-h-[40vh] overflow-y-auto pr-1">
        <BudgetEditor />
      </div>
    </div>,
  ][step];

  const last = step === STEPS.length - 1;

  return (
    <div className="no-print fixed inset-0 z-[65] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div role="dialog" aria-modal aria-label="Set up Four Notes"
        className="scroll-thin flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow)] sm:rounded-2xl">
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="flex flex-1 gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className="h-1 flex-1 rounded-full transition-colors" style={{ background: i <= step ? "var(--accent)" : "var(--line)" }} />
            ))}
          </div>
          <button className="btn-ghost shrink-0 text-xs" onClick={() => close("You can set this up any time in Settings.")}>Skip</button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-5">{content}</div>

        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3">
          <span className="text-xs text-[var(--muted)]">Step {step + 1} of {STEPS.length}</span>
          <div className="ml-auto flex gap-2">
            {step > 0 && <button className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--hover)]" onClick={() => goto(step - 1)}>Back</button>}
            <button
              className="rounded-md bg-[var(--text)] px-4 py-1.5 text-sm font-medium text-[var(--bg)]"
              onClick={() => (last ? close("All set. Enjoy Four Notes!") : step === 2 ? saveKey() : goto(step + 1))}
            >
              {last ? "Finish" : step === 2 && orKey.trim() ? "Save & continue" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
