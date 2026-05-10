import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSpineCrosslinkBoard } from "@/app/(app)/projects/[projectId]/_components/project-spine-crosslink-board";
import { buildProjectSpineCrosslinkSummary, type ProjectSpineCrosslinkInput } from "@/lib/projects/project-spine-crosslinks";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const emptyInput: ProjectSpineCrosslinkInput = {
  projectId: "project-1",
  linkedRtpCycleCount: 0,
  reportRecordCount: 0,
  reportAttentionCount: 0,
  evidenceBackedReportCount: 0,
  comparisonBackedReportCount: 0,
  rtpLinks: {
    constrainedCount: 0,
    illustrativeCount: 0,
    candidateCount: 0,
  },
  scenarios: {
    scenarioSetCount: 0,
    activeScenarioSetCount: 0,
    baselineCount: 0,
    readyAlternativeCount: 0,
    attachedRunCount: 0,
  },
  funding: {
    hasTargetNeed: false,
    label: "Funding target missing",
    reason: "Add a funding need before treating the project as grant-ready.",
    awardCount: 0,
    opportunityCount: 0,
    reimbursementPacketCount: 0,
    unfundedAfterLikelyAmount: 0,
    awardRiskCount: 0,
  },
  engagement: {
    label: "Not linked",
    itemCount: 0,
    handoffReadyCount: 0,
  },
  analysis: {
    recentRunCount: 0,
    comparisonBackedReportCount: 0,
  },
  aerial: {
    missionCount: 0,
    activeMissionCount: 0,
    readyPackageCount: 0,
    verificationReadiness: "none",
  },
};

describe("ProjectSpineCrosslinkBoard", () => {
  it("renders an operator empty state without hiding row-level next actions", () => {
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Empty state")).toBeInTheDocument();
    expect(screen.getByText(/No downstream outputs are linked yet/i)).toBeInTheDocument();
    expect(screen.getByText(/clean setup queue, not a broken board/i)).toBeInTheDocument();
    expect(screen.getByText("Phase 1 shared spine proof")).toHaveAttribute("href", "/admin/pilot-readiness");
    expect(screen.getAllByText("docs/ops/2026-05-02-openplan-local-spine-smoke.md").length).toBeGreaterThan(0);
    expect(screen.getByText(/this empty project still needs its own scoped acceptance rerun/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Attach this project to the right RTP cycle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("No evidence yet").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Readiness proof to check/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/RTP\/report workflow smoke/i).length).toBeGreaterThan(0);
  });

  it("renders schema fallback rows as setup work instead of missing data", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...emptyInput,
      pendingSchema: {
        scenario_sets: true,
        aerial_evidence: true,
      },
    });

    render(<ProjectSpineCrosslinkBoard summary={summary} />);

    expect(screen.getByText("Setup fallback")).toBeInTheDocument();
    expect(screen.getByText(/Some spine lanes are waiting on schema setup/i)).toBeInTheDocument();
    expect(screen.getByText("Migration inventory preflight proof")).toHaveAttribute("href", "/admin/pilot-readiness");
    expect(screen.getByText("docs/ops/2026-05-10-openplan-migration-inventory-preflight-proof.md")).toBeInTheDocument();
    expect(screen.getAllByText("Schema setup pending")).toHaveLength(2);
    expect(screen.getAllByText("Setup needed")).toHaveLength(2);
    expect(screen.getAllByText(/did not treat this as missing evidence/i)).toHaveLength(2);
    expect(screen.getAllByText(/Apply the scenario spine tables/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("setup").length).toBeGreaterThan(0);
  });

  it("keeps a worksurface loading skeleton available for source reads", () => {
    const summary = buildProjectSpineCrosslinkSummary(emptyInput);

    render(<ProjectSpineCrosslinkBoard summary={summary} isLoading />);

    expect(screen.getByText("Loading state")).toBeInTheDocument();
    expect(screen.getByText("Loading crosslink queue")).toBeInTheDocument();
    expect(screen.getByText(/Keep the board visible while source reads finish/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Loading crosslink row")).toHaveLength(6);
  });
});
