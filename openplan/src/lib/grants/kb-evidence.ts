/**
 * Knowledge Base evidence source for the grant-narrative grounding contract.
 *
 * Turns retrieved uploaded-document excerpts into single-sentence citable claims
 * for `buildNarrativeFactList`, exactly like `bca-evidence.ts` /
 * `engagement-evidence.ts`. Each claim names its source document + page and ends
 * with KB_NARRATIVE_CAVEAT verbatim, so a cited [fact:N] traces to an uploaded
 * document and the operator reviewer sees OpenPlan did not independently verify
 * the document's own claims. No change to the grounding kernel is needed.
 */

import {
  excerptPageLabel,
  type KnowledgeBaseExcerpt,
  type KnowledgeBaseExcerptRead,
} from "@/lib/knowledge-base/retrieval";
import { KB_OCR_PROVENANCE_NOTICE } from "@/lib/knowledge-base/ocr-availability";
import type { KnowledgeBaseGroundingDisclosure } from "@/lib/grants/narrative-grounding";

/** Verbatim caveat every KB-derived narrative fact carries (mirrors BCA/engagement caveats). */
export const KB_NARRATIVE_CAVEAT =
  "This statement is quoted from a document uploaded to this workspace and has not been independently verified by OpenPlan.";

/**
 * Sanitize an excerpt for embedding inside a quoted fact claim: neutralize
 * double quotes (they wrap the passage) and defang any literal [fact:...] token
 * so a document cannot inject into the citation namespace.
 */
function sanitizeExcerpt(snippet: string): string {
  return snippet
    .replace(/"/g, "'")
    .replace(/\[fact:/gi, "[fact ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapse a Knowledge Base read outcome into the disclosure a draft's stored
 * grounding record carries. Shared by the report-section and RTP-chapter
 * drafters so the two cannot describe the same outcome differently: a failed
 * search is recorded as a failure, never flattened into "matched nothing".
 */
export function describeKnowledgeBaseRead(
  read: KnowledgeBaseExcerptRead
): KnowledgeBaseGroundingDisclosure {
  return {
    searched: read.searched,
    excerpt_count: read.excerpts.length,
    error: read.error
      ? { message: read.error.message, schema_pending: read.error.schemaPending }
      : null,
  };
}

export function buildKnowledgeBaseFactClaims(
  excerpts: KnowledgeBaseExcerpt[],
  projectName?: string | null
): string[] {
  const scope = projectName ? ` in the ${projectName} project workspace` : "";
  return excerpts
    .map((excerpt) => {
      const passage = sanitizeExcerpt(excerpt.snippet);
      if (!passage) return null;
      const page = excerptPageLabel(excerpt.pageFrom, excerpt.pageTo);
      const source = `"${excerpt.documentTitle}"${page ? `, ${page}` : ""}`;
      // A passage read by OCR carries the machine-transcription notice INSIDE
      // the fact, so it travels with the [fact:N] a drafter cites — the
      // document list shows the same notice off the same column, and a scanned
      // adopted plan's misread digit must not reach a grant narrative looking
      // like author-embedded text.
      const ocrNotice = excerpt.extractionSource === "ocr" ? ` ${KB_OCR_PROVENANCE_NOTICE}` : "";
      return `An uploaded document ${source}${scope} states: "${passage}" ${KB_NARRATIVE_CAVEAT}${ocrNotice}`;
    })
    .filter((claim): claim is string => claim !== null);
}
