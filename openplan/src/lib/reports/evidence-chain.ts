import { titleize } from "@/lib/reports/catalog";
import { type ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import { type ProjectStageGateSnapshot } from "@/lib/stage-gates/summary";

export type EvidenceChainSummary = {
  linkedRunCount: number;
  scenarioSetLinkCount: number;
  scenarioAssumptionSetCount: number;
  scenarioDataPackageCount: number;
  scenarioIndicatorSnapshotCount: number;
  scenarioSharedSpinePendingCount: number;
  projectRecordGroupCount: number;
  totalProjectRecordCount: number;
  engagementLabel: string;
  engagementItemCount: number;
  engagementReadyForHandoffCount: number;
  stageGateLabel: string;
  stageGatePassCount: number;
  stageGateHoldCount: number;
  stageGateBlockedGateLabel: string | null;
};

export function buildEvidenceChainSummary(input: {
  linkedRunCount: number;
  scenarioSetLinks: ReportScenarioSetLink[];
  projectRecordsSnapshot: {
    deliverables: { count: number };
    risks: { count: number };
    issues: { count: number };
    decisions: { count: number };
    meetings: { count: number };
  };
  engagementCampaignCurrent?: {
    status?: string | null;
  } | null;
  engagementItemCount?: number | null;
  engagementReadyForHandoffCount?: number | null;
  stageGateSnapshot: ProjectStageGateSnapshot;
}): EvidenceChainSummary {
  const projectRecordCounts = [
    input.projectRecordsSnapshot.deliverables.count,
    input.projectRecordsSnapshot.risks.count,
    input.projectRecordsSnapshot.issues.count,
    input.projectRecordsSnapshot.decisions.count,
    input.projectRecordsSnapshot.meetings.count,
  ];

  const projectRecordGroupCount = projectRecordCounts.filter((count) => count > 0).length;
  const totalProjectRecordCount = projectRecordCounts.reduce(
    (sum, count) => sum + count,
    0
  );

  const engagementStatus = input.engagementCampaignCurrent?.status ?? null;
  const blockedGate = input.stageGateSnapshot.blockedGate;
  const scenarioAssumptionSetCount = input.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.assumptionSetCount ?? 0),
    0
  );
  const scenarioDataPackageCount = input.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.dataPackageCount ?? 0),
    0
  );
  const scenarioIndicatorSnapshotCount = input.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.indicatorSnapshotCount ?? 0),
    0
  );
  const scenarioSharedSpinePendingCount = input.scenarioSetLinks.filter(
    (link) => link.sharedSpine?.schemaPending
  ).length;

  return {
    linkedRunCount: input.linkedRunCount,
    scenarioSetLinkCount: input.scenarioSetLinks.length,
    scenarioAssumptionSetCount,
    scenarioDataPackageCount,
    scenarioIndicatorSnapshotCount,
    scenarioSharedSpinePendingCount,
    projectRecordGroupCount,
    totalProjectRecordCount,
    engagementLabel: engagementStatus ? titleize(engagementStatus) : "Not linked",
    engagementItemCount: input.engagementItemCount ?? 0,
    engagementReadyForHandoffCount: input.engagementReadyForHandoffCount ?? 0,
    stageGateLabel:
      input.stageGateSnapshot.holdCount > 0
        ? "Hold present"
        : input.stageGateSnapshot.notStartedCount > 0
          ? "In progress"
          : "Complete",
    stageGatePassCount: input.stageGateSnapshot.passCount,
    stageGateHoldCount: input.stageGateSnapshot.holdCount,
    stageGateBlockedGateLabel: blockedGate
      ? `${blockedGate.gateId} · ${blockedGate.name}`
      : null,
  };
}
