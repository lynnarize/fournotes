"use client";
// The Markdown models reply in, drawn as React elements (never as HTML, so nothing a
// reply contains can run): **bold**, *italic*, `code`, [links](https://…), headings,
// bullet and numbered lists. Tables and anything else stay as the text they are.
// Replies are model output and a note or a web page can steer it: only http(s) links open.
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_]+?(?<!\s)_(?![\w_]))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (i % 2 === 0) return <Fragment key={k}>{part}</Fragment>;
    if (part.startsWith("**") || part.startsWith("__")) return <strong key={k} className="font-semibold">{inline(part.slice(2, -2), k)}</strong>;
    if (part.startsWith("`")) return <code key={k} className="rounded bg-[var(--hover)] px-1 py-px text-[0.92em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("[")) {
      const m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (m && /^https?:\/\//i.test(m[2])) {
        return <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2">{m[1]}</a>;
      }
      return <Fragment key={k}>{m ? m[1] : part}</Fragment>;
    }
    return <em key={k}>{inline(part.slice(1, -1), k)}</em>;
  });
}

type Block = { kind: "p" | "h" | "ul" | "ol"; lines: string[] };

export default function Markdown({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*+•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) last?.kind === "ul" ? last.lines.push(bullet[1]) : blocks.push({ kind: "ul", lines: [bullet[1]] });
    else if (numbered) last?.kind === "ol" ? last.lines.push(numbered[1]) : blocks.push({ kind: "ol", lines: [numbered[1]] });
    else if (heading) blocks.push({ kind: "h", lines: [heading[1]] });
    else if (!line.trim()) blocks.push({ kind: "p", lines: [] });
    else if (last?.kind === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }
  return (
    <div className="space-y-2">
      {blocks.filter((b) => b.lines.length).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") return <p key={k} className="font-semibold">{inline(b.lines[0], k)}</p>;
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind === "ul" ? "ul" : "ol";
          return (
            <List key={k} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}>
              {b.lines.map((l, j) => <li key={j}>{inline(l, `${k}-${j}`)}</li>)}
            </List>
          );
        }
        return <p key={k} className="whitespace-pre-wrap">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}
