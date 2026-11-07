// Model lists shared by the server (key resolution) and the browser (Settings).
// No "use client" / "server-only" so both sides can import it.
import verified from "./verified-models.json";

export const ANTHROPIC_USER_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 · most capable" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 · balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 · fastest, cheapest" },
] as const;

/**
 * OpenRouter's Free Models Router. Never offered as a choice: it can land on a
 * model that writes about calling a tool instead of calling it. Used only as the
 * last fallback, restricted to providers that support tools.
 */
export const OPENROUTER_AUTO_MODEL = "openrouter/free";

export interface FreeModel { id: string; label: string; vision: boolean; verified: boolean }

/**
 * Free models that passed `npm run probe:models` (real tool calls, forced
 * capture, and a receipt photo for vision models). Free models are rate limited
 * (roughly 20 requests/minute and 50/day per account) and can be withdrawn,
 * so re-run the probe when one stops working.
 */
export const OPENROUTER_FREE_MODELS: FreeModel[] = verified.models.map((m) => ({
  ...m,
  label: `${m.label} · free${m.vision ? ", reads photos" : ""}`,
}));
export const MODELS_CHECKED_AT: string | null = verified.checkedAt;

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_FREE_MODELS[0]?.id ?? OPENROUTER_AUTO_MODEL;
export const DEFAULT_OPENROUTER_FAST_MODEL = verified.fast;
export const DEFAULT_VISION_MODEL = OPENROUTER_FREE_MODELS.find((m) => m.vision)?.id ?? OPENROUTER_AUTO_MODEL;

/** Models that can never spend credits. */
export const isFreeModel = (id: string) => id === OPENROUTER_AUTO_MODEL || id.endsWith(":free");

const knownVision = (id: string) => (id === OPENROUTER_AUTO_MODEL ? true : OPENROUTER_FREE_MODELS.find((m) => m.id === id)?.vision);

/** Unknown paid models are assumed to handle images; unlisted free ones aren't. */
export const supportsVision = (id: string) => knownVision(id) ?? !isFreeModel(id);

/** Photos need a model that can see; fall back to the tested free vision model. */
export const visionModelFor = (id: string) => (supportsVision(id) ? id : DEFAULT_VISION_MODEL);

/**
 * Models to try, in order, for one request (OpenRouter's `models` fallback).
 * The chosen model first, then the other tested ones, then the router.
 * Kept to three: long lists are rejected on some endpoints.
 */
export function fallbackChain(primary: string, opts: { vision?: boolean } = {}): string[] {
  if (!isFreeModel(primary)) return [primary]; // paid, user-chosen: don't switch models behind their back
  const others = OPENROUTER_FREE_MODELS.filter((m) => !opts.vision || m.vision).map((m) => m.id);
  return [...new Set([primary, ...others])].filter((id) => id !== OPENROUTER_AUTO_MODEL).slice(0, 2).concat(OPENROUTER_AUTO_MODEL);
}

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/settings/credits";

/** A paid OpenRouter model offered in Settings (live list, see /api/ai/openrouter-models). */
export interface PaidModel { id: string; name: string; vision: boolean; context: number; prompt: number; completion: number }

/** An OpenRouter model slug like "anthropic/claude-sonnet-5". Paid models are free text, so check the shape. */
export const isModelId = (id: string | undefined): id is string =>
  Boolean(id && id.length <= 120 && /^~?[a-z0-9][\w.-]*\/[a-z0-9][\w.:-]*$/i.test(id));

/** USD per 1M tokens, for display. */
export const perMillion = (usdPerToken: number) => {
  const v = usdPerToken * 1e6;
  return `$${v < 1 ? v.toFixed(2).replace(/0$/, "") : v % 1 ? v.toFixed(2) : v.toFixed(0)}`;
};

/**
 * OpenCode Go models this app can call (chat-completions format only; the others
 * there use the Messages or Responses APIs). Go is a $10/month subscription with
 * 5-hour, weekly and monthly usage limits. List: https://opencode.ai/docs/go/
 *
 * OpenCode Zen's free models are not offered: OpenCode refuses them outside its own
 * apps ("FreeTierError: OpenCode's free tier can only be used from within OpenCode").
 */
export interface OpenCodeModel { id: string; label: string; vision: boolean }

export const OPENCODE_GO_MODELS: OpenCodeModel[] = [
  { id: "kimi-k3", label: "Kimi K3", vision: false },
  { id: "kimi-k2.6", label: "Kimi K2.6", vision: false },
  { id: "glm-5.3", label: "GLM 5.3", vision: false },
  { id: "glm-5.3-flash", label: "GLM 5.3 Flash", vision: false },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", vision: false },
  { id: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision (experimental)", vision: true },
  { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro", vision: false },
  { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash", vision: false },
  { id: "longcat-2.0", label: "LongCat 2.0", vision: false },
];
export const DEFAULT_OPENCODE_MODEL = "kimi-k3";
/** Photos need a model that can see; this one is part of Go. */
export const OPENCODE_VISION_MODEL = "deepseek-v4-flash-vision-exp";
export const OPENCODE_GO_URL = "https://opencode.ai/go";
export const opencodeLabel = (id?: string) => (OPENCODE_GO_MODELS.find((m) => m.id === id) ?? OPENCODE_GO_MODELS[0]).label;
export const opencodeVisionFor = (id: string) => (OPENCODE_GO_MODELS.find((m) => m.id === id)?.vision ? id : OPENCODE_VISION_MODEL);
