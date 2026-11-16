import { render, screen, within } from "@testing-library/react";
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
import { summarizeBillingInvoiceRecords } from "@/lib/invoicing/invoice-records";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";

/**
 * A FUNDING NEED NOBODY ENTERED IS NOT A ZERO NEED, AND A MATCH NOBODY ENTERED
 * IS NOT A ZERO MATCH.
 *
 * Lane 84's run-through recorded a $200,000 award on a Plumas County, CA
 * project with no funding need saved. The Funding tab printed "Funding need
 * $0.00" and "Still unfunded $0.00", while the scan two panels down said "No
 * amount, target not set" for the same fact. A second award recorded with no
 * match printed "Match $0.00" on its line, while the reimbursement worksheet
 * for the same award printed "Not recorded". Both columns are NOT NULL
 * DEFAULT 0, so a zero cannot be told from an empty field.
 *
 * Blind category: a need deliberately saved as 0 also reads "Not recorded";
 * that is the same rule the worksheet's ledger applies to the award ceiling.
 * Managed (version-bound) awards keep their own unassessed rendering and are
 * not exercised here.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture rows mirror the page's loose row types
type Loose = any;

function award(matchAmount: string, matchPosture: string) {
  return {
    id: AWARD_ID,
    project_id: PROJECT_ID,
    program_id: null,
    funding_opportunity_id: null,
    title: "Demonstration award",
    awarded_amount: "200000.00",
    match_amount: matchAmount,
    match_posture: matchPosture,
    obligation_due_at: null,
    expenditure_deadline_at: null,
    spending_status: "active",
    closure_basis: null,
    closed_at: null,
    closure_note: null,
    reopened_at: null,
    risk_flag: "none",
    notes: null,
    updated_at: "2026-11-16T00:00:00.000Z",
    created_at: "2026-11-16T00:00:00.000Z",
    opportunity: null,
    program: null,
  };
}

function renderPanel({ need, matchAmount = "50000.00", matchPosture = "partial" }: { need: number | null; matchAmount?: string; matchPosture?: string }) {
  const awards = [award(matchAmount, matchPosture)];
  const profile = need === null ? null : { funding_need_amount: need, local_match_need_amount: 0, notes: null };
  const summary = buildProjectFundingStackSummary(profile as Loose, awards as Loose, [], []);
  return render(
    <ProjectFundingPanel
      projectId={PROJECT_ID}
      workspaceId={WORKSPACE_ID}
      canWriteAwards
      projectFundingProfile={profile as Loose}
      projectFundingProfilePending={false}
      fundingAwardsPending={false}
      fundingOpportunitiesPending={false}
      fundingAwards={awards as Loose}
      fundingOpportunities={[]}
      fundingStackSummary={summary}
      fundingNeedAmount={summary.fundingNeedAmount}
      committedFundingAmount={summary.committedFundingAmount}
      committedMatchAmount={summary.committedMatchAmount}
      likelyFundingAmount={summary.likelyFundingAmount}
      remainingFundingGap={summary.unfundedAfterLikelyAmount ?? 0}
      awardWatchCount={0}
      nextObligationAward={null}
      pursueFundingCount={0}
      monitorFundingCount={0}
      skipFundingCount={0}
      pursuedFundingAmount={0}
      openFundingCount={0}
      invoiceSummaryByFundingAwardId={new Map([[AWARD_ID, summarizeBillingInvoiceRecords([])]])}
      invoiceRecordsByFundingAwardId={new Map([[AWARD_ID, []]]) as Loose}
      unlinkedProjectInvoices={[]}
      unlinkedProjectInvoiceSummary={summarizeBillingInvoiceRecords([])}
      comparisonBackedFundingReport={null}
    />
  );
}

/** The value printed in the summary card whose label is `label`. */
function cardValue(label: string): string {
  const card = screen.getAllByText(label, { selector: "p.module-summary-label" })[0].closest(".module-summary-card") as HTMLElement;
  return within(card).getByText((_, element) => element?.classList.contains("module-summary-value") ?? false).textContent ?? "";
}

/** The award's own money line under its title. */
function awardLine(): string {
  return screen.getByText((_, element) => element?.tagName === "P" && (element.textContent ?? "").startsWith("Awarded $200,000.00")).textContent ?? "";
}

describe("the Funding tab says Not recorded for money nobody entered", () => {
  it("prints no zero for a funding need nobody saved, and does not compute a gap from it", () => {
    renderPanel({ need: null });
    expect(cardValue("Funding need")).toBe("Not recorded");
    expect(cardValue("Still unfunded")).toBe("Not assessed");
    // The award itself is still counted: the rule touches only the missing fact.
    expect(cardValue("Committed awards")).toBe("$200,000.00");
  });

  it("prints the need and the gap when a need is saved", () => {
    renderPanel({ need: 300000 });
    expect(cardValue("Funding need")).toBe("$300,000.00");
    expect(cardValue("Still unfunded")).toBe("$100,000.00");
  });

  it("prints a match nobody entered as not recorded, and a recorded match as money", () => {
    renderPanel({ need: null, matchAmount: "0.00", matchPosture: "partial" });
    expect(awardLine()).toContain("Match not recorded");
    expect(awardLine()).not.toContain("Match $0.00");
  });

  it("says not required when the posture records that no match is needed", () => {
    renderPanel({ need: null, matchAmount: "0.00", matchPosture: "not_required" });
    expect(awardLine()).toContain("Match not required");
  });

  it("prints a recorded match as its amount", () => {
    renderPanel({ need: null, matchAmount: "50000.00", matchPosture: "partial" });
    expect(awardLine()).toContain("Match $50,000.00");
  });
});
