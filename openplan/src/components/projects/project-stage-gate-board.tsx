import { Clock3, FileClock, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { StateBlock } from "@/components/ui/state-block";
import { StageGateDecisionRecorder } from "@/components/projects/stage-gate-decision-recorder";
import type { ProjectStageGateSummary, StageGateWorkflowState } from "@/lib/stage-gates/summary";

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * What a count reads as. A number when the decision log loaded, an em dash when
 * it did not — because "0 pass gates" and "we could not find out" are different
 * statements about a planner's compliance posture, and only one of them is a
 * fact this page has established.
 */
function countOrUnknown(summary: ProjectStageGateSummary, value: number): string {
  return summary.decisionsRead.readable ? String(value) : "—";
}

function badgeTone(state: StageGateWorkflowState): "success" | "warning" | "neutral" {
  if (state === "pass") return "success";
  if (state === "hold") return "warning";
  // "no decision recorded" and "not readable" both read neutral: neither is a
  // failure, and styling either as one would put a verdict on screen that nobody
  // recorded.
  return "neutral";
}

export function ProjectStageGateBoard({
  stageGateSummary,
  workspaceId,
  projectId,
  canRecordDecision,
}: {
  stageGateSummary: ProjectStageGateSummary;
  workspaceId: string;
  projectId: string;
  /** False for the read-only viewer tier — see `StageGateDecisionRecorder`. */
  canRecordDecision: boolean;
}) {
  const decisionsUnreadable = !stageGateSummary.decisionsRead.readable;

  return (
    <article id="project-governance" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Governance</p>
            <h2 className="module-section-title">Stage-gate compliance cockpit</h2>
            <p className="module-section-description">
              This is the project-delivery control layer: where the bound template&apos;s statutory,
              environmental, outreach, and programming checkpoints stop being abstract and start
              becoming an explicit workflow. It counts decisions recorded against this project
              only — a decision recorded on another project is not evidence about this one.
            </p>
          </div>
        </div>
      </div>

      {/*
        The distinction the whole board turns on. A failed read renders every
        gate empty, and the empty-state copy — written for "nobody has decided
        yet" — would then state a database error as a compliance finding. So the
        failure is disclosed first, by name, and every count below it refuses to
        print a number.
      */}
      {!stageGateSummary.decisionsRead.readable ? (
        <StateBlock
          tone="danger"
          className="mt-5"
          title="This project's gate decisions could not be read"
          description={`Nothing below is a finding: the gates are shown with an unknown state rather than as undecided, because the decision log did not load (${stageGateSummary.decisionsRead.reason}). An empty board here would not mean no decisions exist.`}
        />
      ) : null}

      <div className="module-summary-grid cols-4 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Pass gates</p>
          <p className="module-summary-value">{countOrUnknown(stageGateSummary, stageGateSummary.passCount)}</p>
          {/* The jurisdiction is READ from the bound template, never written into
              this copy. It used to say "the active California gate scaffold" —
              a literal that told an Ohio agency it was on California's gates. */}
          <p className="module-summary-detail">
            Recorded passes against {stageGateSummary.templateName} ({stageGateSummary.jurisdictionLabel}),
            the template bound to this workspace.
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Hold gates</p>
          <p className="module-summary-value">{countOrUnknown(stageGateSummary, stageGateSummary.holdCount)}</p>
          <p className="module-summary-detail">Gates currently blocked by missing evidence or unresolved rationale.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">
            {decisionsUnreadable ? "State unknown" : "No decision recorded"}
          </p>
          <p className="module-summary-value">
            {decisionsUnreadable
              ? String(stageGateSummary.unknownCount)
              : String(stageGateSummary.notStartedCount)}
          </p>
          <p className="module-summary-detail">
            {decisionsUnreadable
              ? "Gates whose state this page could not establish. Not a count of undecided gates."
              : "Template-defined gates nobody has recorded a decision on. Not a count of failures."}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Next gate</p>
          {/*
            "Next" means the first gate not yet passed, so it is derived ENTIRELY
            from the decision log. With the log unreadable the builder still
            returns the first gate — the honest place to start looking — but
            printing its id here would state a sequencing fact this page has not
            established, next to three cards that correctly refuse to print one.
          */}
          <p className="module-summary-value text-base leading-tight">
            {decisionsUnreadable
              ? "—"
              : stageGateSummary.nextGate
                ? `G${String(stageGateSummary.nextGate.sequence).padStart(2, "0")}`
                : "None"}
          </p>
          <p className="module-summary-detail">
            {decisionsUnreadable
              ? "Which gate is next depends on which have passed, and the decision log did not load."
              : (stageGateSummary.nextGate?.name ?? "All gates currently pass.")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-5">
        <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
          <div className="flex items-center gap-3">
            <FileClock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blocking condition</p>
              <h3 className="text-sm font-semibold text-foreground">
                {stageGateSummary.blockedGate?.name ??
                  (decisionsUnreadable
                    ? "Whether any gate is on hold is unknown"
                    : "No gate currently on formal hold")}
              </h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {stageGateSummary.blockedGate?.rationale ??
              (decisionsUnreadable
                ? "The decision log did not load, so this page cannot say whether a hold exists."
                : "Record the first hold decision to show the current blocker here.")}
          </p>
          {stageGateSummary.blockedGate?.missingArtifacts.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {stageGateSummary.blockedGate.missingArtifacts.map((artifact) => (
                <StatusBadge key={artifact} tone="warning">Missing {artifact}</StatusBadge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
          <div className="flex items-center gap-3">
            <Clock3 className="h-5 w-5 text-sky-500" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Readiness cue</p>
              {/*
                Guarded on the same fact as the "Next gate" card above, and for
                the same reason: this cue is derived ENTIRELY from which gates
                have passed. With the log unreadable the builder still returns
                the first gate, so naming it here — and telling a planner to
                build its evidence pack — would issue a work instruction premised
                on a sequencing fact this page never established, two rows below
                a card that correctly refuses to print it.
              */}
              <h3 className="text-sm font-semibold text-foreground">
                {decisionsUnreadable
                  ? "Which gate is next is unknown"
                  : stageGateSummary.nextGate
                    ? `${stageGateSummary.nextGate.gateId} · ${stageGateSummary.nextGate.name}`
                    : "Gate sequence complete"}
              </h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {decisionsUnreadable
              ? "The next gate follows from which gates have already passed, and the decision log did not load — so no evidence-pack cue is offered here. Reload once the read succeeds."
              : stageGateSummary.nextGate
                ? `${stageGateSummary.nextGate.requiredEvidenceCount} required evidence item${stageGateSummary.nextGate.requiredEvidenceCount === 1 ? "" : "s"} defined in the active template. ${stageGateSummary.nextGate.operatorControlEvidenceCount > 0 ? `${stageGateSummary.nextGate.operatorControlEvidenceCount} PM/invoicing control profile${stageGateSummary.nextGate.operatorControlEvidenceCount === 1 ? " is" : "s are"} available for this review.` : "Build the evidence pack before expecting a pass decision."}`
                : "Every stage gate in the active template currently has a recorded PASS decision."}
          </p>
        </div>
      </div>

      <div className="mt-5 module-record-list">
        {stageGateSummary.gates.map((gate) => (
          <div key={gate.gateId} className="module-record-row">
            <div className="module-record-main">
              <div className="module-record-kicker">
                <StatusBadge tone={badgeTone(gate.workflowState)}>{gate.decisionLabel}</StatusBadge>
                <StatusBadge tone="neutral">{gate.gateId}</StatusBadge>
                <StatusBadge tone="info">{gate.requiredEvidenceCount} required evidence</StatusBadge>
                {gate.operatorControlEvidenceCount > 0 ? (
                  <StatusBadge tone="info">{gate.operatorControlEvidenceCount} PM/invoicing controls</StatusBadge>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="module-record-title">{gate.sequence}. {gate.name}</h3>
                  <p className="module-record-stamp">
                    {gate.decidedAt
                      ? fmtDateTime(gate.decidedAt)
                      : gate.workflowState === "unknown"
                        ? "Unknown"
                        : "No decision recorded"}
                  </p>
                </div>
                <p className="module-record-summary">{gate.rationale}</p>
              </div>

              <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                {[
                  ...gate.lapmMappings.slice(0, 2).map((item) => `LAPM ${item}`),
                  ...gate.ceqaVmtMappings.slice(0, 2).map((item) => `CEQA/VMT ${item}`),
                  ...gate.outreachMappings.slice(0, 1).map((item) => `Outreach ${item}`),
                  ...gate.stipRtipMappings.slice(0, 1).map((item) => `Programming ${item}`),
                ].join(" · ") || "No compliance mappings recorded"}
              </p>

              {gate.evidencePreview.length > 0 ? (
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Evidence preview</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {gate.evidencePreview.map((evidence) => (
                      <li key={evidence.evidence_id}>
                        <div>
                          {evidence.title}
                          {evidence.conditional_required_when ? ` (${evidence.conditional_required_when})` : ""}
                        </div>
                        {evidence.operatorControlTitle ? (
                          <div className="mt-1 space-y-1 pl-1 text-xs text-muted-foreground">
                            <p>
                              PM/invoicing controls: {evidence.operatorControlTitle} · {evidence.operatorControlFieldCount} field{evidence.operatorControlFieldCount === 1 ? "" : "s"}
                            </p>
                            {evidence.operatorControlGoal ? <p>{evidence.operatorControlGoal}</p> : null}
                            {evidence.operatorControlAcceptancePreview.length > 0 ? (
                              <ul className="list-disc space-y-1 pl-5">
                                {evidence.operatorControlAcceptancePreview.map((criterion) => (
                                  <li key={`${evidence.evidence_id}-${criterion}`}>{criterion}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {gate.missingArtifacts.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {gate.missingArtifacts.map((artifact) => (
                    <StatusBadge key={`${gate.gateId}-${artifact}`} tone="warning">Missing {artifact}</StatusBadge>
                  ))}
                </div>
              ) : null}

              {/*
                Recording stays available even when the log could not be READ.
                The two are separate permissions and separate failures, and
                hiding the control would turn a read outage into a write outage.
                The board says the current state is unknown; it does not pretend
                a decision cannot be made.
              */}
              <StageGateDecisionRecorder
                workspaceId={workspaceId}
                projectId={projectId}
                canWrite={canRecordDecision}
                gate={{ gateId: gate.gateId, gateName: gate.name, sequence: gate.sequence }}
                // The example evidence id comes from THIS gate's own required
                // evidence, never from a literal. A hint like "G02_E03" is the
                // California pack's vocabulary; a pack authored for anywhere
                // else numbers its evidence differently, and a placeholder that
                // does not match the template a planner is looking at is a
                // small, confident piece of misinformation.
                evidenceIdExample={gate.evidencePreview[0]?.evidence_id ?? null}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="module-note mt-5 text-sm">
        Template alignment is honest here: OpenPlan tracks gate logic, evidence posture, milestones,
        submittals, and invoicing cues, and now records the pass/hold decisions themselves — but it
        does not yet generate exact exhibit/form packets automatically.
      </div>
    </article>
  );
}
