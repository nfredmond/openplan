import { getOperatorControlProfileByEvidenceId } from "@/lib/stage-gates/operator-controls";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
import { DEFAULT_STAGE_GATE_TEMPLATE_ID } from "@/lib/stage-gates/template-loader";
import type {
  StageGateTemplateEvidence,
  StageGateTemplateGate,
} from "@/lib/stage-gates/template-registry";

export type StageGateDecisionRow = {
  gate_id: string;
  decision: string;
  rationale: string | null;
  decided_at: string | null;
  missing_artifacts?: string[] | null;
};

export type StageGateEvidencePreviewItem = StageGateTemplateEvidence & {
  operatorControlTitle: string | null;
  operatorControlFieldCount: number;
  operatorControlGoal: string | null;
  operatorControlAcceptancePreview: string[];
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

export type StageGateSnapshotGateSummary = {
  gateId: string;
  sequence: number;
  name: string;
  workflowState: StageGateWorkflowState;
  rationale: string;
  missingArtifacts: string[];
  requiredEvidenceCount: number;
  operatorControlEvidenceCount: number;
};

export type ProjectStageGateSnapshot = {
  templateId: string;
  templateVersion: string;
  passCount: number;
  holdCount: number;
  notStartedCount: number;
  blockedGate: StageGateSnapshotGateSummary | null;
  nextGate: StageGateSnapshotGateSummary | null;
  controlHealth: {
    totalOperatorControlEvidenceCount: number;
    gatesWithOperatorControlsCount: number;
  };
};

function normalizeDecisionState(value: string | null | undefined): StageGateWorkflowState {
  if (value === "PASS") return "pass";
  if (value === "HOLD") return "hold";
  return "not_started";
}

export type ProjectStageGateSummaryOptions = {
  /**
   * The template the project is bound to. Omitted means "whatever the registry's
   * interim default is" — the same template every existing workspace is bound
   * to, which is why omitting it stays the current behaviour.
   */
  templateId?: string;
};

/**
 * Build the gate board for a project's bound template.
 *
 * An unregistered `templateId` throws rather than falling back: rendering one
 * jurisdiction's gates under another jurisdiction's template id would be wrong
 * and indistinguishable from correct. Callers that need to degrade gracefully
 * should ask `stageGateTemplateRegistry.get(templateId)` first and show an
 * explicit "template not available" state.
 */
export function buildProjectStageGateSummary(
  decisions: StageGateDecisionRow[] | null | undefined,
  options?: ProjectStageGateSummaryOptions
): ProjectStageGateSummary {
  const templateId = options?.templateId?.trim() || DEFAULT_STAGE_GATE_TEMPLATE_ID;
  if (!templateId) {
    throw new Error("No stage-gate template is registered");
  }

  const entry = stageGateTemplateRegistry.get(templateId);
  if (!entry) {
    throw new Error(`Unsupported stage-gate template: ${templateId}`);
  }
  const template = entry.document;

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

function toSnapshotGateSummary(
  gate: StageGateSummaryItem | null
): StageGateSnapshotGateSummary | null {
  if (!gate) {
    return null;
  }

  return {
    gateId: gate.gateId,
    sequence: gate.sequence,
    name: gate.name,
    workflowState: gate.workflowState,
    rationale: gate.rationale,
    missingArtifacts: gate.missingArtifacts,
    requiredEvidenceCount: gate.requiredEvidenceCount,
    operatorControlEvidenceCount: gate.operatorControlEvidenceCount,
  };
}

export function buildProjectStageGateSnapshot(
  summary: ProjectStageGateSummary
): ProjectStageGateSnapshot {
  return {
    templateId: summary.templateId,
    templateVersion: summary.templateVersion,
    passCount: summary.passCount,
    holdCount: summary.holdCount,
    notStartedCount: summary.notStartedCount,
    blockedGate: toSnapshotGateSummary(summary.blockedGate),
    nextGate: toSnapshotGateSummary(summary.nextGate),
    controlHealth: {
      totalOperatorControlEvidenceCount: summary.gates.reduce(
        (count, gate) => count + gate.operatorControlEvidenceCount,
        0
      ),
      gatesWithOperatorControlsCount: summary.gates.filter(
        (gate) => gate.operatorControlEvidenceCount > 0
      ).length,
    },
  };
}
