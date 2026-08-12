import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CAPTION AND THE FIGURE UNDER IT MUST BE THE SAME CLAIM.
 *
 * The reimbursement lane's "Net requested" tile read:
 *
 *     $244,000.33
 *     All non-rejected invoice records in this workspace register.
 *
 * over a figure that summed `totalNetAmount` — the WHOLE register, rejected
 * claims included. The caption was right about what the number should mean and
 * the number was wrong, which is the worst arrangement of the two: a planner
 * reading the sentence has been told, in writing, that the refused $64,000.00
 * is not in there.
 *
 * This drives the REAL server component through a REAL Supabase call shape.
 * Nothing stubs the summariser — a test that doubles the arithmetic tests the
 * renderer.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const membersEqMock = vi.fn();
const membersSelectMock = vi.fn(() => ({ eq: membersEqMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const fundingAwardsOrderMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

const invoicesLimitMock = vi.fn();
const invoicesOrderMock = vi.fn(() => ({ limit: invoicesLimitMock }));
const invoicesEqMock = vi.fn(() => ({ order: invoicesOrderMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqMock }));

const milestonesInMock = vi.fn(async () => ({ data: [], error: null }));
const milestonesSelectMock = vi.fn(() => ({ in: milestonesInMock }));

const submittalsInMock = vi.fn(async () => ({ data: [], error: null }));
const submittalsSelectMock = vi.fn(() => ({ in: submittalsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") return { select: membersSelectMock };
  if (table === "workspaces") return { select: workspaceSelectMock };
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "funding_awards") return { select: fundingAwardsSelectMock };
  if (table === "billing_invoice_records") return { select: invoicesSelectMock };
  if (table === "project_milestones") return { select: milestonesSelectMock };
  if (table === "project_submittals") return { select: submittalsSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

import { ReimbursementLane } from "@/app/(app)/invoicing/_components/reimbursement-lane";

const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** One row per status that matters, with cents, all linked to one award. */
function invoiceRow(overrides: Record<string, unknown>) {
  return {
    id: "invoice-x",
    project_id: "project-1",
    funding_award_id: AWARD_ID,
    invoice_number: "RB-000",
    consultant_name: "Sierra Counts LLC",
    billing_basis: "time_and_materials",
    status: "submitted",
    invoice_date: "2026-02-20",
    due_date: "2026-12-01",
    amount: "0.00",
    retention_percent: 0,
    retention_amount: 0,
    net_amount: "0.00",
    supporting_docs_status: "complete",
    submitted_to: null,
    caltrans_posture: "lapm_conformed",
    reimbursement_profile_id: null,
    reimbursement_posture: null,
    reimbursement_profile_selection: null,
    notes: null,
    created_at: "2026-02-20T12:00:00.000Z",
    funding_awards: { id: AWARD_ID, title: "Ridge Corridor Safety Improvements" },
    ...overrides,
  };
}

const INVOICE_ROWS = [
  invoiceRow({ id: "invoice-1", invoice_number: "RB-001", status: "paid", amount: "100000.50", net_amount: "100000.50" }),
  invoiceRow({ id: "invoice-2", invoice_number: "RB-002", status: "submitted", amount: "29999.83", net_amount: "29999.83" }),
  invoiceRow({ id: "invoice-3", invoice_number: "RB-003", status: "rejected", amount: "64000.00", net_amount: "64000.00" }),
  invoiceRow({ id: "invoice-4", invoice_number: "RB-004", status: "draft", amount: "50000.00", net_amount: "50000.00" }),
];

async function renderLane() {
  render(
    await ReimbursementLane({
      workspaceId: "workspace-1",
      canWriteInvoices: true,
      resolvedParams: {},
    })
  );
}

describe("the reimbursement lane's 'Net requested' tile", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "under control",
      headline: "Workspace clear",
      detail: "No workspace command pressure in this fixture.",
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
      counts: {},
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: null,
        home_geography_kind: null,
        home_geography_ref: null,
        home_country_code: null,
        home_subdivision_code: null,
      },
      error: null,
    });
    projectsOrderMock.mockResolvedValue({
      data: [{ id: "project-1", name: "Ridge Corridor", status: "active", delivery_phase: null }],
      error: null,
    });
    fundingAwardsOrderMock.mockResolvedValue({
      data: [{ id: AWARD_ID, project_id: "project-1", title: "Ridge Corridor Safety Improvements" }],
      error: null,
    });
    invoicesLimitMock.mockResolvedValue({ data: INVOICE_ROWS, error: null });
  });

  it("shows what was claimed, not what the register totals", async () => {
    await renderLane();

    const label = screen.getByText("Net requested");
    const tile = label.parentElement;
    if (!tile) throw new Error("the Net requested tile has no container");

    // Claimed = paid $100,000.50 + submitted $29,999.83.
    expect(tile.textContent).toContain("$130,000.33");
    // The whole register, which is what the figure used to be.
    expect(tile.textContent).not.toContain("$244,000.33");
  });

  it("says in its caption exactly what it left out, and the amount", async () => {
    await renderLane();

    const tile = screen.getByText("Net requested").parentElement;
    if (!tile) throw new Error("the Net requested tile has no container");

    expect(tile.textContent).toContain("Claimed from funders: in review, submitted, approved, or paid.");
    expect(tile.textContent).toContain("1 draft and 1 rejected record are excluded");
    // An unreported amount is not zero: the refused money is named.
    expect(tile.textContent).toContain("$64,000.00 the funder refused");

    // The sentence that used to sit over a figure contradicting it.
    expect(tile.textContent).not.toContain("All non-rejected invoice records");
  });

  it("the narrative under the filter row quotes the claimed total too", async () => {
    await renderLane();

    const narrative = screen.getByText(/net requested, with/);
    expect(narrative.textContent).toContain("$130,000.33 net requested");
    expect(narrative.textContent).not.toContain("$244,000.33");
  });
});
