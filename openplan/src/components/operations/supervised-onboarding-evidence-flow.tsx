import { GitBranch, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { getOpenPlanRepositoryArtifactUrl } from "@/lib/operations/pilot-readiness-proof-paths";
import { getSupervisedOnboardingEvidenceFlow } from "@/lib/operations/supervised-onboarding-evidence";

type SupervisedOnboardingEvidenceFlowPanelProps = {
  context: "admin-operations" | "pilot-readiness";
};

function ProofArtifactLink({ artifact }: { artifact: string }) {
  return (
    <a
      href={getOpenPlanRepositoryArtifactUrl(artifact)}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[0.72rem] font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-4 hover:text-emerald-900 hover:decoration-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100"
      aria-label={`Open proof artifact ${artifact}`}
    >
      {artifact}
    </a>
  );
}

export function SupervisedOnboardingEvidenceFlowPanel({ context }: SupervisedOnboardingEvidenceFlowPanelProps) {
  const flow = getSupervisedOnboardingEvidenceFlow();
  const isAdminOperations = context === "admin-operations";
  const guard = flow.manualProvisioningGuard;

  return (
    <article className="module-section-surface" aria-label="Supervised onboarding evidence flow">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Onboarding evidence bridge</p>
          <h2 className="module-section-title">Supervised onboarding evidence flow</h2>
          <p className="module-section-description">{flow.summary}</p>
        </div>
        <StatusBadge tone="warning">Manual operator gate</StatusBadge>
      </div>

      <div className="mt-5 module-subpanel">
        <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
          <GitBranch className="h-3.5 w-3.5 text-emerald-700" />
          {isAdminOperations ? "Bridge this queue to pilot readiness" : "Trace the admin queue behind this packet"}
        </div>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-muted-foreground">{flow.boundary}</p>
        <p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
          Source proof: <ProofArtifactLink artifact={flow.sourceProof} />
        </p>
      </div>

      <div className="mt-4 module-subpanel" aria-label="Manual provisioning guard">
        <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
          {guard.label}
        </div>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-muted-foreground">{guard.sideEffectSummary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone="warning">Acknowledgement: {guard.acknowledgement}</StatusBadge>
          {guard.guardrails.map((guardrail) => (
            <StatusBadge key={guardrail} tone="neutral">
              {guardrail}
            </StatusBadge>
          ))}
        </div>
        <p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
          Guard proof: <ProofArtifactLink artifact={guard.proofArtifact} />
        </p>
      </div>

      <div className="mt-5 module-record-list" aria-label="Operator evidence ledger">
        {flow.operatorEvidenceLedger.map((entry) => (
          <div key={entry.key} className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone={entry.key === "manual-provisioning-guard" ? "warning" : "info"}>Evidence ledger</StatusBadge>
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {entry.proofPosture}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="module-record-title">{entry.label}</h3>
                  <p className="module-record-summary">{entry.operatorUse}</p>
                  <p className="text-xs text-muted-foreground">{entry.boundary}</p>
                  <p>
                    <ProofArtifactLink artifact={entry.proofArtifact} />
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 module-record-list">
        {flow.stages.map((stage, index) => (
          <div key={stage.key} className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone={index < 2 ? "info" : "warning"}>Step {index + 1}</StatusBadge>
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {stage.appSurface}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="module-record-title">{stage.label}</h3>
                  <p className="module-record-summary">{stage.operatorCheckpoint}</p>
                  <p className="text-xs text-muted-foreground">{stage.buyerSafeCaveat}</p>
                  <p>
                    <ProofArtifactLink artifact={stage.proofArtifact} />
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
