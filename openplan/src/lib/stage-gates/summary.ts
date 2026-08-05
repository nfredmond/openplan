import { getOperatorControlProfileByEvidenceId } from "@/lib/stage-gates/operator-controls";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
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
  /**
   * Which project the decision is about.
   *
   * Optional on the TYPE, not on a real row: `stage_gate_decisions` gained the
   * column in 20260728000011, so rows written before it carry NULL, and a
   * caller building a board from an empty log has no rows to attribute at all.
   * A row that is MISSING the key entirely came from a `.select()` that did not
   * ask for it, which the builder refuses rather than silently drops — see the
   * scope guard in `buildProjectStageGateSummary`.
   */
  project_id?: string | null;
};

export type StageGateEvidencePreviewItem = StageGateTemplateEvidence & {
  operatorControlTitle: string | null;
  operatorControlFieldCount: number;
  operatorControlGoal: string | null;
  operatorControlAcceptancePreview: string[];
};

/**
 * What the board knows about a gate.
 *
 * `not_started` and `unknown` are the two that matter and they are NOT the same
 * claim. `not_started` says the decision log was read and holds no decision for
 * this gate — an absence established by looking. `unknown` says the log could
 * not be read at all, so nothing whatever is established. Collapsing the second
 * into the first is how a failed query becomes a confident sentence about a
 * planner's compliance posture, which is the failure mode
 * `src/lib/ui/read-failures.ts` exists to name.
 *
 * Neither one may ever be rendered as "not passed". A gate with no decision has
 * not been judged; it has not failed.
 */
export type StageGateWorkflowState = "pass" | "hold" | "not_started" | "unknown";

/**
 * Whether the decision log behind this board was readable.
 *
 * Carried on the summary rather than inferred from empty counts, because zero is
 * a legitimate answer and an unreadable log is not an answer at all.
 */
export type StageGateDecisionsReadState =
  | { readable: true }
  | { readable: false; reason: string };

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
  /**
   * Every REQUIRED evidence id this gate's template declares, in template order.
   *
   * Distinct from `missingArtifacts`, and the distinction is load-bearing: that
   * field is what a decider WROTE DOWN as outstanding, so it is empty on every
   * gate with no recorded decision. This one is what the template ASKS FOR,
   * which is knowable without any decision at all. A surface that needs to name
   * what a blank gate is waiting on must read this; reading `missingArtifacts`
   * there yields an empty list every time, which is a different claim and a
   * silently unreachable condition.
   */
  requiredEvidenceIds: string[];
  operatorControlEvidenceCount: number;
  lapmMappings: string[];
  stipRtipMappings: string[];
  ceqaVmtMappings: string[];
  outreachMappings: string[];
  evidencePreview: StageGateEvidencePreviewItem[];
};

export type ProjectStageGateSummary = {
  templateId: string;
  /** As authored: "California LAPM/CEQA stage gates". */
  templateName: string;
  templateVersion: string;
  /** The flat code carried inside the artifact ("CA"). */
  jurisdiction: string;
  /**
   * The readable jurisdiction, from the registry descriptor rather than derived
   * from the code — deriving "California" from "CA" would need a code-to-name
   * table for the world, and "CA" is Canada under ISO 3166-1. Carried so a
   * surface can name the jurisdiction without writing one into its own copy.
   */
  jurisdictionLabel: string;
  totalGateCount: number;
  passCount: number;
  holdCount: number;
  notStartedCount: number;
  /**
   * Gates whose state could not be established because the decision log did not
   * load. Always 0 when `decisionsRead.readable` is true, and always the full
   * gate count when it is false — the two cannot be mixed, because a read either
   * returned rows or returned an error.
   *
   * A surface rendering `passCount`/`holdCount`/`notStartedCount` MUST check
   * `decisionsRead` first: those three are zero in the unreadable case, and
   * zero pass gates is a claim this build has not earned.
   */
  unknownCount: number;
  decisionsRead: StageGateDecisionsReadState;
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

/**
 * What each state says on the board, in the planner's words.
 *
 * "No decision recorded" rather than "Not started": the gate itself may be well
 * under way — evidence gathered, review scheduled — and what the log is actually
 * missing is a recorded verdict. "Not started" describes the work; only the
 * decision is absent, and saying otherwise puts a claim about the project on
 * screen that the decision log never made.
 */
const DECISION_LABELS: Record<StageGateWorkflowState, string> = {
  pass: "Pass",
  hold: "Hold",
  not_started: "No decision recorded",
  unknown: "Not readable",
};

export type ProjectStageGateSummaryOptions = {
  /**
   * The template the project is bound to. REQUIRED — there is no fallback.
   *
   * There used to be one: an omitted id silently built the board on the
   * registry's default template, and three of the four real callers relied on
   * it. With one registered template that was coincidentally right; with two,
   * every one of them would render the DEFAULT's gate vocabulary instead of the
   * workspace's BOUND template — a CA workspace's recorded decisions would
   * match no gate and a funder-facing packet would claim its gates undecided.
   * The caller must resolve the workspace's binding
   * (`resolveWorkspaceStageGateBinding`) and state the answer here; this
   * builder does not guess.
   */
  templateId: string;
  /**
   * Which project this board is about. REQUIRED whenever any decision is
   * supplied — see the refusal in `buildProjectStageGateSummary`.
   *
   * It reads as optional because an empty log and an unreadable one have
   * nothing to attribute, and both build a legitimate board from the template
   * alone. It is not optional for a caller that read rows: a board built from
   * decisions it cannot attribute is indistinguishable from a correct one, and
   * the surfaces that consume it — the assistant, the report detail page, the
   * packet generator — restate it as a claim about THIS project to a funder or
   * a board.
   *
   * A row with a DIFFERENT project is excluded and a row with NO project is
   * excluded too: an unattributed decision is not evidence about this project,
   * and treating NULL as a wildcard would put one project's verdict on every
   * other project's board — the exact defect 20260728000011 was written to fix.
   */
  projectId?: string | null;
  /**
   * Set when the decision log could not be READ, with the reason.
   *
   * Passing `[]` for `decisions` says "the log is empty". Passing this says
   * "the log is unknown". They produce different boards on purpose: the first
   * reports nine gates awaiting a decision, the second reports nine gates whose
   * state this page cannot establish. Callers should take the reason from the
   * database error — see `src/lib/ui/read-failures.ts`, which collects them.
   */
  decisionsUnavailable?: { reason: string } | null;
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
  options: ProjectStageGateSummaryOptions
): ProjectStageGateSummary {
  // Runtime-defensive on top of the required type: an untyped caller passing
  // `undefined` gets the refusal below, not a bare TypeError. It must NOT fall
  // back to the registry default here — an earlier draft of this line did, and
  // that is the very substitution the required parameter exists to end: it
  // would leave every JavaScript caller, and every place the untyped Supabase
  // seam erases the type, silently building the board on whichever template
  // happens to be the default.
  const templateId = typeof options?.templateId === "string" ? options.templateId.trim() : "";
  if (!templateId) {
    // A blank id is a caller that did not resolve the binding, not a request
    // for "whichever template". Substituting the registry default here is how
    // one jurisdiction's gates get rendered under another's name.
    throw new Error(
      "Refusing to build a stage-gate board without a bound template id: resolve the workspace's " +
        "binding (resolveWorkspaceStageGateBinding) and pass its templateId."
    );
  }

  const entry = stageGateTemplateRegistry.get(templateId);
  if (!entry) {
    throw new Error(`Unsupported stage-gate template: ${templateId}`);
  }
  const template = entry.document;

  const decisionsUnavailable = options.decisionsUnavailable ?? null;
  const scopedProjectId = options.projectId?.trim() || null;
  const readDecisions = decisionsUnavailable ? [] : (decisions ?? []);

  // A gate verdict is a judgement about ONE project, and every surface that
  // consumes this board restates it as a claim about the project in front of
  // the reader — including a generated report packet an agency sends to a
  // funder. Building the board from decisions that name no project is therefore
  // refused for the same reason an unregistered template id is: the result
  // would be wrong and indistinguishable from correct.
  //
  // An empty log is exempt because it has nothing to attribute, and so is an
  // unreadable one — the rows are discarded either way, and the board it builds
  // says only that nothing is established.
  if (!scopedProjectId && readDecisions.length > 0) {
    throw new Error(
      "Refusing to build a stage-gate board from decisions that are not scoped to a project: " +
        "pass `projectId` so one project's gate decision cannot be reported as another's."
    );
  }

  const latestDecisionByGate = new Map<string, StageGateDecisionRow>();

  // Nothing is loaded when the read failed. The map stays empty and every gate
  // resolves to `unknown` below — as opposed to an empty map from a SUCCESSFUL
  // read, which resolves to `not_started`. Same map, different claim.
  for (const decision of readDecisions) {
    if (!("project_id" in decision)) {
      // The read omitted the column, so every row is about to fail the scope
      // test and the board would render as "no decision recorded" on all nine
      // gates — a total loss of the log that looks exactly like an empty one.
      // `.select()` strings are not checked against the schema in this
      // codebase, so this is the only place the omission can be caught.
      throw new Error(
        "Refusing to scope stage-gate decisions by project: the rows carry no `project_id` field, " +
          "so the read did not select it and every decision would be dropped silently."
      );
    }
    if (decision.project_id !== scopedProjectId) continue;
    if (!latestDecisionByGate.has(decision.gate_id)) {
      latestDecisionByGate.set(decision.gate_id, decision);
    }
  }

  const gates = template.gate_order
    .map((gateId) => template.gates.find((gate) => gate.gate_id === gateId))
    .filter((gate): gate is StageGateTemplateGate => Boolean(gate))
    .map((gate) => {
      const latestDecision = latestDecisionByGate.get(gate.gate_id);
      const workflowState: StageGateWorkflowState = decisionsUnavailable
        ? "unknown"
        : normalizeDecisionState(latestDecision?.decision);
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
        decisionLabel: DECISION_LABELS[workflowState],
        // `latestDecision` is always undefined in the unknown case — the map is
        // never filled when the read failed — so the recorded rationale can only
        // win when there genuinely is one.
        rationale:
          latestDecision?.rationale?.trim() ||
          (workflowState === "unknown"
            ? `This gate's decision log could not be read (${decisionsUnavailable?.reason ?? "no reason reported"}), so whether a decision exists for it is unknown — not that none was recorded.`
            : workflowState === "not_started"
              ? "No gate decision has been recorded for this gate. That is an absence of a decision, not a failure to pass."
              : workflowState === "hold"
                ? "Gate is on hold and requires evidence closure."
                : "Gate currently passes based on the latest recorded decision."),
        decidedAt: latestDecision?.decided_at ?? null,
        missingArtifacts,
        requiredEvidenceCount: requiredEvidence.length,
        requiredEvidenceIds: requiredEvidence.map((evidence) => evidence.evidence_id),
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
  const unknownCount = gates.filter((gate) => gate.workflowState === "unknown").length;
  const blockedGate = gates.find((gate) => gate.workflowState === "hold") ?? null;
  // "Next" means the first gate not yet passed. With the log unreadable that is
  // the first gate, which is honest — it is where a reader would have to start
  // looking — and the board says the state is unknown rather than pending.
  const nextGate = gates.find((gate) => gate.workflowState !== "pass") ?? null;

  return {
    templateId: template.template_id,
    templateName: entry.descriptor.templateName,
    templateVersion: template.version,
    jurisdiction: template.jurisdiction,
    jurisdictionLabel: entry.descriptor.jurisdiction.label,
    totalGateCount: gates.length,
    passCount,
    holdCount,
    notStartedCount,
    unknownCount,
    decisionsRead: decisionsUnavailable
      ? { readable: false, reason: decisionsUnavailable.reason }
      : { readable: true },
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

/**
 * Freeze a board into the compliance snapshot a report packet carries.
 *
 * THROWS when the summary was built from a decision log that could not be read.
 * A snapshot is durable evidence: it is written into a report, cited by
 * `evidence-chain.ts`, and later compared against the live board to detect
 * drift. Minting one from an unread log would stamp "0 pass, 0 hold, 9 with no
 * decision" into a permanent artifact, where nothing downstream could ever tell
 * that it was a database error rather than a compliance posture. Refusing loudly
 * is the only outcome that cannot become a false record.
 */
export function buildProjectStageGateSnapshot(
  summary: ProjectStageGateSummary
): ProjectStageGateSnapshot {
  if (!summary.decisionsRead.readable) {
    throw new Error(
      `Refusing to snapshot stage gates: the decision log could not be read (${summary.decisionsRead.reason}), ` +
        "so the counts would record an unread log as an empty one."
    );
  }

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
