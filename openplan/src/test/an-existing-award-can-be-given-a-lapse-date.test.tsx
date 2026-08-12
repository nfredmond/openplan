import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { ProjectFundingPanel } from "@/app/(app)/projects/[projectId]/_components/project-funding-panel";
import { summarizeBillingInvoiceRecords } from "@/lib/invoicing/invoice-records";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import {
  isoInstantToLapseDate,
  lapseDateToIsoInstant,
} from "@/components/projects/award-expenditure-deadline-control";

/**
 * AN AWARD THAT ALREADY EXISTS CAN BE GIVEN A LAPSE DATE.
 *
 * `funding_awards.expenditure_deadline_at` shipped write-once: the create route
 * accepted it, `PATCH /api/funding-awards/[awardId]` did not, and no surface
 * rendered it. The consequences compound.
 *
 *   - Every award already in a database could NEVER get a lapse date. The
 *     expenditure-reminder lane — the whole reason the column exists, and the
 *     one reminder in the product that carries a dollar figure — was
 *     unreachable for all of them, permanently.
 *   - Nobody could confirm the date even when creation HAD recorded one,
 *     because it rendered nowhere. A planner who typed it into the create form
 *     had no way to check it landed.
 *
 * This test proves the PATH, not the unit: the control is mounted by the real
 * funding panel (the surface the project page renders), the click issues the
 * real request, and the request body is the shape the route's zod schema
 * accepts. `funding-awards-route.test.ts` owns the server half.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function awardRow(expenditureDeadlineAt: string | null | undefined) {
  return {
    id: AWARD_ID,
    project_id: PROJECT_ID,
    program_id: null,
    funding_opportunity_id: null,
    title: "Ridge Corridor Safety Improvements",
    awarded_amount: 250000,
    match_amount: 0,
    match_posture: "secured",
    obligation_due_at: "2027-01-31T00:00:00.000Z",
    expenditure_deadline_at: expenditureDeadlineAt,
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
}

function renderPanel(options: {
  expenditureDeadlineAt: string | null | undefined;
  canWriteAwards?: boolean;
}) {
  const awards = [awardRow(options.expenditureDeadlineAt)];

  return render(
    <ProjectFundingPanel
      projectId={PROJECT_ID}
      workspaceId={WORKSPACE_ID}
      canWriteAwards={options.canWriteAwards ?? true}
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

describe("the lapse date is reachable from the project funding lane", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ award: { id: AWARD_ID } }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the recorded lapse date on the award row", () => {
    renderPanel({ expenditureDeadlineAt: "2027-06-30T00:00:00.000Z" });

    expect(screen.getByText(/Funds must be spent by/)).toBeInTheDocument();
    expect(screen.getByText("2027-06-30")).toBeInTheDocument();
  });

  it("says plainly that an award without one gets no reminder", () => {
    renderPanel({ expenditureDeadlineAt: null });

    // Not silence, and not a blank. An award with no lapse date is an award
    // whose money can lapse with no warning, and the row says so.
    expect(
      screen.getByText(/no lapse date recorded — no expenditure reminder will be sent for this award/)
    ).toBeInTheDocument();
  });

  it("sends the date to the award PATCH route in the shape its schema accepts", async () => {
    renderPanel({ expenditureDeadlineAt: null });

    fireEvent.change(screen.getByLabelText("Award lapse date"), { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: /Save lapse date/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/funding-awards/${AWARD_ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      expenditureDeadlineAt: "2027-06-30T00:00:00.000Z",
    });

    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalled());
  });

  it("clears a lapse date with an explicit null, not by omitting the key", async () => {
    renderPanel({ expenditureDeadlineAt: "2027-06-30T00:00:00.000Z" });

    fireEvent.change(screen.getByLabelText("Award lapse date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save lapse date/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Omitting the key means "leave it alone" to the route, so a cleared field
    // would silently save nothing and report success.
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toEqual({ expenditureDeadlineAt: null });
    expect("expenditureDeadlineAt" in body).toBe(true);
  });

  it("offers no editing control to a reader without programs.write", () => {
    renderPanel({ expenditureDeadlineAt: "2027-06-30T00:00:00.000Z", canWriteAwards: false });

    // The date is still shown — reading it is not a write.
    expect(screen.getByText("2027-06-30")).toBeInTheDocument();
    expect(screen.queryByLabelText("Award lapse date")).not.toBeInTheDocument();
  });

  it("distinguishes a column the page did not select from an award with no date", () => {
    renderPanel({ expenditureDeadlineAt: undefined });

    expect(screen.getByText(/Lapse date not loaded on this view/)).toBeInTheDocument();
    expect(screen.queryByText(/no lapse date recorded/)).not.toBeInTheDocument();
  });

  it("round-trips a calendar date through UTC midnight", () => {
    expect(lapseDateToIsoInstant("2027-06-30")).toBe("2027-06-30T00:00:00.000Z");
    expect(lapseDateToIsoInstant("  ")).toBeNull();
    expect(lapseDateToIsoInstant("not-a-date")).toBeNull();
    expect(isoInstantToLapseDate("2027-06-30T00:00:00.000Z")).toBe("2027-06-30");
    expect(isoInstantToLapseDate(null)).toBe("");
  });
});

describe("the project page actually selects the lapse column", () => {
  /**
   * The control above renders "not loaded on this view" when the column is
   * absent, which is honest and completely useless if that is what every
   * planner sees. Supabase clients here are untyped, so no compiler checks a
   * `.select()` string — this reads the real one.
   */
  it("asks for expenditure_deadline_at in the funding-award projection", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await readFile(
      path.resolve(process.cwd(), "src/app/(app)/projects/[projectId]/page.tsx"),
      "utf8"
    );

    const awardSelect = source
      .split("\n")
      .find((line) => line.includes("funding_opportunities(id, title), programs(id, title)"));

    expect(awardSelect, "the funding-award .select() line was not found").toBeTruthy();
    expect(awardSelect).toContain("expenditure_deadline_at");
  });
});
