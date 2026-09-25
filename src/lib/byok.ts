"use client";
// Bring your own API key. Keys live only in this browser: never in AppData, so
// they are never synced to Supabase or included in backups. They are sent to
// this app's own /api routes as headers on each AI request and used for that
// request only; the server never stores or logs them.
import { useEffect, useState } from "react";

export type SttProvider = "openai" | "groq";
export type AiProvider = "openrouter" | "opencode" | "anthropic";

export interface UserKeys {
  openrouterKey?: string; // free models, or paid ones billed to the user's credits
  openrouterModel?: string; // chosen free model
  openrouterTier?: "free" | "paid"; // unset = free
  openrouterPaidModel?: string; // any OpenRouter slug; kept while on free so switching back restores it
  openrouterPaidTextOnly?: boolean; // the paid model can't read photos
  opencodeKey?: string; // OpenCode: Zen's free models, or OpenCode Go (subscription)
  opencodeModel?: string; // chosen free model
  opencodeTier?: "free" | "paid"; // unset = free; paid = OpenCode Go
  opencodeGoModel?: string; // kept while on free so switching back restores it
  anthropicKey?: string;
  anthropicModel?: string; // chat, scans, recordings
  anthropicFastModel?: string; // daily brief, monthly review
  voyageKey?: string; // search by meaning
  sttKey?: string; // server-side transcription
  sttProvider?: SttProvider;
  aiProvider?: AiProvider; // which saved key AI requests use; unset = Claude, then OpenCode, then OpenRouter
}

export {
  ANTHROPIC_USER_MODELS as MODEL_OPTIONS, OPENCODE_FREE_MODELS, OPENCODE_GO_MODELS, OPENCODE_GO_URL, OPENCODE_KEYS_URL, opencodeLabel,
  OPENROUTER_CREDITS_URL, OPENROUTER_FREE_MODELS, OPENROUTER_KEYS_URL,
} from "./ai/models";

const PROVIDER_KEY = { openrouter: "openrouterKey", opencode: "opencodeKey", anthropic: "anthropicKey" } as const;

/** The provider AI requests will use with these keys (mirrors resolveKeys on the server). */
export function activeProvider(k: UserKeys): AiProvider | null {
  if (k.aiProvider && k[PROVIDER_KEY[k.aiProvider]]) return k.aiProvider;
  return k.anthropicKey ? "anthropic" : k.opencodeKey ? "opencode" : k.openrouterKey ? "openrouter" : null;
}

const STORE = "four-notes:byok";
const EVT = "four-notes:byok-changed";

const clean = (k: UserKeys): UserKeys =>
  Object.fromEntries(Object.entries(k).map(([key, v]) => [key, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v)) as UserKeys;

function read(): { keys: UserKeys; persist: boolean } {
  try {
    const session = sessionStorage.getItem(STORE);
    if (session) return { keys: JSON.parse(session), persist: false };
    const local = localStorage.getItem(STORE);
    if (local) return { keys: JSON.parse(local), persist: true };
  } catch { /* storage blocked */ }
  return { keys: {}, persist: true };
}

export const getUserKeys = (): UserKeys => (typeof window === "undefined" ? {} : read().keys);

/** persist=true keeps keys on this device; false forgets them when the tab closes. */
export function saveUserKeys(keys: UserKeys, persist: boolean) {
  const value = clean(keys);
  try {
    localStorage.removeItem(STORE);
    sessionStorage.removeItem(STORE);
    if (Object.keys(value).length) (persist ? localStorage : sessionStorage).setItem(STORE, JSON.stringify(value));
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVT));
}

export const clearUserKeys = () => saveUserKeys({}, true);

/** Printable ASCII only (header-safe), no spaces. */
export const isValidKey = (v?: string) => !v || /^[\x21-\x7e]{16,400}$/.test(v.trim());

export function keyHeaders(keys: UserKeys = getUserKeys()): Record<string, string> {
  const k = clean(keys);
  const h: Record<string, string> = {};
  if (k.anthropicKey && isValidKey(k.anthropicKey)) {
    h["x-anthropic-key"] = k.anthropicKey;
    if (k.anthropicModel) h["x-anthropic-model"] = k.anthropicModel;
    if (k.anthropicFastModel) h["x-anthropic-fast-model"] = k.anthropicFastModel;
  }
  if (k.openrouterKey && isValidKey(k.openrouterKey)) {
    h["x-openrouter-key"] = k.openrouterKey;
    if (k.openrouterTier === "paid" && k.openrouterPaidModel) {
      h["x-openrouter-model"] = k.openrouterPaidModel;
      h["x-openrouter-vision"] = k.openrouterPaidTextOnly ? "0" : "1";
    } else if (k.openrouterModel) h["x-openrouter-model"] = k.openrouterModel;
  }
  if (k.opencodeKey && isValidKey(k.opencodeKey)) {
    h["x-opencode-key"] = k.opencodeKey;
    if (k.opencodeTier === "paid") {
      h["x-opencode-tier"] = "go";
      if (k.opencodeGoModel) h["x-opencode-model"] = k.opencodeGoModel;
    } else if (k.opencodeModel) h["x-opencode-model"] = k.opencodeModel;
  }
  if (k.aiProvider) h["x-ai-provider"] = k.aiProvider;
  if (k.voyageKey && isValidKey(k.voyageKey)) h["x-voyage-key"] = k.voyageKey;
  if (k.sttKey && isValidKey(k.sttKey)) {
    h["x-stt-key"] = k.sttKey;
    h["x-stt-provider"] = k.sttProvider ?? "openai";
  }
  return h;
}

export function useUserKeys() {
  const [state, setState] = useState<{ keys: UserKeys; persist: boolean }>({ keys: {}, persist: true });
  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener(EVT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return state;
}

export const maskKey = (k?: string) => (!k ? "" : k.length > 16 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "••••••••");
