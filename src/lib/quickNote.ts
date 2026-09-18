// Quick notes: short jottings written on Today (they replaced stickies). Each one is a
// normal note tagged "quick", titled from its first line, so it shows up in Notes too.
import type { Note } from "./types";

export const QUICK_TAG = "quick";

export function quickNote(text: string): Partial<Note> {
  const clean = text.trim();
  const first = clean.split("\n")[0].trim();
  return {
    title: first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first,
    content: clean,
    tags: [QUICK_TAG],
  };
}

export const isQuick = (n: Note) => n.tags.includes(QUICK_TAG);
