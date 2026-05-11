import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractMarkdownTableRows,
  getMarkdownSection,
  unresolvedLocalMarkdownLinks,
} from "./markdown-proof-helpers";

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..");

const bridgePath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md");
const adminRunbookPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-admin-operations-smoke-runbook.md");
const prodHealthHelperPath = path.join(repoRoot, "docs/ops/2026-05-10-prod-health-evidence-log-helper.md");
const opsReadmePath = path.join(repoRoot, "docs/ops/README.md");
const checklistPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md");
const appRunbookPath = path.join(appRoot, "docs/ops/RUNBOOK.md");

const bridge = readFileSync(bridgePath, "utf8");
const adminRunbook = readFileSync(adminRunbookPath, "utf8");
const prodHealthHelper = readFileSync(prodHealthHelperPath, "utf8");
const opsReadme = readFileSync(opsReadmePath, "utf8");
const checklist = readFileSync(checklistPath, "utf8");
const appRunbook = readFileSync(appRunbookPath, "utf8");

const bridgeLink =
  "[Admin Ops → Production Health Evidence Bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md)";
const lowerBridgeLink =
  "[admin ops to prod-health bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md)";
const prodHealthLink = "[prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md)";
const adminRunbookLink = "[Admin Operations Smoke Runbook](2026-05-10-openplan-admin-operations-smoke-runbook.md)";

const requiredBridgeSteps = [
  "1. Confirm deploy target",
  "2. Log production health evidence",
  "3. Run admin ops preflight",
  "4. Optional authenticated page smoke",
  "5. Write a bridge note",
];

const prohibitedPatterns = [
  /prospect PII captured:\s*yes/i,
  /rows changed:\s*yes/i,
  /triage\/provisioning clicks:\s*yes/i,
  /emails sent:\s*yes/i,
  /Supabase writes or migrations:\s*yes/i,
];

describe("admin ops to production health evidence bridge", () => {
  it("keeps the bridge doc local, resolvable, and bounded to no-write evidence sequencing", () => {
    expect(unresolvedLocalMarkdownLinks(bridgePath, bridge)).toEqual([]);
    expect(bridge).toContain("Read-only / no-production-write / no-secret / no-PII evidence discipline");
    expect(bridge).toContain("Gate decision: PASS");
    expect(bridge).toContain("No production Supabase writes, schema changes");
    expect(bridge).toContain("No prospect PII, cookies, magic links, invitation URLs");
    expect(bridge).toContain("Supabase writes or migrations: no");
    expect(bridge).toContain(prodHealthLink);
    expect(bridge).toContain(adminRunbookLink);
  });

  it("defines the exact bridge sequence from deployment health logging to admin proof handoff", () => {
    const rows = extractMarkdownTableRows(getMarkdownSection(bridge, "Bridge Sequence"));

    expect(rows.map((row) => row[0])).toEqual(requiredBridgeSteps);
    expect(rows[1][1]).toContain(prodHealthLink);
    expect(rows[1][2]).toContain("Gate decision: PASS");
    expect(rows[2][1]).toContain(adminRunbookLink);
    expect(rows[2][3]).toContain("Mask reviewer email");
    expect(rows[3][3]).toContain("no prospect PII");
    expect(rows[4][3]).toContain("no customer/prospect data");
  });

  it("cross-links the admin runbook, prod-health helper, ops index, final checklist, and incident runbook", () => {
    expect(unresolvedLocalMarkdownLinks(adminRunbookPath, adminRunbook)).toEqual([]);
    expect(unresolvedLocalMarkdownLinks(prodHealthHelperPath, prodHealthHelper)).toEqual([]);
    expect(unresolvedLocalMarkdownLinks(opsReadmePath, opsReadme)).toEqual([]);
    expect(unresolvedLocalMarkdownLinks(checklistPath, checklist)).toEqual([]);
    expect(unresolvedLocalMarkdownLinks(appRunbookPath, appRunbook)).toEqual([]);

    expect(getMarkdownSection(adminRunbook, "Post-Deploy Production Health Bridge")).toContain(bridgeLink);
    expect(getMarkdownSection(adminRunbook, "Post-Deploy Production Health Bridge")).toContain(prodHealthLink);
    expect(getMarkdownSection(prodHealthHelper, "Admin Operations Bridge")).toContain(bridgeLink);
    expect(getMarkdownSection(opsReadme, "Start Here")).toContain(
      "[2026-05-10 admin ops to prod-health evidence bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md)",
    );
    expect(opsReadme).toContain(
      "[2026-05-10 admin ops to prod-health evidence bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md)",
    );
    expect(opsReadme).toMatch(
      /### Production Smoke Evidence[\s\S]*\[2026-05-10 admin ops to prod-health evidence bridge\]\(2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge\.md\)/,
    );
    expect(checklist).toContain(lowerBridgeLink);
    expect(appRunbook).toContain("2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md");
  });

  it("does not weaken the admin smoke or prod-health safety boundaries", () => {
    expect(bridge).toContain("does not add a new production harness, database write, Supabase migration");
    expect(bridge).toContain("does not prove Supabase, billing, Mapbox, support SLA, or authenticated workflow correctness");
    expect(bridge).toContain("does not prove self-serve onboarding, automated provisioning");
    expect(adminRunbook).toContain("Do not substitute a successful `/admin/operations` page load for Vercel Ready verification");
    expect(prodHealthHelper).toContain("does not authorize prospect PII capture, triage/provisioning clicks");

    for (const pattern of prohibitedPatterns) {
      expect(bridge).not.toMatch(pattern);
      expect(adminRunbook).not.toMatch(pattern);
      expect(prodHealthHelper).not.toMatch(pattern);
    }
  });
});
