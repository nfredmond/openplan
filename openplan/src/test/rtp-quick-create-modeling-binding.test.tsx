import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const createRtpPacketRecordMock = vi.fn();
const generateReportArtifactMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/reports/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reports/client")>("@/lib/reports/client");

  return {
    ...actual,
    createRtpPacketRecord: (...args: unknown[]) => createRtpPacketRecordMock(...args),
    generateReportArtifact: (...args: unknown[]) => generateReportArtifactMock(...args),
  };
});

import { RtpReportCreator } from "@/components/rtp/rtp-report-creator";
import { RtpRegistryNextActionShortcut } from "@/components/rtp/rtp-registry-next-action-shortcut";
import { RtpRegistryPacketQueueCommandBoard } from "@/components/rtp/rtp-registry-packet-queue-command-board";
import { RtpRegistryPacketRowAction } from "@/components/rtp/rtp-registry-packet-row-action";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import type { RtpAssistantContext, RtpRegistryAssistantContext } from "@/lib/assistant/context";

const EMPTY_OPERATIONS_SUMMARY = {
  posture: "stable",
  headline: "No active command",
  detail: "No active command",
  counts: {
    projects: 0,
    activeProjects: 0,
    plans: 0,
    plansNeedingSetup: 0,
    programs: 0,
    activePrograms: 0,
    reports: 0,
    reportRefreshRecommended: 0,
    reportNoPacket: 0,
    reportPacketCurrent: 0,
    rtpFundingReviewPackets: 0,
    comparisonBackedReports: 0,
    fundingOpportunities: 0,
    openFundingOpportunities: 0,
    closingSoonFundingOpportunities: 0,
    overdueDecisionFundingOpportunities: 0,
    projectFundingNeedAnchorProjects: 0,
    projectFundingSourcingProjects: 0,
    projectFundingDecisionProjects: 0,
    projectFundingAwardRecordProjects: 0,
    projectFundingReimbursementStartProjects: 0,
    projectFundingReimbursementActiveProjects: 0,
    projectFundingGapProjects: 0,
    queueDepth: 0,
    aerialMissions: 0,
    aerialActiveMissions: 0,
    aerialReadyPackages: 0,
  },
  nextCommand: null,
  commandQueue: [],
  fullCommandQueue: [],
} satisfies RtpAssistantContext["operationsSummary"];

describe("RTP quick-create modeling evidence binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRtpPacketRecordMock.mockResolvedValue({
      reportId: "report-1",
      warningCount: 0,
    });
    generateReportArtifactMock.mockResolvedValue({ warningCount: 0 });
  });

  it("binds the RTP detail quick-create button to the default modeling county run", async () => {
    render(
      <RtpReportCreator
        rtpCycleId="rtp-1"
        defaultTitle="Nevada County RTP 2050 Board / Binder"
        cycleStatus="draft"
        modelingCountyRunId="county-run-1"
      />
    );

    expect(screen.getByText(/Assignment modeling evidence will be attached/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create and generate draft packet/i }));

    await waitFor(() => {
      expect(createRtpPacketRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rtpCycleId: "rtp-1",
          title: "Nevada County RTP 2050 Board / Binder",
          modelingCountyRunId: "county-run-1",
          generateAfterCreate: true,
        })
      );
    });
    expect(pushMock).toHaveBeenCalledWith("/reports/report-1");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("passes modeling evidence through the dominant create-packet shortcut", async () => {
    render(
      <RtpRegistryNextActionShortcut
        actionKey="createPacket"
        cycleIds={["rtp-1", "rtp-2"]}
        reportIds={[]}
        modelingCountyRunId="county-run-1"
      />
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(createRtpPacketRecordMock).toHaveBeenCalledTimes(2);
    });
    expect(createRtpPacketRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        rtpCycleId: "rtp-1",
        modelingCountyRunId: "county-run-1",
        generateAfterCreate: true,
      })
    );
    expect(createRtpPacketRecordMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rtpCycleId: "rtp-2",
        modelingCountyRunId: "county-run-1",
        generateAfterCreate: true,
      })
    );
  });

  it("passes modeling evidence through the queue command board when creating missing packet records", async () => {
    render(
      <RtpRegistryPacketQueueCommandBoard
        resetCycleIds={[]}
        missingCycleIds={["rtp-1"]}
        generateFirstReportIds={[]}
        refreshReportIds={[]}
        resetCount={0}
        missingCount={1}
        modelingCountyRunId="county-run-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear packet queue/i }));

    await waitFor(() => {
      expect(createRtpPacketRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rtpCycleId: "rtp-1",
          modelingCountyRunId: "county-run-1",
        })
      );
    });
    expect(generateReportArtifactMock).toHaveBeenCalledWith("report-1");
  });

  it("passes modeling evidence through row-level missing-packet creation", async () => {
    render(
      <RtpRegistryPacketRowAction
        cycleId="rtp-1"
        reportId={null}
        packetAttention="missing"
        modelingCountyRunId="county-run-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

    await waitFor(() => {
      expect(createRtpPacketRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rtpCycleId: "rtp-1",
          modelingCountyRunId: "county-run-1",
          generateAfterCreate: true,
        })
      );
    });
  });

  it("passes modeling evidence through the RTP cycle assistant create action", () => {
    const links = buildAssistantOperations({
      kind: "rtp_cycle",
      workspace: { id: "workspace-1", name: "OpenPlan QA", plan: "pilot", role: "owner" },
      defaultModelingCountyRunId: "county-run-1",
      rtpCycle: {
        id: "rtp-1",
        title: "Nevada County RTP 2050",
        summary: null,
        status: "draft",
        geographyLabel: "Nevada County",
        horizonStartYear: 2025,
        horizonEndYear: 2050,
        adoptionTargetDate: null,
        publicReviewOpenAt: null,
        publicReviewCloseAt: null,
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
      readiness: { label: "In progress", reason: "", tone: "warning", ready: false, readyCheckCount: 0, totalCheckCount: 0, missingCheckLabels: [], nextSteps: [], checks: [] },
      workflow: { label: "Setup", detail: "", tone: "warning", actionItems: [] },
      counts: {
        chapters: 0,
        readyForReviewChapters: 0,
        completeChapters: 0,
        linkedProjects: 0,
        engagementCampaigns: 0,
        packetReports: 0,
      },
      packetSummary: {
        linkedReportCount: 0,
        noPacketCount: 1,
        refreshRecommendedCount: 0,
        recommendedReport: null,
      },
      operationsSummary: EMPTY_OPERATIONS_SUMMARY,
    } as RtpAssistantContext);

    expect(links.find((link) => link.id === "rtp-create-first-packet")?.executeAction).toMatchObject({
      kind: "create_rtp_packet_record",
      rtpCycleId: "rtp-1",
      modelingCountyRunId: "county-run-1",
      generateAfterCreate: true,
    });
  });

  it("passes modeling evidence through the RTP registry assistant create action", () => {
    const links = buildAssistantOperations({
      kind: "rtp_registry",
      workspace: { id: "workspace-1", name: "OpenPlan QA", plan: "pilot", role: "owner" },
      defaultModelingCountyRunId: "county-run-1",
      counts: {
        cycles: 1,
        draftCycles: 1,
        publicReviewCycles: 0,
        adoptedCycles: 0,
        archivedCycles: 0,
        packetReports: 0,
        noPacketCount: 1,
        refreshRecommendedCount: 0,
      },
      recommendedCycle: {
        id: "rtp-1",
        title: "Nevada County RTP 2050",
        status: "draft",
        packetFreshnessLabel: "No packet",
        packetReportCount: 0,
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
      operationsSummary: EMPTY_OPERATIONS_SUMMARY,
    } as RtpRegistryAssistantContext);

    expect(links.find((link) => link.id === "rtp-registry-create-first-packet")?.executeAction).toMatchObject({
      kind: "create_rtp_packet_record",
      rtpCycleId: "rtp-1",
      modelingCountyRunId: "county-run-1",
      generateAfterCreate: true,
    });
  });
});
