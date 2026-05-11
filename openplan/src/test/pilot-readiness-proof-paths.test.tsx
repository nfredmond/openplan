import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import {
  ADMIN_PILOT_READINESS_ROUTE,
  FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
  PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
} from "@/lib/operations/pilot-readiness-proof-paths";
import {
  buildAdminPilotReadinessProofPacketMarkdown,
} from "@/lib/operations/pilot-readiness-packet";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactIndex,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";
import { buildProjectSpineCrosslinkSummary, type ProjectSpineCrosslinkInput } from "@/lib/projects/project-spine-crosslinks";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

const repoRoot = path.resolve(process.cwd(), "..");

const commandBoardSummary: WorkspaceOperationsSummary = {
  posture: "active",
  headline: "Ready for release proof review",
  detail: "OpenPlan proof lanes are ready for supervised review.",
  counts: {
    projects: 1,
    activeProjects: 1,
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
};

const emptyProjectSpineInput: ProjectSpineCrosslinkInput = {
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

describe("canonical pilot readiness proof paths", () => {
  it("keeps artifact index, command board, project spine, and sales packet docs on the same readiness/preflight paths", () => {
    const artifactIndex = getAdminPilotReadinessProofArtifactIndex();
    const finalChecklist = artifactIndex.find((artifact) => artifact.key === "final-checklist");
    const pilotPreflight = artifactIndex.find((artifact) => artifact.key === "pilot-preflight-proof");

    expect(finalChecklist?.artifact).toBe(FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT);
    expect(finalPilotReadinessChecklistSync.checklistArtifact).toBe(FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT);
    expect(pilotPreflight?.artifact).toBe(PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT);
    expect(releaseProofPosture.actions.find((action) => action.label === "Open readiness packet")?.href).toBe(
      ADMIN_PILOT_READINESS_ROUTE,
    );

    render(<WorkspaceCommandBoard summary={commandBoardSummary} />);
    expect(screen.getByRole("link", { name: /readiness packet \+ preflight proof/i })).toHaveAttribute(
      "href",
      ADMIN_PILOT_READINESS_ROUTE,
    );
    expect(screen.getByText(new RegExp(PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();

    const projectSpineSummary = buildProjectSpineCrosslinkSummary(emptyProjectSpineInput);
    expect(projectSpineSummary.stateProofReference.href).toBe(ADMIN_PILOT_READINESS_ROUTE);
    expect(projectSpineSummary.stateProofReference.artifact).toBe(PHASE1_SHARED_SPINE_PROOF_ARTIFACT);

    const generatedMarkdown = buildAdminPilotReadinessProofPacketMarkdown();
    const staticMarkdown = readFileSync(
      path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md"),
      "utf8",
    );
    const staticHtml = readFileSync(
      path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html"),
      "utf8",
    );
    const staticPdf = readFileSync(
      path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf"),
    ).toString("latin1");

    for (const content of [generatedMarkdown, staticMarkdown, staticHtml, staticPdf]) {
      expect(content).toContain(FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT);
      expect(content).toContain(PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT);
      expect(content).toContain(PHASE1_SHARED_SPINE_PROOF_ARTIFACT);
    }
  });
});
