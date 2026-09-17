import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { resolveKeys } from "@/lib/ai/keys";
import { OPENROUTER_AUTO_MODEL, OPENROUTER_FREE_MODELS } from "@/lib/ai/models";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { service: "anthropic" | "voyage" | "stt" } with the key in headers
// -> { ok, message }. Tests only keys the user typed; uses no tokens where possible.
export async function POST(req: Request) {
  const limited = rateLimit(req, "key-test");
  if (limited) return limited;
  const keys = resolveKeys(req);
  const { service } = (await req.json().catch(() => ({}))) as { service?: string };
  const model = keys.openrouter.model;
  const result = (ok: boolean, message: string) => NextResponse.json({ ok, message });

  try {
    if (service === "anthropic") {
      if (keys.anthropic.source !== "user") return result(false, "Enter an Anthropic API key first.");
      const client = new Anthropic({ apiKey: keys.anthropic.apiKey, maxRetries: 0, timeout: 15_000 });
      const page = await client.models.list({ limit: 100 });
      const ids = page.data.map((m) => m.id);
      const missing = [...new Set([keys.anthropic.model, keys.anthropic.fastModel])].filter(
        (m) => ids.length > 0 && !ids.some((id) => id === m || id.startsWith(`${m}-`)),
      );
      return missing.length
        ? result(false, `Key works, but it can't use ${missing.join(" or ")}. Choose another model.`)
        : result(true, `Key works · ${ids.length} models available.`);
    }

    if (service === "openrouter") {
      if (keys.openrouter.source !== "user") return result(false, "Enter an OpenRouter key first.");
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${keys.openrouter.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) return result(false, "OpenRouter rejected this key.");
      if (!res.ok) return result(false, `OpenRouter returned an error (${res.status}).`);
      const info = (await res.json().catch(() => ({}))) as { data?: { limit_remaining?: number | null; is_free_tier?: boolean } };
      const free = OPENROUTER_FREE_MODELS.find((m) => m.id === model);
      const remaining = info.data?.limit_remaining;
      // A working key isn't enough: the chosen model has to still exist.
      const listed = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ data?: { id: string }[] }>) : null))
        .catch(() => null);
      if (listed?.data && model !== OPENROUTER_AUTO_MODEL && !listed.data.some((m) => m.id === model)) {
        return result(true, `Key works, but ${free?.label ?? model} is no longer offered. The app will use Auto instead.`);
      }
      return result(
        true,
        `Key works. Using ${free?.label ?? model}.${typeof remaining === "number" ? ` ${remaining} credits left.` : " Free models have daily limits."}`,
      );
    }

    if (service === "voyage") {
      if (keys.voyage.source !== "user") return result(false, "Enter a Voyage API key first.");
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.voyage.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: ["ping"], model: keys.voyage.model, input_type: "query" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) return result(false, "Voyage rejected this key.");
      return res.ok ? result(true, "Key works. Search by meaning is on.") : result(false, `Voyage returned an error (${res.status}).`);
    }

    if (service === "stt") {
      if (keys.stt.source !== "user") return result(false, "Enter a speech-to-text key first.");
      const res = await fetch(`${keys.stt.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${keys.stt.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) return result(false, "The provider rejected this key.");
      return res.ok ? result(true, "Key works. Recordings will be transcribed on the server.") : result(false, `The provider returned an error (${res.status}).`);
    }

    return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return result(false, "Anthropic rejected this key.");
    if (e instanceof Anthropic.PermissionDeniedError) return result(false, "This key doesn't have permission to use the API.");
    if (e instanceof Anthropic.RateLimitError) return result(false, "Rate limited. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionError) return result(false, "Couldn't reach Anthropic.");
    return result(false, e instanceof Error && e.name === "TimeoutError" ? "The provider took too long to respond." : "Test failed. Check the key and try again.");
  }
}
