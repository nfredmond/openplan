import { FileCheck2, ShieldCheck } from "lucide-react";
import { ExportButton } from "./ExportButton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSmokeStatus, type SmokeStatus } from "@/lib/operations/pilot-readiness";

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

          <div className="mt-5 flex flex-wrap gap-3">
            <ExportButton statusList={statusList} />
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
