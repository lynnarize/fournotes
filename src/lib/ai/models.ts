// Model lists shared by the server (key resolution) and the browser (Settings).
// No "use client" / "server-only" so both sides can import it.

export const ANTHROPIC_USER_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 · most capable" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 · balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 · fastest, cheapest" },
] as const;

/**
 * Free models on OpenRouter. ":free" models cost nothing but are rate limited
 * (roughly 20 requests/minute and 50/day per account, more with credits) and can
 * be busy at times. `vision` marks the ones that can read photos.
 */
export const OPENROUTER_FREE_MODELS = [
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash · free, reads photos", vision: true },
  { id: "nvidia/nemotron-nano-9b-v2:free", label: "Nemotron Nano 9B · free, fast", vision: false },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B · free", vision: false },
  { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 · free", vision: false },
] as const;

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-exp:free";
export const DEFAULT_OPENROUTER_FAST_MODEL = "nvidia/nemotron-nano-9b-v2:free";
export const DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-exp:free";

const knownVision = (id: string) => OPENROUTER_FREE_MODELS.find((m) => m.id === id)?.vision;

/** Unknown paid models are assumed to handle images; known text-only free ones aren't. */
export const supportsVision = (id: string) => knownVision(id) ?? !id.endsWith(":free");

/** Photos need a model that can see; fall back to the free vision model. */
export const visionModelFor = (id: string) => (supportsVision(id) ? id : DEFAULT_VISION_MODEL);

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
