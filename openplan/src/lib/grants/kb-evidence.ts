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

import { excerptPageLabel, type KnowledgeBaseExcerpt } from "@/lib/knowledge-base/retrieval";

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
      return `An uploaded document ${source}${scope} states: "${passage}" ${KB_NARRATIVE_CAVEAT}`;
    })
    .filter((claim): claim is string => claim !== null);
}
