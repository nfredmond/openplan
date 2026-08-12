/**
 * THE PROVENANCE CHIP — a figure that was copied out of a document says so,
 * beside the figure, wherever the figure appears.
 *
 * Nathaniel's Q2 decision, 2026-08-11: provenance EVERYWHERE, including the
 * body. In-app, on the public plan page, and in the board export body — never
 * folded into an appendix that nobody reads at the meeting where the number is
 * being voted on.
 *
 * A SERVER COMPONENT, deliberately. There is no state, no fetch and no
 * interaction here: it is a sentence composed by `lib/rtp/extraction/display.ts`
 * and printed. Keeping it out of the client bundle also keeps it renderable on
 * the public plan page, which is a server component with no client boundary
 * around its figures.
 *
 * WHAT IT NEVER RENDERS:
 *
 *   - Anything for a hand-typed figure. `extraction_candidate_id IS NULL` means
 *     a person entered it, permanently, and the honest rendering of that is
 *     nothing at all. Callers pass `record={null}` and get `null` back, so the
 *     absence is enforced here rather than at every call site.
 *   - A score of any kind. There is no confidence, certainty or quality number
 *     anywhere in this feature. What a reader gets is the page and the
 *     document's own sentence, which they can check for themselves.
 *   - A link a public reader cannot follow. The source document lives behind
 *     workspace membership, so `documentHref` is passed only by the in-app
 *     surfaces; on the public page the chip names the document and quotes it,
 *     and offers no door that answers 401.
 */
import { FileText } from "lucide-react";
import {
  buildProvenanceChip,
  type ProvenanceChipAudience,
  type TranscriptionRecord,
} from "@/lib/rtp/extraction/display";

export function ExtractionProvenanceChip({
  record,
  audience,
  documentHref,
  className,
}: {
  /** `null` for a figure a person typed — the component renders nothing. */
  record: TranscriptionRecord | null | undefined;
  audience: ProvenanceChipAudience;
  /** Members only. Omitted on public surfaces. */
  documentHref?: string;
  className?: string;
}) {
  if (!record) return null;
  const chip = buildProvenanceChip(record, audience);

  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[0.7rem] leading-tight",
        chip.edited
          ? "border-amber-300/70 bg-amber-50/60 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-border/70 bg-muted/30 text-muted-foreground",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
      {documentHref ? (
        <a href={documentHref} className="underline-offset-2 hover:underline">
          {chip.headline}
        </a>
      ) : (
        <span>{chip.headline}</span>
      )}
      {/*
        The document's own words reach a screen reader even where the layout has
        no room to print them. The quote is the artifact — a chip that named a
        page without carrying the sentence would be a citation nobody can check.
      */}
      <span className="sr-only">The document says: {chip.quote}</span>
    </span>
  );
}

/**
 * The block form: the chip, the sentence that explains it, and the document's
 * own words printed rather than hidden.
 *
 * This is what the public plan page and the review card use. A resident reading
 * a published plan cannot open the source document, so the quote on the page IS
 * the check available to them, and it is printed in full.
 */
export function ExtractionProvenanceCitation({
  record,
  audience,
  documentHref,
  className,
}: {
  record: TranscriptionRecord | null | undefined;
  audience: ProvenanceChipAudience;
  documentHref?: string;
  className?: string;
}) {
  if (!record) return null;
  const chip = buildProvenanceChip(record, audience);

  return (
    <div className={["space-y-1", className ?? ""].filter(Boolean).join(" ")}>
      <p className="flex flex-wrap items-center gap-1 text-xs font-medium text-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {documentHref ? (
          <a href={documentHref} className="underline underline-offset-2">
            {chip.headline}
          </a>
        ) : (
          <span>{chip.headline}</span>
        )}
      </p>
      {chip.detail ? <p className="text-xs text-muted-foreground">{chip.detail}</p> : null}
      <blockquote className="border-l-2 border-border/70 pl-3 text-xs italic text-muted-foreground">
        {chip.quote}
      </blockquote>
    </div>
  );
}
