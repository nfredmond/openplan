import { FileCheck2, ShieldCheck } from "lucide-react";
import { ExportButton } from "./ExportButton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSmokeStatus, type SmokeStatus } from "@/lib/operations/pilot-readiness";
import {
  finalPilotReadinessChecklistSync,
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

function buildReadinessHeadline(statusList: SmokeStatus[]): { label: string; detail: string; tone: "success" | "danger" | "warning" | "neutral" } {
  const failCount = statusList.filter((item) => item.status === "FAIL").length;
  const pendingCount = statusList.filter((item) => item.status === "PENDING").length;
  const passCount = statusList.filter((item) => item.status === "PASS").length;

  if (failCount > 0) {
    return {
      label: "Follow-up required",
      detail: `${failCount} readiness lane${failCount === 1 ? " is" : "s are"} currently failing.`,
      tone: "danger",
    };
  }

  if (passCount > 0 && pendingCount > 0) {
    return {
      label: "Evidence current with open gaps",
      detail: `${passCount} lane${passCount === 1 ? " shows" : "s show"} recent passing evidence while ${pendingCount} still need fresh proof.`,
      tone: "warning",
    };
  }

  if (passCount > 0) {
    return {
      label: "Evidence current",
      detail: "All tracked readiness lanes currently show passing proof artifacts.",
      tone: "success",
    };
  }

  return {
    label: "Evidence still forming",
    detail: "No passing proof artifacts are available yet for the tracked readiness lanes.",
    tone: "neutral",
  };
}

export default function PilotReadinessPage() {
  const statusList = getSmokeStatus();
  const passCount = statusList.filter((item) => item.status === "PASS").length;
  const failCount = statusList.filter((item) => item.status === "FAIL").length;
  const pendingCount = statusList.filter((item) => item.status === "PENDING").length;
  const latestEvidenceDate = statusList
    .map((item) => item.lastRun)
    .filter((value) => value !== "N/A" && value !== "Unknown")
    .sort()
    .reverse()[0] ?? "No dated proof yet";
  const readinessHeadline = buildReadinessHeadline(statusList);
  const salesCaveatProof =
    releaseProofPosture.proofItems.find((item) => item.key === "sales-caveats") ?? releaseProofPosture.proofItems[0];

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <FileCheck2 className="h-3.5 w-3.5" />
            Readiness status
          </div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={readinessHeadline.tone}>{readinessHeadline.label}</StatusBadge>
              <StatusBadge tone="neutral">Latest evidence: {latestEvidenceDate}</StatusBadge>
            </div>
            <h1 className="module-intro-title">Readiness overview</h1>
            <p className="module-intro-description">
              Track the latest smoke-test results, see which areas are healthy, and export a shareable summary of the
              current status.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Passing checks</p>
              <p className="module-summary-value">{passCount}</p>
              <p className="module-summary-detail">Checks with a recent passing result.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Failing checks</p>
              <p className="module-summary-value">{failCount}</p>
              <p className="module-summary-detail">Checks that need follow-up before they can be treated as healthy.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pending checks</p>
              <p className="module-summary-value">{pendingCount}</p>
              <p className="module-summary-detail">Tracked checks that still need a recent result.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Export</p>
              <p className="module-summary-value">Ready</p>
              <p className="module-summary-detail">Generate a markdown summary from the current status list.</p>
            </div>
          </div>

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
              <h2 className="module-operator-title">{readinessHeadline.label}</h2>
            </div>
          </div>
          <p className="module-operator-copy">{readinessHeadline.detail}</p>
          <div className="module-operator-list">
            <div className="module-operator-item">This page shows recorded results rather than planned work.</div>
            <div className="module-operator-item">Each check stays visible even when the latest result is missing, pending, or failing.</div>
            <div className="module-operator-item">Use the exported summary as a status snapshot, then follow up in the source documents when more detail is needed.</div>
          </div>
        </article>
      </header>

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
                    {finalPilotReadinessChecklistSync.checklistArtifact}
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
                      <li key={filename}>{filename}</li>
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
                    <p className="font-mono text-[0.72rem] text-muted-foreground">{artifact.artifact}</p>
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
            <h2 className="module-section-title">Which artifacts support sale and pilot readiness</h2>
            <p className="module-section-description">
              The export below uses the same release-proof posture as Command Center, so operators can see the source
              artifact, what it supports, and which caveats must travel with the claim.
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
                    <p className="font-mono text-[0.72rem] text-muted-foreground">{item.artifact}</p>
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
            <h2 className="module-section-title">Latest results by app surface</h2>
            <p className="module-section-description">
              Each card below shows the latest result we could find for that check.
            </p>
          </div>
        </div>

        <div className="mt-5 module-record-list">
          {statusList.map((status) => (
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
                    <p className="module-record-summary break-all">
                      {status.details}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                {status.status === "PASS"
                  ? "Recent passing proof artifact available for pilot diligence."
                  : status.status === "FAIL"
                    ? "Failing evidence — needs follow-up before this lane can be cited as ready."
                    : status.status === "PENDING"
                      ? "Tracked but still needs a fresh proof artifact."
                      : "Could not be interpreted automatically. Inspect the source file directly."}
              </p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
