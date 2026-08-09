import { render, screen, within } from "@testing-library/react";
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
    rtpReviewLoopOpenPackets: 0,
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

/**
 * A fully measured set of lane observations. Every field is a real number, so a
 * test that wants the "not measured" path has to say so explicitly — the
 * opposite default from the one that let literal zeros into this module before.
 */
const measuredObservations: NonNullable<WorkspaceOperationsSummary["moduleObservations"]> = {
  engagement: {
    campaigns: 2,
    activeCampaigns: 1,
    moderationActionableItems: 4,
    approvedItems: 11,
    leadActiveCampaign: { id: "campaign-1", title: "Corridor listening sessions" },
  },
  safety: {
    crashIngests: 3,
    readyCrashIngests: 2,
    failedCrashIngests: 0,
    uncoveredCrashIngests: 1,
  },
  modeling: {
    modelRuns: 6,
    activeModelRuns: 1,
    failedModelRuns: 2,
    succeededModelRuns: 3,
    scenarioSets: 2,
    activeScenarioSets: 1,
    countyRuns: 1,
    validatedScreeningCountyRuns: 0,
  },
  evidence: {
    datasets: 4,
    datasetsNeedingAttention: 0,
    knowledgeDocuments: 3,
    readyKnowledgeDocuments: 3,
    failedKnowledgeDocuments: 0,
  },
  receivables: {
    clientInvoices: 2,
    draftClientInvoices: 1,
    awaitingPaymentClientInvoices: 1,
  },
  unreadable: [],
};

describe("WorkspaceCommandBoard", () => {
  it("surfaces funding-backed RTP packet review in shared packet work copy", () => {
    render(<WorkspaceCommandBoard summary={summary} />);

    expect(
      screen.getByText(/1 RTP packet is up to date but still needs funding sorted out in Grants before you share it\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 ready to review, 1 waiting on funding in Grants\./i)).toBeInTheDocument();
    expect(screen.getByText("Reports needing action")).toBeInTheDocument();
    expect(screen.getByText(/Only the ones that need something from you: 0 to regenerate, 0 to generate, 1 waiting on funding, 0 still in review\./i)).toBeInTheDocument();
    expect(screen.getByText(/1 up-to-date packet is not counted here, because nothing is being asked of you\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start with this one/i })).toHaveAttribute(
      "href",
      "/grants#grants-gap-resolution-lane"
    );
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
    expect(screen.getByText("Check the public comments")).toBeInTheDocument();
    expect(screen.getByText(/standing check · handoff check/i)).toBeInTheDocument();
    expect(screen.getByText(/Standing check: handoff/i)).toBeInTheDocument();
    expect(screen.getByText("Funding follow-through")).toBeInTheDocument();
    expect(screen.getAllByText("Grants OS").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Funding review: 1/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Primary next action")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open primary action/i })).toHaveAttribute(
      "href",
      "/grants#grants-gap-resolution-lane"
    );
  });

  it("counts open RTP release-review loops as report governance attention", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          headline: "Run release review on current packets",
          detail: "Current RTP packets still need release-review follow-through.",
          counts: {
            ...summary.counts,
            rtpFundingReviewPackets: 0,
            rtpReviewLoopOpenPackets: 2,
          },
          nextCommand: {
            key: "review-current-report-packets",
            title: "Run release review on current packets",
            detail: "2 current RTP packets still read as public comment matrix pending.",
            href: "/reports/report-1#release-review",
            tone: "warning",
            priority: 2.5,
            badges: [
              { label: "Current", value: 1 },
              { label: "Review loop open", value: 2 },
            ],
          },
          commandQueue: [],
          fullCommandQueue: [],
        }}
      />
    );

    const governancePanel = screen.getByText("Reports needing action").closest("div");
    expect(governancePanel).not.toBeNull();
    expect(within(governancePanel as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/Only the ones that need something from you: 0 to regenerate, 0 to generate, 0 waiting on funding, 2 still in review\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start with this one/i })).toHaveAttribute(
      "href",
      "/reports/report-1#release-review"
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

      expect(screen.getByText(/0 out of date, 0 not generated yet, 0 ready to review\./i)).toBeInTheDocument();
      expect(screen.getByText(/Only the ones that need something from you: 0 to regenerate, 0 to generate, 0 waiting on funding, 0 still in review\./i)).toBeInTheDocument();
      expect(screen.getByText(/0 regenerate · 0 generate · 0 review/i)).toBeInTheDocument();
      expect(screen.getByText(/0 open opportunities · 0 queued checks/i)).toBeInTheDocument();
      expect(screen.getByText(/0 comparison-backed reports/i)).toBeInTheDocument();
      expect(screen.getByText("No linked analysis evidence")).toBeInTheDocument();
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
    expect(screen.getByText("Comparison support visible")).toBeInTheDocument();
    expect(screen.getAllByText(/Modeling triage: 1 ready · 0 refresh · 0 thin · 1 none/i).length).toBeGreaterThan(0);
  });

  it("rolls stale modeling readiness into the workflow lanes", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          counts: {
            ...summary.counts,
            comparisonBackedReports: 2,
            projectFundingDecisionProjects: 2,
            queueDepth: 1,
          },
          grantModelingSummary: {
            breakdown: {
              decisionReady: 1,
              refreshRecommended: 1,
              thin: 0,
              noVisibleSupport: 1,
            },
            breakdownSummary:
              "3 opportunity-linked projects: 1 appears decision-ready, 1 refresh recommended, 0 appears thin, 1 without visible support.",
            operatorDetail: null,
            leadDecisionDetail: null,
          },
        }}
      />
    );

    expect(screen.getAllByText("Stale modeling evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Stale evidence refresh")).toBeInTheDocument();
    expect(screen.getAllByText(/Stale modeling: 1/i).length).toBeGreaterThan(0);
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

  it("shows engagement, safety and modeling state once the summary reads those modules", () => {
    render(<WorkspaceCommandBoard summary={{ ...summary, moduleObservations: measuredObservations }} />);

    const moderationPanel = screen.getByText("Engagement moderation").closest("div");
    expect(moderationPanel).not.toBeNull();
    expect(within(moderationPanel as HTMLElement).getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/2 campaigns, with 11 approved comments available to draw from/i)).toBeInTheDocument();

    const crashPanel = screen.getByText("Crash data pulls").closest("div");
    expect(within(crashPanel as HTMLElement).getByText("3")).toBeInTheDocument();
    // A study area with no registered source must never read as a finding about
    // collisions — that sentence is the whole reason this panel exists.
    expect(screen.getByText(/no registered source coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/disclosed gap, not a reading about collisions/i)).toBeInTheDocument();

    const modelPanel = screen.getByText("Model runs").closest("div");
    expect(within(modelPanel as HTMLElement).getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/1 run in flight, 2 runs failed, across 2 scenario sets/i)).toBeInTheDocument();

    // Every lane the board now claims is present as a workflow lane.
    expect(screen.getByText("Safety")).toBeInTheDocument();
    expect(screen.getByText("Data & knowledge")).toBeInTheDocument();
    expect(screen.getByText("Receivables")).toBeInTheDocument();
  });

  it("shows an unreadable lane as unmeasured and names it, instead of showing zero", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          moduleObservations: {
            ...measuredObservations,
            engagement: {
              campaigns: null,
              activeCampaigns: null,
              moderationActionableItems: null,
              approvedItems: null,
              leadActiveCampaign: null,
            },
            unreadable: [
              { label: "engagement campaigns", message: "permission denied for table engagement_campaigns" },
              {
                label: "engagement comments awaiting moderation",
                message: "permission denied for table engagement_items",
              },
            ],
          },
        }}
      />
    );

    const moderationPanel = screen.getByText("Engagement moderation").closest("div");
    expect(within(moderationPanel as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(moderationPanel as HTMLElement).queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.getByText(/The moderation queue could not be read, so this is not a claim that nothing is waiting/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /could not read engagement campaigns and engagement comments awaiting moderation/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/shown as unmeasured rather than as zero/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/NaN/);
  });
});
