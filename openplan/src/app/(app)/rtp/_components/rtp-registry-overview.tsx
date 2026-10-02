import { navLabel } from "@/components/nav/nav-registry";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER } from "@/lib/money/format";
import { formatUsdWholeAmount } from "./_helpers";

type Props = {
  /** The page's primary action. The registry page passes the cycle creator. */
  actions: ReactNode;
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
  actions,
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
    <PageHeader
      title={navLabel("/rtp")}
      description="One record per plan update. The project list, the chapters, the public review, and the money all hang off it, so nothing drifts apart."
      actions={actions}
    >
      <div className="module-summary-grid cols-6">
        <div className="module-summary-card">
          <p className="module-summary-label">Cycles</p>
          <p className="module-summary-value">{cycleCount}</p>
          <p className="module-summary-detail">Plan updates tracked here.</p>
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
          {/*
            Same three `billing_invoice_records` figures the invoicing register
            renders to the cent. Rounded here; said so here. See
            `src/lib/money/format.ts`.
          */}
          <p className="module-summary-detail mt-1">{ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER}</p>
        </div>
      </div>
    </PageHeader>
  );
}
