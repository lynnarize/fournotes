// A short, stable fingerprint of some text (FNV-1a), for "has what this was written
// from changed?" checks — Today's brief and Finance's monthly review.
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
