import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

const summary: WorkspaceOperationsSummary = {
  posture: "attention",
  headline: "Run Grants follow-through on current packets",
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
      title: "Run Grants follow-through on current packets",
      detail: "1 current RTP packet still carries funding follow-up from linked projects.",
      href: "/grants#grants-gap-resolution-lane",
      tone: "warning",
      priority: 2.5,
      badges: [
      { label: "Current", value: 1 },
      { label: "Funding review", value: 1 },
    ],
  },
  commandQueue: [
    {
      key: "review-current-report-packets",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Run Grants follow-through on current packets",
      detail: "1 current RTP packet still carries funding follow-up from linked projects.",
      href: "/grants#grants-gap-resolution-lane",
      tone: "warning",
      priority: 2.5,
      badges: [
        { label: "Current", value: 1 },
        { label: "Funding review", value: 1 },
      ],
    },
  ],
  fullCommandQueue: [
    {
      key: "review-current-report-packets",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Run Grants follow-through on current packets",
      detail: "1 current RTP packet still carries funding follow-up from linked projects.",
      href: "/grants#grants-gap-resolution-lane",
      tone: "warning",
      priority: 2.5,
      badges: [
        { label: "Current", value: 1 },
        { label: "Funding review", value: 1 },
      ],
    },
  ],
};

describe("WorkspaceCommandBoard", () => {
  it("surfaces funding-backed RTP packet review in shared packet work copy", () => {
    render(<WorkspaceCommandBoard summary={summary} />);

    expect(
      screen.getByText(/1 current RTP packet still needs Grants OS follow-through before packet release review is treated as settled\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 ready for release review, 1 routed through Grants OS\./i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Run Grants follow-through on current packets/i })[0]).toHaveAttribute(
      "href",
      "/grants#grants-gap-resolution-lane"
    );
    expect(screen.getByText("Workflow next-action groups")).toBeInTheDocument();
    expect(screen.getByText("RTP")).toBeInTheDocument();
    expect(screen.getByText("Grants")).toBeInTheDocument();
    expect(screen.getByText("Engagement")).toBeInTheDocument();
    expect(screen.getByText("Analysis / modeling")).toBeInTheDocument();
    expect(screen.getByText("Aerial")).toBeInTheDocument();
    expect(screen.getByText("Admin / release proof")).toBeInTheDocument();
    expect(screen.getByText("Inspect engagement handoff readiness")).toBeInTheDocument();
    expect(screen.getByText(/1 total command · 1 proof-linked action/i)).toBeInTheDocument();
    expect(screen.getByText(/1 queued action · 1 open opportunity · 1 queued check/i)).toBeInTheDocument();
    expect(screen.getByText(/standing check · handoff check/i)).toBeInTheDocument();
    expect(screen.getByText(/Standing check: handoff/i)).toBeInTheDocument();
    expect(screen.getAllByText("Grants OS").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Funding review: 1/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Primary next action")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open primary action/i })).toHaveAttribute(
      "href",
      "/grants#grants-gap-resolution-lane"
    );
  });

  it("defaults missing numeric counts to zero instead of rendering NaN", () => {
    const {
      reportPacketCurrent: _reportPacketCurrent,
      rtpFundingReviewPackets: _rtpFundingReviewPackets,
      openFundingOpportunities: _openFundingOpportunities,
      comparisonBackedReports: _comparisonBackedReports,
      queueDepth: _queueDepth,
      aerialMissions: _aerialMissions,
      aerialReadyPackages: _aerialReadyPackages,
      ...partialCounts
    } = summary.counts;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(
        <WorkspaceCommandBoard
          summary={{
            ...summary,
            counts: partialCounts as unknown as WorkspaceOperationsSummary["counts"],
            nextCommand: null,
            commandQueue: [],
            fullCommandQueue: [],
          }}
        />
      );

      expect(screen.getByText(/0 refresh recommended, 0 without packets, 0 ready for release review\./i)).toBeInTheDocument();
      expect(screen.getByText(/0 regenerate · 0 generate · 0 review/i)).toBeInTheDocument();
      expect(screen.getByText(/0 open opportunities · 0 queued checks/i)).toBeInTheDocument();
      expect(screen.getByText(/0 comparison-backed reports/i)).toBeInTheDocument();
      expect(screen.getByText(/0 total commands · 0 proof-linked actions/i)).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/NaN/);
      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          call.some((part) => String(part).includes("Received NaN"))
        )
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("shows comparison-backed queue caveats as planning support", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          posture: "active",
          detail: "Saved comparison-backed packet work is ready for review.",
          counts: {
            ...summary.counts,
            reportPacketCurrent: 0,
            rtpFundingReviewPackets: 0,
            comparisonBackedReports: 1,
            queueDepth: 1,
          },
          nextCommand: {
            key: "review-comparison-backed-reports",
            title: "Review comparison-backed packet posture",
            detail:
              "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
            href: "/reports?posture=comparison-backed",
            tone: "info",
            priority: 9,
            badges: [
              { label: "Comparison-backed", value: 1 },
              { label: "Ready comparisons", value: 1 },
            ],
          },
          commandQueue: [
            {
              key: "review-comparison-backed-reports",
              title: "Review comparison-backed packet posture",
              detail:
                "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
              href: "/reports?posture=comparison-backed",
              tone: "info",
              priority: 9,
              badges: [
                { label: "Comparison-backed", value: 1 },
                { label: "Ready comparisons", value: 1 },
                { label: "Modeling triage", value: "1 ready · 0 refresh · 0 thin · 1 none" },
              ],
            },
          ],
          fullCommandQueue: [
            {
              key: "review-comparison-backed-reports",
              title: "Review comparison-backed packet posture",
              detail:
                "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
              href: "/reports?posture=comparison-backed",
              tone: "info",
              priority: 9,
              badges: [
                { label: "Comparison-backed", value: 1 },
                { label: "Ready comparisons", value: 1 },
                { label: "Modeling triage", value: "1 ready · 0 refresh · 0 thin · 1 none" },
              ],
            },
          ],
        }}
      />
    );

    expect(
      screen.getAllByText(/saved comparison context that can support grant planning language or prioritization framing/i)
        .length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/not proof of award likelihood or a replacement for funding-source review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Review comparison-backed packet posture/i })[0]).toHaveAttribute(
      "href",
      "/reports?posture=comparison-backed"
    );
    expect(screen.getAllByText(/Modeling triage: 1 ready · 0 refresh · 0 thin · 1 none/i).length).toBeGreaterThan(0);
  });

  it("shows Grants OS lane metadata and routes grants commands to the shared lane", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          detail: "A funding need anchor is missing.",
          counts: {
            ...summary.counts,
            reportPacketCurrent: 0,
            rtpFundingReviewPackets: 0,
            projectFundingNeedAnchorProjects: 1,
            queueDepth: 1,
          },
          nextCommand: {
            key: "anchor-project-funding-needs",
            moduleKey: "grants",
            moduleLabel: "Grants OS",
            title: "Anchor project funding needs",
            detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
            href: "/projects/project-anchor#project-funding-opportunities",
            targetProjectId: "project-anchor",
            tone: "warning",
            priority: 3,
            badges: [{ label: "Missing anchors", value: 1 }],
          },
          commandQueue: [
            {
              key: "anchor-project-funding-needs",
              moduleKey: "grants",
              moduleLabel: "Grants OS",
              title: "Anchor project funding needs",
              detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
              href: "/projects/project-anchor#project-funding-opportunities",
              targetProjectId: "project-anchor",
              tone: "warning",
              priority: 3,
              badges: [{ label: "Missing anchors", value: 1 }],
            },
          ],
          fullCommandQueue: [
            {
              key: "anchor-project-funding-needs",
              moduleKey: "grants",
              moduleLabel: "Grants OS",
              title: "Anchor project funding needs",
              detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
              href: "/projects/project-anchor#project-funding-opportunities",
              targetProjectId: "project-anchor",
              tone: "warning",
              priority: 3,
              badges: [{ label: "Missing anchors", value: 1 }],
            },
          ],
        }}
      />
    );

    expect(screen.getAllByText("Grants OS").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Anchor project funding needs/i })[0]).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-anchor#grants-funding-need-editor"
    );
  });
});
