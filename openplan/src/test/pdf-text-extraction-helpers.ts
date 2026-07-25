/**
 * Read the text back out of a generated PDF, for tests.
 *
 * `writeTextPdf` emits uncompressed content streams whose strings are pure
 * ASCII: `\`, `(` and `)` are backslash-escaped and every other byte is a
 * three-digit octal escape under `/WinAnsiEncoding`. Undoing both is what lets
 * a test assert on the prose a reader will actually see — "Chapter 1 — Corridor
 * Element" rather than "Chapter 1 \227 Corridor Element".
 *
 * Shared because two suites need identical extraction, and a per-file copy is
 * how the two PDF writers this replaced came to diverge in the first place.
 */

/**
 * The WinAnsi 0x80–0x9F block, which is where the printable punctuation Latin-1
 * leaves undefined actually lives. Outside this range a WinAnsi byte and its
 * Unicode codepoint agree, so `String.fromCharCode` is already correct.
 */
const WIN_ANSI_HIGH_RANGE: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

/** Decode one PDF string literal body back to the text it represents. */
export function decodePdfLiteral(literal: string): string {
  return literal.replace(/\\(\\|\(|\)|[0-7]{3})/g, (_match, body: string) => {
    if (body === "\\" || body === "(" || body === ")") return body;
    const code = Number.parseInt(body, 8);
    return WIN_ANSI_HIGH_RANGE[code] ?? String.fromCharCode(code);
  });
}

/** Every `(…) Tj` operand in the document, decoded and joined in page order. */
export function pdfDrawnText(bytes: Uint8Array): string {
  const source = new TextDecoder("latin1").decode(bytes);
  return [...source.matchAll(/\(([\s\S]*?)\) Tj/g)]
    .map((match) => decodePdfLiteral(match[1]))
    .join(" ");
}

/** The raw serialized document, for structural assertions (xref, /Count, …). */
export function pdfSource(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}
