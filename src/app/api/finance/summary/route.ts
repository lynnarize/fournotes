import { NextResponse } from "next/server";
import { aiError } from "@/lib/ai/http";
import { activeSource, resolveKeys } from "@/lib/ai/keys";
import { getProvider } from "@/lib/ai/provider";
import { guardSharedKey } from "@/lib/ai/shared";
import { rateLimit } from "@/lib/ratelimit";
import type { Transaction } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = rateLimit(req, "summary");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const blocked = guardSharedKey(req, keys);
  if (blocked) return blocked;
  try {
    const { month, transactions, currency } = (await req.json()) as {
      month: string;
      currency: string;
      transactions: Pick<Transaction, "merchant" | "amount" | "category" | "date">[];
    };
    const provider = await getProvider(keys);
    const text = await provider.monthlySummary(month, transactions, currency);
    return NextResponse.json({ text });
  } catch (e) {
    return aiError(e, "finance/summary", activeSource(keys));
  }
}
