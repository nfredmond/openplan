import { navLabel } from "@/components/nav/nav-registry";
import type { ReactNode } from "react";
import { FigureRow } from "@/components/ui/figure-row";
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
      description="One record per plan update, with its projects, chapters, public review and funding."
      actions={actions}
    >
      <FigureRow
        label="Regional plan figures"
        figures={[
          {
            label: "Plan updates",
            value: cycleCount,
            note: `${draftCount} draft, ${publicReviewCount} in public review`,
          },
          {
            label: "Adopted",
            value: adoptedCount,
            note: `${readyFoundationCount} ready for projects`,
          },
          {
            label: "Linked projects",
            value: linkedProjectCount,
            note: `${fundedProjectCount} funded, ${likelyCoveredProjectCount} likely, ${unfundedProjectCount} with a gap`,
          },
          {
            label: "Reimbursement outstanding",
            value: formatUsdWholeAmount(outstandingReimbursementTotal),
            note: `${formatUsdWholeAmount(paidReimbursementTotal)} paid, ${formatUsdWholeAmount(uninvoicedAwardTotal)} not invoiced`,
          },
        ]}
      />
      {/*
        Same three `billing_invoice_records` figures the invoicing register
        renders to the cent. Rounded here; said so here. See
        `src/lib/money/format.ts`.
      */}
      <p className="mt-2 text-xs text-muted-foreground">{ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER}</p>
    </PageHeader>
  );
}
