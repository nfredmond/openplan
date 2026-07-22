import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();
const canReviewAccessRequestsMock = vi.fn();

const actionLimitMock = vi.fn();
const actionOrderMock = vi.fn(() => ({ limit: actionLimitMock }));
const actionEqMock = vi.fn(() => ({ order: actionOrderMock }));
const actionSelectMock = vi.fn(() => ({ eq: actionEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "assistant_action_executions") {
    return { select: actionSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
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

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/access-requests", async () => {
  const actual = await vi.importActual<typeof import("@/lib/access-requests")>("@/lib/access-requests");
  return {
    ...actual,
    canReviewAccessRequests: (...args: unknown[]) => canReviewAccessRequestsMock(...args),
  };
});

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

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: ({ children }: { children?: ReactNode }) => (
    <div>
      <div data-testid="workspace-command-board" />
      {children}
    </div>
  ),
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

import CommandCenterPage from "@/app/(app)/command-center/page";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";


const riskyCommandCenterClaimFragments = [
  /self-serve launch/i,
  /certified forecast/i,
  /automatic activation path/i,
  /completed compliance determination/i,
  /run checkout/i,
  /instant activation/i,
  /self-serve activation/i,
] as const;

const allowedRiskContextPattern = /do not say|does not|stop if|no production writes|not production|not a broader|not new|not instant|supervised|boundary|caveat|sample context/i;

function expectRiskyCommandCenterClaimsOnlyInWarningContext() {
  const statements = (document.body.textContent ?? "")
    .split(/[\n.]/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const pattern of riskyCommandCenterClaimFragments) {
    const matches = statements.filter((statement) => pattern.test(statement));
    expect(matches.length, `${pattern} should remain present as warning/boundary copy`).toBeGreaterThan(0);
    for (const statement of matches) {
      expect(
        allowedRiskContextPattern.test(statement),
        `Risky claim appears without warning context: ${statement}`,
      ).toBe(true);
    }
  }
}

const summary: WorkspaceOperationsSummary = {
  posture: "attention",
  headline: "Run release review on current packets",
  detail: "A current RTP packet still carries linked-project funding follow-up.",
  counts: {
    projects: 1,
    activeProjects: 1,
    plans: 0,
    plansNeedingSetup: 0,
    programs: 0,
    activePrograms: 0,
    reports: 1,
    reportRefreshRecommended: 0,
    reportNoPacket: 0,
    reportPacketCurrent: 1,
    rtpFundingReviewPackets: 1,
    comparisonBackedReports: 0,
    fundingOpportunities: 1,
    openFundingOpportunities: 1,
    closingSoonFundingOpportunities: 0,
    overdueDecisionFundingOpportunities: 0,
    projectFundingNeedAnchorProjects: 0,
    projectFundingSourcingProjects: 0,
    projectFundingDecisionProjects: 0,
    projectFundingAwardRecordProjects: 0,
    projectFundingReimbursementStartProjects: 0,
    projectFundingReimbursementActiveProjects: 0,
    projectFundingGapProjects: 0,
    queueDepth: 1,
    aerialMissions: 0,
    aerialActiveMissions: 0,
    aerialReadyPackages: 0,
  },
  nextCommand: {
    key: "review-current-report-packets",
    moduleKey: "grants",
    moduleLabel: "Grants OS",
    title: "Run release review on current packets",
    detail: "1 current RTP packet still carries funding follow-up from linked projects.",
    href: "/grants#grants-gap-resolution-lane",
    tone: "warning",
    priority: 2.5,
    badges: [
      { label: "Current", value: 1 },
      { label: "Funding review", value: 1 },
    ],
  },
  commandQueue: [],
  fullCommandQueue: [],
};

describe("CommandCenterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: "workspace-1",
        role: "owner",
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue(summary);
    canReviewAccessRequestsMock.mockReturnValue(true);

    actionLimitMock.mockResolvedValue({
      data: [
        {
          id: "action-1",
          action_kind: "generate_report_artifact",
          audit_event: "planner_agent.generate_report_artifact",
          approval: "safe",
          regrounding: "refresh_preview",
          outcome: "succeeded",
          error_message: null,
          input_summary: {
            reportId: "report-1234567890",
            artifactId: "artifact-1234567890",
            linkedRunCount: 1,
          },
          started_at: "2026-04-20T07:00:00.000Z",
          completed_at: "2026-04-20T07:01:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("shows operational surfaces and operator buyer-demo scaffolding for operators", async () => {
    render(await CommandCenterPage());

    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-runtime-cue")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-command-board")).toBeInTheDocument();
    expect(screen.getByText("Release proof packet")).toBeInTheDocument();
    expect(screen.getAllByText(/No fresh same-cycle paid canary is claimed/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText("Recent audited operator actions")).toBeInTheDocument();
    expect(screen.getByText("Generate Report Artifact")).toBeInTheDocument();
    expect(screen.getByText("planner_agent.generate_report_artifact")).toBeInTheDocument();
    expect(screen.getByText(/report report-1/i)).toBeInTheDocument();
    expect(screen.getByText(/1 linked run/i)).toBeInTheDocument();
    expect(screen.getByText("Read-only sample cue")).toBeInTheDocument();
    expect(screen.getByText("Demo story without changing this workspace")).toBeInTheDocument();
    expect(screen.getByText(/does not seed data, run checkout, provision accounts, or write production records/i)).toBeInTheDocument();
    expect(screen.getByText("Nevada County")).toBeInTheDocument();
    expect(screen.getByText("internal prototype only")).toBeInTheDocument();
    expect(screen.getAllByText(/237\.62% Max APE/i).length).toBeGreaterThan(0);
    expect(screen.getByText("docs/ops/2026-04-18-modeling-nevada-county-live-proof.md")).toBeInTheDocument();
    expect(screen.getByText("Sample story beats")).toBeInTheDocument();
    expect(screen.getByText("Grass Valley corridor screening")).toBeInTheDocument();
    expect(screen.getByText(/not a full regional travel model or adopted RTP finding/i)).toBeInTheDocument();
    expect(screen.getByText("Max APE blocks stronger claims")).toBeInTheDocument();
    expect(screen.getByText(/prevents outward forecasting language/i)).toBeInTheDocument();
    expect(screen.getByText("Scope the first supervised workflow")).toBeInTheDocument();
    expect(screen.getByText(/what geography, data owner, review path, and hosting model/i)).toBeInTheDocument();
    expect(screen.getByText("Rural screening evidence table")).toBeInTheDocument();
    expect(screen.getByText(/sample screening evidence from the static Nevada County proof catalog/i)).toBeInTheDocument();
    expect(screen.getByText(/useful for explanation but not valid for outward forecasting claims/i)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Station" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Observed" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Modeled daily PCE" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Obs rank" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Mod rank" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "SR 20 at Jct Rte 49" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "SR 174 at Brunswick Rd" })).toBeInTheDocument();
    expect(screen.getByText("73,666")).toBeInTheDocument();
    expect(screen.getByText("34,775")).toBeInTheDocument();
    expect(screen.getByText("Demo narration rail")).toBeInTheDocument();
    expect(screen.getByText("Start with the proof boundary")).toBeInTheDocument();
    expect(screen.getByText(/does not alter the buyer workspace or create operational records/i)).toBeInTheDocument();
    expect(screen.getByText("Explain the validation gate")).toBeInTheDocument();
    expect(screen.getByText(/failed validation blocks stronger forecasting claims/i)).toBeInTheDocument();
    expect(screen.getByText("Show caveat-preserving evidence")).toBeInTheDocument();
    expect(screen.getByText(/carries uncomfortable evidence forward instead of smoothing it away/i)).toBeInTheDocument();
    expect(screen.getByText("Open the public evidence catalog")).toBeInTheDocument();
    expect(screen.getByText(/completed artifacts as proof posture rather than a sales promise/i)).toBeInTheDocument();
    expect(screen.getByText("What to say / what not to say")).toBeInTheDocument();
    expect(screen.getByText(/supervised, proof-first planning workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/not say: this is a self-serve launch/i)).toBeInTheDocument();
    expect(screen.getByText("Caveats to say out loud")).toBeInTheDocument();
    expect(screen.getByText(/screening-grade only/i)).toBeInTheDocument();
    expect(screen.getByText(/OSM default speeds\/capacities/i)).toBeInTheDocument();
    expect(screen.getByText(/tract fragments are not calibrated TAZs/i)).toBeInTheDocument();
    expect(screen.getByText(/jobs are estimated from tract-scale demographic proxies/i)).toBeInTheDocument();
    expect(screen.getByText(/external gateways are inferred from major boundary-crossing roads/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open public evidence catalog/i })).toHaveAttribute("href", "/examples");
    expect(document.body).not.toHaveTextContent(/validated forecast/i);
    expect(document.body).not.toHaveTextContent(/live run/i);
    expect(document.body).not.toHaveTextContent(/production data seeded/i);
    expect(document.body).not.toHaveTextContent(/automatic workspace provisioning/i);
    expect(document.body).not.toHaveTextContent(/instant customer activation/i);
    expect(screen.getByText("Demo rehearsal checklist")).toBeInTheDocument();
    expect(screen.getByText("Operator readiness before the buyer sees anything")).toBeInTheDocument();
    expect(screen.getByText("1. Run live-read preflight")).toBeInTheDocument();
    expect(screen.getByText(/read any attention items before speaking/i)).toBeInTheDocument();
    expect(screen.getByText("2. Open proof packet")).toBeInTheDocument();
    expect(screen.getByText(/keep the caveat sheet attached/i)).toBeInTheDocument();
    expect(screen.getByText("3. Rehearse caveats out loud")).toBeInTheDocument();
    expect(screen.getByText(/screening evidence rather than production model validation/i)).toBeInTheDocument();
    expect(screen.getByText("4. Open examples after the boundary")).toBeInTheDocument();
    expect(screen.getByText(/instant activation, checkout, provisioning, or current runtime proof/i)).toBeInTheDocument();
    expect(screen.getByText("Buyer demo handoff")).toBeInTheDocument();
    expect(screen.getByText(/verify the proof packet first, then review supervised intake and examples before presenting/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the buyer intake/i })).toHaveAttribute("href", "/request-access");
    expect(screen.getByRole("link", { name: /Review access queue/i })).toHaveAttribute("href", "/admin/operations");
    expect(screen.getByRole("link", { name: /Confirm pilot readiness/i })).toHaveAttribute(
      "href",
      "/admin/pilot-readiness"
    );
    expect(screen.getByText("Final pre-demo check")).toBeInTheDocument();
    expect(screen.getByText("npm run ops:check-buyer-demo-preflight -- --live-reads")).toBeInTheDocument();
    expect(screen.getByText("docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md")).toBeInTheDocument();
    expect(screen.getByText("90-second opening script")).toBeInTheDocument();
    expect(screen.getByText(/Apache-2.0 open-source planning software/i)).toBeInTheDocument();
    expect(screen.getByText(/the claim, evidence, and caveat stay together/i)).toBeInTheDocument();
    expect(screen.getByText(/the 237\.62% Max APE means we treat it as screening evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/not production model validation/i)).toBeInTheDocument();
    expect(screen.getByText(/scope one supervised first workflow: geography, data owner, review owner, hosting lane/i)).toBeInTheDocument();
    expect(screen.getByText("docs/sales/2026-05-17-openplan-90-second-buyer-demo-talk-track.md")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /Buyer demo proof sequence/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1\. Readiness packet/i })).toHaveAttribute("href", "/admin/pilot-readiness");
    expect(screen.getByRole("link", { name: /2\. Request access/i })).toHaveAttribute("href", "/request-access");
    expect(screen.getByRole("link", { name: /3\. Examples/i })).toHaveAttribute("href", "/examples");
    expect(screen.getByText("Handoff boundary:")).toBeInTheDocument();
    expect(screen.getByText(/No production writes, provisioning, outbound email, checkout, or self-serve activation/i)).toBeInTheDocument();
    expect(screen.getByText("Stop rule:")).toBeInTheDocument();
    expect(screen.getByText(/Stop the demo if live-read preflight reports unresolved attention/i)).toBeInTheDocument();
    expect(screen.getByText(/current production health and Vercel read posture/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open buyer evidence brief/i })).toHaveAttribute(
      "href",
      "/examples#nevada-county-buyer-evidence-brief",
    );
    expectRiskyCommandCenterClaimsOnlyInWarningContext();
    expect(actionEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(actionOrderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(actionLimitMock).toHaveBeenCalledWith(8);
  });

  it("keeps the activity lane visible before any audited actions run", async () => {
    actionLimitMock.mockResolvedValueOnce({ data: [], error: null });

    render(await CommandCenterPage());

    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText(/No audited operator actions have run in this workspace yet/i)).toBeInTheDocument();
  });

  it("hides the buyer-demo / sales scaffolding for non-operators", async () => {
    canReviewAccessRequestsMock.mockReturnValue(false);

    render(await CommandCenterPage());

    // Operational cross-domain content stays visible for every workspace member.
    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-runtime-cue")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-command-board")).toBeInTheDocument();
    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText("Jump into a lane")).toBeInTheDocument();

    // Buyer-demo / sales rehearsal scaffolding is operator-only and hidden here.
    expect(screen.queryByText("Demo rehearsal checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only sample cue")).not.toBeInTheDocument();
    expect(screen.queryByText("Buyer demo handoff")).not.toBeInTheDocument();
    expect(screen.queryByText("90-second opening script")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Nevada County/i);
  });
});
