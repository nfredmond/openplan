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
          RTP cycle foundation live
        </div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">RTP Cycles</h1>
          <p className="module-intro-description">
            Register each RTP update as one parent control object so portfolio, chapter, engagement, and funding work can hang off a shared spine.
          </p>
        </div>

        <div className="module-summary-grid cols-6">
          <div className="module-summary-card">
            <p className="module-summary-label">Cycles</p>
            <p className="module-summary-value">{cycleCount}</p>
            <p className="module-summary-detail">RTP update cycles tracked in the current workspace.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Draft / review</p>
            <p className="module-summary-value">{draftCount + publicReviewCount}</p>
            <p className="module-summary-detail">{publicReviewCount} currently marked in public review posture.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Adopted</p>
            <p className="module-summary-value">{adoptedCount}</p>
            <p className="module-summary-detail">Cycles already marked as adopted.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Foundation ready</p>
            <p className="module-summary-value">{readyFoundationCount}</p>
            <p className="module-summary-detail">Cycles with core metadata in place for portfolio build-out.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Linked projects</p>
            <p className="module-summary-value">{linkedProjectCount}</p>
            <p className="module-summary-detail">Project-to-cycle portfolio links now visible across the registry.</p>
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
            <p className="module-operator-eyebrow">Regional planning control room</p>
            <h2 className="module-operator-title">Make the RTP update a first-class operating object</h2>
          </div>
        </div>
        <p className="module-operator-copy">
          This is the foundation for project portfolio, chapter narrative, public review, and financial traceability. Keep one cycle per update instead of scattering state across plans and engagement records.
        </p>
        <div className="module-operator-list">
          <div className="module-operator-item">One cycle can later anchor project, chapter, and funding linkage.</div>
          <div className="module-operator-item">Public review dates stay explicit instead of buried in a memo or draft PDF.</div>
          <div className="module-operator-item">The next implementation slice will attach portfolio and chapter records to this parent.</div>
        </div>
      </article>
    </header>
  );
}
