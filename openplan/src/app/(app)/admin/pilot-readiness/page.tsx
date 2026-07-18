import { FileCheck2, ShieldCheck, TerminalSquare } from "lucide-react";
import { ExportButton } from "./ExportButton";
import { SupervisedOnboardingEvidenceFlowPanel } from "@/components/operations/supervised-onboarding-evidence-flow";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildPilotReadinessControlSummary } from "@/lib/operations/admin-operator-control";
import { getSmokeStatus, type SmokeStatus } from "@/lib/operations/pilot-readiness";
import { getOpenPlanRepositoryArtifactUrl } from "@/lib/operations/pilot-readiness-proof-paths";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactCategoryLabel,
  getAdminPilotReadinessProofArtifactIndex,
  getAdminPilotReadinessProofHubSteps,
  getReleaseProofItemCaveats,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";

export const metadata = {
  title: "Pilot Readiness Evidence Center | OpenPlan Admin",
};

function getStatusTone(status: SmokeStatus["status"]): "success" | "danger" | "warning" | "neutral" {
  if (status === "PASS") return "success";
  if (status === "FAIL") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

function getStatusProofArtifact(status: SmokeStatus) {
  if (status.proofArtifact) return status.proofArtifact;

  const details = status.details.trim();
  if (!details || details === "No test runs found") return null;
  if (!/\.(md|html|pdf|ts|tsx|mjs|json)$/i.test(details)) return null;

  return details.includes("/") ? details : `docs/ops/${details}`;
}

function ProofArtifactLink({ artifact, href, contextLabel }: { artifact: string; href?: string; contextLabel?: string }) {
  const linkContext = contextLabel ? ` for ${contextLabel}` : "";

  return (
    <a
      href={href ?? getOpenPlanRepositoryArtifactUrl(artifact)}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[0.72rem] font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-4 hover:text-emerald-900 hover:decoration-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100"
      aria-label={`Open proof artifact ${artifact}${linkContext}`}
    >
      {artifact}
    </a>
  );
}

export default function PilotReadinessPage() {
  const statusList = getSmokeStatus();
  const pilotControl = buildPilotReadinessControlSummary(statusList);
  const proofArtifactIndex = getAdminPilotReadinessProofArtifactIndex();
  const proofHubSteps = getAdminPilotReadinessProofHubSteps();
  const salesCaveatProof =
    releaseProofPosture.proofItems.find((item) => item.key === "sales-caveats") ?? releaseProofPosture.proofItems[0];

  return (
    <section className="module-page" aria-labelledby="pilot-readiness-ledger-title">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <FileCheck2 className="h-3.5 w-3.5" />
            Readiness status
          </div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={pilotControl.tone}>{pilotControl.label}</StatusBadge>
              <StatusBadge tone="neutral">Latest evidence: {pilotControl.latestEvidenceDate}</StatusBadge>
            </div>
            <h1 id="pilot-readiness-ledger-title" className="module-intro-title">Pilot readiness evidence ledger</h1>
            <p className="module-intro-description">
              Read the latest smoke-test evidence as an operator ledger: what is citeable, what needs repair, and which
              caveats must travel with any supervised pilot conversation. This is evidence review, not buyer
              authorization or a launch certificate.
            </p>
          </div>

          <dl
            aria-label="Pilot readiness evidence ledger"
            className="mt-6 divide-y divide-border/70 border-y border-border/80"
          >
            <div className="grid gap-2 py-3 sm:grid-cols-[11rem_4rem_minmax(0,1fr)] sm:items-baseline">
              <dt id="pilot-readiness-ledger-passing-label" className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Passing checks
              </dt>
              <dd aria-label="Passing checks count" aria-describedby="pilot-readiness-ledger-passing-label" className="font-mono text-xl font-semibold text-emerald-700 dark:text-emerald-200">
                {pilotControl.counts.pass}
              </dd>
              <dd className="text-sm leading-relaxed text-muted-foreground">
                Recent proof artifacts that may be cited after source-document review.
              </dd>
            </div>
            <div className="grid gap-2 py-3 sm:grid-cols-[11rem_4rem_minmax(0,1fr)] sm:items-baseline">
              <dt id="pilot-readiness-ledger-failing-label" className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Failing checks
              </dt>
              <dd aria-label="Failing checks count" aria-describedby="pilot-readiness-ledger-failing-label" className="font-mono text-xl font-semibold text-rose-700 dark:text-rose-200">
                {pilotControl.counts.fail}
              </dd>
              <dd className="text-sm leading-relaxed text-muted-foreground">
                Lanes requiring repair before the evidence appears in buyer or SOW language.
              </dd>
            </div>
            <div className="grid gap-2 py-3 sm:grid-cols-[11rem_4rem_minmax(0,1fr)] sm:items-baseline">
              <dt id="pilot-readiness-ledger-pending-label" className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Pending checks
              </dt>
              <dd aria-label="Pending checks count" aria-describedby="pilot-readiness-ledger-pending-label" className="font-mono text-xl font-semibold text-amber-700 dark:text-amber-200">
                {pilotControl.counts.pending}
              </dd>
              <dd className="text-sm leading-relaxed text-muted-foreground">
                Tracked lanes missing a current artifact; do not cite them as ready.
              </dd>
            </div>
            <div className="grid gap-2 py-3 sm:grid-cols-[11rem_4rem_minmax(0,1fr)] sm:items-baseline">
              <dt id="pilot-readiness-ledger-caveats-label" className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Caveats
              </dt>
              <dd aria-label="Required caveats count" aria-describedby="pilot-readiness-ledger-caveats-label" className="font-mono text-xl font-semibold text-foreground">
                {pilotControl.requiredCaveatCount}
              </dd>
              <dd className="text-sm leading-relaxed text-muted-foreground">
                Required boundaries for supervised onboarding, billing proof, modeling, AI, legal/compliance, and hosting
                terms.
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ExportButton statusList={statusList} />
            <div
              aria-label="Export caveat sync status"
              className="flex max-w-2xl items-start gap-3 rounded-[0.75rem] border border-emerald-300/40 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/45 dark:bg-emerald-950/20 dark:text-emerald-100"
            >
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <span>
                <span className="block font-medium">Export caveats mirror Command Center release proof.</span>
                <span className="block text-emerald-900/80 dark:text-emerald-100/75">
                  The packet reuses {releaseProofPosture.caveats.length} required caveats and {releaseProofPosture.proofItems.length} proof artifacts from the shared release-proof posture; final checklist source: {finalPilotReadinessChecklistSync.checklistArtifact}; caveat source: {salesCaveatProof.artifact}.
                </span>
              </span>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Status summary</p>
              <h2 className="module-operator-title">{pilotControl.label}</h2>
            </div>
          </div>
          <p className="module-operator-copy">{pilotControl.detail}</p>
          <div className="module-operator-list">
            <div className="module-operator-item">This page shows recorded results rather than planned work.</div>
            <div className="module-operator-item">Each check stays visible even when the latest result is missing, pending, or failing.</div>
            <div className="module-operator-item">Use the exported summary as an operator snapshot, then verify source documents before external reliance.</div>
            <div className="module-operator-item">Preflight posture: {pilotControl.preflightPosture}</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Deployment preflight posture</p>
            <h2 className="module-section-title">Run a read-only preflight before outward reliance</h2>
            <p className="module-section-description">
              The preflight is an operator check, not a deployment trigger or self-serve activation path. The proof note
              below defines when to run it, how to read ATTENTION items, and which safety boundaries must stay intact.
            </p>
          </div>
          <StatusBadge tone="warning">Manual operator gate</StatusBadge>
        </div>
        <div className="mt-5 module-subpanel">
          <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
            <TerminalSquare className="h-3.5 w-3.5 text-emerald-700" />
            Read-only command
          </div>
          <code className="mt-2 block break-words rounded border border-border/70 bg-muted/15 px-2 py-1.5 text-[0.72rem] text-foreground/80">
            {pilotControl.preflightCommand}
          </code>
          <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
            {pilotControl.preflightOperatorInstruction}
          </p>
          <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Proof source
              </p>
              <p className="mt-1 break-all font-mono text-[0.72rem] text-muted-foreground">
                <ProofArtifactLink artifact={pilotControl.preflightProofArtifact} contextLabel="deployment preflight proof source" />
              </p>
            </div>
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Boundary
              </p>
              <p className="mt-1 text-[0.78rem] leading-relaxed text-muted-foreground">
                {pilotControl.preflightProofScope} {pilotControl.supervisedBoundary} {pilotControl.proofPacketCaveat}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
            No commands run in the browser; no schema changes, production writes, workspace provisioning, billing activity,
            or autonomous readiness claims are triggered from this panel.
          </p>
        </div>
      </article>

      <article className="module-section-surface" aria-label="Pilot readiness proof and document hub guide">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Proof/doc hub guide</p>
            <h2 className="module-section-title">How to use this evidence center without overclaiming readiness</h2>
            <p className="module-section-description">
              Follow these rows in order before a buyer call or pilot handoff. The page is a navigation hub for source
              documents; it is not the evidence itself and it does not certify a finished product suite.
            </p>
          </div>
          <StatusBadge tone="warning">Source docs before claims</StatusBadge>
        </div>

        <ol className="mt-5 module-record-list" aria-label="Pilot readiness proof and document hub source sequence">
          {proofHubSteps.map((step) => (
            <li key={step.key} className="module-record-row" aria-labelledby={`pilot-readiness-proof-hub-${step.key}-title`}>
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-50 text-[0.72rem] font-semibold text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950/35 dark:text-emerald-100">
                      {step.order}
                    </span>
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Operator sequence
                    </span>
                  </div>
                  <div className="space-y-2">
                    <h3 id={`pilot-readiness-proof-hub-${step.key}-title`} className="module-record-title">{step.label}</h3>
                    <p className="module-record-summary">{step.operatorAction}</p>
                    <dl className="grid gap-2 text-[0.76rem] leading-relaxed text-muted-foreground md:grid-cols-3">
                      <div>
                        <dt className="font-semibold text-foreground">Evidence anchor</dt>
                        <dd>{step.evidenceAnchor}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-foreground">Safe citation</dt>
                        <dd>{step.citeOnly}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-foreground">Stop condition</dt>
                        <dd>{step.stopCondition}</dd>
                      </div>
                    </dl>
                    <p>
                      <ProofArtifactLink artifact={step.artifact} contextLabel={`proof/doc hub step ${step.order}: ${step.label}`} />
                    </p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </article>

      <article className="module-section-surface" aria-label="Compact proof artifact index">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Proof artifact index</p>
            <h2 className="module-section-title">Current packet docs, static exports, and preflight proof</h2>
            <p className="module-section-description">
              A compact helper for buyer-safe review: proof packet documents, the generated MD/HTML/PDF sales packet,
              and the read-only preflight proof note stay visible without implying self-serve activation or broader claims.
            </p>
          </div>
          <StatusBadge tone="warning">Buyer-safe caveats required</StatusBadge>
        </div>

        <div className="mt-5 module-record-list">
          {proofArtifactIndex.map((item) => (
            <div key={item.key} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={item.category === "preflight-proof" ? "warning" : "neutral"}>
                      {getAdminPilotReadinessProofArtifactCategoryLabel(item.category)}
                    </StatusBadge>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="module-record-title">{item.label}</h3>
                    <p className="module-record-summary">{item.operatorUse}</p>
                    <p className="text-xs text-muted-foreground">{item.buyerSafeCaveat}</p>
                    <p>
                      <ProofArtifactLink artifact={item.artifact} contextLabel={`proof artifact index item: ${item.label}`} />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>

      <SupervisedOnboardingEvidenceFlowPanel context="pilot-readiness" />

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Final checklist sync</p>
            <h2 className="module-section-title">Export filenames and caveats before buyer reliance</h2>
            <p className="module-section-description">
              {finalPilotReadinessChecklistSync.operatorInstruction}
            </p>
          </div>
          <StatusBadge tone="warning">Human review before external use</StatusBadge>
        </div>

        <div className="mt-5 module-record-list">
          <div className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone="success">Checklist</StatusBadge>
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Supervised pilot posture
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="module-record-title">{finalPilotReadinessChecklistSync.verdict}</h3>
                  <p className="module-record-summary">{finalPilotReadinessChecklistSync.supervisedOnboardingCaveat}</p>
                  <p className="font-mono text-[0.72rem] text-muted-foreground">
                    <ProofArtifactLink artifact={finalPilotReadinessChecklistSync.checklistArtifact} contextLabel="final checklist sync source" />
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone="neutral">Packet files</StatusBadge>
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Generated export surface
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="module-record-title">Admin Pilot Readiness proof packet filenames</h3>
                  <ul className="space-y-1 font-mono text-[0.72rem] text-muted-foreground">
                    {finalPilotReadinessChecklistSync.exportFilenames.map((filename) => (
                      <li key={filename}>
                        <ProofArtifactLink artifact={filename} contextLabel="generated packet file" />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => (
            <div key={artifact.artifact} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone="info">Latest proof lane</StatusBadge>
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Synced from final checklist
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="module-record-title">{artifact.label}</h3>
                    <p className="module-record-summary">{artifact.role}</p>
                    <p className="text-xs text-muted-foreground">{artifact.caveat}</p>
                    <p>
                      <ProofArtifactLink artifact={artifact.artifact} contextLabel={`latest proof lane: ${artifact.label}`} />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Release-proof drilldown</p>
            <h2 className="module-section-title">Which artifacts support supervised sale and pilot review</h2>
            <p className="module-section-description">
              The export below uses the same release-proof posture as Command Center, so operators can see the source
              artifact, the narrow claim it supports, and which caveats must travel with that language.
            </p>
          </div>
          <StatusBadge tone="warning">Supervised workbench</StatusBadge>
        </div>

        <div className="mt-5 module-record-list">
          {releaseProofPosture.proofItems.map((item) => (
            <div key={item.key} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={item.status === "pass" ? "success" : item.status === "next" ? "info" : "warning"}>
                      {item.label}
                    </StatusBadge>
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {item.status === "pass" ? "Evidence" : item.status === "next" ? "Next check" : "Caveat source"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="module-record-title">{item.headline}</h3>
                    <p className="module-record-summary">{item.readinessRole}</p>
                    <p className="text-xs text-muted-foreground">{item.operatorCheck}</p>
                    <p>
                      <ProofArtifactLink artifact={item.artifact} contextLabel={`release-proof drilldown item: ${item.label}`} />
                    </p>
                    <p className="text-[0.72rem] text-muted-foreground">
                      Caveats: {getReleaseProofItemCaveats(item).map((caveat) => caveat.label).join(" · ")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Tracked checks</p>
            <h2 className="module-section-title">Latest proof results by app surface</h2>
            <p className="module-section-description">
              Each row shows the latest parsed result for that check; cite only the source artifact, not the dashboard row.
            </p>
          </div>
        </div>

        <div className="mt-5 module-record-list">
          {statusList.map((status) => {
            const proofArtifact = getStatusProofArtifact(status);
            const proofArtifactHref = proofArtifact
              ? (status.proofArtifactHref ?? getOpenPlanRepositoryArtifactUrl(proofArtifact))
              : null;

            return (
              <div key={status.lane} className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={getStatusTone(status.status)}>{status.status}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{status.lane}</h3>
                        <p className="module-record-stamp">Last run: {status.lastRun}</p>
                      </div>
                      <p className="module-record-summary break-all">{status.details}</p>
                      {proofArtifact ? (
                        <p className="text-[0.72rem] text-muted-foreground">
                          Exact proof: <ProofArtifactLink artifact={proofArtifact} href={proofArtifactHref ?? undefined} contextLabel={`tracked check: ${status.lane}`} />
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                  {status.status === "PASS"
                    ? "Passing proof artifact available for supervised pilot diligence."
                    : status.status === "FAIL"
                      ? "Failing evidence — needs follow-up before this lane can be cited as ready."
                      : status.status === "PENDING"
                        ? "Tracked but still needs a fresh proof artifact."
                        : "Could not be interpreted automatically. Inspect the source file directly."}
                </p>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
