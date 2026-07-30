import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { titleizeEngagementValue } from "@/lib/engagement/catalog";
import type { EngagementCommentMatrixPreview } from "@/lib/engagement/comment-matrix";
import { formatDateTime } from "@/lib/reports/catalog";
import type { summarizeEngagementItems } from "@/lib/engagement/summary";

/**
 * The report-appendix readiness cue and the comment-matrix export preview,
 * lifted OUT of the campaign detail page.
 *
 * WHY IT MOVED. `src/app/(app)/**\/page.tsx` carries a 1200-line eslint ceiling,
 * and the campaign console had ten lines of headroom left. The ceiling exists to
 * be extracted against rather than raised, and this block is the cleanest thing
 * to lift: it is presentation over two already-computed values and reads nothing
 * of its own. Behaviour is unchanged — the markup and the copy are the same
 * markup and the same copy.
 *
 * `formatDateTime` from the reports catalog replaces the page's own private
 * `fmtDateTime`, which was byte-identical to it. One formatter, not two.
 *
 * A SERVER COMPONENT on purpose: nothing here is interactive, so nothing here
 * needs to cross into a bundle.
 */
export function EngagementAppendixReadinessNote({
  appendixReadiness,
  commentMatrixPreview,
}: {
  appendixReadiness: ReturnType<typeof summarizeEngagementItems>["appendixReadiness"];
  commentMatrixPreview: EngagementCommentMatrixPreview;
}) {
  return (
    <div className="module-note border-amber-300/40 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Report appendix readiness</p>
      <h3 className="mt-2 text-sm font-semibold text-foreground">
        {appendixReadiness.appendixReadyCount} approved public comment{appendixReadiness.appendixReadyCount === 1 ? "" : "s"} ready for appendix review
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        This is a staff handoff cue, not a representativeness or legal sufficiency finding. Public comments, internal notes, meeting/email items, and duplicate-looking records stay separated before report use.
      </p>
      <div className="mt-3">
        <MetaList>
          <MetaItem>{appendixReadiness.publicApprovedCategorizedCount} approved public comment{appendixReadiness.publicApprovedCategorizedCount === 1 ? "" : "s"}</MetaItem>
          <MetaItem>{appendixReadiness.nonPublicApprovedCategorizedCount} internal/meeting/email ready item{appendixReadiness.nonPublicApprovedCategorizedCount === 1 ? "" : "s"}</MetaItem>
          <MetaItem>{appendixReadiness.duplicateReviewCount} duplicate-review item{appendixReadiness.duplicateReviewCount === 1 ? "" : "s"}</MetaItem>
          <MetaItem>{appendixReadiness.duplicateExcludedCount} appendix candidate{appendixReadiness.duplicateExcludedCount === 1 ? "" : "s"} held for duplicate review</MetaItem>
        </MetaList>
      </div>
      <div className="mt-5 rounded-[0.5rem] border border-amber-200/70 bg-background/75 p-4 dark:border-amber-900/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Comment matrix export preview</p>
            <h4 className="mt-1 text-sm font-semibold text-foreground">
              {commentMatrixPreview.counts.includedCount} included · {commentMatrixPreview.counts.heldDuplicateReviewCount} held · {commentMatrixPreview.counts.excludedInternalPrivateCount} internal/private excluded
            </h4>
          </div>
          <StatusBadge tone="warning">Staff cue only</StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{commentMatrixPreview.caveat}</p>
        <div className="mt-3 space-y-2">
          {commentMatrixPreview.rows.map((row) => {
            const postureTone =
              row.posture === "included"
                ? "success"
                : row.posture === "held_duplicate_review"
                  ? "warning"
                  : row.posture === "excluded_internal_private"
                    ? "neutral"
                    : "info";

            return (
              <div key={row.itemId} className="module-record-row bg-background/80">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={postureTone}>{row.postureLabel}</StatusBadge>
                      <StatusBadge tone="neutral">{titleizeEngagementValue(row.sourceType)}</StatusBadge>
                      {row.categoryLabel ? <StatusBadge tone="info">{row.categoryLabel}</StatusBadge> : null}
                    </div>
                    <h5 className="module-record-title text-[0.95rem]">{row.title}</h5>
                    <p className="module-record-summary">{row.reason}</p>
                    <p className="module-record-summary">{row.bodyExcerpt}</p>
                  </div>
                </div>
                <MetaList>
                  <MetaItem>{row.submittedBy ? `Submitted by ${row.submittedBy}` : "Submitter not recorded"}</MetaItem>
                  <MetaItem>Updated {formatDateTime(row.updatedAt)}</MetaItem>
                </MetaList>
              </div>
            );
          })}
          {commentMatrixPreview.rows.length === 0 ? (
            <div className="rounded-[0.5rem] border border-dashed border-border/80 bg-background/70 px-5 py-6 text-sm text-muted-foreground">
              No comments are available for matrix preview yet.
            </div>
          ) : null}
        </div>
        {commentMatrixPreview.counts.previewedRowCount < commentMatrixPreview.counts.totalItemCount ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {commentMatrixPreview.counts.previewedRowCount} of {commentMatrixPreview.counts.totalItemCount} comments in handoff order.
          </p>
        ) : null}
      </div>
    </div>
  );
}
