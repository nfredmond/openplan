import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

import { ProjectFundingPanel } from "@/app/(app)/projects/[projectId]/_components/project-funding-panel";
import { summarizeBillingInvoiceRecords } from "@/lib/invoicing/invoice-records";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";

/**
 * The colour a closed award wears on the project funding lane.
 *
 * Every award reading `fully_spent` used to get the same success green,
 * whether the close-out was earned against paid invoices, asserted by whoever
 * imported the award, or backfilled as `unrecorded_legacy` because it was
 * already closed before OpenPlan recorded a basis. Three different facts, one
 * reassuring colour — and colour is read long before any sentence is. These
 * tests hold the green to the one basis that earned it.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The tone classes StatusBadge paints, by the CSS variable each one names. */
const SUCCESS_TONE = "--pine";
const INFO_TONE = "--accent";
const WARNING_TONE = "--copper";

type ClosureColumns = {
  closure_basis?: string | null;
  closed_at?: string | null;
  closure_note?: string | null;
  reopened_at?: string | null;
};

function closedAward(closure: ClosureColumns) {
  return {
    id: "award-1",
    project_id: PROJECT_ID,
    program_id: null,
    funding_opportunity_id: null,
    title: "Corridor construction award",
    awarded_amount: 250000,
    match_amount: 0,
    match_posture: "secured",
    obligation_due_at: null,
    spending_status: "fully_spent",
    risk_flag: "none",
    notes: null,
    updated_at: "2026-05-02T18:00:00.000Z",
    created_at: "2026-04-01T18:00:00.000Z",
    funding_opportunities: null,
    programs: null,
    opportunity: null,
    program: null,
    ...closure,
  };
}

function renderPanelWithAward(closure: ClosureColumns) {
  const awards = [closedAward(closure)];

  return render(
    <ProjectFundingPanel
      projectId={PROJECT_ID}
      projectFundingProfile={null}
      projectFundingProfilePending={false}
      fundingAwardsPending={false}
      fundingOpportunitiesPending={false}
      fundingAwards={awards}
      fundingOpportunities={[]}
      fundingStackSummary={buildProjectFundingStackSummary(null, awards, [], [])}
      fundingNeedAmount={0}
      committedFundingAmount={250000}
      committedMatchAmount={0}
      likelyFundingAmount={0}
      remainingFundingGap={0}
      awardWatchCount={0}
      nextObligationAward={null}
      pursueFundingCount={0}
      monitorFundingCount={0}
      skipFundingCount={0}
      pursuedFundingAmount={0}
      openFundingCount={0}
      invoiceSummaryByFundingAwardId={new Map()}
      invoiceRecordsByFundingAwardId={new Map()}
      unlinkedProjectInvoices={[]}
      unlinkedProjectInvoiceSummary={summarizeBillingInvoiceRecords([])}
      comparisonBackedFundingReport={null}
    />
  );
}

/** The class list of the badge that states the award's spending status. */
function spendingStatusBadgeClasses(): string {
  return screen.getByText("Fully spent").className;
}

describe("a closed funding award on the project funding lane", () => {
  it("wears the success colour only when the close-out was earned against paid invoices", () => {
    renderPanelWithAward({
      closure_basis: "earned_coverage",
      closed_at: "2026-05-01T18:00:00.000Z",
      closure_note: null,
      reopened_at: null,
    });

    expect(spendingStatusBadgeClasses()).toContain(SUCCESS_TONE);
    expect(screen.getByText("Closed out on invoice coverage")).toBeInTheDocument();
    expect(screen.getByText(/Paid invoices covered the full awarded amount/i)).toBeInTheDocument();
  });

  it("does not paint a closure asserted on import as an earned one", () => {
    renderPanelWithAward({
      closure_basis: "recorded_on_import",
      closed_at: "2026-05-01T18:00:00.000Z",
      closure_note: "Closed in the agency ledger years before this workspace existed.",
      reopened_at: null,
    });

    // The status still reads "Fully spent" — it is fully spent — but the colour
    // no longer says a verification happened, and the words say who said so.
    expect(spendingStatusBadgeClasses()).not.toContain(SUCCESS_TONE);
    expect(spendingStatusBadgeClasses()).toContain(INFO_TONE);
    expect(screen.getByText("Recorded as closed on import")).toBeInTheDocument();
    expect(screen.getByText(/No invoice coverage was checked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Closed in the agency ledger years before this workspace existed\./i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
  });

  it("flags a legacy closure whose basis nobody recorded, rather than assuming one", () => {
    // Written only by the migration's backfill, for awards already closed before
    // OpenPlan stored how. It cannot be told apart from one that was typed in,
    // and the lane has to say exactly that.
    renderPanelWithAward({
      closure_basis: "unrecorded_legacy",
      closed_at: null,
      closure_note: null,
      reopened_at: null,
    });

    expect(spendingStatusBadgeClasses()).not.toContain(SUCCESS_TONE);
    expect(spendingStatusBadgeClasses()).toContain(WARNING_TONE);
    expect(screen.getByText("Closure basis not recorded")).toBeInTheDocument();
    expect(screen.getByText(/before OpenPlan recorded how a closure was reached/i)).toBeInTheDocument();
  });

  it("keeps a re-opening visible on an award that was closed again afterwards", () => {
    // A re-open that erased itself on the next close-out would falsify the
    // record in the other direction, so `reopened_at` survives a re-close and
    // has to reach the page that shows the closure.
    renderPanelWithAward({
      closure_basis: "earned_coverage",
      closed_at: "2026-06-01T18:00:00.000Z",
      closure_note: null,
      reopened_at: "2026-05-15T18:00:00.000Z",
    });

    expect(screen.getByText(/^Re-opened /)).toBeInTheDocument();
  });

  it("says the basis was not loaded when the page did not ask for it", () => {
    // The state the whole app was in before the two award pages selected the
    // columns. It must keep working: a future page that forgets them should
    // degrade to "not known", never to the reassuring reading.
    renderPanelWithAward({});

    expect(spendingStatusBadgeClasses()).not.toContain(SUCCESS_TONE);
    expect(screen.getByText("Closure basis not loaded")).toBeInTheDocument();
    expect(screen.getByText(/is not recorded in what was loaded here/i)).toBeInTheDocument();
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
  });

  it("says nothing about a closure basis on an award that is still open", () => {
    // An open award has no basis by construction — the schema ties the two
    // together — so a "not recorded" line there would invent a gap in a record
    // that is complete.
    const awards = [{ ...closedAward({}), spending_status: "active" }];

    render(
      <ProjectFundingPanel
        projectId={PROJECT_ID}
        projectFundingProfile={null}
        projectFundingProfilePending={false}
        fundingAwardsPending={false}
        fundingOpportunitiesPending={false}
        fundingAwards={awards}
        fundingOpportunities={[]}
        fundingStackSummary={buildProjectFundingStackSummary(null, awards, [], [])}
        fundingNeedAmount={0}
        committedFundingAmount={250000}
        committedMatchAmount={0}
        likelyFundingAmount={0}
        remainingFundingGap={0}
        awardWatchCount={0}
        nextObligationAward={null}
        pursueFundingCount={0}
        monitorFundingCount={0}
        skipFundingCount={0}
        pursuedFundingAmount={0}
        openFundingCount={0}
        invoiceSummaryByFundingAwardId={new Map()}
        invoiceRecordsByFundingAwardId={new Map()}
        unlinkedProjectInvoices={[]}
        unlinkedProjectInvoiceSummary={summarizeBillingInvoiceRecords([])}
        comparisonBackedFundingReport={null}
      />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Closure basis not loaded")).toBeNull();
    expect(screen.queryByText(/is not recorded in what was loaded here/i)).toBeNull();
  });
});
