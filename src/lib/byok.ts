"use client";
// Bring your own API key. Keys live only in this browser: never in AppData, so
// they are never synced to Supabase or included in backups. They are sent to
// this app's own /api routes as headers on each AI request and used for that
// request only; the server never stores or logs them.
import { useEffect, useState } from "react";

export type SttProvider = "openai" | "groq";

export interface UserKeys {
  openrouterKey?: string; // free models
  openrouterModel?: string;
  anthropicKey?: string;
  anthropicModel?: string; // chat, scans, recordings
  anthropicFastModel?: string; // daily brief, monthly review
  voyageKey?: string; // search by meaning
  sttKey?: string; // server-side transcription
  sttProvider?: SttProvider;
}

export { ANTHROPIC_USER_MODELS as MODEL_OPTIONS, OPENROUTER_FREE_MODELS, OPENROUTER_KEYS_URL } from "./ai/models";

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
    if (k.openrouterModel) h["x-openrouter-model"] = k.openrouterModel;
  }
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
