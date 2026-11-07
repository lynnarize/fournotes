import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveKeys } from "@/lib/ai/keys";
import { OPENCODE_USER_AGENT } from "@/lib/ai/openrouter";
import { isFreeModel, opencodeLabel, OPENROUTER_AUTO_MODEL, OPENROUTER_FREE_MODELS } from "@/lib/ai/models";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST { service: "openrouter" | "opencode" | "anthropic" | "voyage" | "stt" } with the key in headers
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
      if (!isFreeModel(model)) {
        if (listed?.data && !listed.data.some((m) => m.id === model)) return result(false, `Key works, but OpenRouter has no model called ${model}.`);
        if (info.data?.is_free_tier) return result(false, `Key works, but this account has no credits yet. Add some to use ${model}.`);
        if (typeof remaining === "number" && remaining <= 0) return result(false, `Key works, but its credit limit is used up. ${model} needs credits.`);
        return result(true, `Key works. Using ${model} (paid)${typeof remaining === "number" ? ` · $${remaining.toFixed(2)} left on this key` : ""}.`);
      }
      if (listed?.data && model !== OPENROUTER_AUTO_MODEL && !listed.data.some((m) => m.id === model)) {
        return result(true, `Key works, but ${free?.label ?? model} is no longer offered. The app will use Auto instead.`);
      }
      return result(
        true,
        `Key works. Using ${free?.label ?? model}.${typeof remaining === "number" ? ` ${remaining} credits left.` : " Free models have daily limits."}`,
      );
    }

    if (service === "opencode") {
      if (keys.opencode.source !== "user") return result(false, "Enter an OpenCode key first.");
      const label = opencodeLabel(keys.opencode.model);
      // Go has no key-info endpoint (its model list is public), so send the smallest real request.
      const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keys.opencode.apiKey}`, "Content-Type": "application/json",
          "User-Agent": OPENCODE_USER_AGENT, "x-opencode-session": randomUUID(),
        },
        body: JSON.stringify({ model: keys.opencode.model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(20_000),
      });
      // Read the reason first: a 403 is often a policy refusal for this model, not a bad key.
      const detail = res.ok
        ? undefined
        : await res.json().then((j: { error?: { message?: string; type?: string } | string }) =>
            typeof j.error === "string" ? j.error : [j.error?.type, j.error?.message].filter(Boolean).join(": ")).catch(() => undefined);
      if (!res.ok) console.warn(`[ai/test] opencode-go ${res.status} model=${keys.opencode.model}: ${detail || "(no detail)"}`);
      if (res.status === 401 || (res.status === 403 && (!detail || /api key|invalid key|unauthori[sz]ed|authenticat/i.test(detail)))) {
        return result(false, "OpenCode rejected this key.");
      }
      if (res.status === 403) return result(false, `Key works, but OpenCode refused ${label}: ${detail!.slice(0, 200)}`);
      if (res.status === 402) return result(false, "Key works, but it has no active OpenCode Go subscription. Subscribe at opencode.ai/go.");
      if (res.status === 429) return result(true, `Key works. Go usage limit reached for now; ${label} will work again when it resets.`);
      if (res.status === 404) return result(false, `Key works, but OpenCode Go doesn't offer ${label} any more. Pick another model.`);
      if (res.ok) return result(true, `Key works. Using ${label} on OpenCode Go.`);
      return result(false, `OpenCode returned an error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}.`);
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
