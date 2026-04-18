import { Clock3, FileClock, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { ProjectStageGateSummary } from "@/lib/stage-gates/summary";

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ProjectStageGateBoard({
  stageGateSummary,
}: {
  stageGateSummary: ProjectStageGateSummary;
}) {
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
              This is the project-delivery control layer: where LAPM, CEQA/VMT, outreach, and programming readiness stop being abstract and start becoming an explicit workflow.
            </p>
          </div>
        </div>
      </div>

      <div className="module-summary-grid cols-4 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Pass gates</p>
          <p className="module-summary-value">{stageGateSummary.passCount}</p>
          <p className="module-summary-detail">Recorded passes against the active California gate scaffold.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Hold gates</p>
          <p className="module-summary-value">{stageGateSummary.holdCount}</p>
          <p className="module-summary-detail">Gates currently blocked by missing evidence or unresolved rationale.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Not started</p>
          <p className="module-summary-value">{stageGateSummary.notStartedCount}</p>
          <p className="module-summary-detail">Template-defined gates with no recorded decision yet.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Next gate</p>
          <p className="module-summary-value text-base leading-tight">
            {stageGateSummary.nextGate ? `G${String(stageGateSummary.nextGate.sequence).padStart(2, "0")}` : "None"}
          </p>
          <p className="module-summary-detail">{stageGateSummary.nextGate?.name ?? "All gates currently pass."}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-5">
        <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
          <div className="flex items-center gap-3">
            <FileClock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blocking condition</p>
              <h3 className="text-sm font-semibold text-foreground">{stageGateSummary.blockedGate?.name ?? "No gate currently on formal hold"}</h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {stageGateSummary.blockedGate?.rationale ?? "Record the first hold decision to show the current blocker here."}
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
              <h3 className="text-sm font-semibold text-foreground">
                {stageGateSummary.nextGate ? `${stageGateSummary.nextGate.gateId} · ${stageGateSummary.nextGate.name}` : "Gate sequence complete"}
              </h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {stageGateSummary.nextGate
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
                <StatusBadge tone={gate.workflowState === "pass" ? "success" : gate.workflowState === "hold" ? "warning" : "neutral"}>
                  {gate.decisionLabel}
                </StatusBadge>
                <StatusBadge tone="neutral">{gate.gateId}</StatusBadge>
                <StatusBadge tone="info">{gate.requiredEvidenceCount} required evidence</StatusBadge>
                {gate.operatorControlEvidenceCount > 0 ? (
                  <StatusBadge tone="info">{gate.operatorControlEvidenceCount} PM/invoicing controls</StatusBadge>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="module-record-title">{gate.sequence}. {gate.name}</h3>
                  <p className="module-record-stamp">{gate.decidedAt ? fmtDateTime(gate.decidedAt) : "No decision yet"}</p>
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
            </div>
          </div>
        ))}
      </div>

      <div className="module-note mt-5 text-sm">
        California/LAPM alignment is honest here: OpenPlan now tracks gate logic, evidence posture, milestones, submittals, and invoicing cues, but it does not yet generate exact exhibit/form packets automatically.
      </div>
    </article>
  );
}
