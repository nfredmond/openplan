type EvidenceCase = {
  label: string;
  metadata: Record<string, unknown> | null;
  supported: boolean;
};

const evidenceCounts = [
  "linkedRunCount",
  "scenarioSetLinkCount",
  "totalProjectRecordCount",
  "engagementItemCount",
  "stageGatePassCount",
  "stageGateHoldCount",
  "modelingEvidenceCount",
  "safetyAcquisitionCount",
] as const;

const emptySummary = Object.fromEntries(evidenceCounts.map((field) => [field, 0]));

// Each populated case supplies only one evidence category, so a missing parser
// field cannot hide behind another positive count.
export const REPORT_EVIDENCE_CASES: EvidenceCase[] = [
  { label: "missing metadata", metadata: null, supported: false },
  { label: "source context without a summary", metadata: { sourceContext: {} }, supported: false },
  { label: "empty summary", metadata: { sourceContext: { evidenceChainSummary: {} } }, supported: false },
  { label: "explicit zero counts", metadata: { sourceContext: { evidenceChainSummary: emptySummary } }, supported: false },
  ...evidenceCounts.map((field) => ({
    label: field,
    metadata: {
      sourceContext: {
        evidenceChainSummary: { ...emptySummary, [field]: 1, modelingEvidenceClaimLabel: "Prototype Only" },
      },
    },
    supported: true,
  })),
];
