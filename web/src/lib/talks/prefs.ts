// What a new recording starts with: the language spoken and in person or a call, as last
// picked. Shared by the Meetings page's new-recording form and Today's next-meeting card.
import type { RecordMode } from "./recorder";

export const LANGS: [string, string][] = [
  ["en-US", "English"], ["id-ID", "Bahasa Indonesia"], ["ms-MY", "Bahasa Melayu"], ["ja-JP", "日本語"], ["ko-KR", "한국어"],
  ["zh-CN", "中文"], ["es-ES", "Español"], ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["pt-BR", "Português"], ["ar-SA", "العربية"],
];
export const PREFS = "four-notes:transcribe";
export const readPrefs = (): { mode?: RecordMode; lang?: string } => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } };
export const defaultLang = () => {
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  return LANGS.find(([code]) => nav.startsWith(code.slice(0, 2)))?.[0] ?? "en-US";
};
export const preferredLang = () => readPrefs().lang ?? defaultLang();

/** A call's sound can be shared from this browser: Chrome or Edge on a computer. */
export const canRecordCalls = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Android|iPhone|iPad/i.test(navigator.userAgent);
