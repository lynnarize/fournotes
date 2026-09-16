"use client";
// Settings → Bring your own API key.
// OpenRouter's free models come first: one free key and the app is fully working.
import { useEffect, useState } from "react";
import {
  clearUserKeys, isValidKey, keyHeaders, maskKey, MODEL_OPTIONS, OPENROUTER_FREE_MODELS, OPENROUTER_KEYS_URL,
  saveUserKeys, useUserKeys, type SttProvider, type UserKeys,
} from "@/lib/byok";
import { inputBox, useToast } from "./ui";

type Service = "openrouter" | "anthropic" | "voyage" | "stt";
type ServerStatus = {
  anthropic: boolean; openrouter: boolean; voyage: boolean; stt: boolean;
  provider: "anthropic" | "openrouter" | "demo";
  model: string; fastModel: string; openrouterModel: string;
  shared?: boolean; sharedPerVisitorDaily?: number; sharedSignedInDaily?: number; sharedDailyLimit?: number; sharedRequiresSignIn?: boolean;
};

const normalized = (k: UserKeys) => JSON.stringify(Object.entries(k).filter(([, v]) => v).sort());
const modelLabel = (id: string) => OPENROUTER_FREE_MODELS.find((m) => m.id === id)?.label ?? id;

export default function ApiKeysSection() {
  const toast = useToast();
  const { keys, persist } = useUserKeys();
  const [draft, setDraft] = useState<UserKeys>({});
  const [keep, setKeep] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [testing, setTesting] = useState<Service | null>(null);
  const [results, setResults] = useState<Partial<Record<Service, { ok: boolean; message: string }>>>({});

  useEffect(() => {
    setDraft(keys);
    setKeep(persist);
    if (keys.voyageKey || keys.sttKey) setAdvanced(true);
  }, [keys, persist]);

  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
  }, []);

  const set = (p: Partial<UserKeys>) => {
    setDraft((d) => ({ ...d, ...p }));
    setResults((r) => {
      const next = { ...r };
      if ("openrouterKey" in p || "openrouterModel" in p) delete next.openrouter;
      if ("anthropicKey" in p || "anthropicModel" in p || "anthropicFastModel" in p) delete next.anthropic;
      if ("voyageKey" in p) delete next.voyage;
      if ("sttKey" in p || "sttProvider" in p) delete next.stt;
      return next;
    });
  };

  const invalid = [draft.openrouterKey, draft.anthropicKey, draft.voyageKey, draft.sttKey].some((k) => !isValidKey(k));
  const dirty = normalized(draft) !== normalized(keys) || keep !== persist;
  const hasSaved = Object.values(keys).some(Boolean);

  const test = async (service: Service) => {
    setTesting(service);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders(draft) },
        body: JSON.stringify({ service }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setResults((r) => ({ ...r, [service]: { ok: Boolean(res.ok && data.ok), message: data.message ?? data.error ?? "Test failed" } }));
    } catch {
      setResults((r) => ({ ...r, [service]: { ok: false, message: "Couldn't run the test. Are you online?" } }));
    } finally {
      setTesting(null);
    }
  };

  const save = () => {
    saveUserKeys(draft, keep);
    const which = draft.anthropicKey ? "Claude" : draft.openrouterKey ? "OpenRouter" : null;
    toast(which ? `🔑 Key saved. AI requests now use your ${which} key.` : "API key settings saved.");
  };

  const remove = () => {
    if (!window.confirm("Remove your API keys from this browser?")) return;
    clearUserKeys();
    setResults({});
    toast(server?.provider === "demo" ? "Keys removed. The app is back in demo mode." : "Keys removed. The app will use the server's key.");
  };

  const using = keys.anthropicKey
    ? { label: "Your Claude key", detail: `${maskKey(keys.anthropicKey)} · ${keys.anthropicModel ?? server?.model ?? "default model"}`, tone: "var(--ok)" }
    : keys.openrouterKey
      ? { label: "Your OpenRouter key", detail: `${maskKey(keys.openrouterKey)} · ${modelLabel(keys.openrouterModel ?? server?.openrouterModel ?? "")}`, tone: "var(--ok)" }
      : server?.anthropic
        ? { label: "Shared key (Claude)", detail: server.model, tone: "var(--accent)" }
        : server?.openrouter
          ? { label: "Shared free key", detail: `${modelLabel(server.openrouterModel)} · limited each day`, tone: "var(--accent)" }
          : { label: "Demo mode", detail: "rule-based replies, no photo reading", tone: "#d9730d" };

  const keyInput = (value: string | undefined, onChange: (v: string) => void, placeholder: string, label: string) => (
    <input
      type={reveal ? "text" : "password"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      className={`${inputBox} min-w-0 flex-1 font-mono text-xs ${value && !isValidKey(value) ? "border-[var(--danger)]" : ""}`}
    />
  );

  const testButton = (service: Service, enabled: boolean) => (
    <button type="button" className="btn-ghost border border-[var(--line)] text-xs" disabled={!enabled || testing !== null} onClick={() => test(service)}>
      {testing === service ? "Testing…" : "Test"}
    </button>
  );

  const resultLine = (service: Service) => {
    const r = results[service];
    return r ? (
      <p className="text-xs" style={{ color: r.ok ? "var(--ok)" : "var(--danger)" }} role="status">
        {r.ok ? "✓" : "✗"} {r.message}
      </p>
    ) : null;
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-[var(--hover)] px-3 py-2">
        <span className="h-2 w-2 rounded-full" style={{ background: using.tone }} />
        <span>AI is using: <b>{using.label}</b></span>
        <span className="text-xs text-[var(--muted)]">{using.detail}</span>
      </div>

      {server?.shared && !keys.anthropicKey && !keys.openrouterKey && (
        <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
          You&apos;re using this app&apos;s shared free key: about {server.sharedPerVisitorDaily ?? 10} AI requests a day, or{" "}
          {server.sharedSignedInDaily ?? 40} when signed in with Google (Settings → Cloud sync). Add your own free key below for your own
          allowance — it takes a minute.
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <span className="rounded bg-[var(--ok)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Free</span>
              OpenRouter key {server?.openrouter && !draft.openrouterKey ? "· server key in use" : ""}
            </span>
            <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="text-[var(--accent)]">Get a free key ↗</a>
          </div>
          <div className="flex gap-2">
            {keyInput(draft.openrouterKey, (v) => set({ openrouterKey: v }), "sk-or-v1-…", "OpenRouter API key")}
            <button type="button" className="btn-ghost text-xs" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>{reveal ? "Hide" : "Show"}</button>
            {testButton("openrouter", Boolean(draft.openrouterKey && isValidKey(draft.openrouterKey)))}
          </div>
          {resultLine("openrouter")}
          <label className="mt-1 flex flex-col gap-1 text-xs text-[var(--muted)]">Free model
            <select
              value={draft.openrouterModel ?? ""}
              disabled={!draft.openrouterKey}
              onChange={(e) => set({ openrouterModel: e.target.value || undefined })}
              className={inputBox}
            >
              <option value="">Default{server ? ` (${modelLabel(server.openrouterModel)})` : ""}</option>
              {OPENROUTER_FREE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            Free models cost nothing but have daily limits and can be busy at times. Only models marked &ldquo;reads photos&rdquo; can scan receipts;
            the app switches to a free vision model for photos automatically.
          </p>
        </div>

        <div className="space-y-1 border-t border-[var(--line)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
            <span>Anthropic (Claude) key · paid, best quality {server?.anthropic && !draft.anthropicKey ? "· server key in use" : ""}</span>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[var(--accent)]">Get a key ↗</a>
          </div>
          <div className="flex gap-2">
            {keyInput(draft.anthropicKey, (v) => set({ anthropicKey: v }), "sk-ant-api03-…", "Anthropic API key")}
            {testButton("anthropic", Boolean(draft.anthropicKey && isValidKey(draft.anthropicKey)))}
          </div>
          {resultLine("anthropic")}
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Main model
              <select value={draft.anthropicModel ?? ""} disabled={!draft.anthropicKey} onChange={(e) => set({ anthropicModel: e.target.value || undefined })} className={inputBox}>
                <option value="">Default{server ? ` (${server.model})` : ""}</option>
                {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Quick jobs model
              <select value={draft.anthropicFastModel ?? ""} disabled={!draft.anthropicKey} onChange={(e) => set({ anthropicFastModel: e.target.value || undefined })} className={inputBox}>
                <option value="">Default{server ? ` (${server.fastModel})` : ""}</option>
                {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-[var(--muted)]">A Claude key is used instead of OpenRouter when both are saved.</p>
        </div>

        <button type="button" className="text-xs text-[var(--accent)]" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          {advanced ? "▾" : "▸"} Optional keys: search by meaning, transcription
        </button>

        {advanced && (
          <div className="space-y-3 border-l-2 border-[var(--line)] pl-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Voyage AI key (search notes by meaning){server?.voyage && !draft.voyageKey ? " · server key in use" : ""}</span>
                <a href="https://dashboard.voyageai.com/api-keys" target="_blank" rel="noreferrer" className="text-[var(--accent)]">Get a key ↗</a>
              </div>
              <div className="flex gap-2">
                {keyInput(draft.voyageKey, (v) => set({ voyageKey: v }), "pa-…", "Voyage API key")}
                {testButton("voyage", Boolean(draft.voyageKey && isValidKey(draft.voyageKey)))}
              </div>
              {resultLine("voyage")}
            </div>

            <div className="space-y-1">
              <div className="text-xs text-[var(--muted)]">
                Speech-to-text key (more accurate recordings){server?.stt && !draft.sttKey ? " · server key in use" : ""}
              </div>
              <div className="flex gap-2">
                <select value={draft.sttProvider ?? "openai"} onChange={(e) => set({ sttProvider: e.target.value as SttProvider })} aria-label="Speech-to-text provider" className={`${inputBox} text-xs`}>
                  <option value="openai">OpenAI Whisper</option>
                  <option value="groq">Groq Whisper</option>
                </select>
                {keyInput(draft.sttKey, (v) => set({ sttKey: v }), draft.sttProvider === "groq" ? "gsk_…" : "sk-…", "Speech-to-text API key")}
                {testButton("stt", Boolean(draft.sttKey && isValidKey(draft.sttKey)))}
              </div>
              {resultLine("stt")}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Remember keys on this device
          <span className="text-xs text-[var(--muted)]">(off: forgotten when this tab closes)</span>
        </label>

        <p className="text-xs leading-relaxed text-[var(--muted)]">
          Keys are stored only in this browser. They are sent to this app&apos;s server with each AI request and used for that request only.
          They are never saved on the server, synced to the cloud, or included in backups. Usage is billed to your provider account.
          Don&apos;t save keys on a shared computer.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md bg-[var(--text)] px-3 py-1 text-sm text-[var(--bg)] disabled:opacity-30" disabled={!dirty || invalid} onClick={save}>
            Save keys
          </button>
          {dirty && <button type="button" className="btn-ghost text-xs" onClick={() => { setDraft(keys); setKeep(persist); setResults({}); }}>Discard changes</button>}
          {invalid && <span className="text-xs text-[var(--danger)]">A key looks incomplete or has spaces.</span>}
          {hasSaved && <button type="button" className="btn-ghost ml-auto text-xs text-[var(--danger)]" onClick={remove}>Remove keys</button>}
        </div>
      </div>
    </section>
  );
}
