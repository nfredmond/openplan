import { Route as RouteIcon, ShieldCheck } from "lucide-react";
import { formatUsdWholeAmount } from "./_helpers";

type Props = {
  cycleCount: number;
  draftCount: number;
  publicReviewCount: number;
  adoptedCount: number;
  readyFoundationCount: number;
  linkedProjectCount: number;
  fundedProjectCount: number;
  likelyCoveredProjectCount: number;
  unfundedProjectCount: number;
  paidReimbursementTotal: number;
  outstandingReimbursementTotal: number;
  uninvoicedAwardTotal: number;
};

export function RtpRegistryOverview({
  cycleCount,
  draftCount,
  publicReviewCount,
  adoptedCount,
  readyFoundationCount,
  linkedProjectCount,
  fundedProjectCount,
  likelyCoveredProjectCount,
  unfundedProjectCount,
  paidReimbursementTotal,
  outstandingReimbursementTotal,
  uninvoicedAwardTotal,
}: Props) {
  return (
    <header className="module-header-grid">
      <article className="module-intro-card">
        <div className="module-intro-kicker">
          <RouteIcon className="h-3.5 w-3.5" />
          Regional Transportation Plan
        </div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">RTP Cycles</h1>
          <p className="module-intro-description">
            One record per plan update. The project list, the chapters, the public review, and the money all hang off it, so nothing drifts apart.
          </p>
        </div>

        <div className="module-summary-grid cols-6">
          <div className="module-summary-card">
            <p className="module-summary-label">Cycles</p>
            <p className="module-summary-value">{cycleCount}</p>
            <p className="module-summary-detail">Plan updates tracked in this workspace.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Draft / review</p>
            <p className="module-summary-value">{draftCount + publicReviewCount}</p>
            <p className="module-summary-detail">{publicReviewCount} currently out for public review.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Adopted</p>
            <p className="module-summary-value">{adoptedCount}</p>
            <p className="module-summary-detail">Cycles already marked as adopted.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Foundation ready</p>
            <p className="module-summary-value">{readyFoundationCount}</p>
            <p className="module-summary-detail">Cycles with enough recorded to start adding projects.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Linked projects</p>
            <p className="module-summary-value">{linkedProjectCount}</p>
            <p className="module-summary-detail">Projects attached to a cycle across every update.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Portfolio funding</p>
            <p className="module-summary-value">{fundedProjectCount}/{linkedProjectCount}</p>
            <p className="module-summary-detail">
              {likelyCoveredProjectCount} more look coverable from pursued funding, {unfundedProjectCount} still carry a gap, and linked award invoices show {formatUsdWholeAmount(paidReimbursementTotal)} paid, {formatUsdWholeAmount(outstandingReimbursementTotal)} outstanding, and {formatUsdWholeAmount(uninvoicedAwardTotal)} not yet invoiced.
            </p>
          </div>
        </div>
      </article>

      <article className="module-operator-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </span>
          <div>
            <p className="module-operator-eyebrow">Regional planning</p>
            <h2 className="module-operator-title">Keep the whole plan update in one record</h2>
          </div>
        </div>
        <p className="module-operator-copy">
          The project list, the chapter text, the public review, and the fiscal constraint all belong to the same update. One cycle per update beats tracking them separately and hoping they agree.
        </p>
        <div className="module-operator-list">
          <div className="module-operator-item">Projects, chapters, and funding all attach to the cycle.</div>
          <div className="module-operator-item">Public review dates are recorded here, not buried in a memo or a draft PDF.</div>
          <div className="module-operator-item">Open a cycle to work its project list, chapters, financial element, and draft review.</div>
        </div>
      </article>
    </header>
  );
}
