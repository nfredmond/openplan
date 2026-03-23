import { getOperatorControlProfileByEvidenceId } from "@/lib/stage-gates/operator-controls";
import caStageGatesTemplate from "@/lib/stage-gates/templates/ca_stage_gates_v0.1.json";

export type StageGateDecisionRow = {
  gate_id: string;
  decision: string;
  rationale: string | null;
  decided_at: string | null;
  missing_artifacts?: string[] | null;
};

type StageGateTemplateEvidence = {
  evidence_id: string;
  title: string;
  artifact_type: string;
  required: boolean;
  conditional_required_when?: string;
};

export type StageGateEvidencePreviewItem = StageGateTemplateEvidence & {
  operatorControlTitle: string | null;
  operatorControlFieldCount: number;
  operatorControlGoal: string | null;
  operatorControlAcceptancePreview: string[];
};

type StageGateTemplateGate = {
  gate_id: string;
  sequence: number;
  name: string;
  lapm_mapping?: string[];
  stip_rtip_mapping?: string[];
  ceqa_vmt_mapping?: string[];
  outreach_mapping?: string[];
  required_evidence?: StageGateTemplateEvidence[];
};

type StageGateTemplate = {
  template_id: string;
  template_name: string;
  version: string;
  jurisdiction: string;
  gate_order: string[];
  gates: StageGateTemplateGate[];
};

export type StageGateWorkflowState = "pass" | "hold" | "not_started";

export type StageGateSummaryItem = {
  gateId: string;
  sequence: number;
  name: string;
  workflowState: StageGateWorkflowState;
  decisionLabel: string;
  rationale: string;
  decidedAt: string | null;
  missingArtifacts: string[];
  requiredEvidenceCount: number;
  operatorControlEvidenceCount: number;
  lapmMappings: string[];
  stipRtipMappings: string[];
  ceqaVmtMappings: string[];
  outreachMappings: string[];
  evidencePreview: StageGateEvidencePreviewItem[];
};

export type ProjectStageGateSummary = {
  templateId: string;
  templateVersion: string;
  jurisdiction: string;
  totalGateCount: number;
  passCount: number;
  holdCount: number;
  notStartedCount: number;
  nextGate: StageGateSummaryItem | null;
  blockedGate: StageGateSummaryItem | null;
  gates: StageGateSummaryItem[];
};

const template = caStageGatesTemplate as StageGateTemplate;

function normalizeDecisionState(value: string | null | undefined): StageGateWorkflowState {
  if (value === "PASS") return "pass";
  if (value === "HOLD") return "hold";
  return "not_started";
}

export function buildProjectStageGateSummary(
  decisions: StageGateDecisionRow[] | null | undefined
): ProjectStageGateSummary {
  const latestDecisionByGate = new Map<string, StageGateDecisionRow>();

  for (const decision of decisions ?? []) {
    if (!latestDecisionByGate.has(decision.gate_id)) {
      latestDecisionByGate.set(decision.gate_id, decision);
    }
  }

  const gates = template.gate_order
    .map((gateId) => template.gates.find((gate) => gate.gate_id === gateId))
    .filter((gate): gate is StageGateTemplateGate => Boolean(gate))
    .map((gate) => {
      const latestDecision = latestDecisionByGate.get(gate.gate_id);
      const workflowState = normalizeDecisionState(latestDecision?.decision);
      const missingArtifacts = Array.isArray(latestDecision?.missing_artifacts)
        ? latestDecision?.missing_artifacts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      const requiredEvidence = (gate.required_evidence ?? []).filter((item) => item.required);
      const evidencePreview = requiredEvidence.slice(0, 3).map((evidence) => {
        const operatorControlProfile = getOperatorControlProfileByEvidenceId(evidence.evidence_id);

        return {
          ...evidence,
          operatorControlTitle: operatorControlProfile?.title ?? null,
          operatorControlFieldCount: operatorControlProfile?.operator_fields.length ?? 0,
          operatorControlGoal: operatorControlProfile?.goal ?? null,
          operatorControlAcceptancePreview: operatorControlProfile?.acceptance_criteria.slice(0, 2) ?? [],
        } satisfies StageGateEvidencePreviewItem;
      });
      const operatorControlEvidenceCount = requiredEvidence.filter((evidence) => getOperatorControlProfileByEvidenceId(evidence.evidence_id)).length;

      return {
        gateId: gate.gate_id,
        sequence: gate.sequence,
        name: gate.name,
        workflowState,
        decisionLabel:
          workflowState === "pass"
            ? "Pass"
            : workflowState === "hold"
              ? "Hold"
              : "Not started",
        rationale:
          latestDecision?.rationale?.trim() ||
          (workflowState === "not_started"
            ? "No gate decision recorded yet."
            : workflowState === "hold"
              ? "Gate is on hold and requires evidence closure."
              : "Gate currently passes based on the latest recorded decision."),
        decidedAt: latestDecision?.decided_at ?? null,
        missingArtifacts,
        requiredEvidenceCount: requiredEvidence.length,
        operatorControlEvidenceCount,
        lapmMappings: gate.lapm_mapping ?? [],
        stipRtipMappings: gate.stip_rtip_mapping ?? [],
        ceqaVmtMappings: gate.ceqa_vmt_mapping ?? [],
        outreachMappings: gate.outreach_mapping ?? [],
        evidencePreview,
      } satisfies StageGateSummaryItem;
    });

  const passCount = gates.filter((gate) => gate.workflowState === "pass").length;
  const holdCount = gates.filter((gate) => gate.workflowState === "hold").length;
  const notStartedCount = gates.filter((gate) => gate.workflowState === "not_started").length;
  const blockedGate = gates.find((gate) => gate.workflowState === "hold") ?? null;
  const nextGate = gates.find((gate) => gate.workflowState !== "pass") ?? null;

  return {
    templateId: template.template_id,
    templateVersion: template.version,
    jurisdiction: template.jurisdiction,
    totalGateCount: gates.length,
    passCount,
    holdCount,
    notStartedCount,
    nextGate,
    blockedGate,
    gates,
  };
}
