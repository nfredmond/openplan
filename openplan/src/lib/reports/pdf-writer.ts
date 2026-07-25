/**
 * A paginating, dependency-free PDF writer.
 *
 * WHY THIS EXISTS. OpenPlan had two hand-rolled PDF builders — the corridor
 * report (`api/report/route.ts`) and the RTP board packet
 * (`api/rtp-cycles/[id]/export/route.ts`). Both emitted a single
 * `/Type /Pages … /Count 1` object and hard-truncated their content to fit it:
 * `.slice(0, 48)` and `.slice(0, 60)` lines respectively. A multi-chapter RTP
 * packet a planner spent hours assembling came out as one clipped page, with
 * nothing on the page saying anything had been dropped. Both also wrapped at a
 * fixed 92–95 CHARACTERS against a 512pt text column, so even surviving lines
 * could overflow the right margin.
 *
 * THE RULE THIS MODULE ENFORCES: there is no truncation. The type has no
 * `limit`, the code has no `slice`, and `maxPages` exists only as a runaway
 * backstop that APPENDS a page naming what was not rendered — never a silent
 * cut. A deliverable that quietly drops content is the same defect class as a
 * data source that quietly returns nothing.
 *
 * DETERMINISM IS A CONTRACT. No clock, no `/CreationDate`, no `/ID`, no random
 * ids. Identical input produces byte-identical output, which is what makes
 * artifact assertions safe to write. `generatedAt` is a caller-supplied string
 * for exactly this reason.
 *
 * ENCODING. Both fonts declare `/WinAnsiEncoding`, and every byte outside
 * printable ASCII is emitted as a three-digit octal escape. That keeps the
 * serialized document pure ASCII — so UTF-8 byte offsets in the xref table are
 * exact — while em dashes, curly quotes, ellipses and Latin-1 accented names
 * still render as themselves instead of `?`. Non-Latin scripts remain out of
 * reach without an embedded font; `unsupportedCharacters` reports when that
 * happened so a caller can disclose it rather than ship silent mojibake.
 */

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "listItem"; text: string }
  | { kind: "row"; cells: string[] }
  | { kind: "note"; text: string }
  | { kind: "spacer" };

export type PdfTextDocument = {
  title: string;
  /** Caller-supplied. NEVER read the clock here — determinism is the contract. */
  generatedAt: string | null;
  blocks: PdfBlock[];
};

export type PdfPageSize = "letter" | "a4";

export type WriteTextPdfOptions = {
  pageSize?: PdfPageSize;
  /** Appended to every page footer, after the page number. */
  footerLabel?: string;
  /** Runaway backstop only. Exceeding it appends a disclosure page. */
  maxPages?: number;
};

export type PdfWriteResult = {
  bytes: Uint8Array;
  pageCount: number;
  /** Characters that had no WinAnsi representation and were substituted. */
  unsupportedCharacters: string[];
};

const PAGE_SIZES: Record<PdfPageSize, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

const MARGIN_X = 50;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 54;
/** Reserved under the text column for the page footer. */
const FOOTER_BAND = 22;
const DEFAULT_MAX_PAGES = 2000;

type FontKey = "F1" | "F2";

/**
 * Adobe Helvetica / Helvetica-Bold advance widths (units per 1000 em) for
 * codepoints 32..126, in order. These are the standard AFM values; wrapping by
 * measured width rather than character count is what keeps a long line inside
 * the text column instead of running off the page.
 */
const HELVETICA_WIDTHS = (
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 " +
  "556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 " +
  "1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 " +
  "667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 " +
  "333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 " +
  "556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
)
  .split(" ")
  .map(Number);

const HELVETICA_BOLD_WIDTHS = (
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 " +
  "556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 " +
  "975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 " +
  "667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 " +
  "333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 " +
  "611 611 389 556 333 611 556 778 556 556 500 389 280 389 584"
)
  .split(" ")
  .map(Number);

/**
 * Unicode characters that have a WinAnsi byte, with that byte's advance width.
 * Everything here is punctuation a planning document actually contains — em
 * dashes in prose, curly quotes from pasted text, accented characters in place
 * and person names.
 */
const WIN_ANSI_SPECIALS: Record<string, { byte: number; width: number; boldWidth: number }> = {
  "‘": { byte: 0x91, width: 222, boldWidth: 278 }, // '
  "’": { byte: 0x92, width: 222, boldWidth: 278 }, // '
  "“": { byte: 0x93, width: 333, boldWidth: 500 }, // "
  "”": { byte: 0x94, width: 333, boldWidth: 500 }, // "
  "•": { byte: 0x95, width: 350, boldWidth: 350 }, // bullet
  "–": { byte: 0x96, width: 556, boldWidth: 556 }, // en dash
  "—": { byte: 0x97, width: 1000, boldWidth: 1000 }, // em dash
  "…": { byte: 0x85, width: 1000, boldWidth: 1000 }, // ellipsis
  "†": { byte: 0x86, width: 556, boldWidth: 556 },
  " ": { byte: 32, width: 278, boldWidth: 278 }, // nbsp -> space
};

/**
 * Characters with no WinAnsi byte that have an unambiguous ASCII rendering.
 *
 * Preferred over the `?` fallback because these appear in real report copy —
 * "≥30%" reading as "?30%" changes a threshold into nonsense, which is worse
 * than a typographic downgrade.
 */
const ASCII_TRANSLITERATIONS: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~=",
  "→": "->",
  "←": "<-",
  "−": "-",
  "\u2032": "'",
  "\u2033": '"',
};

/** Latin-1 accented range renders directly under WinAnsi. */
function latin1Width(code: number, bold: boolean): number {
  // Uppercase accented forms track their base letter closely enough for
  // wrapping; a few points of drift cannot push a line off the page because
  // the wrap threshold already reserves the full margin.
  if (code >= 0xc0 && code <= 0xdf) return bold ? 722 : 667;
  if (code >= 0xe0 && code <= 0xff) return bold ? 611 : 556;
  return bold ? 556 : 556;
}

function charWidth(char: string, font: FontKey): number {
  const bold = font === "F2";
  const code = char.codePointAt(0) ?? 63;

  if (code >= 32 && code <= 126) {
    const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
    return table[code - 32] ?? 556;
  }

  const special = WIN_ANSI_SPECIALS[char];
  if (special) return bold ? special.boldWidth : special.width;

  if (code >= 0xa0 && code <= 0xff) return latin1Width(code, bold);

  const ascii = ASCII_TRANSLITERATIONS[char];
  if (ascii) {
    let total = 0;
    for (const replacement of ascii) total += charWidth(replacement, font);
    return total;
  }

  // Substituted with "?" — measure it as such.
  return bold ? 611 : 556;
}

/** Width of `text` in points at `size`. */
export function measureText(text: string, font: FontKey, size: number): number {
  let total = 0;
  for (const char of text) total += charWidth(char, font);
  return (total / 1000) * size;
}

/**
 * Serialize a string as the body of a PDF string literal.
 *
 * Output is pure ASCII: `\`, `(` and `)` are backslash-escaped and every other
 * non-printable byte becomes a three-digit octal escape. That is what lets the
 * xref byte offsets be computed with a UTF-8 encoder and still be correct.
 */
export function toPdfLiteral(text: string, unsupported?: Set<string>): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;

    if (char === "\\") { out += "\\\\"; continue; }
    if (char === "(") { out += "\\("; continue; }
    if (char === ")") { out += "\\)"; continue; }

    if (code >= 32 && code <= 126) { out += char; continue; }

    const special = WIN_ANSI_SPECIALS[char];
    if (special) {
      out += special.byte === 32 ? " " : `\\${special.byte.toString(8).padStart(3, "0")}`;
      continue;
    }

    if (code >= 0xa0 && code <= 0xff) {
      out += `\\${code.toString(8).padStart(3, "0")}`;
      continue;
    }

    const ascii = ASCII_TRANSLITERATIONS[char];
    if (ascii) {
      out += ascii;
      continue;
    }

    unsupported?.add(char);
    out += "?";
  }
  return out;
}

type Style = {
  font: FontKey;
  size: number;
  leading: number;
  spaceBefore: number;
  spaceAfter: number;
  indent: number;
  gray: number | null;
};

const STYLES: Record<Exclude<PdfBlock["kind"], "spacer" | "row">, Style> = {
  title: { font: "F2", size: 18, leading: 22, spaceBefore: 0, spaceAfter: 10, indent: 0, gray: null },
  heading: { font: "F2", size: 13, leading: 16, spaceBefore: 12, spaceAfter: 5, indent: 0, gray: null },
  paragraph: { font: "F1", size: 10, leading: 13.5, spaceBefore: 0, spaceAfter: 7, indent: 0, gray: null },
  listItem: { font: "F1", size: 10, leading: 13.5, spaceBefore: 0, spaceAfter: 3, indent: 14, gray: null },
  note: { font: "F1", size: 9, leading: 12, spaceBefore: 4, spaceAfter: 7, indent: 0, gray: 0.32 },
};

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 15, 2: 13, 3: 11 };

type LaidOutLine = {
  text: string;
  x: number;
  y: number;
  font: FontKey;
  size: number;
  gray: number | null;
};

/** Greedy word wrap by measured width; over-long words are hard-broken. */
function wrapByWidth(text: string, font: FontKey, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (const word of normalized.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (measureText(word, font, size) <= maxWidth) {
      current = word;
      continue;
    }

    // A single unbreakable token wider than the column (a long URL, an id).
    // Break it by character rather than let it run off the page.
    let chunk = "";
    for (const char of word) {
      if (measureText(chunk + char, font, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }

  pushCurrent();
  return lines;
}

function styleFor(block: PdfBlock): Style {
  if (block.kind === "heading") {
    return { ...STYLES.heading, size: HEADING_SIZES[block.level], leading: HEADING_SIZES[block.level] + 3 };
  }
  if (block.kind === "spacer" || block.kind === "row") {
    return STYLES.paragraph;
  }
  return STYLES[block.kind];
}

/**
 * Lay every block out into pages FIRST, then serialize.
 *
 * Doing it in this order is what makes `/Count N` correct by construction and
 * "Page i of N" possible at all — the previous writers emitted bytes as they
 * went, which is why they could only ever claim one page.
 */
function layout(
  doc: PdfTextDocument,
  width: number,
  height: number,
  maxPages: number,
  unsupported: Set<string>
): { pages: LaidOutLine[][]; droppedBlocks: number } {
  const contentWidth = width - MARGIN_X * 2;
  const topY = height - MARGIN_TOP;
  const floorY = MARGIN_BOTTOM + FOOTER_BAND;

  const pages: LaidOutLine[][] = [[]];
  let y = topY;

  const currentPage = () => pages[pages.length - 1];

  const newPage = () => {
    pages.push([]);
    // Pages after the first carry a running title, so text starts lower.
    y = topY - 14;
    currentPage().push({
      text: doc.title,
      x: MARGIN_X,
      y: topY,
      font: "F1",
      size: 8,
      gray: 0.45,
    });
  };

  const emit = (text: string, x: number, font: FontKey, size: number, gray: number | null) => {
    currentPage().push({ text, x, y, font, size, gray });
  };

  let droppedBlocks = 0;

  for (let index = 0; index < doc.blocks.length; index += 1) {
    if (pages.length > maxPages) {
      droppedBlocks = doc.blocks.length - index;
      break;
    }

    const block = doc.blocks[index];

    if (block.kind === "spacer") {
      y -= 8;
      continue;
    }

    const style = styleFor(block);
    y -= style.spaceBefore;

    if (block.kind === "row") {
      const cells = block.cells.length > 0 ? block.cells : [""];
      const columnWidth = contentWidth / cells.length;
      const wrapped = cells.map((cell, cellIndex) =>
        wrapByWidth(cell, cellIndex === 0 ? "F2" : "F1", style.size, columnWidth - 8)
      );
      const rowLines = Math.max(1, ...wrapped.map((lines) => lines.length));

      if (y - rowLines * style.leading < floorY) newPage();

      for (let line = 0; line < rowLines; line += 1) {
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
          const text = wrapped[cellIndex][line];
          if (!text) continue;
          emit(text, MARGIN_X + cellIndex * columnWidth, cellIndex === 0 ? "F2" : "F1", style.size, null);
        }
        y -= style.leading;
      }
      y -= style.spaceAfter;
      continue;
    }

    const prefix = block.kind === "listItem" ? "• " : "";
    const bodyIndent = style.indent;
    const lines = wrapByWidth(block.text, style.font, style.size, contentWidth - bodyIndent);

    if (lines.length === 0) continue;

    // A heading must not be orphaned at the foot of a page.
    const needed =
      block.kind === "heading" || block.kind === "title"
        ? lines.length * style.leading + STYLES.paragraph.leading
        : style.leading;
    if (y - needed < floorY) newPage();

    for (let line = 0; line < lines.length; line += 1) {
      if (y - style.leading < floorY) newPage();

      if (line === 0 && prefix) {
        emit(prefix, MARGIN_X, style.font, style.size, style.gray);
      }
      emit(lines[line], MARGIN_X + bodyIndent, style.font, style.size, style.gray);
      y -= style.leading;
    }

    y -= style.spaceAfter;
  }

  // Pre-measure every string so `unsupportedCharacters` is complete before the
  // caller decides what to disclose.
  for (const page of pages) {
    for (const line of page) toPdfLiteral(line.text, unsupported);
  }

  return { pages, droppedBlocks };
}

function contentStreamFor(
  lines: LaidOutLine[],
  footer: string,
  width: number,
  unsupported: Set<string>
): string {
  const commands: string[] = ["BT"];
  let activeFont: string | null = null;
  let activeGray: number | null = null;

  const setGray = (gray: number | null) => {
    const value = gray ?? 0;
    if (activeGray !== value) {
      commands.push(`${value} g`);
      activeGray = value;
    }
  };

  for (const line of lines) {
    const fontToken = `/${line.font} ${line.size} Tf`;
    if (activeFont !== fontToken) {
      commands.push(fontToken);
      activeFont = fontToken;
    }
    setGray(line.gray);
    commands.push(`1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm`);
    commands.push(`(${toPdfLiteral(line.text, unsupported)}) Tj`);
  }

  // Footer, right-aligned against the same margin the text column uses.
  setGray(0.45);
  const footerFont = `/F1 8 Tf`;
  if (activeFont !== footerFont) commands.push(footerFont);
  const footerWidth = measureText(footer, "F1", 8);
  commands.push(`1 0 0 1 ${(width - MARGIN_X - footerWidth).toFixed(2)} ${MARGIN_BOTTOM.toFixed(2)} Tm`);
  commands.push(`(${toPdfLiteral(footer, unsupported)}) Tj`);
  commands.push("ET");

  return commands.join("\n");
}

/**
 * Serialize a document to PDF bytes.
 *
 * Object numbering: 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold, then for
 * page i (0-based) the page object is `5 + 2i` and its content stream `6 + 2i`.
 */
export function writeTextPdf(doc: PdfTextDocument, options: WriteTextPdfOptions = {}): PdfWriteResult {
  const encoder = new TextEncoder();
  const { width, height } = PAGE_SIZES[options.pageSize ?? "letter"];
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const unsupported = new Set<string>();

  const blocks: PdfBlock[] = [
    { kind: "title", text: doc.title },
    ...(doc.generatedAt ? ([{ kind: "note", text: `Generated ${doc.generatedAt}` }] as PdfBlock[]) : []),
    ...doc.blocks,
  ];

  const { pages, droppedBlocks } = layout({ ...doc, blocks }, width, height, maxPages, unsupported);

  if (droppedBlocks > 0) {
    // The ONLY case where content does not reach the document, and it is
    // announced on its own page rather than cut silently.
    pages.push([
      {
        text: `This document reached the ${maxPages}-page safety limit.`,
        x: MARGIN_X,
        y: height - MARGIN_TOP,
        font: "F2",
        size: 13,
        gray: null,
      },
      {
        text: `${droppedBlocks} further section${droppedBlocks === 1 ? "" : "s"} were not rendered. Nothing above this page has been shortened. Export the underlying record to obtain the remainder.`,
        x: MARGIN_X,
        y: height - MARGIN_TOP - 22,
        font: "F1",
        size: 10,
        gray: null,
      },
    ]);
  }

  const pageCount = pages.length;
  const footerLabel = options.footerLabel ? ` · ${options.footerLabel}` : "";

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectNumbers.push(5 + index * 2);
  }

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  for (let index = 0; index < pageCount; index += 1) {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    const stream = contentStreamFor(
      pages[index],
      `Page ${index + 1} of ${pageCount}${footerLabel}`,
      width,
      unsupported
    );
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`
    );
    objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  }

  const parts: string[] = [];
  let length = 0;
  const offsets = [0];

  const push = (part: string) => {
    parts.push(part);
    length += encoder.encode(part).length;
  };

  push("%PDF-1.4\n%OpenPlan\n");

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(length);
    push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }

  const xrefStart = length;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF\n`);

  return {
    bytes: encoder.encode(parts.join("")),
    pageCount,
    unsupportedCharacters: [...unsupported].sort(),
  };
}
