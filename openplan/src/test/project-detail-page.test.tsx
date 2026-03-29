import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();

const projectSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ single: projectSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const workspaceSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ single: workspaceSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const reportsLimitMock = vi.fn();
const reportsOrderMock = vi.fn(() => ({ limit: reportsLimitMock }));
const reportsEqMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock }));

const stageGateLimitMock = vi.fn();
const stageGateOrderMock = vi.fn(() => ({ limit: stageGateLimitMock }));
const stageGateEqMock = vi.fn(() => ({ order: stageGateOrderMock }));
const stageGateSelectMock = vi.fn(() => ({ eq: stageGateEqMock }));

const milestonesLimitMock = vi.fn();
const milestonesOrderMock = vi.fn(() => ({ limit: milestonesLimitMock }));
const milestonesEqMock = vi.fn(() => ({ order: milestonesOrderMock }));
const milestonesSelectMock = vi.fn(() => ({ eq: milestonesEqMock }));

const submittalsLimitMock = vi.fn();
const submittalsOrderMock = vi.fn(() => ({ limit: submittalsLimitMock }));
const submittalsEqMock = vi.fn(() => ({ order: submittalsOrderMock }));
const submittalsSelectMock = vi.fn(() => ({ eq: submittalsEqMock }));

const deliverablesLimitMock = vi.fn();
const deliverablesOrderMock = vi.fn(() => ({ limit: deliverablesLimitMock }));
const deliverablesEqMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqMock }));

const risksLimitMock = vi.fn();
const risksOrderMock = vi.fn(() => ({ limit: risksLimitMock }));
const risksEqMock = vi.fn(() => ({ order: risksOrderMock }));
const risksSelectMock = vi.fn(() => ({ eq: risksEqMock }));

const issuesLimitMock = vi.fn();
const issuesOrderMock = vi.fn(() => ({ limit: issuesLimitMock }));
const issuesEqMock = vi.fn(() => ({ order: issuesOrderMock }));
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
const decisionsEqMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqMock }));

const meetingsLimitMock = vi.fn();
const meetingsOrderMock = vi.fn(() => ({ limit: meetingsLimitMock }));
const meetingsEqMock = vi.fn(() => ({ order: meetingsOrderMock }));
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqMock }));

const invoicesLimitMock = vi.fn();
const invoicesOrderMock = vi.fn(() => ({ limit: invoicesLimitMock }));
const invoicesEqMock = vi.fn(() => ({ order: invoicesOrderMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqMock }));

const datasetLinksOrderMock = vi.fn();
const datasetLinksEqMock = vi.fn(() => ({ order: datasetLinksOrderMock }));
const datasetLinksSelectMock = vi.fn(() => ({ eq: datasetLinksEqMock }));

const buildProjectControlsSummaryMock = vi.fn();
const summarizeBillingInvoiceRecordsMock = vi.fn();
const buildProjectStageGateSummaryMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "stage_gate_decisions") {
    return { select: stageGateSelectMock };
  }
  if (table === "project_milestones") {
    return { select: milestonesSelectMock };
  }
  if (table === "project_submittals") {
    return { select: submittalsSelectMock };
  }
  if (table === "project_deliverables") {
    return { select: deliverablesSelectMock };
  }
  if (table === "project_risks") {
    return { select: risksSelectMock };
  }
  if (table === "project_issues") {
    return { select: issuesSelectMock };
  }
  if (table === "project_decisions") {
    return { select: decisionsSelectMock };
  }
  if (table === "project_meetings") {
    return { select: meetingsSelectMock };
  }
  if (table === "billing_invoice_records") {
    return { select: invoicesSelectMock };
  }
  if (table === "data_dataset_project_links") {
    return { select: datasetLinksSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/components/projects/project-record-composer", () => ({
  ProjectRecordComposer: () => <div data-testid="project-record-composer" />,
}));

vi.mock("@/lib/projects/controls", () => ({
  buildProjectControlsSummary: (...args: unknown[]) => buildProjectControlsSummaryMock(...args),
}));

vi.mock("@/lib/billing/invoice-records", () => ({
  summarizeBillingInvoiceRecords: (...args: unknown[]) => summarizeBillingInvoiceRecordsMock(...args),
}));

vi.mock("@/lib/stage-gates/summary", () => ({
  buildProjectStageGateSummary: (...args: unknown[]) => buildProjectStageGateSummaryMock(...args),
}));

import ProjectDetailPage from "@/app/(app)/projects/[projectId]/page";

async function renderPage() {
  render(
    await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    })
  );
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    projectSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
      error: null,
    });

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
        slug: "openplan-qa",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        created_at: "2026-03-28T18:00:00.000Z",
      },
      error: null,
    });

    runsLimitMock.mockResolvedValue({ data: [], error: null });
    stageGateLimitMock.mockResolvedValue({ data: [], error: null });
    milestonesLimitMock.mockResolvedValue({ data: [], error: null });
    submittalsLimitMock.mockResolvedValue({ data: [], error: null });
    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });
    invoicesLimitMock.mockResolvedValue({ data: [], error: null });
    datasetLinksOrderMock.mockResolvedValue({ data: [], error: null });

    reportsLimitMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Packet with corridor safety recommendations.",
          report_type: "project_status",
          status: "generated",
          updated_at: "2026-03-28T21:10:00.000Z",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          title: "Board Packet",
          summary: null,
          report_type: "board_packet",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      count: 2,
      error: null,
    });

    buildProjectControlsSummaryMock.mockReturnValue({
      controlHealth: "attention",
      milestoneCount: 0,
      completedMilestoneCount: 0,
      blockedMilestoneCount: 0,
      pendingSubmittalCount: 0,
      overdueSubmittalCount: 0,
      overdueMilestoneCount: 0,
      nextMilestone: null,
      nextSubmittal: null,
    });

    summarizeBillingInvoiceRecordsMock.mockReturnValue({
      outstandingNetAmount: 0,
      submittedCount: 0,
      totalCount: 0,
      paidNetAmount: 0,
      overdueCount: 0,
      totalNetAmount: 0,
    });

    buildProjectStageGateSummaryMock.mockReturnValue({
      passCount: 0,
      holdCount: 0,
      notStartedCount: 0,
      nextGate: null,
      blockedGate: null,
      gates: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces project-linked report freshness guidance", async () => {
    await renderPage();

    expect(screen.getByText(/Packet freshness and regeneration cues/i)).toBeInTheDocument();
    expect(screen.getByText(/Downtown Safety Packet needs attention/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Next action: open this report and regenerate the packet\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 most recent report records/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open report$/i })).toHaveAttribute(
      "href",
      "/reports/report-1"
    );
  });

  it("shows an empty reporting state when no reports are linked", async () => {
    reportsLimitMock.mockResolvedValueOnce({ data: [], count: 0, error: null });

    await renderPage();

    expect(
      screen.getByText(/No report records linked to this project yet\./i)
    ).toBeInTheDocument();
  });
});
