// Rule-based parser for e-wallet and bank notifications (GoPay, OVO, DANA,
// ShopeePay, LinkAja, QRIS, BCA/Mandiri/BRI/BNI/Jago). Used offline and in demo
// mode; with an API key the AI handles any wording, including screenshots.
import { parseAmount } from "./money";
import type { ExpenseCategory } from "./types";

export interface ParsedNotification {
  merchant: string;
  amount: number; // positive = spend, negative = income
  category: ExpenseCategory;
  wallet?: string;
}

const WALLETS = ["GoPay", "OVO", "DANA", "ShopeePay", "LinkAja", "QRIS", "BCA", "Mandiri", "BRI", "BNI", "Jago", "SeaBank", "Blu", "Jenius"];

const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/gofood|grabfood|shopeefood|kopi|coffee|starbucks|mcd|kfc|resto|restaurant|warung|warteg|bakso|makan|cafe|lunch|dinner|breakfast|food|meal/i, "Food & Drink"],
  [/indomaret|alfamart|superindo|hypermart|lotte|grocer|grocery|groceries|supermarket|sayur|pasar/i, "Groceries"],
  [/gojek|goride|gocar|grab|bluebird|kai|krl|mrt|transjakarta|pertamina|shell|bensin|parkir|tol|e-toll|gas|fuel|parking|taxi|uber|train|bus|toll/i, "Transport"],
  [/pln|listrik|token|pdam|indihome|biznet|telkomsel|xl|pulsa|paket data|bpjs|internet|electricity|water bill|phone bill|rent|mobile data/i, "Bills & Utilities"],
  [/tokopedia|shopee|lazada|blibli|zalora|uniqlo/i, "Shopping"],
  [/netflix|spotify|youtube|disney|vidio|steam|playstation|cinema|xxi|cgv/i, "Entertainment"],
  [/apotek|kimia farma|halodoc|klinik|hospital|rumah sakit|guardian/i, "Health"],
];

export const guessCategory = (text: string): ExpenseCategory =>
  CATEGORY_HINTS.find(([re]) => re.test(text))?.[1] ?? "Other";

export function parseWalletNotification(text: string): ParsedNotification | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!/(rp|idr)\s?\.?\s?\d/i.test(t)) return null;
  const amount = parseAmount(t.match(/(rp|idr)\.?\s?[\d.,]+/i)?.[0] ?? "");
  if (!amount) return null;

  const income = /(diterima|masuk|received|top ?up berhasil|dana masuk|transfer masuk|kredit|incoming|refund|cashback)/i.test(t);
  const wallet = WALLETS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));

  // "... ke MERCHANT", "to MERCHANT", "di MERCHANT", "at MERCHANT", "dari NAME"
  const who =
    t.match(/\b(?:ke|kepada|to|di|at|merchant:?|dari|from)\s+([A-Z0-9][\w&'.-]*(?:\s+[A-Z0-9][\w&'.-]*){0,3})/)?.[1] ??
    t.match(/\b(?:ke|kepada|to|di|at|dari|from)\s+([\w&'.-]+(?:\s+[\w&'.-]+){0,2})/i)?.[1];
  const merchant = (who ?? wallet ?? "E-wallet payment")
    .replace(/\b(sebesar|senilai|sejumlah|rp|idr|berhasil|successful|was|of|for|on|pada)\b.*$/i, "")
    .trim()
    .slice(0, 40) || "E-wallet payment";

  return {
    merchant,
    amount: income ? -amount : amount,
    category: income ? "Income" : guessCategory(t),
    wallet,
  };
}
