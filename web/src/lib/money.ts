// Money helpers shared by the browser and the server (no "use client").
// The app UI is English, so amounts are always formatted with en-US conventions.

export function formatMoney(amount: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : currency === "IDR" || currency === "JPY" || currency === "KRW" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-US")}`;
  }
}

/** Parse "150k", "1.5M", "Rp 25,000", "IDR 1,250,000.00" into a number (Indonesian "25rb", "1,5jt", "Rp 25.000" also work). */
export function parseAmount(s: string): number | null {
  const m = s.replace(/(rp|idr)\.?\s*/gi, "").match(/(\d[\d.,]*)\s*(rb|ribu|k|jt|juta|m)?(?![\p{L}])/iu);
  if (!m) return null;
  let raw = m[1].replace(/[.,]$/, "");
  const unit = (m[2] || "").toLowerCase();
  if (unit) raw = raw.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, "").replace(",", "."); // 25.000,00
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) raw = raw.replace(/,/g, ""); // 25,000.00
  else raw = raw.replace(",", ".");
  let n = parseFloat(raw);
  if (Number.isNaN(n)) return null;
  if (["rb", "ribu", "k"].includes(unit)) n *= 1_000;
  if (["jt", "juta", "m"].includes(unit)) n *= 1_000_000;
  return Math.round(n * 100) / 100;
}
