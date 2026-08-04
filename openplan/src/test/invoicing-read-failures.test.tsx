import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER — reimbursement lane.
 *
 * `const { data } = await supabase…` hands back `null` for both "there is
 * nothing here" and "this query failed", so the empty-state sentence written
 * for the first case states the second one as fact. On THIS module the false
 * sentences are about money: "No invoice records recorded yet for this
 * workspace" and a $0.00 outstanding balance, told to an agency that may be
 * owed hundreds of thousands of dollars by its funder under a Caltrans LAPM
 * grant reimbursement. (This is the agency invoicing ITS FUNDER — it is not
 * billing for OpenPlan, which is free.)
 *
 * Every test below drives the REAL component with a REAL Supabase call shape.
 * Nothing here stubs the loader, because a test that doubles the loader tests
 * the renderer.
 *
 * THE THIRD CASE IS THE POINT. Disclosure only means something if the ordinary
 * empty state still appears when the read SUCCEEDS and there genuinely is
 * nothing — otherwise a page that always shows a warning would pass.
 */

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

// workspace_members: .select(...).eq("user_id", ...)
const membersEqMock = vi.fn();
const membersSelectMock = vi.fn(() => ({ eq: membersEqMock }));

// workspaces: .select(...).eq("id", ...).maybeSingle()
const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

// projects: .select(...).eq("workspace_id", ...).order(...)
const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

// funding_awards: .select(...).eq("workspace_id", ...).order(...)
const fundingAwardsOrderMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

// billing_invoice_records: .select(...).eq("workspace_id", ...).order(...).limit(...)
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
  redirect: (...args: unknown[]) => redirectMock(...args),
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

import InvoicingPage from "@/app/(app)/invoicing/page";
import { ReimbursementLane } from "@/app/(app)/invoicing/_components/reimbursement-lane";

const INVOICE_ROW = {
  id: "invoice-1",
  project_id: "project-1",
  funding_award_id: "award-1",
  invoice_number: "INV-2026-004",
  consultant_name: "Corridor Studio",
  billing_basis: "time_and_materials",
  status: "submitted",
  invoice_date: "2026-06-01",
  due_date: "2026-07-01",
  amount: 250000,
  retention_percent: 5,
  retention_amount: 12500,
  net_amount: 237500,
  supporting_docs_status: "complete",
  submitted_to: "State reimbursement office",
  caltrans_posture: "lapm_conformed",
  reimbursement_profile_id: null,
  reimbursement_posture: null,
  reimbursement_profile_selection: null,
  notes: null,
  created_at: "2026-06-01T12:00:00.000Z",
  funding_awards: { id: "award-1", title: "Corridor safety award" },
};

async function renderLane() {
  render(
    await ReimbursementLane({
      workspaceId: "workspace-1",
      canWriteInvoices: true,
      resolvedParams: {},
    })
  );
}

describe("the reimbursement lane does not render a failed read as an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
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
      data: [{ id: "project-1", name: "Main Street corridor", status: "active", delivery_phase: null }],
      error: null,
    });
    fundingAwardsOrderMock.mockResolvedValue({
      data: [{ id: "award-1", project_id: "project-1", title: "Corridor safety award" }],
      error: null,
    });
    invoicesLimitMock.mockResolvedValue({ data: [INVOICE_ROW], error: null });
  });

  it("still says the register is empty when the read SUCCEEDS and there genuinely are no invoices", async () => {
    invoicesLimitMock.mockResolvedValueOnce({ data: [], error: null });

    await renderLane();

    expect(
      screen.getAllByText(/No invoice records recorded yet for this workspace/i).length
    ).toBeGreaterThan(0);
    // Nothing failed, so nothing is disclosed. Without this assertion the two
    // tests below could not tell disclosure from a lane that always warns.
    expect(
      screen.queryAllByText(/Part of this reimbursement lane could not be read/i)
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(/The invoice register could not be read/i)
    ).toHaveLength(0);
  });

  it("does not answer 'no invoice records recorded yet' when the register read FAILED", async () => {
    invoicesLimitMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "billing_invoice_records"' },
    });

    await renderLane();

    // (a) the false absence is gone. So is the $0.00 register position beside
    // it: an unread register has no total, and rendering one as zero tells an
    // agency it has claimed nothing from its funder.
    expect(
      screen.queryAllByText(/No invoice records recorded yet for this workspace/i)
    ).toHaveLength(0);
    expect(screen.queryAllByText(/Net requested/i)).toHaveLength(0);
    expect(screen.queryAllByText(/^Outstanding$/i)).toHaveLength(0);

    // (b) the failure is disclosed by name, and said plainly to be a failed
    // read rather than a finding about what this workspace is owed. Internal
    // page, so the database's own message is shown to the person who can act.
    expect(
      screen.getAllByText(/Part of this reimbursement lane could not be read/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/this workspace's reimbursement invoice register/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permission denied for table "billing_invoice_records"/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/not a finding that this workspace has no reimbursement invoices/i).length
    ).toBeGreaterThan(0);
  });

  it("keeps the pending-schema classification, which has a truer thing to say", async () => {
    // Classify first, collect what is left: "apply the migration" is a better
    // answer than "could not be read", and it must not be swallowed by the
    // generic disclosure.
    // Twice: a pending-schema error makes the lane retry with the legacy
    // projection (for deployments missing only the profile columns), and the
    // retry is the result the pending branch is decided on.
    invoicesLimitMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "billing_invoice_records" does not exist' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "billing_invoice_records" does not exist' },
      });

    await renderLane();

    expect(
      screen.getAllByText(/Invoice register tables are pending in the current database/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(/No invoice records recorded yet for this workspace/i)
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(/this workspace's reimbursement invoice register/i)
    ).toHaveLength(0);
  });

  it("discloses a failed funding-award read rather than presenting no awards", async () => {
    fundingAwardsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "funding_awards"' },
    });

    await renderLane();

    expect(
      screen.getAllByText(/this workspace's funding awards/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permission denied for table "funding_awards"/i).length
    ).toBeGreaterThan(0);
  });
});

describe("the invoicing page does not render a failed membership read as an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("still says no membership was found when the read SUCCEEDS and there genuinely is none", async () => {
    membersEqMock.mockResolvedValueOnce({ data: [], error: null });

    render(await InvoicingPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getAllByText(/no workspace membership was found for this account/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(/Your workspace memberships could not be read/i)
    ).toHaveLength(0);
  });

  it("does not answer 'no workspace membership was found' when the read FAILED", async () => {
    membersEqMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "workspace_members"' },
    });

    render(await InvoicingPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.queryAllByText(/no workspace membership was found for this account/i)
    ).toHaveLength(0);
    expect(
      screen.getAllByText(/Your workspace memberships could not be read/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permission denied for table "workspace_members"/i).length
    ).toBeGreaterThan(0);
  });
});
