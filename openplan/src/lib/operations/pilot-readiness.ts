import fs from "fs";
import path from "path";

export type SmokeStatusValue = "PASS" | "FAIL" | "PENDING" | "UNKNOWN";

export interface SmokeStatus {
  lane: string;
  status: SmokeStatusValue;
  lastRun: string;
  details: string;
}

const STATUS_HEADER_RE = /^\s*(?:\*\*)?status(?:\*\*)?\s*:\s*(PASS|FAIL|PENDING|UNKNOWN)\b/im;
const PASS_EVIDENCE_RE = /^\s*(?:[-*]\s*)?PASS(?:\s*:|\s*$)/im;
const FAIL_EVIDENCE_RE = /^\s*(?:[-*]\s*)?FAIL(?:\s*:|\s*$)/im;

const READINESS_LANES = [
  { lane: "Authenticated Auth", regex: /openplan-production-authenticated-smoke\.md$/ },
  { lane: "County Scaffold", regex: /openplan-production-county-scaffold-smoke\.md$/ },
  { lane: "Layout Audit", regex: /openplan-production-layout-overlap-audit\.md$/ },
  { lane: "Managed Run", regex: /openplan-production-managed-run-smoke\.md$/ },
  { lane: "Scenario Comparison", regex: /openplan-production-scenario-comparison-smoke\.md$/ },
  { lane: "Workspace URL Isolation", regex: /openplan-local-workspace-url-isolation-smoke\.md$/ },
  { lane: "RTP Release Review", regex: /openplan-local-rtp-release-review-smoke\.md$/ },
  { lane: "Grants Flow", regex: /openplan-local-grants-flow-smoke\.md$/ },
  { lane: "Engagement Report Handoff", regex: /openplan-local-engagement-report-handoff-smoke\.md$/ },
  { lane: "Analysis Report Linkage", regex: /openplan-local-analysis-report-linkage-smoke\.md$/ },
  { lane: "Phase 1 Spine", regex: /openplan-local-spine-smoke\.md$/ },
  { lane: "Aerial Evidence Spine", regex: /openplan-local-aerial-evidence-smoke\.md$/ },
  { lane: "Admin Support Flow", regex: /openplan-local-admin-support-flow-smoke\.md$/ },
  { lane: "Production Admin Operations Auth", regex: /openplan-production-admin-operations-authenticated-smoke\.md$/ },
];

function defaultOpsDir() {
  return path.join(process.cwd(), "../docs/ops");
}

export function parseSmokeStatus(content: string): SmokeStatusValue {
  const explicitStatus = content.match(STATUS_HEADER_RE)?.[1]?.toUpperCase() as SmokeStatusValue | undefined;
  if (explicitStatus) return explicitStatus;

  if (FAIL_EVIDENCE_RE.test(content)) return "FAIL";
  if (PASS_EVIDENCE_RE.test(content)) return "PASS";

  return "UNKNOWN";
}

export function getSmokeStatus(opsDir = defaultOpsDir()): SmokeStatus[] {
  if (!fs.existsSync(opsDir)) {
    return [{ lane: "System", status: "UNKNOWN", lastRun: "N/A", details: `Ops directory not found at ${opsDir}` }];
  }

  const files = fs.readdirSync(opsDir);
  const statusList: SmokeStatus[] = [];

  for (const { lane, regex } of READINESS_LANES) {
    const matchingFiles = files.filter((file) => regex.test(file)).sort().reverse();
    if (matchingFiles.length > 0) {
      const latestFile = matchingFiles[0];
      const content = fs.readFileSync(path.join(opsDir, latestFile), "utf8");
      const dateMatch = latestFile.match(/^(\d{4}-\d{2}-\d{2})/);

      statusList.push({
        lane,
        status: parseSmokeStatus(content),
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
