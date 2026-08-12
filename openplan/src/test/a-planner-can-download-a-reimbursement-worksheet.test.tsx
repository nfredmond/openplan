import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

// The award row now carries a lapse-date control, which is a client component
// using `useRouter` to refresh after a save.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

import { ProjectFundingPanel } from "@/app/(app)/projects/[projectId]/_components/project-funding-panel";
import { worksheetFilenameFromDisposition } from "@/components/invoicing/reimbursement-worksheet-download";
import { summarizeBillingInvoiceRecords } from "@/lib/invoicing/invoice-records";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";

/**
 * CAN A PLANNER ACTUALLY GET THE REIMBURSEMENT WORKSHEET?
 *
 * `GET /api/funding-awards/[awardId]/drawdown-worksheet` shipped complete,
 * audited, permission-gated and tested — with nothing in the product calling
 * it. That is this repository's most expensive recurring defect (at least eight
 * instances now), and `every-api-route-has-a-caller.test.ts` caught this one
 * during the release gate.
 *
 * That guard proves only that SOME file mentions the path. It cannot tell a
 * live control from a dead import, which is why this test exists beside it: it
 * renders the REAL `ProjectFundingPanel` — the component the project page
 * actually mounts, with an award of the shape the page actually loads — clicks
 * the control a planner would click, and asserts on the request that leaves the
 * browser. If the control is removed, hidden behind a condition that never
 * holds, or wired to a different path, this fails.
 *
 * THE BINDINGS ARE VARIED ON PURPOSE. Every id asserted here is checked against
 * a second render using different ids. One fixture cannot tell "threads the
 * award id" apart from "hardcodes the award id that happened to be in the
 * fixture" — a distinction this repo has been burned by before (60 tests once
 * passed a hardcode mutation).
 *
 * WHAT THIS TEST DELIBERATELY DOES NOT DO: assert any dollar figure. No money
 * is computed on this surface, and that is the design — the ledger is built
 * server-side from recorded rows. A client-side total here would be a second
 * arithmetic path that could disagree with the packet.
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Two of everything, so a hardcoded value cannot satisfy both renders. */
const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const AWARD_A = "33333333-3333-4333-8333-333333333333";
const AWARD_B = "44444444-4444-4444-8444-444444444444";

function award(overrides: { id: string; title: string }) {
  return {
    project_id: PROJECT_ID,
    program_id: null,
    funding_opportunity_id: null,
    awarded_amount: 250000,
    match_amount: 0,
    match_posture: "secured",
    obligation_due_at: null,
    spending_status: "active",
    risk_flag: "none",
    notes: null,
    updated_at: "2026-05-02T18:00:00.000Z",
    created_at: "2026-04-01T18:00:00.000Z",
    funding_opportunities: null,
    programs: null,
    opportunity: null,
    program: null,
    closure_basis: null,
    closed_at: null,
    closure_note: null,
    reopened_at: null,
    ...overrides,
  };
}

function renderPanel(params: { workspaceId: string; awardId: string; awardTitle: string }) {
  const awards = [award({ id: params.awardId, title: params.awardTitle })];

  return render(
    <ProjectFundingPanel
      projectId={PROJECT_ID}
      workspaceId={params.workspaceId}
      canWriteAwards
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

/** A successful PDF response, shaped the way the route shapes one. */
function pdfResponse(filename: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    }),
    blob: async () => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
  } as unknown as Response;
}

/** A refusal, shaped the way the route shapes one. */
function refusal(status: number, message: string) {
  return {
    ok: false,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ error: message }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let createdObjectUrls: number;

beforeEach(() => {
  createdObjectUrls = 0;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  // jsdom implements neither of these; the component uses them for the save.
  // Counting the calls is what lets a refusal assert that NO file was produced.
  vi.stubGlobal("URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        createdObjectUrls += 1;
        return "blob:worksheet";
      }),
      revokeObjectURL: vi.fn(),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The URL string of the single request the component made. */
function requestedUrl(): string {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return String(fetchMock.mock.calls[0][0]);
}

describe("the reimbursement worksheet is reachable from the project funding lane", () => {
  it("renders a download control on the award row a planner is already looking at", () => {
    renderPanel({ workspaceId: WORKSPACE_A, awardId: AWARD_A, awardTitle: "Corridor construction award" });

    // The control sits inside the award's own row, not in some workspace-level
    // toolbar: the packet is per-award, and so is the button.
    const button = screen.getByRole("button", { name: /download worksheet/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText("Reimbursement worksheet")).toBeInTheDocument();
  });

  it("requests the worksheet route for THIS award in THIS workspace", async () => {
    fetchMock.mockResolvedValue(pdfResponse("reimbursement-worksheet-corridor.pdf"));

    const first = renderPanel({
      workspaceId: WORKSPACE_A,
      awardId: AWARD_A,
      awardTitle: "Corridor construction award",
    });

    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const urlA = requestedUrl();
    expect(urlA).toContain(`/api/funding-awards/${AWARD_A}/drawdown-worksheet`);
    expect(urlA).toContain(`workspaceId=${WORKSPACE_A}`);
    // No period was entered, so neither bound is sent — the route reads an
    // absent bound as "the whole award to date", which is not the same request
    // as one bounded by an empty string.
    expect(urlA).not.toContain("periodStart");
    expect(urlA).not.toContain("periodEnd");

    // THE BINDING VARIES. A component that hardcoded either id would pass the
    // assertions above and fail here.
    first.unmount();
    fetchMock.mockClear();

    renderPanel({ workspaceId: WORKSPACE_B, awardId: AWARD_B, awardTitle: "Bridge rehabilitation award" });
    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const urlB = requestedUrl();
    expect(urlB).toContain(`/api/funding-awards/${AWARD_B}/drawdown-worksheet`);
    expect(urlB).toContain(`workspaceId=${WORKSPACE_B}`);
    expect(urlB).not.toContain(AWARD_A);
    expect(urlB).not.toContain(WORKSPACE_A);
  });

  it("sends the period bounds a planner typed, and only the ones they typed", async () => {
    fetchMock.mockResolvedValue(pdfResponse("reimbursement-worksheet-corridor.pdf"));

    renderPanel({ workspaceId: WORKSPACE_A, awardId: AWARD_A, awardTitle: "Corridor construction award" });

    fireEvent.change(screen.getByLabelText(/costs from/i), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = requestedUrl();
    expect(url).toContain("periodStart=2026-04-01");
    // The end bound was left empty and must not be sent as one. An empty
    // `periodEnd` would fail the route's ISO-date schema and turn an open-ended
    // period into a 400.
    expect(url).not.toContain("periodEnd");
  });

  it("shows the route's own refusal instead of writing a worksheet of zeros", async () => {
    // The 503 the route answers when the invoice register has not been migrated
    // onto this deployment. The whole point of that refusal is that a packet
    // reading "$0 claimed against a $250,000 award" is a database outage
    // wearing the clothes of a financial fact — so the planner must see the
    // sentence, and no file may be produced.
    const message =
      "The invoice register is not available on this deployment yet, so no worksheet can be produced.";
    fetchMock.mockResolvedValue(refusal(503, message));

    renderPanel({ workspaceId: WORKSPACE_A, awardId: AWARD_A, awardTitle: "Corridor construction award" });

    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(createdObjectUrls).toBe(0);
    // Nothing on the surface may claim a zero position while the read is broken.
    expect(alert.textContent ?? "").not.toMatch(/\$0/);
  });

  it("does not swallow a permission refusal into a generic failure", async () => {
    fetchMock.mockResolvedValue(refusal(403, "Workspace access denied"));

    renderPanel({ workspaceId: WORKSPACE_A, awardId: AWARD_A, awardTitle: "Corridor construction award" });
    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace access denied");
    expect(createdObjectUrls).toBe(0);
  });

  it("reports a transport failure rather than appearing to have downloaded something", async () => {
    fetchMock.mockRejectedValue(new Error("Network request failed"));

    renderPanel({ workspaceId: WORKSPACE_A, awardId: AWARD_A, awardTitle: "Corridor construction award" });
    fireEvent.click(screen.getByRole("button", { name: /download worksheet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Network request failed/);
    expect(createdObjectUrls).toBe(0);
  });
});

describe("the saved filename comes from the route, not from a second guess at it", () => {
  it("reads the filename the route asked for", () => {
    expect(
      worksheetFilenameFromDisposition('attachment; filename="reimbursement-worksheet-corridor.pdf"')
    ).toBe("reimbursement-worksheet-corridor.pdf");
    expect(worksheetFilenameFromDisposition("attachment; filename=worksheet.pdf")).toBe("worksheet.pdf");
  });

  it("refuses a header that tries to name a path rather than a file", () => {
    // A response header is not a trusted source for a save target.
    expect(worksheetFilenameFromDisposition('attachment; filename="../../etc/passwd"')).toBeNull();
    expect(worksheetFilenameFromDisposition('attachment; filename="a\\b.pdf"')).toBeNull();
  });

  it("returns null when the route named nothing, so the caller can fall back", () => {
    expect(worksheetFilenameFromDisposition(null)).toBeNull();
    expect(worksheetFilenameFromDisposition("attachment")).toBeNull();
  });
});
