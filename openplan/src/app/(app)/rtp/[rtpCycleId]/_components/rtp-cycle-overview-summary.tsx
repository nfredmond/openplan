import { ShieldCheck } from "lucide-react";
import { formatRtpDate } from "@/lib/rtp/catalog";

type SectionReadState = "ok" | "pending_schema" | "failed";

/**
 * The cycle's counts and its workflow card. These sat in the two header cards
 * above the tab strip; they now lead the Overview tab. Every "could not be
 * read" sentence is unchanged: a failed read shows a dash and says so, never a
 * count of zero.
 */
export function RtpCycleOverviewSummary({
  chaptersState,
  chapterCount,
  chapterReadyForReviewCount,
  chapterCompleteCount,
  projectLinksState,
  projectLinkCount,
  fundingReadFailed,
  fundedProjectCount,
  likelyCoveredProjectCount,
  unfundedProjectCount,
  scenarioComparisonState,
  scenarioComparisonIndicatorCount,
  scenarioComparisonReadyCount,
  workflow,
  cycle,
}: {
  chaptersState: SectionReadState;
  chapterCount: number;
  chapterReadyForReviewCount: number;
  chapterCompleteCount: number;
  projectLinksState: SectionReadState;
  projectLinkCount: number;
  fundingReadFailed: boolean;
  fundedProjectCount: number;
  likelyCoveredProjectCount: number;
  unfundedProjectCount: number;
  scenarioComparisonState: SectionReadState;
  scenarioComparisonIndicatorCount: number;
  scenarioComparisonReadyCount: number;
  workflow: { detail: string; actionItems: string[] };
  cycle: {
    geography_label: string | null;
    horizon_start_year: number | null;
    horizon_end_year: number | null;
    adoption_target_date: string | null;
    public_review_open_at: string | null;
    public_review_close_at: string | null;
  };
}) {
  return (
    <>
      <div className="module-summary-grid cols-5">
        {/*
          A count is an assertion. Where the read behind one failed, the card
          shows an em dash and says so — "0" here would be the page telling a
          planner their cycle has no chapters, no projects, no funding.
        */}
        <div className="module-summary-card">
          <p className="module-summary-label">Chapters</p>
          <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapterCount}</p>
          <p className="module-summary-detail">
            {chaptersState === "failed"
              ? "The chapter sections could not be read, so this is not a count of zero."
              : "Initial RTP shell sections seeded for this cycle."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Ready for review</p>
          <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapterReadyForReviewCount}</p>
          <p className="module-summary-detail">
            {chaptersState === "failed"
              ? "Unavailable while the chapter sections cannot be read."
              : "Sections that can move into coordinated review."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Complete</p>
          <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapterCompleteCount}</p>
          <p className="module-summary-detail">
            {chaptersState === "failed"
              ? "Unavailable while the chapter sections cannot be read."
              : "Sections already marked complete."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Linked projects</p>
          <p className="module-summary-value">{projectLinksState === "failed" ? "—" : projectLinkCount}</p>
          <p className="module-summary-detail">
            {projectLinksState === "failed"
              ? "The project links could not be read, so this is not a count of zero."
              : "Portfolio records currently attached to this cycle."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Funded projects</p>
          <p className="module-summary-value">
            {projectLinksState === "failed" || fundingReadFailed ? "—" : `${fundedProjectCount}/${projectLinkCount}`}
          </p>
          <p className="module-summary-detail">
            {projectLinksState === "failed" || fundingReadFailed
              ? "Funding posture is unavailable because part of the funding record could not be read — this is not a finding that nothing is funded."
              : `${likelyCoveredProjectCount} more look coverable from pursued funding, while ${unfundedProjectCount} still carry a remaining gap.`}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Scenario signals</p>
          <p className="module-summary-value">
            {scenarioComparisonState === "failed" ? "—" : scenarioComparisonIndicatorCount}
          </p>
          <p className="module-summary-detail">
            {scenarioComparisonState === "failed"
              ? "Scenario comparisons could not be read, so this page cannot say whether any are linked."
              : scenarioComparisonIndicatorCount === 0
                ? "No ready scenario comparisons are linked to these projects yet."
                : `${scenarioComparisonReadyCount} ready comparison snapshot${scenarioComparisonReadyCount === 1 ? "" : "s"} aggregated across linked projects.`}
          </p>
        </div>
      </div>
      <article className="module-operator-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </span>
          <div>
            <p className="module-operator-eyebrow">Digital RTP shell</p>
            <h2 className="module-operator-title">Chapter structure is now a first-class operating surface</h2>
          </div>
        </div>
        <p className="module-operator-copy">{workflow.detail}</p>
        <div className="module-operator-list">
          {workflow.actionItems.map((item) => (
            <div key={item} className="module-operator-item">{item}</div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="module-metric-card">
            <p className="module-metric-label">Geography</p>
            <p className="module-metric-value text-sm">{cycle.geography_label?.trim() || "Not set"}</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Horizon</p>
            <p className="module-metric-value text-sm">
              {typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
                ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
                : "Not set"}
            </p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Adoption target</p>
            <p className="module-metric-value text-sm">{formatRtpDate(cycle.adoption_target_date)}</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Public review</p>
            <p className="module-metric-value text-sm">
              {cycle.public_review_open_at && cycle.public_review_close_at
                ? `${formatRtpDate(cycle.public_review_open_at)} → ${formatRtpDate(cycle.public_review_close_at)}`
                : "Not set"}
            </p>
          </div>
        </div>
      </article>
    </>
  );
}
