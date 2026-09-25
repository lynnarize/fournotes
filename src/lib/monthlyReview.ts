// The monthly review, with its figures from the app rather than the model.
// Ported from the macOS app (Models/MonthlyReview.swift, Views/Finance/BriefText.swift).
// Small models add badly: one reported a month's total as Rp 350,000 when it was
// Rp 3,591,500. The app writes the total and the top categories; the model keeps what
// needs judgement — what looks unusual, and a tip.
import { cleanText } from "./ai/text";
import { formatMoney, parseAmount } from "./money";

const JUDGEMENT = ["unusual", "notable", "watch", "note", "tip", "saving", "suggest", "advice", "insight", "trend", "alert", "idea"];
const stripBullet = (l: string) => l.trim().replace(/^([-•*]|\d+[.)])\s+/, "");

/**
 * The model's lines that are judgement — "Unusual: …", "Tip: …" — or a plain sentence
 * with no figures in it. A labelled line with an amount ("Internet: Rp 350,000") is the
 * model redoing the maths, and is dropped.
 */
export function judgement(written: string): string[] {
  return cleanText(written)
    .split("\n")
    .map(stripBullet)
    .filter((line) => {
      if (!line) return false;
      const colon = line.indexOf(":");
      if (colon < 0) return !/\d/.test(line);
      const label = line.slice(0, colon).toLowerCase().replace(/\*/g, "");
      return JUDGEMENT.some((j) => label.includes(j));
    })
    .slice(0, 3)
    .map((l) => `- ${l}`);
}

export function composeReview(written: string, total: number, byCategory: Record<string, number>, currency: string): string {
  const lines = [`- Total: ${formatMoney(total, currency)}`];
  const top = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push(`- Top categories: ${top.map(([c, v]) => `${c} ${formatMoney(v, currency, true)}`).join(", ")}`);
  return [...lines, ...judgement(written)].join("\n");
}

/** A review written by the app (not an older one straight from a model) starts with the app's own total. */
export const isComposedReview = (text: string, total: number, currency: string) =>
  text.startsWith(`- Total: ${formatMoney(total, currency)}`);

export type ReviewLine = { label?: string; body: string; icon: string };

/** A review laid out rather than shown raw: bullets stripped, "Label: text" split, amounts in the app's format. */
export function reviewLines(text: string, currency: string): ReviewLine[] {
  const amountRe = new RegExp(`(?:(?:Rp|IDR|${currency})\\s?)?(\\d{1,3}(?:[,.]\\d{3})+)(?:\\s?(?:IDR|${currency}))?`, "gi");
  return cleanText(text)
    .split("\n")
    .map(stripBullet)
    .filter(Boolean)
    .map((line) => {
      const money = line.replace(amountRe, (whole, digits: string) => {
        const n = parseAmount(digits);
        return n == null ? whole : formatMoney(n, currency);
      });
      const m = money.match(/^\**([A-Za-z][\w &/'’-]{1,28}?)\**\s*:\s*\**\s*(.+)$/);
      const label = m?.[1].trim();
      return { label, body: m ? m[2] : money, icon: iconFor(label ?? money) };
    });
}

function iconFor(label: string) {
  const l = label.toLowerCase();
  if (l.includes("total") || l.includes("spent")) return "wallet";
  if (l.includes("top") || l.includes("categor")) return "chart";
  if (["unusual", "watch", "notable", "alert"].some((w) => l.includes(w))) return "warning";
  if (["tip", "saving", "suggest", "advice"].some((w) => l.includes(w))) return "sparkle";
  return "check";
}
