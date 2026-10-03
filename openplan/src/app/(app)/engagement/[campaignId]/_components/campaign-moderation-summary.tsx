import { ShieldCheck } from "lucide-react";
import type { getEngagementHandoffReadiness } from "@/lib/engagement/readiness";
import type { summarizeEngagementItems } from "@/lib/engagement/summary";

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-US");
}

function fmtPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The campaign's counts and moderation workload. These sat in the two header
 * cards above the tab strip; they now lead the Responses tab, where the queue
 * they count is worked. Every "could not be read" sentence is unchanged: a
 * failed read is still reported as unknown, never as zero.
 */
export function CampaignModerationSummary({
  projectName,
  projectUnreadable,
  itemsUnreadable,
  reportsUnreadable,
  counts,
  handoffReadiness,
  reportCount,
  updatedAt,
}: {
  projectName: string | null;
  projectUnreadable: boolean;
  itemsUnreadable: boolean;
  reportsUnreadable: boolean;
  counts: ReturnType<typeof summarizeEngagementItems>;
  handoffReadiness: ReturnType<typeof getEngagementHandoffReadiness>;
  reportCount: number;
  updatedAt: string;
}) {
  return (
    <div className="mt-6 min-w-0 space-y-6">
      <div className="module-summary-grid cols-3">
        <div className="module-summary-card">
          <p className="module-summary-label">Linked project</p>
          <p className="module-summary-value text-lg">
            {projectUnreadable ? "Unavailable" : projectName ?? "Unlinked"}
          </p>
          <p className="module-summary-detail">
            {projectUnreadable
              ? "This campaign names a project, but that record could not be read — it is not unlinked."
              : "Project context stays visible so engagement does not float free."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Review queue</p>
          <p className="module-summary-value">
            {itemsUnreadable ? "Unavailable" : counts.moderationQueue.actionableCount}
          </p>
          <p className="module-summary-detail">
            {itemsUnreadable
              ? "The comments could not be read, so the queue depth is unknown rather than empty."
              : `${counts.statusCounts.pending} pending, ${counts.statusCounts.flagged} flagged for operator review.`}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Report status</p>
          <p className="module-summary-value">{handoffReadiness.completeCount}/{handoffReadiness.totalChecks}</p>
          <p className="module-summary-detail">
            {handoffReadiness.label}. {counts.statusCounts.approved} approved, {counts.uncategorizedItems} still need category assignment.
          </p>
        </div>
      </div>

      <article className="module-operator-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </span>
          <div>
            <p className="module-operator-eyebrow">Moderation Summary</p>
            <h2 className="module-operator-title">What still needs a moderator&apos;s decision</h2>
          </div>
        </div>
        <p className="module-operator-copy">
          Comments waiting on review, and comments someone flagged. Work through these before
          generating a report — anything still pending is left out of it.
        </p>
        <div className="module-operator-list">
          {itemsUnreadable ? (
            <div className="module-operator-item">
              Moderation workload unavailable — the comments could not be read, so these are not counts of zero.
            </div>
          ) : (
            <>
              <div className="module-operator-item">Pending: {counts.moderationQueue.pendingCount}</div>
              <div className="module-operator-item">Flagged: {counts.moderationQueue.flaggedCount}</div>
              <div className="module-operator-item">Triaged: {counts.moderationQueue.triagedCount} ({fmtPercent(counts.moderationQueue.triagedShare)})</div>
              <div className="module-operator-item">Recent activity: {counts.recentActivity.count} items in the last 7 days</div>
              <div className="module-operator-item">Moderation notes present on {counts.moderationQueue.itemsWithNotesCount} items</div>
            </>
          )}
          <div className="module-operator-item">
            Linked reports: {reportsUnreadable || projectUnreadable ? "unavailable" : reportCount}
          </div>
          <div className="module-operator-item">Last updated {fmtDateTime(updatedAt)}</div>
        </div>
      </article>
    </div>
  );
}
