import { Fragment, type ReactNode } from "react";

// Agent answers are short and use only a little Markdown: paragraphs, bullet/numbered lists, headings,
// **bold**, *italic*, `code` and links. Rendered as React elements (never raw HTML), so answer text stays inert.
export type Block = { kind: "p" | "h"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function blocks(text: string): Block[] {
  const result: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = result[result.length - 1];
    const bullet = BULLET.exec(line), numbered = NUMBERED.exec(line), heading = HEADING.exec(line);
    if (!line.trim()) result.push({ kind: "p", lines: [] });
    else if (heading) result.push({ kind: "h", lines: [heading[1]] });
    else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol", item = (bullet ?? numbered)![1];
      if (last?.kind === kind) last.items.push(item);
      else result.push({ kind, items: [item] });
    } else if (last?.kind === "p") last.lines.push(line);
    else result.push({ kind: "p", lines: [line] });
  }
  return result.filter(block => "items" in block || block.lines.length > 0);
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\s][^*]*?)\*/g;

export function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) nodes.push(text.slice(at, match.index));
    const [, bold, bold2, code, label, href, italic] = match;
    const key = match.index;
    if (bold ?? bold2) nodes.push(<strong key={key}>{inline(bold ?? bold2)}</strong>);
    else if (code) nodes.push(<code key={key}>{code}</code>);
    else if (href) nodes.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer">{inline(label)}</a>);
    else nodes.push(<em key={key}>{inline(italic)}</em>);
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(text.slice(at));
  return nodes;
}

const lines = (rows: string[]) => rows.map((row, index) => <Fragment key={index}>{index > 0 && <br />}{inline(row)}</Fragment>);

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{blocks(text).map((block, index) =>
    "items" in block ? (block.kind === "ul" ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>
      : <ol key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>)
    : block.kind === "h" ? <p key={index}><strong>{lines(block.lines)}</strong></p>
    : <p key={index}>{lines(block.lines)}</p>)}</div>;
}
