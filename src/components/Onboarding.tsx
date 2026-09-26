"use client";
// First-run setup, over the whole window, as the macOS app has it (Views/OnboardingView.swift):
// a calm, paper-and-light welcome that shows what the app does, then asks only what it
// needs — how the day reads, how it looks, the assistant, a backup, the currency — and
// ends on a small celebration. Skippable at every step, and resumable if the Google
// sign-in sends the browser away mid-way. Each step blurs into the next.
import { useEffect, useState, type ReactNode } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { BRIEF_STYLES, useBriefStyle, type BriefStyle } from "@/lib/briefParagraph";
import { saveUserKeys, useUserKeys, OPENROUTER_KEYS_URL } from "@/lib/byok";
import { useStore } from "@/lib/store";
import { useTheme, type ThemePref } from "@/lib/theme";
import { CURRENCIES } from "@/lib/types";
import { GoogleSyncPanel, useGoogleSync } from "./googleSync";
import Logo from "./Logo";
import SecretInput from "./SecretInput";
import { Icon, useToast } from "./ui";

const KEY = "four-notes:onboarding";
const STEP_KEY = "four-notes:onboarding-step";
const START_EVT = "four-notes:onboarding-start";

export const needsOnboarding = () => {
  try { return localStorage.getItem(KEY) === "pending"; } catch { return false; }
};
/** Opens the wizard straight away — no reload, which would fight the back stack. */
export const startOnboarding = () => {
  try { localStorage.setItem(KEY, "pending"); localStorage.setItem(STEP_KEY, "0"); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(START_EVT));
};
const finishOnboarding = () => {
  try { localStorage.setItem(KEY, "done"); localStorage.removeItem(STEP_KEY); } catch { /* storage blocked */ }
};

type ServerStatus = { shared?: boolean; provider?: "anthropic" | "openrouter" | "demo"; sharedPerVisitorDaily?: number };

/** The steps, in order; each has a dash in the progress bar. The celebration comes after the last. */
const PAGES = ["welcome", "oneView", "brief", "nothingSlips", "look", "assistant", "backup", "money"] as const;
const BACKUP = PAGES.indexOf("backup");
const CELEBRATION = PAGES.length;

export default function Onboarding() {
  const store = useStore();
  const google = useGoogleSync();
  const { keys } = useUserKeys();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [forward, setForward] = useState(true);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [orKey, setOrKey] = useState("");
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (!store.ready || !needsOnboarding()) return;
    setOpen(true);
    const saved = Number(localStorage.getItem(STEP_KEY) ?? "0");
    // Coming back from Google's consent screen lands on the backup step.
    const returned = new URLSearchParams(window.location.search).has("google") || google.email;
    setStep(returned ? BACKUP : Number.isFinite(saved) ? Math.min(Math.max(saved, 0), PAGES.length - 1) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready]);

  // "Run first-time setup again" from Settings.
  useEffect(() => {
    const onStart = () => { setStep(0); setOpen(true); };
    window.addEventListener(START_EVT, onStart);
    return () => window.removeEventListener(START_EVT, onStart);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
    setNotify(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, [open]);

  const go = (delta: number) => {
    const next = Math.min(CELEBRATION, Math.max(0, step + delta));
    setForward(delta > 0);
    setStep(next);
    try { localStorage.setItem(STEP_KEY, String(Math.min(next, PAGES.length - 1))); } catch { /* storage blocked */ }
  };

  const close = (message?: string) => {
    finishOnboarding();
    setOpen(false);
    if (message) toast(message);
  };

  // Back goes to the previous step; on the first step it closes the wizard.
  useBackDismiss(open, () => {
    if (step === 0) return close("You can set this up any time in Settings.");
    go(-1);
    return true; // still open: keep a back entry for the next press
  });

  const page = PAGES[step] as (typeof PAGES)[number] | undefined;
  const celebrating = step === CELEBRATION;

  const primary = () => {
    if (page === "assistant" && orKey.trim()) {
      saveUserKeys({ ...keys, openrouterKey: orKey.trim() }, true);
      toast("🔑 Key saved. The assistant is ready.");
    }
    if (celebrating) close();
    else go(1);
  };

  // Enter moves on, as the default button does on the Mac — but not while typing in a field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Enter" || e.isComposing || ["TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName)) return;
      if (t.tagName === "INPUT" && page !== "assistant") return;
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const primaryTitle = page === "welcome" ? "Get started" : page === "look" ? "Looks good"
    : page === "assistant" ? (orKey.trim() ? "Save and continue" : "Continue")
    : page === "money" ? "I'm ready" : celebrating ? "Open Four Notes" : "Continue";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Set up Four Notes"
      className="fn-onboarding fn-calm no-print fixed inset-0 z-[65] flex flex-col overflow-hidden text-[var(--text)]"
      style={celebrating ? ({ "--calm-glow": "75%" } as React.CSSProperties) : undefined}
    >
      <div className="flex h-12 shrink-0 items-center justify-end px-5 pt-[env(safe-area-inset-top)] sm:px-7">
        {step > 0 && !celebrating && (
          <button
            className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => (page === "assistant" ? go(1) : close("You can set this up any time in Settings."))}
            title={page === "assistant" ? "Set up the assistant later in Settings" : "Skip setup"}
          >
            {page === "assistant" ? "Not now" : "Skip"}
          </button>
        )}
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 sm:px-14">
        <div key={step} data-dir={forward ? "fwd" : "back"} className="fn-step w-full max-w-[900px] py-6">
          {page === "welcome" && (
            <Split picture={<WelcomeCards />}>
              <Title>Four notebooks.<br />One calm place.</Title>
              <Lead>Notes, to-dos, spending and an assistant that files things for you — together in one fast app.</Lead>
            </Split>
          )}
          {page === "oneView" && (
            <Centered title="Your day, on one calm page" lead="What's due, what you spent and what you jotted down — sorted by what needs you now.">
              <TodayMock />
            </Centered>
          )}
          {page === "brief" && (
            <Centered title="How should your day read?" lead="A few sentences with the details a click away, or everything point by point. Change it any time in Settings.">
              <BriefTiles />
            </Centered>
          )}
          {page === "nothingSlips" && (
            <Split picture={<RemindMock />} pictureFirst>
              <Title>Nothing slips<br />through</Title>
              <Lead>Say “remind me to pay rent Friday” and Four Notes reminds you on Friday. A receipt photo becomes spending; a voice memo becomes a note with its to-dos.</Lead>
            </Split>
          )}
          {page === "look" && (
            <Centered title="Make it yours" lead="Follow your device, or pick a look and keep it. Change it any time in Settings.">
              <ThemeTiles />
            </Centered>
          )}
          {page === "assistant" && (
            <Centered
              title="Meet your assistant"
              lead={server?.shared
                ? `It already works here with free AI — about ${server.sharedPerVisitorDaily ?? 10} requests a day. Your own free key gives you your own allowance.`
                : "Paste a free OpenRouter key and it can read receipts, write your daily brief and answer questions. Without one, simple rule-based replies still work."}
            >
              <div className="mx-auto mt-5 w-full max-w-[340px] space-y-2.5 text-center">
                {server?.shared && (
                  <p className="mx-auto flex h-[34px] w-fit items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] px-3.5 text-[13px] font-medium">
                    <Icon name="check" size={13} className="text-[var(--ok)]" /> The assistant is ready to use
                  </p>
                )}
                <SecretInput
                  value={orKey}
                  onChange={(e) => setOrKey(e.target.value)}
                  placeholder="OpenRouter key (optional) — sk-or-v1-…"
                  aria-label="OpenRouter API key"
                  className="h-[38px] w-full rounded-[9px] border border-[color-mix(in_srgb,var(--text)_8%,transparent)] bg-[color-mix(in_srgb,var(--panel)_85%,transparent)] px-3.5 text-[13.5px] outline-none placeholder:text-[var(--faint)] focus:border-[color-mix(in_srgb,var(--ob-accent)_55%,transparent)]"
                />
                <p className="text-xs text-[var(--muted)]">Prefer Claude? <b className="text-[var(--text)]">Settings → AI &amp; API keys</b></p>
                <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-[var(--ob-accent)] hover:underline">Get a free OpenRouter key</a>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
                <Trust icon="key">Keys stay in this browser</Trust>
                <Trust icon="cloud">Never synced or backed up</Trust>
                <Trust icon="trash">Delete any time</Trust>
              </div>
            </Centered>
          )}
          {page === "backup" && (
            <Centered title="Keep a copy safe" lead="Everything is saved in this browser. Back it up to your own Google Drive and it syncs across your devices.">
              <div className="mx-auto mt-6 w-full max-w-[460px] rounded-[14px] border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--card-paper)] p-4 text-left text-sm shadow-[0_6px_28px_rgba(0,0,0,0.07)]">
                {google.enabled ? (
                  <GoogleSyncPanel />
                ) : (
                  <p className="text-[var(--muted)]">Sync isn&apos;t set up on this app yet, so everything stays in this browser. You can export a backup file any time from Settings → Data &amp; privacy.</p>
                )}
              </div>
            </Centered>
          )}
          {page === "money" && (
            <Split picture={<FeatureOrbit />}>
              <Title>Bring your<br />money in</Title>
              <Lead>Pick the currency you count in. Budgets and categories can wait.</Lead>
              <label className="mt-2 flex items-center gap-2.5 text-[13px] text-[var(--muted)]">
                Currency
                <select
                  value={store.settings.currency}
                  onChange={(e) => store.updateSettings({ currency: e.target.value })}
                  className="h-8 rounded-md border border-[color-mix(in_srgb,var(--text)_8%,transparent)] bg-[var(--card-paper)] px-2 text-[var(--text)] outline-none"
                >
                  {[...new Set([store.settings.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="fn-serif text-lg text-[var(--ob-accent)]">“</span>
                {store.hasSamples ? (
                  <span className="fn-serif text-[13.5px] text-[var(--muted)]">Sample data is loaded — remove it any time in Settings</span>
                ) : (
                  <button
                    className="fn-serif text-left text-[13.5px] text-[var(--ob-accent)] hover:underline"
                    onClick={() => { store.loadSamples(); toast("Sample data loaded. Remove it any time in Settings → Data & privacy."); }}
                  >
                    Load a few samples to look around first
                  </button>
                )}
              </p>
            </Split>
          )}
          {celebrating && (
            <div className="flex flex-col items-center">
              <CelebrationRow />
              <p className="mt-9 flex items-baseline gap-2 text-center">
                <span className="fn-serif text-lg text-[var(--ob-accent)]">“</span>
                <span className="fn-serif text-[14.5px] text-[var(--muted)]">Your notebook is ready. Press / anywhere to ask the assistant.</span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex h-16 shrink-0 items-center px-5 pb-[env(safe-area-inset-bottom)] sm:px-7">
        {!celebrating && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center gap-[5px]" aria-label={`Step ${step + 1} of ${PAGES.length}`} role="img">
            {PAGES.map((p, i) => (
              <span
                key={p}
                className="h-[3px] rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 24 : 16,
                  background: i === step ? "var(--ob-accent)" : `color-mix(in srgb, var(--faint) ${i < step ? 55 : 28}%, transparent)`,
                }}
              />
            ))}
          </div>
        )}
        {celebrating ? (
          notify !== "unsupported" && (
            <button
              className="relative flex items-center gap-1.5 text-[13px] font-medium disabled:text-[var(--muted)]"
              disabled={notify !== "default"}
              onClick={() => Notification.requestPermission().then(setNotify)}
              title={notify === "denied" ? "Notifications are blocked for this site in the browser's settings" : undefined}
            >
              <Icon name={notify === "granted" ? "check" : "bell"} size={13} />
              {notify === "granted" ? "Reminders on" : notify === "denied" ? "Reminders blocked in the browser" : "Turn on reminders"}
            </button>
          )
        ) : step > 0 ? (
          <button className="relative flex items-center gap-1 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]" onClick={() => go(-1)}>
            <Icon name="chevronLeft" size={13} /> Back
          </button>
        ) : null}
        <button
          className="fn-press relative ml-auto flex h-8 items-center gap-2 rounded-lg bg-[var(--text)] px-3.5 text-[13px] font-semibold text-[var(--bg)] hover:opacity-90"
          onClick={primary}
        >
          {primaryTitle} <span className="text-[10px] opacity-60" aria-hidden>↵</span>
        </button>
      </div>
    </div>
  );
}

// ---- Layout pieces ------------------------------------------------------------------------

const Title = ({ children, centered }: { children: ReactNode; centered?: boolean }) => (
  <h2 className={`fn-serif text-[2.1rem] leading-[1.08] tracking-[-0.02em] sm:text-[2.45rem] ${centered ? "text-center" : ""}`}>{children}</h2>
);
const Lead = ({ children }: { children: ReactNode }) => (
  <p className="max-w-[360px] text-[15px] leading-relaxed text-[var(--muted)]">{children}</p>
);

/** Words on one side, a picture on the other; stacked on phones. */
function Split({ children, picture, pictureFirst }: { children: ReactNode; picture: ReactNode; pictureFirst?: boolean }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
      <div className={`space-y-3.5 ${pictureFirst ? "md:order-2" : ""}`}>{children}</div>
      <div className={`flex justify-center ${pictureFirst ? "md:order-1" : ""}`}>{picture}</div>
    </div>
  );
}

function Centered({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Title centered>{title}</Title>
      <p className="mt-2.5 max-w-[540px] text-[14.5px] text-[var(--muted)]">{lead}</p>
      <div className="mt-6 w-full">{children}</div>
    </div>
  );
}

/** A white card with a soft shadow, the building block of every picture. */
const Paper = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={`rounded-[14px] border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--card-paper)] shadow-[0_6px_28px_rgba(0,0,0,0.07)] ${className}`} style={style}>{children}</div>
);

/** Comes in once, a beat after the one before it. */
const arrive = (delay: number): React.CSSProperties => ({ animationDelay: `${delay}s` });

const MarkTile = ({ size = 56, className = "" }: { size?: number; className?: string }) => (
  <span
    className={`grid shrink-0 place-items-center border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--card-paper)] shadow-[0_5px_24px_rgba(0,0,0,0.09)] ${className}`}
    style={{ width: size, height: size, borderRadius: size * 0.26 }}
  >
    <Logo size={Math.round(size * 0.62)} />
  </span>
);

const Glyph = ({ icon, tone, size = 30 }: { icon: string; tone: string; size?: number }) => (
  <span className="grid shrink-0 place-items-center rounded-full text-white" style={{ width: size, height: size, background: tone }}>
    <Icon name={icon} size={Math.round(size * 0.5)} />
  </span>
);

const Trust = ({ icon, children }: { icon: string; children: ReactNode }) => (
  <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]"><Icon name={icon} size={12} className="text-[var(--ob-accent)]" />{children}</span>
);

// ---- Pictures -------------------------------------------------------------------------------

/** Four things the app keeps, floating in a loose stack. */
function WelcomeCards() {
  const rows = [
    { icon: "note", tone: "#7d6ff6", title: "Singapore trip", detail: "Flights on the 12th, hotel near Bugis…", trailing: "Note", x: 26 },
    { icon: "todo", tone: "#3ba5f1", title: "Pay the electricity bill", detail: "Tomorrow, 9:00", trailing: "Due", accent: true, x: 6 },
    { icon: "coffee", tone: "#f0a23b", title: "Kopi Kenangan", detail: "Food & Drink", trailing: "Rp 25.000", x: 30 },
    { icon: "sparkle", tone: "#3cc6a3", title: "Receipt filed", detail: "Rp 128.500 at Indomaret · Groceries", trailing: "now", x: 12 },
  ];
  return (
    <div className="relative w-full max-w-[340px]">
      <MarkTile size={54} className="fn-arrive absolute -left-4 -top-4 z-10 -rotate-6" />
      <div className="space-y-3 pt-9">
        {rows.map((r, i) => (
          <Paper key={r.title} className="fn-arrive flex w-[300px] max-w-full items-center gap-2.5 px-3 py-2.5" style={{ ...arrive(0.15 + i * 0.12), marginLeft: r.x }}>
            <Glyph icon={r.icon} tone={r.tone} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{r.title}</span>
              <span className="block truncate text-[11.5px] text-[var(--muted)]">{r.detail}</span>
            </span>
            <span className={`text-[11px] font-medium ${r.accent ? "text-[var(--ob-accent)]" : "text-[var(--faint)]"}`}>{r.trailing}</span>
          </Paper>
        ))}
      </div>
    </div>
  );
}

/** A small Today page: the sidebar, what's due, and the assistant's note. */
function TodayMock() {
  const line = (icon: string, tone: string, title: string, detail: string, tag: string, tagClass = "text-[var(--muted)]") => (
    <div className="flex items-center gap-2">
      <Glyph icon={icon} tone={tone} size={20} />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold">{title}</span>
        <span className="block text-[10px] text-[var(--muted)]">{detail}</span>
      </span>
      <span className={`text-[10px] font-medium ${tagClass}`}>{tag}</span>
    </div>
  );
  return (
    <div className="relative mx-auto h-[270px] w-full max-w-[540px] text-left">
      <Paper className="fn-arrive absolute left-0 top-0 flex h-[250px] w-[min(440px,100%)] overflow-hidden" style={arrive(0.05)}>
        <div className="flex w-[42px] flex-col items-center gap-3.5 bg-[color-mix(in_srgb,var(--panel)_70%,transparent)] pt-3">
          <Logo size={16} />
          {["today", "note", "todo", "finance"].map((i) => <Icon key={i} name={i} size={13} className={i === "today" ? "text-[var(--ob-accent)]" : "text-[var(--faint)]"} />)}
        </div>
        <div className="flex-1 space-y-2 p-3.5">
          <div className="flex items-center justify-between text-[13px] font-semibold">Today <Icon name="search" size={11} className="text-[var(--faint)]" /></div>
          <div className="pt-0.5 text-[10.5px] font-semibold">Due today <span className="font-normal text-[var(--faint)]">2</span></div>
          {line("todo", "#3ba5f1", "Pay the electricity bill", "9:00 · Bills", "Due", "text-[var(--ob-accent)]")}
          {line("todo", "#7d6ff6", "Send the Q3 deck to Maya", "Before 5 PM", "2h", "text-[var(--faint)]")}
          <div className="pt-0.5 text-[10.5px] font-semibold">Spent yesterday</div>
          {line("coffee", "#f0a23b", "Kopi Kenangan", "Food & Drink", "Rp 25.000")}
          {line("cart", "#3cc6a3", "Indomaret", "Groceries", "Rp 128.500")}
        </div>
      </Paper>
      <Paper className="fn-arrive absolute bottom-0 right-0 w-[200px] rotate-[2.5deg] space-y-1.5 p-3" style={arrive(0.3)}>
        <div className="flex items-center gap-2">
          <MarkTile size={26} />
          <span>
            <span className="block text-[12.5px] font-semibold">Assistant</span>
            <span className="block text-[10.5px] text-[var(--muted)]">One message, three things</span>
          </span>
        </div>
        {["A task for Friday", "Rp 45.000 at Warteg", "A note: “gift ideas”"].map((t) => (
          <div key={t} className="flex items-center gap-1.5 text-[11.5px]"><Icon name="check" size={10} className="text-[var(--ok)]" />{t}</div>
        ))}
      </Paper>
    </div>
  );
}

/** "Remind me…" and the task it becomes, typed out as it happens. */
function RemindMock() {
  const message = "Remind me to pay rent on Friday";
  const [typed, setTyped] = useState(0);
  const [filed, setFiled] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(message.length); setFiled(true); return; }
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setTyped(i);
      t = i < message.length ? setTimeout(tick, 34) : setTimeout(() => setFiled(true), 350);
    };
    t = setTimeout(tick, 450);
    return () => clearTimeout(t);
  }, []);
  return (
    <Paper className="fn-arrive h-[220px] w-[360px] max-w-full -rotate-[1.5deg] space-y-3 p-4 text-left" style={arrive(0.05)}>
      <div className="flex items-center gap-2.5">
        <MarkTile size={30} />
        <span>
          <span className="block text-[13px] font-semibold">Four Notes</span>
          <span className="block text-[11px] text-[var(--muted)]">Assistant</span>
        </span>
      </div>
      <div className="h-px bg-[color-mix(in_srgb,var(--text)_6%,transparent)]" />
      <div className="flex justify-end pl-10">
        <span className="rounded-xl bg-[var(--text)] px-3 py-2 text-[13px] text-[var(--bg)]">{message.slice(0, typed)}{typed < message.length ? "▍" : ""}</span>
      </div>
      {filed && (
        <div className="fn-rise flex items-center gap-2.5 rounded-[10px] bg-[var(--panel)] p-2.5">
          <Glyph icon="bell" tone="var(--ob-accent)" size={28} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Pay rent</span>
            <span className="block text-[11.5px] text-[var(--muted)]">Friday, 9:00 · I&apos;ll remind you</span>
          </span>
          <Icon name="check" size={13} className="text-[var(--ok)]" />
        </div>
      )}
    </Paper>
  );
}

/** Each way the brief can read, shown as a small live Today; a link or row lights up in turn. */
function BriefTiles() {
  const [style, setStyle] = useBriefStyle();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setBeat((b) => b + 1), 1100);
    return () => clearInterval(id);
  }, []);
  const tile = (id: BriefStyle) => {
    const o = BRIEF_STYLES.find((b) => b.id === id)!;
    const selected = style === id;
    return (
      <button key={id} className={`fn-arrive w-[280px] max-w-full text-left transition-opacity ${selected ? "" : "opacity-80"}`} style={arrive(id === "paragraph" ? 0.08 : 0.18)} onClick={() => setStyle(id)} role="radio" aria-checked={selected}>
        <Paper className={`h-[164px] p-4 transition-transform duration-300 ${selected ? "scale-[1.03] ring-2 ring-[var(--ob-accent)]" : ""}`}>
          <p className="fn-serif text-[17px]">Good morning.</p>
          {id === "paragraph" ? (
            <p className="mt-2 text-[12.5px] leading-[1.75] text-[var(--muted)]">
              {[["You have ", false], ["3 things due", true], [" today, starting with ", false], ["Call Budi", true], [" at 2:30 PM. Yesterday you spent ", false], ["Rp 120rb", true], [", mostly on food.", false]].reduce<{ out: ReactNode[]; link: number }>(
                (acc, [text, isLink], i) => {
                  if (isLink) {
                    const lit = acc.link === beat % 3;
                    acc.out.push(<span key={i} className={`underline underline-offset-2 transition-colors ${lit ? "text-[var(--ob-accent)] decoration-[var(--ob-accent)]" : "text-[var(--text)] decoration-[var(--faint)]"}`}>{text as string}</span>);
                    acc.link += 1;
                  } else acc.out.push(<span key={i}>{text as string}</span>);
                  return acc;
                },
                { out: [], link: 0 },
              ).out}
            </p>
          ) : (
            <div className="mt-2.5 space-y-[9px]">
              {([["✳︎", 150], ["○", 120], ["○", 170], ["⚠︎", 110]] as const).map(([g, w], i) => {
                const lit = beat % 4 === i;
                return (
                  <div key={i} className="flex items-center gap-[9px] transition-transform duration-300" style={{ transform: lit ? "translateX(3px)" : undefined }}>
                    <span className={`w-3 text-[10px] ${lit ? "text-[var(--ob-accent)]" : "text-[var(--faint)]"}`}>{g}</span>
                    <span className="h-[5px] rounded-full transition-colors" style={{ width: w, background: lit ? "color-mix(in srgb, var(--ob-accent) 55%, transparent)" : "color-mix(in srgb, var(--faint) 35%, transparent)" }} />
                  </div>
                );
              })}
            </div>
          )}
        </Paper>
        <span className={`mt-3 flex items-center gap-1.5 text-[13.5px] ${selected ? "font-semibold" : "font-medium text-[var(--muted)]"}`}>
          <Icon name={o.icon} size={13} /> {o.label}
          {id === "paragraph" && <span className="rounded-full bg-[color-mix(in_srgb,var(--ob-accent)_12%,transparent)] px-[7px] py-px text-[10.5px] font-semibold text-[var(--ob-accent)]">Compact</span>}
          <span className={`ml-auto grid h-4 w-4 place-items-center rounded-full border-[1.5px] ${selected ? "border-[var(--ob-accent)]" : "border-[color-mix(in_srgb,var(--faint)_50%,transparent)]"}`}>
            {selected && <span className="h-2 w-2 rounded-full bg-[var(--ob-accent)]" />}
          </span>
        </span>
        <span className="mt-1 block text-[12.5px] text-[var(--muted)]">{o.detail}</span>
      </button>
    );
  };
  return <div role="radiogroup" aria-label="How the daily brief reads" className="flex flex-wrap justify-center gap-8 sm:gap-10">{tile("paragraph")}{tile("points")}</div>;
}

// Fixed colours on purpose: each tile previews its theme whatever the current one is.
const LOOKS: Record<"light" | "paper" | "dark", { bg: string; panel: string; text: string; muted: string; faint: string; accent: string }> = {
  light: { bg: "#ffffff", panel: "#f7f7f5", text: "#37352f", muted: "#6b6a66", faint: "#8c8983", accent: "#2383e2" },
  paper: { bg: "#fbf6e8", panel: "#f4edd9", text: "#3a3326", muted: "#6b624f", faint: "#857b66", accent: "#b0582a" },
  dark: { bg: "#191919", panel: "#202020", text: "#e6e6e4", muted: "#aaa9a5", faint: "#8a8984", accent: "#529cca" },
};

function MiniWindow({ look }: { look: (typeof LOOKS)["light"] }) {
  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex w-[34px] flex-col gap-[5px] p-2" style={{ background: look.panel }}>
        {[0, 1, 2, 3].map((i) => <span key={i} className="h-[3px] w-4 rounded-full" style={{ background: i ? look.faint : look.accent, opacity: i ? 0.5 : 1 }} />)}
      </div>
      <div className="flex flex-1 flex-col gap-[5px] p-[9px]" style={{ background: look.bg }}>
        <span className="h-1 w-[34px] rounded-full" style={{ background: look.text }} />
        {[0, 1, 2].map((i) => <span key={i} className="h-[3px] rounded-full" style={{ background: look.muted, opacity: 0.5 }} />)}
      </div>
    </div>
  );
}

function ThemeTiles() {
  const { pref, setPref } = useTheme();
  const options: { id: ThemePref; label: string; icon: string }[] = [
    { id: "system", label: "System", icon: "monitor" },
    { id: "light", label: "Light", icon: "today" },
    { id: "paper", label: "Paper", icon: "book" },
    { id: "dark", label: "Dark", icon: "moon" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap justify-center gap-3.5">
      {options.map((o) => {
        const selected = pref === o.id;
        return (
          <button key={o.id} role="radio" aria-checked={selected} onClick={() => setPref(o.id)} className={`transition-transform duration-300 ${selected ? "scale-[1.03]" : ""}`}>
            <span
              className={`flex h-[88px] w-[132px] overflow-hidden rounded-[10px] border transition-shadow ${selected ? "border-2 border-[var(--ob-accent)] shadow-[0_4px_20px_rgba(0,0,0,0.12)]" : "border-[color-mix(in_srgb,var(--text)_6%,transparent)] shadow-[0_4px_12px_rgba(0,0,0,0.05)]"}`}
            >
              {o.id === "system" ? (<><MiniWindow look={LOOKS.light} /><MiniWindow look={LOOKS.dark} /></>) : <MiniWindow look={LOOKS[o.id]} />}
            </span>
            <span className={`mt-2.5 flex items-center justify-center gap-[5px] text-[12.5px] ${selected ? "font-semibold" : "text-[var(--muted)]"}`}>
              <Icon name={o.icon} size={12} /> {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Everything the app does, around its mark. */
function FeatureOrbit() {
  const items = [["note", "Notes"], ["todo", "To-Do"], ["finance", "Finance"], ["scan", "Scan"], ["mic", "Voice"], ["search", "Search"]];
  const r = 124;
  return (
    <div className="relative h-[320px] w-[320px] max-w-full">
      <span className="absolute left-1/2 top-1/2 rounded-full border border-dashed border-[color-mix(in_srgb,var(--faint)_35%,transparent)]" style={{ width: r * 2, height: r * 2, transform: "translate(-50%, -50%)" }} />
      <span className="fn-arrive absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={arrive(0.05)}><MarkTile size={70} /></span>
      {items.map(([icon, label], i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
        return (
          <span
            key={label}
            className="fn-arrive absolute flex flex-col items-center gap-[5px]"
            style={{ ...arrive(0.12 + i * 0.07), left: `calc(50% + ${Math.cos(a) * r}px)`, top: `calc(50% + ${Math.sin(a) * r + 8}px)`, transform: "translate(-50%, -50%)" }}
          >
            <span className="grid h-[42px] w-[42px] place-items-center rounded-[11px] border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--card-paper)] text-[color-mix(in_srgb,var(--text)_75%,transparent)] shadow-[0_3px_14px_rgba(0,0,0,0.06)]">
              <Icon name={icon} size={17} />
            </span>
            <span className="text-[10.5px] text-[var(--muted)]">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The last page: what you just set up, in a row, with the mark raised. */
function CelebrationRow() {
  const left = [["note", "#7d6ff6"], ["todo", "#3ba5f1"], ["today", "#f0a23b"]];
  const right = [["finance", "#3cc6a3"], ["mic", "#f2616e"], ["scan", "#5b6cf0"]];
  const tile = ([icon, tone]: string[]) => (
    <span key={icon} className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-[13px] border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[var(--card-paper)] shadow-[0_2px_10px_rgba(0,0,0,0.06)]" style={{ color: tone }}>
      <Icon name={icon} size={20} />
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-3.5">
      <p className="fn-arrive fn-serif flex h-[50px] items-center rounded-full border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[color-mix(in_srgb,var(--card-paper)_75%,transparent)] px-[22px] text-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] sm:text-2xl" style={arrive(0.35)}>
        I&apos;ve just set up my Four Notes 🎉
      </p>
      <div className="fn-arrive flex h-[76px] max-w-full items-center gap-2 overflow-visible rounded-[22px] border border-[color-mix(in_srgb,var(--text)_6%,transparent)] bg-[color-mix(in_srgb,var(--card-paper)_55%,transparent)] px-3.5 sm:gap-3" style={arrive(0.05)}>
        <span className="hidden gap-2 sm:flex sm:gap-3">{left.map(tile)}</span>
        <span className="fn-raise"><MarkTile size={74} /></span>
        <span className="hidden gap-2 sm:flex sm:gap-3">{right.map(tile)}</span>
      </div>
    </div>
  );
}
