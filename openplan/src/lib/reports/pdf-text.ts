/**
 * Deterministic HTML → PDF block extraction.
 *
 * WHY THIS EXISTS. `/api/report` and the RTP export each already build a
 * complete, styled HTML document, then THREW IT AWAY in their PDF branch and
 * hand-assembled a much thinner text document from a different set of fields —
 * the corridor PDF carried ~9 labelled values where the HTML carried 13
 * sections, and the RTP PDF dropped the modeling-evidence posture, the funding
 * source-context, the adoption checklist and the appendix outright. Lifting the
 * `.slice()` caps alone would still have shipped the wrong document.
 *
 * Deriving the PDF from the SAME html string is what makes the two outputs
 * structurally incapable of disagreeing: whichever engine renders it, there is
 * one content source. That property is worth more than the fidelity difference
 * between them, and it is why this module exists rather than a second
 * content builder.
 *
 * Not a general HTML parser and not trying to be. It is a linear tokenizer over
 * the tags these two generators actually emit (h1-h3, p, div, ul/li, table/tr/
 * td/th, strong/em/span), which is enough to preserve document order and
 * structure without pulling in a DOM.
 *
 * PURE — no I/O, no clock. Identical input yields identical blocks.
 */

import type { PdfBlock } from "./pdf-writer";

/** Block-level tags that end whatever text was being accumulated. */
const BLOCK_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "section", "article", "header", "footer", "main",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
  "blockquote", "pre", "figcaption", "caption",
]);

/** Dropped entirely, contents included. */
const DISCARDED_TAGS = new Set(["head", "script", "style", "title", "meta", "link", "svg", "noscript"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Decode the entities `esc()` produces, plus the punctuation ones. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function normalize(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

type OpenContext = {
  tag: string;
  /** Where in `blocks` this context's own content should land. */
  kind: PdfBlock["kind"] | null;
  level: 1 | 2 | 3;
};

function contextFor(tag: string): OpenContext {
  if (tag === "h1") return { tag, kind: "title", level: 1 };
  if (tag === "h2") return { tag, kind: "heading", level: 1 };
  if (tag === "h3") return { tag, kind: "heading", level: 2 };
  if (tag === "h4" || tag === "h5" || tag === "h6") return { tag, kind: "heading", level: 3 };
  if (tag === "li") return { tag, kind: "listItem", level: 1 };
  if (tag === "td" || tag === "th") return { tag, kind: null, level: 1 };
  if (tag === "tr") return { tag, kind: null, level: 1 };
  return { tag, kind: "paragraph", level: 1 };
}

/**
 * Extract ordered blocks from a rendered HTML document.
 *
 * Text always attaches to the INNERMOST open block, so a `<div>` wrapping an
 * `<h2>` does not also emit the heading's text as a stray paragraph.
 */
export function htmlToPdfBlocks(html: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];

  let buffer = "";
  let current: OpenContext = { tag: "body", kind: "paragraph", level: 1 };
  const stack: OpenContext[] = [];

  // Table state. A row collects its cells and emits once, so the columns stay
  // side by side instead of becoming N stray paragraphs.
  let rowCells: string[] | null = null;

  const flushText = () => {
    const text = normalize(buffer);
    buffer = "";
    if (!text) return;

    if (rowCells !== null && (current.tag === "td" || current.tag === "th")) {
      rowCells.push(text);
      return;
    }
    if (rowCells !== null) {
      // Text directly inside a <tr> but outside a cell — keep it as a cell so
      // it is not silently dropped.
      rowCells.push(text);
      return;
    }

    const kind = current.kind ?? "paragraph";
    if (kind === "title") blocks.push({ kind: "title", text });
    else if (kind === "heading") blocks.push({ kind: "heading", level: current.level, text });
    else if (kind === "listItem") blocks.push({ kind: "listItem", text });
    else blocks.push({ kind: "paragraph", text });
  };

  // Matches a comment, a declaration (`<!doctype html>` — both generators open
  // with one, and letting it through would put it at the top of every PDF), or
  // an opening/closing tag.
  const tokenizer = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let lastIndex = 0;
  let discardDepth = 0;
  let discardTag: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenizer.exec(html)) !== null) {
    const raw = match[0];
    const tag = (match[1] ?? "").toLowerCase();

    if (discardDepth === 0) buffer += html.slice(lastIndex, match.index);
    lastIndex = tokenizer.lastIndex;

    if (raw.startsWith("<!")) continue;

    const isClosing = raw.startsWith("</");
    const selfClosing = raw.endsWith("/>");

    if (discardDepth > 0) {
      if (tag === discardTag) {
        if (isClosing) discardDepth -= 1;
        else if (!selfClosing) discardDepth += 1;
        if (discardDepth === 0) discardTag = null;
      }
      continue;
    }

    if (!isClosing && DISCARDED_TAGS.has(tag)) {
      flushText();
      if (!selfClosing) {
        discardDepth = 1;
        discardTag = tag;
      }
      continue;
    }

    if (tag === "br") {
      buffer += " ";
      continue;
    }

    if (!BLOCK_TAGS.has(tag)) {
      // Inline formatting (strong/em/span/a) carries no structure of its own.
      continue;
    }

    flushText();

    if (isClosing) {
      if (tag === "tr" && rowCells !== null) {
        if (rowCells.length > 0) blocks.push({ kind: "row", cells: rowCells });
        rowCells = null;
      }
      if (tag === "table") {
        rowCells = null;
        blocks.push({ kind: "spacer" });
      }
      const popped = stack.pop();
      current = popped ?? { tag: "body", kind: "paragraph", level: 1 };
      continue;
    }

    if (selfClosing) continue;

    if (tag === "tr") {
      rowCells = [];
    }

    stack.push(current);
    current = contextFor(tag);
  }

  if (discardDepth === 0) buffer += html.slice(lastIndex);
  flushText();

  if (rowCells !== null && rowCells.length > 0) {
    blocks.push({ kind: "row", cells: rowCells });
  }

  return collapseSpacers(blocks);
}

/** Drop leading/trailing/duplicate spacers so the layout has no dead gaps. */
function collapseSpacers(blocks: PdfBlock[]): PdfBlock[] {
  const out: PdfBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "spacer") {
      if (out.length === 0) continue;
      if (out[out.length - 1].kind === "spacer") continue;
    }
    out.push(block);
  }
  while (out.length > 0 && out[out.length - 1].kind === "spacer") out.pop();
  return out;
}
