import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ProjectFundingPanel } from "@/app/(app)/projects/[projectId]/_components/project-funding-panel";
import { ProjectDeliveryBoard } from "@/app/(app)/projects/[projectId]/_components/project-delivery-board";
import type { ProjectRow } from "@/app/(app)/projects/[projectId]/_components/_types";
import { GrantsAwardsReimbursementSection } from "@/components/grants/grants-awards-reimbursement-section";
import { buildAwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";
import {
  summarizeBillingInvoiceRecords,
  uninvoicedCommittedAwardAmount,
} from "@/lib/invoicing/invoice-records";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
} from "@/lib/invoicing/reimbursement-worksheet";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";

/**
 * A REJECTED CLAIM IS NOT MONEY YOU DREW, AND AN AWARD HAS ONE CLAIMED FIGURE.
 *
 * Two defects, one fixture, because they are the same mistake seen twice: a
 * money figure whose definition lived at the call site instead of in the one
 * module that owns it.
 *
 *   B. `summarizeBillingInvoiceRecords` exports `claimedNetAmount` — net over
 *      the four CLAIMED statuses — and every surface that says "requested" or
 *      subtracts from an award read `totalNetAmount` instead, which sums the
 *      whole register including claims the funder REFUSED. On this fixture
 *      that is a $64,000.00 rejected invoice removed from what the agency
 *      believed it could still invoice: /grants showed $6,000.00 left to bill
 *      against a $250,000.00 award where the honest figure is $119,999.67.
 *      The direction of the error is the part that costs money — it tells an
 *      agency it has nothing left to claim, and the award lapses unspent.
 *
 *   A. The project funding panel computed an award's claimed/remaining with a
 *      second summariser (`buildAwardClaimProgress`, now deleted) that summed
 *      NET over every non-rejected status INCLUDING DRAFTS, ten lines above a
 *      download control describing itself as "the printable form of the two
 *      lines above" whose PDF sums GROSS over the four claimed statuses. The
 *      $50,000.00 draft below moved the two $50,000.00 apart.
 *
 * THE FIXTURE IS SHARED ON PURPOSE. Every assertion in this file reads the
 * same four invoice rows, so a change to what "claimed" means cannot be made
 * true on one surface and left false on another.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const AWARDED_AMOUNT = "250000.00";

/**
 * Four rows spanning the partition: one paid, one still in the payment flow,
 * one rejected, one draft. Cents are deliberate — a fixture in round thousands
 * cannot tell a rounding regression from a correct answer.
 *
 *   claimed (gross, and net here since retention is 0) = 100,000.50 + 29,999.83
 *                                                      = 130,000.33
 *   remaining against the authorization = 250,000.00 - 130,000.33 = 119,999.67
 *   register total, rejected and draft included          = 244,000.33
 */
const INVOICE_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: PROJECT_ID,
    funding_award_id: AWARD_ID,
    invoice_number: "RB-001",
    consultant_name: "Sierra Counts LLC",
    billing_basis: "time_and_materials",
    status: "paid",
    invoice_date: "2026-01-15",
    due_date: "2026-02-15",
    paid_date: "2026-02-10",
    amount: "100000.50",
    retention_percent: 0,
    retention_amount: 0,
    net_amount: "100000.50",
    submitted_to: null,
    notes: null,
    created_at: "2026-01-15T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    project_id: PROJECT_ID,
    funding_award_id: AWARD_ID,
    invoice_number: "RB-002",
    consultant_name: "Sierra Counts LLC",
    billing_basis: "time_and_materials",
    status: "submitted",
    invoice_date: "2026-02-20",
    due_date: "2026-03-20",
    paid_date: null,
    amount: "29999.83",
    retention_percent: 0,
    retention_amount: 0,
    net_amount: "29999.83",
    submitted_to: null,
    notes: null,
    created_at: "2026-02-20T00:00:00.000Z",
  },
  {
    // THE ROW THIS FILE EXISTS FOR. The funder refused it; those dollars are
    // still available to re-invoice and must appear in no claimed total.
    id: "33333333-3333-4333-8333-333333333333",
    project_id: PROJECT_ID,
    funding_award_id: AWARD_ID,
    invoice_number: "RB-003",
    consultant_name: "Sierra Counts LLC",
    billing_basis: "time_and_materials",
    status: "rejected",
    invoice_date: "2026-03-01",
    due_date: "2026-04-01",
    paid_date: null,
    amount: "64000.00",
    retention_percent: 0,
    retention_amount: 0,
    net_amount: "64000.00",
    submitted_to: null,
    notes: null,
    created_at: "2026-03-01T00:00:00.000Z",
  },
  {
    // Nobody has asked the funder for this yet, so it is not a claim either.
    id: "44444444-4444-4444-8444-444444444444",
    project_id: PROJECT_ID,
    funding_award_id: AWARD_ID,
    invoice_number: "RB-004",
    consultant_name: "Sierra Counts LLC",
    billing_basis: "time_and_materials",
    status: "draft",
    invoice_date: "2026-03-20",
    due_date: null,
    paid_date: null,
    amount: "50000.00",
    retention_percent: 0,
    retention_amount: 0,
    net_amount: "50000.00",
    submitted_to: null,
    notes: null,
    created_at: "2026-03-20T00:00:00.000Z",
  },
];

const AWARD_ROW = {
  id: AWARD_ID,
  project_id: PROJECT_ID,
  program_id: null,
  funding_opportunity_id: null,
  title: "Ridge Corridor Safety Improvements",
  awarded_amount: AWARDED_AMOUNT,
  match_amount: 0,
  match_posture: "secured",
  obligation_due_at: null,
  expenditure_deadline_at: null,
  spending_status: "active",
  risk_flag: "none",
  notes: null,
  updated_at: "2026-05-02T18:00:00.000Z",
  created_at: "2026-04-01T18:00:00.000Z",
  funding_opportunities: null,
  programs: null,
  opportunity: null,
  program: null,
};

/** The claimed figures, as the ONE module that owns them computes them. */
function fixtureLedger() {
  const built = buildAwardDrawdownLedger({
    award: { awarded_amount: AWARDED_AMOUNT, match_amount: 0, match_posture: "secured" },
    invoiceRead: { ok: true, invoices: INVOICE_ROWS },
  });
  if (!built.ok) throw new Error("fixture ledger failed to build");
  return built.ledger;
}

/** US currency as every surface here formats it, so figures compare as text. */
function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- page prop rows are untyped Supabase reads
type Loose = any;

function renderFundingPanel() {
  const awards = [AWARD_ROW];
  const invoicesByAward = new Map<string, Loose[]>([[AWARD_ID, INVOICE_ROWS]]);

  return render(
    <ProjectFundingPanel
      projectId={PROJECT_ID}
      workspaceId={WORKSPACE_ID}
      canWriteAwards
      projectFundingProfile={null}
      projectFundingProfilePending={false}
      fundingAwardsPending={false}
      fundingOpportunitiesPending={false}
      fundingAwards={awards as Loose}
      fundingOpportunities={[]}
      fundingStackSummary={buildProjectFundingStackSummary(null, awards, [], INVOICE_ROWS)}
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
      invoiceSummaryByFundingAwardId={new Map([[AWARD_ID, summarizeBillingInvoiceRecords(INVOICE_ROWS)]])}
      invoiceRecordsByFundingAwardId={invoicesByAward as Loose}
      unlinkedProjectInvoices={[]}
      unlinkedProjectInvoiceSummary={summarizeBillingInvoiceRecords([])}
      comparisonBackedFundingReport={null}
    />
  );
}

describe("finding B — a rejected claim is excluded from every 'requested' figure", () => {
  it("the summariser itself partitions the fixture the way the surfaces must", () => {
    const summary = summarizeBillingInvoiceRecords(INVOICE_ROWS);

    // The honest figure, and the one the surfaces used to show instead.
    expect(summary.claimedNetAmount).toBe(130000.33);
    expect(summary.totalNetAmount).toBe(244000.33);
    expect(summary.rejectedNetAmount).toBe(64000);
    expect(summary.rejectedCount).toBe(1);
  });

  it("/grants counts uninvoiced award dollars against claims only, not the register", () => {
    const linkedInvoiceSummary = summarizeBillingInvoiceRecords(INVOICE_ROWS);
    // The SAME function the grants page calls, not a copy of its arithmetic.
    // Re-deriving the expression here would be a fixture describing the page
    // rather than a test of it: reverting the page to `totalNetAmount` would
    // leave this green.
    const uninvoicedCommittedAmount = uninvoicedCommittedAwardAmount(250000, linkedInvoiceSummary);

    render(
      <GrantsAwardsReimbursementSection
        fundingAwardsCount={1}
        fundingProjectStacks={[]}
        committedAwardAmount={250000}
        trackedMatchAmount={0}
        uninvoicedCommittedAmount={uninvoicedCommittedAmount}
        awardWatchCount={0}
        linkedInvoiceSummary={linkedInvoiceSummary}
        reimbursementNotStartedCount={0}
        reimbursementActiveCount={0}
        reimbursementPaidCount={0}
        reimbursementComposerStack={null}
        reimbursementProfile={null}
        activeFocusedProjectId={null}
        workspaceId={WORKSPACE_ID}
        canWriteInvoices={false}
        canCloseOutAwards={false}
      />
    );

    // This surface rounds to whole dollars. $119,999.67 is still claimable;
    // the defect rendered $6,000 — the rejected $64,000.00 and the unsent
    // $50,000.00 draft both subtracted from what may still be invoiced.
    expect(uninvoicedCommittedAmount).toBeCloseTo(119999.67, 2);
    expect(screen.getByText("$120,000")).toBeInTheDocument();
    expect(screen.queryByText("$6,000")).not.toBeInTheDocument();

    // "Requested" is the claimed total, not the register total…
    expect(screen.getByText("$130,000")).toBeInTheDocument();
    expect(screen.queryByText("$244,000")).not.toBeInTheDocument();
    // …and what was excluded is disclosed rather than silently dropped.
    expect(screen.getByText(/\$64,000 across 1 rejected record is excluded/)).toBeInTheDocument();
  });

  it("the project funding panel's award row reports claims, not the register", () => {
    renderFundingPanel();

    const chain = screen.getByText(/linked invoice record/);
    expect(chain.textContent).toContain("$130,000.33 net requested");
    expect(chain.textContent).not.toContain("$244,000.33");
    expect(chain.textContent).toContain("$64,000.00 rejected, not counted");
  });

  it("the project delivery board's invoice tile reports claims, not the register", () => {
    const controlsSummary = buildProjectControlsSummary([], [], INVOICE_ROWS, null, "2026-04-01T00:00:00.000Z");

    render(
      <ProjectDeliveryBoard
        assigneeRoster={{ ok: true, members: [] }}
        canWrite={false}
        project={{ id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Ridge Corridor" } as ProjectRow}
        projectControlsSummary={controlsSummary}
        invoiceSummary={controlsSummary.invoiceSummary}
        recommendedReport={null}
        firstBlockedMilestone={null}
        firstOverdueMilestone={null}
        firstOverdueSubmittal={null}
        firstOverdueInvoice={null}
        projectMilestonesPending={false}
        milestones={[]}
        prioritizedMilestones={[]}
        projectSubmittalsPending={false}
        submittals={[]}
        prioritizedSubmittals={[]}
        projectInvoicesPending={false}
        projectInvoices={[]}
        prioritizedProjectInvoices={[]}
        deliverables={[]}
        budgetSummaryByDeliverableId={new Map()}
      />
    );

    const tile = screen.getByText(/Net requested/);
    expect(tile.textContent).toContain("Net requested $130,000.33");
    expect(tile.textContent).not.toContain("$244,000.33");
    expect(tile.textContent).toContain("$64,000.00 rejected, not counted");
  });
});

describe("finding A — the panel and its worksheet answer with the same numbers", () => {
  /**
   * THE EQUALITY THAT MATTERS. Both figures are pulled out of what each
   * surface actually RENDERS — not from two calls to the same function, which
   * would pass no matter what the panel printed.
   */
  it("claimed and remaining are identical on the screen and in the packet", () => {
    const ledger = fixtureLedger();

    const profile = resolveReimbursementProfile({ workspaceJurisdiction: { country: "US", subdivision: "CA" } });
    if (profile.kind !== "resolved") throw new Error("fixture profile did not resolve");

    const worksheetHtml = buildReimbursementWorksheetHtml({
      workspace: { name: "Sierra Regional Transportation Agency" },
      award: { title: AWARD_ROW.title, projectName: "Ridge Corridor" },
      period: null,
      ledger,
      profile: profile.binding,
      costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }),
    });

    renderFundingPanel();
    const panelLine = screen.getByText(/Claim progress:/).textContent ?? "";

    // The two figures a planner compares between screen and packet.
    const claimed = usd(130000.33);
    const remaining = usd(119999.67);

    expect(panelLine).toContain(`claimed ${claimed} gross`);
    expect(panelLine).toContain(`${remaining} not yet claimed`);
    expect(worksheetHtml).toContain(`<td class="num">${claimed}</td>`);
    expect(worksheetHtml).toContain(`<td class="num">${remaining}</td>`);

    // And the disagreement the deleted second summariser produced is gone:
    // net-over-non-rejected-including-drafts was $180,000.33 / $69,999.67.
    expect(panelLine).not.toContain(usd(180000.33));
    expect(panelLine).not.toContain(usd(69999.67));
  });

  it("the draft is disclosed on the panel, counted in neither figure", () => {
    renderFundingPanel();
    const panelLine = screen.getByText(/Claim progress:/).textContent ?? "";

    expect(panelLine).toContain("$50,000.00 drafted and not yet claimed, counted in none of the above");
  });

  it("there is only one definition of an award's claimed total left in the repo", async () => {
    // `buildAwardClaimProgress` was the second one. Its absence is the fix;
    // a re-introduction under the same name fails here before it can diverge.
    const fundingModule = await import("@/lib/projects/funding");
    expect(Object.keys(fundingModule)).not.toContain("buildAwardClaimProgress");
  });
});
