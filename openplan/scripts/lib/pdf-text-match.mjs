/**
 * Find a phrase in text that Poppler's pdftotext extracted from a PDF, the
 * same way on Linux and Windows.
 *
 * Why this exists (KI-2026-11-14-117). The same export, rendered by Chrome on
 * Linux and on Windows, reads back differently: a label set with letter
 * spacing can come out as "C O M M E N T S A P P R OV E D", a URL in a
 * narrow table column comes out one piece per line, and a line that wraps at
 * a hyphen can lose the hyphen. A plain substring search misses the first and
 * a whitespace-squashing search finds phrases that are not there ("art" in
 * "start", or two table cells read side by side as one sentence).
 *
 * The rule. Both texts are normalized (Unicode NFKC, lower case, soft
 * hyphens and zero-width characters removed, typographic quotes made plain).
 * The phrase must then appear with its characters in order and:
 * - start and end on a word edge;
 * - cross nothing harder than one line break: never a blank line (a new
 *   block), a run of two or more spaces (a column gap in -layout output) or a
 *   form feed (a new page);
 * - keep its words apart: a space between two of its words may match a
 *   space, a line break or a hyphen in the text, never nothing;
 * - keep its words whole: inside one of its words the text may break only at
 *   a line end, a hyphen or a letter-spaced gap, never at a plain space.
 * A letter-spaced run is three or more tokens in a row on one line, each one
 * to three characters long (kerning keeps pairs such as "AT" or "ATA"
 * together), more than half of them a single letter. Hyphens are ignored on
 * both sides.
 *
 * Blind category. Inside a letter-spaced run the extracted text keeps no word
 * breaks, so a phrase that stops partway through a spaced word ("comment" in
 * "C O M M E N T S") is found. Two cells that sit next to each other on one
 * line, or one after the other across a single line break, read as one
 * passage. A run of real one-letter words on one line ("I a b") can be taken
 * for letter spacing.
 *
 * Plain ESM with no dependencies, so vitest, Node scripts and CommonJS
 * scripts (Node 22.12 or later, through require) can all load it.
 */

const INVISIBLE = /[­​-‍⁠﻿]/g;

/** Separator kinds, from softest to hardest. */
const NONE = 0; // inside a word
const GLUE = 1; // a gap inside a letter-spaced run
const HYPHEN = 2; // a removed hyphen
const LINE = 3; // one line break
const SPACE = 4; // one plain space on a line
const HARD = 5; // blank line, column gap or page break

/**
 * Normalize extracted PDF text for comparison: NFKC, lower case, invisible
 * characters removed, hyphen and quote variants made plain, CRLF made LF.
 * Spacing is kept, because line and block breaks carry meaning for matching.
 * @param {string} text
 * @returns {string}
 */
export function normalizePdfText(text) {
  return String(text)
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[‐‑]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n?/g, "\n")
    .toLowerCase();
}

/** The kind of one whitespace run between two tokens. */
function separatorKind(gap) {
  if (gap.includes("\f")) return HARD;
  const breaks = (gap.match(/\n/g) ?? []).length;
  if (breaks >= 2) return HARD;
  if (breaks === 1) return LINE;
  return gap.length >= 2 ? HARD : SPACE;
}

/** Tokens and the separator before each, for normalized text. */
function tokenize(normalized) {
  const tokens = [];
  const pattern = /(\s*)(\S+)/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    tokens.push({ text: match[2], before: tokens.length === 0 ? HARD : separatorKind(match[1]) });
  }
  return tokens;
}

function isRunToken(token) {
  return token.length <= 3;
}

function isSingleLetter(token) {
  return /^\p{L}$/u.test(token);
}

/** Mark the plain spaces inside letter-spaced runs as GLUE. Returns the runs found. */
function markLetterSpacing(tokens) {
  const runs = [];
  let start = 0;
  while (start < tokens.length) {
    let end = start;
    if (isRunToken(tokens[start].text)) {
      while (end + 1 < tokens.length && tokens[end + 1].before === SPACE && isRunToken(tokens[end + 1].text)) end += 1;
    }
    const run = tokens.slice(start, end + 1);
    if (run.length >= 3 && run.filter((token) => isSingleLetter(token.text)).length * 2 > run.length) {
      for (let index = start + 1; index <= end; index += 1) tokens[index].before = GLUE;
      runs.push(run.map((token) => token.text).join(" "));
    }
    start = end + 1;
  }
  return runs;
}

/**
 * The comparison stream: the characters of every token with hyphens removed,
 * and for each position between two characters the separator kind there.
 */
function stream(normalized) {
  const tokens = tokenize(normalized);
  markLetterSpacing(tokens);
  let chars = "";
  /** kinds[i] is the separator before chars[i]; kinds[chars.length] closes the stream. */
  const kinds = [];
  for (const token of tokens) {
    let pending = token.before;
    for (const char of token.text) {
      if (char === "-") {
        pending = Math.max(pending, HYPHEN);
        continue;
      }
      kinds.push(pending);
      chars += char;
      pending = NONE;
    }
  }
  kinds.push(HARD);
  if (kinds.length > 0) kinds[0] = HARD;
  return { chars, kinds };
}

function isWordChar(char) {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** True when position `at` in the stream is a word edge. */
function isEdge(chars, kinds, at) {
  if (kinds[at] !== NONE) return true;
  return isWordChar(chars[at - 1]) !== isWordChar(chars[at]);
}

/** The phrase as characters, plus where its word breaks and hyphens fall. */
function phraseShape(phrase) {
  const words = normalizePdfText(phrase).split(/\s+/).filter(Boolean);
  let chars = "";
  const wordBreaks = new Set();
  const hyphens = new Set();
  words.forEach((word, index) => {
    if (index > 0) wordBreaks.add(chars.length);
    for (const char of word) {
      if (char === "-") {
        hyphens.add(chars.length);
        continue;
      }
      chars += char;
    }
  });
  return { chars, wordBreaks, hyphens };
}

/**
 * True when `phrase` is in `text` under the rule at the top of this file.
 * `text` is one page, or any passage, of pdftotext output (with or without
 * -layout). An empty phrase is never found.
 * @param {string} text
 * @param {string} phrase
 * @returns {boolean}
 */
export function pdfTextHasPhrase(text, phrase) {
  const shape = phraseShape(phrase);
  if (shape.chars.length === 0) return false;
  const { chars, kinds } = stream(normalizePdfText(text));
  for (let start = chars.indexOf(shape.chars); start !== -1; start = chars.indexOf(shape.chars, start + 1)) {
    const end = start + shape.chars.length;
    if (!isEdge(chars, kinds, start) || !isEdge(chars, kinds, end)) continue;
    let fits = true;
    for (let offset = 1; offset < shape.chars.length && fits; offset += 1) {
      const kind = kinds[start + offset];
      if (kind === HARD) fits = false;
      // A hyphen in the phrase may meet any softer break, or none.
      else if (shape.hyphens.has(offset)) fits = true;
      // Two of the phrase's words must not run together in the text.
      else if (shape.wordBreaks.has(offset)) fits = kind !== NONE;
      // Inside one of its words, the text may not have a plain space.
      else fits = kind !== SPACE;
    }
    if (fits) return true;
  }
  return false;
}

/**
 * The 1-based numbers of the pages that hold `phrase`, in order. A phrase is
 * looked for on each page separately, so one that only exists by joining the
 * end of a page to the start of the next is not found.
 * @param {readonly string[]} pages pdftotext output, one entry per page
 * @param {string} phrase
 * @returns {number[]}
 */
export function findPdfPhrase(pages, phrase) {
  const found = [];
  pages.forEach((page, index) => {
    if (pdfTextHasPhrase(page, phrase)) found.push(index + 1);
  });
  return found;
}

/**
 * The letter-spaced runs in extracted text, each as its tokens joined by one
 * space ("c o m m e n t s"). An export whose headings read back as words
 * returns none.
 * @param {string} text
 * @returns {string[]}
 */
export function letterSpacedRuns(text) {
  return markLetterSpacing(tokenize(normalizePdfText(text)));
}

/**
 * The text with each letter-spaced run joined into one token, case kept. Use
 * it before a case-sensitive whole-word test such as /\bDRAFT\b/, so a stamp
 * that reads back as "D R A F T" is still seen.
 * @param {string} text
 * @returns {string}
 */
export function joinLetterSpacing(text) {
  const source = String(text).normalize("NFKC").replace(INVISIBLE, "");
  const tokens = [];
  const pattern = /(\s*)(\S+)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tokens.push({ gap: match[1], text: match[2], before: tokens.length === 0 ? HARD : separatorKind(match[1]) });
  }
  markLetterSpacing(tokens);
  return tokens.map((token) => (token.before === GLUE ? "" : token.gap) + token.text).join("");
}
