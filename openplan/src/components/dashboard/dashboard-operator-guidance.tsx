import { ShieldCheck } from "lucide-react";

export type DashboardOperatorGuidanceProps = {
  rtpFundingReviewCount: number;
  grantsRoutedRtpFundingReview: boolean;
  comparisonBackedReportCount: number;
  grantModelingOperatorDetail: string | null;
  firstRunAt: string | null;
  timeToFirstResultFormatted: string;
};

export function DashboardOperatorGuidance({
  rtpFundingReviewCount,
  grantsRoutedRtpFundingReview,
  comparisonBackedReportCount,
  grantModelingOperatorDetail,
  firstRunAt,
  timeToFirstResultFormatted,
}: DashboardOperatorGuidanceProps) {
  const rtpIsPlural = rtpFundingReviewCount !== 1;
  const comparisonIsPlural = comparisonBackedReportCount !== 1;

  return (
    <article className="module-operator-card">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
          <ShieldCheck className="h-5 w-5 text-emerald-200" />
        </span>
        <div>
          <p className="module-operator-eyebrow">Overview</p>
          <h2 className="module-operator-title">Start here, then move into the work</h2>
        </div>
      </div>
      <p className="module-operator-copy">
        Start with a quick scan of your workspace, then open the project, analysis, or report that needs work.
        {rtpFundingReviewCount > 0
          ? grantsRoutedRtpFundingReview
            ? ` ${rtpFundingReviewCount} current RTP packet${rtpIsPlural ? "s still need" : " still needs"} Grants OS follow-through even though freshness already reads current.`
            : ` ${rtpFundingReviewCount} current RTP packet${rtpIsPlural ? "s still need" : " still needs"} funding-backed release review even though freshness already reads current.`
          : ""}
      </p>
      <div className="module-operator-list">
        <div className="module-operator-item">
          Review active projects, recent updates, and items that need follow-up.
        </div>
        {rtpFundingReviewCount > 0 ? (
          <div className="module-operator-item">
            {grantsRoutedRtpFundingReview
              ? `Current RTP packet work is now a Grants OS follow-through lane, ${rtpFundingReviewCount} packet${rtpIsPlural ? "s still need" : " still needs"} linked-project funding cleanup before packet posture is truly settled.`
              : `Current RTP packet work is not just freshness, ${rtpFundingReviewCount} packet${rtpIsPlural ? "s still carry" : " still carries"} linked-project funding follow-up.`}
          </div>
        ) : null}
        {comparisonBackedReportCount > 0 ? (
          <div className="module-operator-item">
            {comparisonBackedReportCount} comparison-backed report packet{comparisonIsPlural ? "s can" : " can"} support grant planning language or prioritization framing, but that evidence still does not prove award likelihood or replace funding-source review.
          </div>
        ) : null}
        {grantModelingOperatorDetail ? (
          <div className="module-operator-item">{grantModelingOperatorDetail}</div>
        ) : null}
        <div className="module-operator-item">
          Open Projects to manage a planning effort, or Analysis Studio to work on a corridor study.
        </div>
        <div className="module-operator-item">
          {firstRunAt
            ? `Time to first result: ${timeToFirstResultFormatted}.`
            : "No analysis runs yet — open Analysis Studio to start the first corridor study."}
        </div>
      </div>
    </article>
  );
}
