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
          <p className="module-operator-eyebrow">Where to start</p>
          <h2 className="module-operator-title">What is worth your attention today</h2>
        </div>
      </div>
      <p className="module-operator-copy">
        A quick read of the workspace, then straight into whatever needs you — a project, a corridor study, or a report.
        {rtpFundingReviewCount > 0
          ? grantsRoutedRtpFundingReview
            ? ` ${rtpFundingReviewCount} RTP packet${rtpIsPlural ? "s are" : " is"} up to date but still ${rtpIsPlural ? "need" : "needs"} funding sorted out in Grants before you share ${rtpIsPlural ? "them" : "it"}.`
            : ` ${rtpFundingReviewCount} RTP packet${rtpIsPlural ? "s are" : " is"} up to date but still ${rtpIsPlural ? "need" : "needs"} a funding check before you share ${rtpIsPlural ? "them" : "it"}.`
          : ""}
      </p>
      <div className="module-operator-list">
        <div className="module-operator-item">
          Look over your active projects and anything that has changed recently.
        </div>
        {rtpFundingReviewCount > 0 ? (
          <div className="module-operator-item">
            {grantsRoutedRtpFundingReview
              ? `An RTP packet being current is not the same as being finished: ${rtpFundingReviewCount} still ${rtpIsPlural ? "need" : "needs"} the funding on ${rtpIsPlural ? "their" : "its"} projects tidied up in Grants first.`
              : `An RTP packet being current is not the same as being finished: ${rtpFundingReviewCount} still ${rtpIsPlural ? "have" : "has"} funding follow-up on the projects ${rtpIsPlural ? "they include" : "it includes"}.`}
          </div>
        ) : null}
        {comparisonBackedReportCount > 0 ? (
          <div className="module-operator-item">
            {comparisonBackedReportCount} report{comparisonIsPlural ? "s are" : " is"} backed by a scenario comparison, which is useful when you are explaining why one option was chosen. It does not say anything about whether a grant will be awarded, and it does not replace reading the funding rules.
          </div>
        ) : null}
        {grantModelingOperatorDetail ? (
          <div className="module-operator-item">{grantModelingOperatorDetail}</div>
        ) : null}
        <div className="module-operator-item">
          Projects is where a piece of work lives. Analysis Studio is where you study a corridor.
        </div>
        <div className="module-operator-item">
          {firstRunAt
            ? `Your first result took ${timeToFirstResultFormatted}.`
            : "No corridor studies yet. Analysis Studio will run your first one in a few minutes."}
        </div>
      </div>
    </article>
  );
}
