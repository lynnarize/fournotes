// Turning an assistant reply into a note — as it was shown, not rewritten.
// Ported from the macOS app (Models/ReplyNote.swift).
//
// "yea save that" used to go to the model like any other message, and the model wrote
// a new note from its own memory of the conversation — a garbled copy, cut off
// mid-word. Saving a reply is not a job for a model: the app saves the exact text,
// with the chat's Markdown turned into the note format.

/** Worth a "Save as note" button: more than a line or two. */
export const isWorthSaving = (reply: string) => reply.trim().length >= 160;

const isClosingOffer = (line: string) =>
  /^\W*(would you like|do you want|want me to|let me know|shall i|should i|anything else|mau saya|apakah (anda|kamu) mau)/i.test(line);

/** Index of the closing offer ("Would you like me to…"), looked for in the second half only. */
const offerIndex = (lines: string[]) => lines.findIndex((l, i) => i >= Math.floor(lines.length / 2) && isClosingOffer(l));

/** Bold, italic and code markers removed; the words stay. */
const inline = (text: string) =>
  text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");

/** Chat Markdown in the note's plain-text form: headings and lists kept, emphasis dropped, tables as "a — b" bullets. */
export function noteTextFromMarkdown(markdown: string): string {
  const out: string[] = [];
  for (const raw of markdown.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;
      out.push(`• ${cells.map(inline).join(" — ")}`);
      continue;
    }
    const indent = raw.match(/^ */)?.[0] ?? "";
    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    const heading = trimmed.match(/^#{4,6}\s+(.*)$/);
    if (bullet) out.push(`${indent}• ${inline(bullet[1])}`);
    else if (heading) out.push(`### ${inline(heading[1])}`);
    else out.push(indent + inline(trimmed));
  }
  // No more than one blank line in a row.
  return out.filter((l, i) => !(l === "" && out[i - 1] === "")).join("\n").trim();
}

/** The reply as note text: Markdown turned into the note's own form, and the closing offer left out. */
export function noteContentFromReply(reply: string): string {
  let lines = reply.split("\n");
  const offer = offerIndex(lines);
  if (offer >= 0) lines = lines.slice(0, offer);
  // A trailing divider or blank lines left behind by the cut.
  while (lines.length && /^(\s*|-{3,}|_{3,}|\*{3,})$/.test(lines[lines.length - 1].trim())) lines.pop();
  return noteTextFromMarkdown(lines.join("\n"));
}

/** The reply ends by offering to save itself ("Want me to create a note…?"), so a "yes" means saving it. */
export function offersToSave(reply: string): boolean {
  const lines = reply.split("\n");
  const offer = offerIndex(lines);
  if (offer < 0) return false;
  return /\b(save|create|make|put|keep|add)\b.{0,40}\b(note|notes|this|it|that|itinerary|list|plan)\b|simpan|catatan/i.test(lines.slice(offer).join(" "));
}

const shortened = (text: string) => {
  const words = text.split(/\s+/).slice(0, 8).join(" ").replace(/^[\s:.,!?]+|[\s:.,!?]+$/g, "");
  return words ? words[0].toUpperCase() + words.slice(1) : "Saved from chat";
};

/** What a reply says it is, from its first line: "Here's a recommended Bandung itinerary you can adapt…" → "Bandung itinerary". */
function leadPhrase(reply: string): string | null {
  const first = reply.split("\n").map((l) => inline(l).trim()).find(Boolean);
  const m = first?.match(/^(?:here's|here is|here are|below is|this is)\s+(?:a |an |your |some |the )?(?:recommended |suggested |quick |simple |relaxed |detailed |sample |possible )?(.+)$/i);
  if (!m) return null;
  let phrase = m[1];
  // Stop at the first break, and before a clause about the reader ("you can adapt…").
  for (const stop of [" — ", " – ", " - ", ":", ". ", "!", ", "]) {
    const at = phrase.indexOf(stop);
    if (at >= 0) phrase = phrase.slice(0, at);
  }
  const clause = phrase.search(/ (you|that|which|to help|for you|i ) ?/i);
  if (clause >= 0) phrase = phrase.slice(0, clause);
  phrase = phrase.replace(/^[\s.:]+|[\s.:]+$/g, "");
  return phrase.split(/\s+/).length >= 2 ? phrase : null;
}

/**
 * A title for a saved reply, best source first: a heading in the reply; what the reply
 * says it is; the question it answered ("any recommendation for a rainy weekend in
 * Bandung?" is "A rainy weekend in Bandung"); its first line.
 */
export function replyNoteTitle(reply: string, question?: string | null): string {
  const heading = reply.split("\n").map((l) => l.match(/^#{1,3}\s+(.+)$/)?.[1]).find(Boolean);
  if (heading) return shortened(inline(heading));
  const lead = leadPhrase(reply);
  if (lead) return shortened(lead);
  if (question) {
    const topic = question
      .replace(
        /^\W*(hi|hey|please|pls|tolong)?\W*(can you |could you )?(give me |show me |i need |i want |what are |make me |plan |recommend |suggest )?(me )?(any |some |a few |good |the best |an? )?(recommendations?|suggestions?|ideas?|tips?|advice|rekomendasi|saran|ide)?\s*(for|on|about|untuk|buat|tentang)?\s*/i,
        "",
      )
      .replace(/^[\s?!.,]+|[\s?!.,]+$/g, "");
    if (topic.split(/\s+/).length >= 2) return shortened(topic);
  }
  const first = reply.split("\n").map((l) => inline(l).replace(/^[\s:#*•-]+|[\s:#*•-]+$/g, "")).find(Boolean) ?? "Saved from chat";
  // "Plan for Saturday: rest." — the part before the colon names it.
  const beforeColon = first.split(":")[0];
  return shortened(beforeColon.split(/\s+/).length >= 2 ? beforeColon : first);
}
