import fs from "fs";
import path from "path";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { ExportButton } from "./ExportButton";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata = {
  title: "Pilot Readiness Evidence Center | OpenPlan Admin",
};

interface SmokeStatus {
  lane: string;
  status: "PASS" | "FAIL" | "PENDING" | "UNKNOWN";
  lastRun: string;
  details: string;
}

function getSmokeStatus(): SmokeStatus[] {
  const rootDir = process.cwd();
  const opsDir = path.join(rootDir, "../docs/ops");

  if (!fs.existsSync(opsDir)) {
    return [{ lane: "System", status: "UNKNOWN", lastRun: "N/A", details: `Ops directory not found at ${opsDir}` }];
  }

  const files = fs.readdirSync(opsDir);
  const lanes = [
    { lane: "Authenticated Auth", regex: /openplan-production-authenticated-smoke\.md$/ },
    { lane: "County Scaffold", regex: /openplan-production-county-scaffold-smoke\.md$/ },
    { lane: "Layout Audit", regex: /openplan-production-layout-overlap-audit\.md$/ },
    { lane: "Managed Run", regex: /openplan-production-managed-run-smoke\.md$/ },
    { lane: "Scenario Comparison", regex: /openplan-production-scenario-comparison-smoke\.md$/ },
  ];

  const statusList: SmokeStatus[] = [];

  for (const { lane, regex } of lanes) {
    const matchingFiles = files.filter((file) => regex.test(file)).sort().reverse();
    if (matchingFiles.length > 0) {
      const latestFile = matchingFiles[0];
      const content = fs.readFileSync(path.join(opsDir, latestFile), "utf8");
      const isPass =
        content.includes("Status: PASS") ||
        content.includes("STATUS: PASS") ||
        content.includes("**Status**: PASS") ||
        content.includes("**STATUS**: PASS");
      const isFail =
        content.includes("Status: FAIL") ||
        content.includes("STATUS: FAIL") ||
        content.includes("**Status**: FAIL") ||
        content.includes("**STATUS**: FAIL");
      const dateMatch = latestFile.match(/^(\d{4}-\d{2}-\d{2})/);

      statusList.push({
        lane,
        status: isPass ? "PASS" : isFail ? "FAIL" : "UNKNOWN",
        lastRun: dateMatch ? dateMatch[1] : "Unknown",
        details: latestFile,
      });
    } else {
      statusList.push({
        lane,
        status: "PENDING",
        lastRun: "N/A",
        details: "No test runs found",
      });
    }
  }

  return statusList;
}

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
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
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

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {statusList.map((status) => (
            <article key={status.lane} className="module-subpanel min-h-[190px]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Check</p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{status.lane}</h3>
                </div>
                <StatusBadge tone={getStatusTone(status.status)}>{status.status}</StatusBadge>
              </div>

              <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground">Last run</div>
                  <p className="mt-1">{status.lastRun}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Evidence artifact</div>
                  <p className="mt-1 break-all">{status.details}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Interpretation</div>
                  <p className="mt-1">
                    {status.status === "PASS"
                      ? "This lane has a recent passing proof artifact available for pilot diligence."
                      : status.status === "FAIL"
                        ? "This lane currently has failing evidence and should not be described as ready without follow-up."
                        : status.status === "PENDING"
                          ? "This lane is tracked but still needs a fresh proof artifact before it can be cited confidently."
                          : "The current artifact could not be interpreted automatically. Inspect the underlying file before using it in launch-facing language."}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
