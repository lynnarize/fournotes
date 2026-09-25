// Today's brief as one short paragraph told like a story, for when a point-by-point
// list is more than you want to read. Written from the same data as the list, so it is
// there at once and needs no model. The phrases worth a closer look are links — a task,
// yesterday's spending, a budget — and clicking one goes to where the details are.
// Ported from the macOS app (Models/BriefParagraph.swift).
import { useEffect, useState } from "react";
import { formatMoney } from "./money";

/** Where a phrase leads. */
export type BriefTarget =
  | { kind: "todos" }
  | { kind: "todo"; id: string }
  | { kind: "finance" }
  | { kind: "notes" }
  | { kind: "note"; id: string };

/** A run of the paragraph: plain text, or a phrase that leads somewhere. */
export type BriefPiece = { text: string; target?: BriefTarget };

export type BriefItem = { id: string; title: string; due?: Date | null };

export type BriefParagraphInput = {
  now: Date;
  /** Due today or overdue, soonest first. */
  due: BriefItem[];
  /** High-priority tasks with no date, used when nothing is due. */
  focus: BriefItem[];
  yesterday: { category: string; amount: number }[];
  currency: string;
  /** Budgets, subscriptions and money owed, as the list shows them. */
  alerts: string[];
  /** Quick notes written today, newest first. */
  notesToday: { id: string; title: string }[];
};

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const name = (title: string, fallback = "an untitled task") => {
  const t = title.trim();
  if (!t) return fallback;
  return t.length > 48 ? `${t.slice(0, 45).trim()}…` : t;
};

const hasTime = (d: Date) => d.getHours() !== 0 || d.getMinutes() !== 0;

function topCategory(spends: { category: string; amount: number }[]) {
  const totals = new Map<string, number>();
  for (const s of spends) totals.set(s.category, (totals.get(s.category) ?? 0) + s.amount);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/** Where the day's story picks up, going by the time of day. */
function stage(now: Date) {
  const h = now.getHours();
  return h < 12 ? "The day ahead" : h < 18 ? "The rest of the afternoon" : "The evening";
}

/** "Food budget 85% used (Rp 850k of Rp 1jt)" → "Food budget 85% used". */
export const shortAlert = (alert: string) => alert.replace(/\s*\([^)]*\)\s*$/, "");

/** "Food budget 85% used" → "your Food budget is 85% used", so it reads in a sentence. */
export const asClause = (alert: string) => alert.replace(/^(.+) budget (\d+% used)$/, "your $1 budget is $2");

/**
 * The day told as a short story, in order: how yesterday ended, what today holds, what
 * to keep an eye on along the way, and what's already been jotted down. Only the parts
 * with something to say are told.
 */
export function composeBrief(input: BriefParagraphInput): BriefPiece[] {
  const out: BriefPiece[] = [];
  const plain = (text: string) => out.push({ text });
  const link = (text: string, target: BriefTarget) => out.push({ text, target });

  // How yesterday ended.
  const total = input.yesterday.reduce((s, x) => s + x.amount, 0);
  if (total > 0) {
    plain("Yesterday closed with ");
    link(formatMoney(total, input.currency, true), { kind: "finance" });
    plain(" spent");
    const top = topCategory(input.yesterday);
    if (top) plain(new Set(input.yesterday.map((x) => x.category)).size > 1 ? `, most of it on ${top}` : ` on ${top}`);
    plain(".");
  }

  // What today holds.
  if (out.length) plain(" ");
  const startOfToday = new Date(input.now);
  startOfToday.setHours(0, 0, 0, 0);
  const isLate = (t: BriefItem) => (t.due ?? input.now) < startOfToday;
  const when = (t: BriefItem) => (isLate(t) ? ", carried over from an earlier day" : t.due && hasTime(t.due) ? ` at ${time(t.due)}` : "");
  const [first] = input.due;
  if (first) {
    plain(`${stage(input.now)} holds `);
    if (input.due.length === 1) {
      plain("just ");
      link("one task", { kind: "todos" });
      plain(": ");
      link(name(first.title), { kind: "todo", id: first.id });
      plain(when(first));
    } else {
      link(`${input.due.length} tasks`, { kind: "todos" });
      plain(", and it opens with ");
      link(name(first.title), { kind: "todo", id: first.id });
      plain(when(first));
      const late = isLate(first) ? undefined : input.due.slice(1).find(isLate);
      if (late) {
        plain(", while ");
        link(name(late.title), { kind: "todo", id: late.id });
        plain(" has been waiting since an earlier day");
      }
    }
    plain(".");
  } else if (input.focus[0]) {
    plain("Nothing is pressing today, which leaves room for ");
    link(name(input.focus[0].title), { kind: "todo", id: input.focus[0].id });
    plain(" to finally move forward.");
  } else {
    plain("Nothing is pressing today, so the page is yours to fill.");
  }

  // Along the way: at most two, without the figures in brackets.
  const alerts = input.alerts.slice(0, 2).map((a) => asClause(shortAlert(a)));
  if (alerts.length) {
    plain(" Along the way, keep in mind that ");
    alerts.forEach((a, i) => {
      if (i) plain(" and ");
      link(a, { kind: "finance" });
    });
    plain(".");
  }

  // What's already been jotted down.
  if (input.notesToday.length === 1) {
    plain(" And ");
    link(name(input.notesToday[0].title, "the quick note"), { kind: "note", id: input.notesToday[0].id });
    plain(", jotted down earlier, is right where you left it.");
  } else if (input.notesToday.length > 1) {
    plain(" And the ");
    link(`${input.notesToday.length} quick notes`, { kind: "notes" });
    plain(" you jotted down today are right where you left them.");
  }

  // Neighbouring plain runs joined, so there are fewer pieces.
  return out.reduce<BriefPiece[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (!p.target && last && !last.target) last.text += p.text;
    else acc.push({ ...p });
    return acc;
  }, []);
}

// ---- How the brief reads (Settings → Today, and first-run setup) ------------------------
export type BriefStyle = "paragraph" | "points";

export const BRIEF_STYLES: { id: BriefStyle; label: string; detail: string; icon: string }[] = [
  { id: "paragraph", label: "One paragraph", detail: "Your day told as a short story. Click an underlined phrase for the details.", icon: "alignLeft" },
  { id: "points", label: "Point by point", detail: "The written brief, then each task and heads-up on its own line.", icon: "listBullet" },
];

const STYLE_KEY = "four-notes:brief-style";
const STYLE_EVT = "four-notes:brief-style-changed";

export function getBriefStyle(): BriefStyle {
  try { return localStorage.getItem(STYLE_KEY) === "points" ? "points" : "paragraph"; } catch { return "paragraph"; }
}

export function setBriefStyle(style: BriefStyle) {
  try { localStorage.setItem(STYLE_KEY, style); } catch { /* storage blocked: this session only */ }
  window.dispatchEvent(new Event(STYLE_EVT));
}

/** Per device, like the theme: it is how this screen reads, not your data. */
export function useBriefStyle(): [BriefStyle, (s: BriefStyle) => void] {
  const [style, setStyle] = useState<BriefStyle>("paragraph");
  useEffect(() => {
    const update = () => setStyle(getBriefStyle());
    update();
    window.addEventListener(STYLE_EVT, update);
    const onStorage = (e: StorageEvent) => e.key === STYLE_KEY && update();
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STYLE_EVT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [style, setBriefStyle];
}
