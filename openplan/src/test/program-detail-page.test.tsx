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
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const programMaybeSingleMock = vi.fn();
const programEqMock = vi.fn((column: string) => {
  if (column === "id") {
    return { maybeSingle: programMaybeSingleMock };
  }

  if (column === "workspace_id") {
    return { order: workspaceProgramsOrderMock };
  }

  throw new Error(`Unexpected programs eq column: ${column}`);
});
const programSelectMock = vi.fn(() => ({ eq: programEqMock }));

const projectsMaybeSingleMock = vi.fn();
const projectsOrderMock = vi.fn();
const projectsInMock = vi.fn();
const projectsEqMock = vi.fn((column: string) => {
  if (column === "workspace_id") {
    return { order: projectsOrderMock };
  }

  if (column === "id") {
    return { maybeSingle: projectsMaybeSingleMock };
  }

  throw new Error(`Unexpected projects eq column: ${column}`);
});
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock, in: projectsInMock }));

const programLinksEqMock = vi.fn(() => ({ data: [], error: null }));
const programLinksSelectMock = vi.fn(() => ({ eq: programLinksEqMock }));

const plansProjectOrderMock = vi.fn();
const plansWorkspaceOrderMock = vi.fn();
const plansInMock = vi.fn();
const plansEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: plansProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: plansWorkspaceOrderMock };
  }

  throw new Error(`Unexpected plans eq column: ${column}`);
});
const plansSelectMock = vi.fn(() => ({ eq: plansEqMock, in: plansInMock }));

const reportsProjectOrderMock = vi.fn();
const reportsWorkspaceOrderMock = vi.fn();
const reportsInMock = vi.fn();
const reportsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: reportsProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: reportsWorkspaceOrderMock };
  }

  throw new Error(`Unexpected reports eq column: ${column}`);
});
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock, in: reportsInMock }));

const campaignsProjectOrderMock = vi.fn();
const campaignsWorkspaceOrderMock = vi.fn();
const campaignsInMock = vi.fn();
const campaignsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: campaignsProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: campaignsWorkspaceOrderMock };
  }

  throw new Error(`Unexpected engagement_campaigns eq column: ${column}`);
});
const campaignsSelectMock = vi.fn(() => ({ eq: campaignsEqMock, in: campaignsInMock }));

const fundingOpportunitiesProgramOrderMock = vi.fn();
const fundingOpportunitiesWorkspaceOrderMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn((column: string) => {
  if (column === "program_id") {
    return { order: fundingOpportunitiesProgramOrderMock };
  }

  if (column === "workspace_id") {
    return { order: fundingOpportunitiesWorkspaceOrderMock };
  }

  throw new Error(`Unexpected funding_opportunities eq column: ${column}`);
});
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const workspaceProgramsOrderMock = vi.fn();
const projectFundingProfilesEqMock = vi.fn();
const projectFundingProfilesSelectMock = vi.fn(() => ({ eq: projectFundingProfilesEqMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const modelsProjectOrderMock = vi.fn();
const modelsInMock = vi.fn();
const modelsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: modelsProjectOrderMock };
  }

  throw new Error(`Unexpected models eq column: ${column}`);
});
const modelsSelectMock = vi.fn(() => ({ eq: modelsEqMock, in: modelsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "programs") {
    return { select: programSelectMock };
  }
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "program_links") {
    return { select: programLinksSelectMock };
  }
  if (table === "plans") {
    return { select: plansSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "engagement_campaigns") {
    return { select: campaignsSelectMock };
  }
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: projectFundingProfilesSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  if (table === "models") {
    return { select: modelsSelectMock };
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

vi.mock("@/components/programs/program-detail-controls", () => ({
  ProgramDetailControls: () => <div data-testid="program-detail-controls" />,
}));

vi.mock("@/components/programs/funding-opportunity-creator", () => ({
  FundingOpportunityCreator: () => <div data-testid="funding-opportunity-creator" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import ProgramDetailPage from "@/app/(app)/programs/[programId]/page";

async function renderPage() {
  render(
    await ProgramDetailPage({
      params: Promise.resolve({ programId: "program-1" }),
    })
  );
}

describe("ProgramDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    programMaybeSingleMock.mockResolvedValue({
      data: {
        id: "program-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "2027 RTIP",
        program_type: "rtip",
        status: "assembling",
        cycle_name: "2027 RTIP",
        funding_classification: "capital",
        sponsor_agency: "County",
        owner_label: "Planner",
        cadence_label: "Quarterly",
        fiscal_year_start: 2027,
        fiscal_year_end: 2029,
        nomination_due_at: null,
        adoption_target_at: null,
        summary: "Programming cycle for capital projects.",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
      error: null,
    });

    projectsOrderMock.mockResolvedValue({
      data: [{ id: "project-1", name: "Downtown Mobility Plan" }],
      error: null,
    });

    projectsMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T20:00:00.000Z",
      },
      error: null,
    });

    plansProjectOrderMock.mockResolvedValue({ data: [], error: null });
    plansWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    reportsProjectOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Programming Packet",
          report_type: "board_packet",
          status: "generated",
          summary: "Packet with programming recommendations.",
          generated_at: null,
          latest_artifact_kind: "html",
          updated_at: "2026-03-28T21:10:00.000Z",
        },
      ],
      error: null,
    });
    reportsWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    campaignsProjectOrderMock.mockResolvedValue({ data: [], error: null });
    campaignsWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    fundingOpportunitiesProgramOrderMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    workspaceProgramsOrderMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfilesEqMock.mockResolvedValue({ data: [], error: null });

    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
        },
      ],
      error: null,
    });

    modelsProjectOrderMock.mockResolvedValue({ data: [], error: null });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps artifact-backed linked reports in refresh posture when report generated_at is null", async () => {
    await renderPage();

    const reportLinks = screen.getAllByRole("link");
    expect(
      reportLinks.some((link) => link.getAttribute("href") === "/reports/report-1#drift-since-generation")
    ).toBe(true);
    expect(screen.getAllByText("Refresh recommended").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Not generated$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Generated .*2026/i)).toBeInTheDocument();
  });
});
