import { EngagementAppendixReadinessNote } from "@/components/engagement/engagement-appendix-readiness-note";
import { EngagementReportCreateButton } from "@/components/engagement/engagement-report-create-button";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { titleizeEngagementValue } from "@/lib/engagement/catalog";
import type { EngagementCommentMatrixPreview } from "@/lib/engagement/comment-matrix";
import type {
  getEngagementHandoffReadiness,
  getEngagementPublicReviewCopyGuard,
} from "@/lib/engagement/readiness";
import type { summarizeEngagementItems } from "@/lib/engagement/summary";
import { formatDateTime, getReportPacketActionLabel } from "@/lib/reports/catalog";

/**
 * "Is this campaign ready to hand to planning" — the readiness verdict, the
 * coverage tiles, the copy guard and the packet button, lifted OUT of the
 * campaign detail page.
 *
 * WHY IT MOVED. `src/app/(app)/**\/page.tsx` carries a 1200-line eslint ceiling
 * and the console had run out of headroom, the same reason
 * `EngagementAppendixReadinessNote` moved before it. The ceiling exists to be
 * extracted against rather than raised. Behaviour is unchanged: same markup,
 * same copy, over values the page had already computed.
 *
 * WHAT IS NOT COSMETIC HERE. `readsIncomplete` is the honesty seam. Every check
 * in this verdict is computed over reads the page performed, and a read that
 * FAILED produces exactly the same "open check" as work that was never done —
 * so when any of them failed the verdict says it is incomplete rather than
 * letting a moderator act on a finding nothing established. Likewise
 * `itemsUnreadable` is threaded in rather than inferred from an empty
 * `counts`: "No intake items yet" out of a broken query tells an agency its
 * community did not respond.
 *
 * A SERVER COMPONENT on purpose; only the packet button inside it is a client
 * component, and it already was.
 */
export function CampaignHandoffReadinessSection({
  handoffReadiness,
  publicReviewCopyGuard,
  counts,
  appendixReadiness,
  commentMatrixPreview,
  campaign,
  project,
  projectUnreadable,
  readsIncomplete,
  itemsUnreadable,
  primarySource,
  reportCount,
  linkedReportCount,
  packetAttentionCount,
  recommendedReport,
}: {
  handoffReadiness: ReturnType<typeof getEngagementHandoffReadiness>;
  publicReviewCopyGuard: ReturnType<typeof getEngagementPublicReviewCopyGuard>;
  counts: ReturnType<typeof summarizeEngagementItems>;
  appendixReadiness: ReturnType<typeof summarizeEngagementItems>["appendixReadiness"];
  commentMatrixPreview: EngagementCommentMatrixPreview;
  campaign: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    engagement_type: string;
    project_id: string | null;
    allow_public_submissions: boolean;
    submissions_closed_at: string | null;
    created_at: string;
    updated_at: string;
  };
  project: { name?: string | null; status?: string | null; summary?: string | null } | null;
  projectUnreadable: boolean;
  readsIncomplete: boolean;
  itemsUnreadable: boolean;
  primarySource: ReturnType<typeof summarizeEngagementItems>["sourceSummaries"][number] | null;
  reportCount: number;
  linkedReportCount: number;
  packetAttentionCount: number;
  recommendedReport: { id: string; title: string; packetFreshness: { label: string; detail: string } } | null;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Handoff Readiness</p>
          <h2 className="module-section-title">Review posture and planning handoff</h2>
          <p className="module-section-description">
            Campaigns stay explicitly tied to planning context, moderation load, map coverage, and downstream report awareness.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="module-record-row">
          <div className="module-record-head">
            <div className="module-record-main">
              <div className="module-record-kicker">
                <StatusBadge tone={handoffReadiness.tone}>{handoffReadiness.label}</StatusBadge>
                <StatusBadge tone="neutral">{handoffReadiness.completeCount}/{handoffReadiness.totalChecks} checks complete</StatusBadge>
              </div>
              <h3 className="module-record-title text-[1rem]">Campaign handoff decision</h3>
              <p className="module-record-summary">{handoffReadiness.nextAction}</p>
              {readsIncomplete ? (
                <p className="module-record-summary">
                  These checks were computed over reads that did not all succeed, so this verdict is
                  incomplete rather than a finding. Do not treat an open check here as evidence the
                  work is missing.
                </p>
              ) : null}
            </div>
          </div>
          <MetaList>
            {handoffReadiness.checks.map((check) => (
              <MetaItem key={check.id}>
                {check.passed ? "Pass" : "Open"} · {check.label}
              </MetaItem>
            ))}
          </MetaList>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {handoffReadiness.checks.map((check) => (
            <div key={check.id} className="module-summary-card">
              <p className="module-summary-label">{check.label}</p>
              <p className="module-summary-value text-lg">{check.passed ? "Ready" : "Open"}</p>
              <p className="module-summary-detail">{check.detail}</p>
            </div>
          ))}
        </div>

        <div className="module-record-row">
          <div className="module-record-head">
            <div className="module-record-main">
              <div className="module-record-kicker">
                <StatusBadge tone={projectUnreadable ? "warning" : project ? "success" : "neutral"}>
                  {projectUnreadable ? "Project unreadable" : project ? "Linked project" : "Unlinked project"}
                </StatusBadge>
                {project?.status ? <StatusBadge tone="neutral">{titleizeEngagementValue(project.status)}</StatusBadge> : null}
              </div>
              <h3 className="module-record-title text-[1rem]">
                {projectUnreadable
                  ? "The linked project could not be read"
                  : project?.name ?? "No project linked yet"}
              </h3>
              <p className="module-record-summary">
                {projectUnreadable
                  ? "This campaign records a project id, so it is linked. The project record itself could not be read, which is why it cannot be named here — this is not an unlinked campaign."
                  : project
                    ? project.summary || "Project context is present even when campaign reporting stays lightweight."
                    : "Link a project when this intake should stay traceable to a planning effort rather than stand alone."}
              </p>
            </div>
          </div>
          <MetaList>
            <MetaItem>Campaign status {titleizeEngagementValue(campaign.status)}</MetaItem>
            {itemsUnreadable ? null : (
              <>
                <MetaItem>Recent activity {counts.recentActivity.count} items</MetaItem>
                <MetaItem>{counts.geographyCoverage.geolocatedItems} geolocated</MetaItem>
              </>
            )}
            <MetaItem>{reportCount} linked reports</MetaItem>
          </MetaList>
        </div>

        {/*
          EVERY FIGURE BELOW IS COUNTED FROM THE CAMPAIGN'S COMMENTS, so when
          that read failed they are withheld as a block rather than gated one at
          a time. Gating them one at a time is how the first pass left "0
          uncategorized" rendering with a SUCCESS tone on a campaign whose
          comments could not be read — a green verdict that the backlog is clean,
          produced by a query that never returned. It also made the page's own
          disclosure sentence false: it promises that anything depending on a
          failed read "is shown as unavailable rather than as zero".
        */}
        {itemsUnreadable ? (
          <StateBlock
            tone="danger"
            title="The coverage and workload figures could not be computed"
            description="Moderation load, categorized coverage, map coverage, export readiness and the comment appendix are all counted from this campaign's comments, and that read failed. They are withheld rather than shown as zero — a zero here would say this campaign received no input, which nothing has established."
          />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="module-summary-card">
                <p className="module-summary-label">Actionable review</p>
                <p className="module-summary-value">{counts.moderationQueue.actionableCount}</p>
                <p className="module-summary-detail">
                  {counts.moderationQueue.pendingCount} pending and {counts.moderationQueue.flaggedCount} flagged.
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Categorized coverage</p>
                <p className="module-summary-value">{counts.categorizedItems}</p>
                <p className="module-summary-detail">
                  {counts.uncategorizedItems} items still need classification before reporting is reliable.
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Map coverage</p>
                <p className="module-summary-value">{Math.round(counts.geographyCoverage.geolocatedShare * 100)}%</p>
                <p className="module-summary-detail">
                  {counts.geographyCoverage.geolocatedItems} geolocated, {counts.geographyCoverage.nonGeolocatedItems} non-geolocated.
                </p>
              </div>
            </div>

            <div className="module-note border-sky-300/40 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Map export readiness</p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {counts.exportCoverage.mapReadyItems} approved item{counts.exportCoverage.mapReadyItems === 1 ? "" : "s"} ready for GIS/map export
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {counts.exportCoverage.handoffReadyWithoutLocation > 0
                  ? `${counts.exportCoverage.handoffReadyWithoutLocation} approved categorized item${counts.exportCoverage.handoffReadyWithoutLocation === 1 ? "" : "s"} still need a map location before they can appear in public map exports.`
                  : counts.moderationQueue.readyForHandoffCount > 0
                    ? "Every handoff-ready item has a location for map display and downstream GIS review."
                    : "Approve and categorize geolocated items to build a reliable public map/export layer."}
              </p>
            </div>

            <EngagementAppendixReadinessNote
              appendixReadiness={appendixReadiness}
              commentMatrixPreview={commentMatrixPreview}
            />
          </>
        )}

        <div className="module-note border-slate-300/50 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/30">
          <div className="module-record-kicker">
            <StatusBadge tone={publicReviewCopyGuard.tone}>{publicReviewCopyGuard.label}</StatusBadge>
            <StatusBadge tone={campaign.submissions_closed_at ? "neutral" : campaign.allow_public_submissions ? "warning" : "neutral"}>
              {campaign.submissions_closed_at ? "Intake closed" : campaign.allow_public_submissions ? "Intake may be open" : "Staff-controlled intake"}
            </StatusBadge>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Public-review copy guard</p>
          <h3 className="mt-2 text-sm font-semibold text-foreground">Keep handoff language supervised and source-bound</h3>
          <p className="mt-2 text-sm text-muted-foreground">{publicReviewCopyGuard.summary}</p>
          <p className="mt-2 text-sm text-muted-foreground">{publicReviewCopyGuard.nextCopyAction}</p>
          <div className="mt-3">
            <MetaList>
              {publicReviewCopyGuard.guardrails.map((guardrail) => (
                <MetaItem key={guardrail}>{guardrail}</MetaItem>
              ))}
            </MetaList>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {/*
            The "0 uncategorized" badge here is the sharpest case in the whole
            section: its tone is SUCCESS when the count is zero, so an unread
            comment table rendered a green verdict that the moderation backlog is
            clean. A tone is a finding, not a number, and a failed read cannot
            reach one.
          */}
          {itemsUnreadable ? null : (
            <article className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={counts.moderationQueue.readyForHandoffCount > 0 ? "success" : "neutral"}>
                      {counts.moderationQueue.readyForHandoffCount} handoff-ready
                    </StatusBadge>
                    <StatusBadge tone={counts.moderationQueue.uncategorizedCount > 0 ? "warning" : "success"}>
                      {counts.moderationQueue.uncategorizedCount} uncategorized
                    </StatusBadge>
                  </div>
                  <h3 className="module-record-title text-[1rem]">Lightweight planning handoff cue</h3>
                  <p className="module-record-summary">
                    Approved items with category assignment are the cleanest candidates for report inclusion or planning review.
                  </p>
                </div>
              </div>
              <MetaList>
                <MetaItem>{counts.statusCounts.approved} approved total</MetaItem>
                <MetaItem>{counts.moderationQueue.readyForHandoffCount} approved + categorized</MetaItem>
                <MetaItem>{counts.moderationQueue.itemsWithNotesCount} with audit notes</MetaItem>
              </MetaList>
            </article>
          )}

          <article className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone="info">
                    {itemsUnreadable
                      ? "Source mix unavailable"
                      : primarySource
                        ? `${titleizeEngagementValue(primarySource.sourceType)} lead source`
                        : "No source mix yet"}
                  </StatusBadge>
                  {itemsUnreadable ? null : (
                    <StatusBadge tone="neutral">{counts.recentActivity.count} recent items</StatusBadge>
                  )}
                </div>
                <h3 className="module-record-title text-[1rem]">Recent intake signal</h3>
                <p className="module-record-summary">
                  {itemsUnreadable
                    ? "The comments could not be read, so the intake signal is unknown — not zero."
                    : primarySource
                      ? `${titleizeEngagementValue(primarySource.sourceType)} is currently the largest source of input, with ${primarySource.count} items.`
                      : "No intake items yet."}
                </p>
              </div>
            </div>
            {itemsUnreadable ? null : (
              <MetaList>
                <MetaItem>{counts.recentActivity.byStatus.pending} pending in window</MetaItem>
                <MetaItem>{counts.recentActivity.byStatus.flagged} flagged in window</MetaItem>
                <MetaItem>Last activity {formatDateTime(counts.lastActivityAt)}</MetaItem>
              </MetaList>
            )}
          </article>
        </div>

        <article className="module-record-row">
          <div className="module-record-head">
            <div className="module-record-main">
              <div className="module-record-kicker">
                <StatusBadge tone={campaign.project_id ? "success" : "warning"}>
                  {campaign.project_id ? "Project-linked" : "Project link required"}
                </StatusBadge>
                {itemsUnreadable ? null : (
                  <StatusBadge tone={counts.moderationQueue.readyForHandoffCount > 0 ? "success" : "neutral"}>
                    {counts.moderationQueue.readyForHandoffCount} handoff-ready
                  </StatusBadge>
                )}
              </div>
              <h3 className="module-record-title text-[1rem]">Create an engagement handoff packet</h3>
              <p className="module-record-summary">
                Seed a project-linked report with this campaign as an explicit source section so planning review does not rely on manual copy-paste.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MetaList>
              {itemsUnreadable ? null : (
                <>
                  <MetaItem>{counts.totalItems} total items</MetaItem>
                  <MetaItem>{counts.moderationQueue.actionableCount} actionable review items</MetaItem>
                </>
              )}
              <MetaItem>{reportCount} existing project reports</MetaItem>
              <MetaItem>{packetAttentionCount} packet issue{packetAttentionCount === 1 ? "" : "s"}</MetaItem>
            </MetaList>
            {/*
              THE ONE PLACE A FAILED READ WOULD OUTLIVE THE RENDER. This button
              does not merely display `counts` — it writes them, through
              `buildEngagementHandoffProvenance`, into the packet's stored
              provenance. Seeded from an unread comment table, the report would
              carry "0 total items, 0 ready for handoff" as a captured fact about
              this campaign at this timestamp, and that record travels to whoever
              the packet is handed to. Withholding the seed is not withholding
              the planner's data: the comments are unavailable to this render,
              the packet can be created the moment the read succeeds, and every
              other route to reporting is untouched.
            */}
            {itemsUnreadable ? (
              <p className="max-w-md text-sm text-muted-foreground">
                Packet creation is unavailable until the comments can be read. This button records the
                campaign&apos;s counts into the packet&apos;s provenance, and seeding it now would write
                zeros that nothing established.
              </p>
            ) : (
              <EngagementReportCreateButton
                campaign={campaign}
                counts={counts}
                existingReportGuidance={
                  recommendedReport
                    ? {
                        reportCount: linkedReportCount,
                        packetAttentionCount,
                        recommendedReportId: recommendedReport.id,
                        recommendedReportTitle: recommendedReport.title,
                        recommendedAction: getReportPacketActionLabel(recommendedReport.packetFreshness.label),
                        recommendedDetail: recommendedReport.packetFreshness.detail,
                      }
                    : null
                }
              />
            )}
          </div>
        </article>
      </div>
    </article>
  );
}
