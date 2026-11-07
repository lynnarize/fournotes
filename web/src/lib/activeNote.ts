// The note currently open in the editor can answer "do you have text?" before its
// debounced save lands in the store — so switching away never discards fresh typing.
let active: { id: string; hasText: () => boolean } | null = null;

export function setActiveNote(entry: { id: string; hasText: () => boolean } | null, id?: string) {
  if (entry) active = entry;
  else if (!id || active?.id === id) active = null;
}

/** true / false from the open editor, or null when that note isn't open. */
export const activeNoteHasText = (id: string): boolean | null => (active?.id === id ? active.hasText() : null);

/** The id of the note open in the editor, if any. */
export const activeNoteId = (): string | null => active?.id ?? null;
