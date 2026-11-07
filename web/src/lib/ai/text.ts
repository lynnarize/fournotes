// Cleaning up what free models write. Some put their chain of thought in the
// reply, tagged (<think>) or not ("Here's a thinking process: …").
// No "server-only": the Today tab uses it to discard a brief saved before this existed.

/** Removes <think> blocks, including an unterminated one or a stray closing tag. */
export function cleanText(text: string): string {
  return text
    .replace(/^[\s\S]*?<\/think>/i, "")
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .trim();
}

const THINKING = new RegExp(
  [
    String.raw`thinking process`,
    String.raw`analy[sz]e the (request|data|prompt)`,
    String.raw`deconstruct the`,
    String.raw`^\s*[-*\d.)\s]*\**constraints?:`,
    String.raw`\bthe user (wants|asked|is asking)\b`,
    String.raw`\blet me (think|analy[sz]e|draft)\b`,
    String.raw`\bdraft(ing)? (the|a|an) (response|answer|brief)\b`,
    String.raw`\boutput format:`,
  ].join("|"),
  "im",
);
/** True when text reads like a model reasoning about the task rather than doing it. */
export const looksLikeThinking = (text: string) => THINKING.test(text);

/** The instruction appended to plain-text prompts; pairs with `extractAnswer`. */
export const ANSWER_INSTRUCTION =
  "Reply with only the final text inside <answer></answer> tags. Do not explain your reasoning or restate these instructions.";

/** The last <answer> block if there is one, otherwise the cleaned text. */
export function extractAnswer(raw: string): string {
  const blocks = [...raw.matchAll(/<answer>([\s\S]*?)(?:<\/answer>|$)/gi)];
  return cleanText(blocks.length ? blocks[blocks.length - 1][1] : raw);
}

const EMOJI_START = /^\p{Extended_Pictographic}/u;

/**
 * The brief's three emoji lines, or null if the text isn't a usable brief.
 * Takes the last ones, since a model that drafts first writes its final lines last.
 */
export function briefLines(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[\s>*•\-\d.)]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => EMOJI_START.test(l) && l.length <= 240 && !looksLikeThinking(l));
  return lines.length >= 3 ? lines.slice(-3) : null;
}

/** A usable brief as stored text, or false for one written by a model thinking out loud. */
export const isUsableBrief = (text: string) => !looksLikeThinking(text) && briefLines(text) !== null;
