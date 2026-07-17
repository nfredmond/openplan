/**
 * Deterministic citation validator for AI-generated narrative text.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/llm/grounding.py`.
 *
 * Every sentence in a narrative must carry at least one inline
 * `[fact:<fact_id>]` citation that matches a known fact_id. The check is
 * regex + set membership only — it never calls a language model to judge
 * correctness, because the whole point of the grounding contract is that
 * the check itself cannot hallucinate.
 *
 * Two modes are supported:
 *
 * - `strict` — ungrounded sentences are removed from the narrative. The
 *   caller (QA gate) then blocks export if any sentence was removed, so
 *   shipped reports cannot contain ungrounded prose.
 * - `annotated` — ungrounded sentences are kept but prefixed with `⚠` so a
 *   planner reviewer can see them. Useful during development, never
 *   acceptable for shipped exports.
 *
 * Deliberate divergences from the Python original (JS regex semantics):
 * - Lines are split on `\r\n`, `\r`, or `\n` only; Python `str.splitlines()`
 *   also splits on exotic separators (`\v`, `\f`, `\x1c`–`\x1e`, `\x85`,
 *   ` `, ` `). Narrative text from the model never contains those.
 * - JS `\s` / `trim()` and Python `\s` / `str.strip()` cover marginally
 *   different Unicode whitespace sets (e.g. Python treats `\x1c`–`\x1f` as
 *   strippable); identical for ASCII and ordinary Unicode spaces.
 */

/** Matches an inline `[fact:<fact_id>]` citation token. */
const CITATION_PATTERN = /\[fact:([A-Za-z0-9][A-Za-z0-9_.-]*)\]/g;

/** Sentence boundary: terminal punctuation (or `]`), whitespace, capital/digit/quote/paren. */
const SENTENCE_SPLIT = /(?<=[.!?\]])\s+(?=[A-Z0-9"'`(])/;

const STRUCTURAL_PREFIXES = ["#", "---", "===", "```", "|", ">"] as const;

const LIST_MARKER_PATTERN = /^(?:[-*+]\s+|\d+[.)]\s+)/;

export const GROUNDING_ANNOTATION_PREFIX = "⚠ ";

export type GroundingMode = "strict" | "annotated";

export type GroundedSentence = {
  text: string;
  citedFactIds: string[];
  isGrounded: boolean;
  unknownFactIds: string[];
};

export type GroundingIssue = {
  kind: "missing_citation" | "unknown_fact_id";
  detail: string;
  sentence: string;
};

export type GroundedNarrative = {
  /** The narrative with ungrounded sentences removed (strict) or annotated. */
  text: string;
  /** Sentences kept in `text` (annotated mode keeps ungrounded ones too). */
  sentences: GroundedSentence[];
  /** Sentences removed in strict mode (always empty in annotated mode). */
  droppedSentences: GroundedSentence[];
  citedFactIds: string[];
  unknownFactIds: string[];
  ungroundedSentenceCount: number;
  issues: GroundingIssue[];
  isFullyGrounded: boolean;
  /** `pass` when fully grounded; `block` means the export gate must reject. */
  verdict: "pass" | "block";
};

function isCitationOnly(piece: string): boolean {
  return piece.replace(CITATION_PATTERN, "").trim() === "";
}

/**
 * Split block text into sentence-level claims.
 *
 * Lines that are purely structural (headings, horizontal rules, code
 * fences, table rows, blockquotes, blank lines) are skipped — they are not
 * factual claims and do not need citations. Bullet markers, numbered-list
 * markers, and blockquote markers are stripped so the sentence itself is
 * what gets validated. Trailing citation-only fragments (`. [fact:abc]`)
 * are re-attached to the preceding sentence so the citation stays anchored
 * to the claim it supports.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let inCodeBlock = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }
    if (STRUCTURAL_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    line = line.replace(LIST_MARKER_PATTERN, "");
    if (!line) {
      continue;
    }
    const rawPieces = line
      .split(SENTENCE_SPLIT)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0);
    const merged: string[] = [];
    for (const piece of rawPieces) {
      if (merged.length > 0 && isCitationOnly(piece)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`.trim();
      } else {
        merged.push(piece);
      }
    }
    sentences.push(...merged);
  }
  return sentences;
}

function classifySentence(sentence: string, knownFactIds: ReadonlySet<string>): GroundedSentence {
  const cited: string[] = [];
  const seen = new Set<string>();
  for (const match of sentence.matchAll(CITATION_PATTERN)) {
    const factId = match[1];
    if (!seen.has(factId)) {
      seen.add(factId);
      cited.push(factId);
    }
  }
  const unknown = cited.filter((factId) => !knownFactIds.has(factId));
  return {
    text: sentence,
    citedFactIds: cited,
    isGrounded: cited.length > 0 && unknown.length === 0,
    unknownFactIds: unknown,
  };
}

function dedupePreservingOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Validate `text` against `knownFactIds` and return a `GroundedNarrative`
 * whose `text` has ungrounded sentences removed (`strict`) or visibly
 * annotated (`annotated`).
 */
export function validateGroundedNarrative(
  text: string,
  knownFactIds: Iterable<string>,
  mode: GroundingMode = "strict"
): GroundedNarrative {
  const known: ReadonlySet<string> = new Set(Array.from(knownFactIds, (factId) => String(factId)));
  const classified = splitSentences(text).map((sentence) => classifySentence(sentence, known));

  const issues: GroundingIssue[] = [];
  const keptSentences: GroundedSentence[] = [];
  const droppedSentences: GroundedSentence[] = [];
  const keptTextLines: string[] = [];
  let ungroundedCount = 0;
  const unknownAll: string[] = [];
  const citedAll: string[] = [];

  for (const sentence of classified) {
    citedAll.push(...sentence.citedFactIds);
    if (sentence.isGrounded) {
      keptSentences.push(sentence);
      keptTextLines.push(sentence.text);
      continue;
    }

    ungroundedCount += 1;
    unknownAll.push(...sentence.unknownFactIds);
    if (sentence.citedFactIds.length === 0) {
      issues.push({
        kind: "missing_citation",
        detail: "sentence has no [fact:*] citation",
        sentence: sentence.text,
      });
    } else {
      issues.push({
        kind: "unknown_fact_id",
        detail: `unknown fact_ids: [${sentence.unknownFactIds.map((factId) => `'${factId}'`).join(", ")}]`,
        sentence: sentence.text,
      });
    }

    if (mode === "annotated") {
      keptSentences.push(sentence);
      keptTextLines.push(GROUNDING_ANNOTATION_PREFIX + sentence.text);
    } else {
      droppedSentences.push(sentence);
    }
  }

  const unknownFactIds = dedupePreservingOrder(unknownAll);
  const isFullyGrounded = ungroundedCount === 0 && unknownFactIds.length === 0;

  return {
    text: keptTextLines.join(" ").trim(),
    sentences: keptSentences,
    droppedSentences,
    citedFactIds: dedupePreservingOrder(citedAll),
    unknownFactIds,
    ungroundedSentenceCount: ungroundedCount,
    issues,
    isFullyGrounded,
    verdict: isFullyGrounded ? "pass" : "block",
  };
}
