import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractMarkdownTableRows,
  getMarkdownSection,
  unresolvedLocalMarkdownLinks,
} from "./markdown-proof-helpers";

const repoRoot = path.resolve(process.cwd(), "..");
const runbookPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-admin-operations-smoke-runbook.md");
const runbook = readFileSync(runbookPath, "utf8");

const requiredHardStopRules = [
  "No production writes",
  "No prospect PII",
  "No provisioning clicks",
  "No secret capture",
  "No buyer overclaim",
];

const requiredChecklistSteps = [
  "1. Confirm target",
  "2. Confirm reviewer",
  "3. Run preflight",
  "4. Use skip-network only for rehearsal",
  "5. Load admin page as reviewer",
  "6. Verify visible surfaces",
  "7. Exit without mutation",
];

describe("admin operations smoke runbook", () => {
  it("keeps every local proof link resolvable", () => {
    expect(unresolvedLocalMarkdownLinks(runbookPath, runbook)).toEqual([]);
  });

  it("preserves the required hard-stop guardrails", () => {
    const hardStopSection = getMarkdownSection(runbook, "Hard Stop Rules");

    for (const rule of requiredHardStopRules) {
      expect(hardStopSection).toContain(`**${rule}:**`);
    }

    expect(hardStopSection).toContain("do not mutate `access_requests`, workspaces, invitations, billing");
    expect(hardStopSection).toContain("do not print, paste, screenshot, transcribe, export, or summarize prospect");
    expect(hardStopSection).toContain("do not click triage, contacted, invited, provision, billing, email, or owner-invite controls");
    expect(hardStopSection).toContain("do not record service-role keys, Supabase tokens, Vercel tokens");
  });

  it("documents the reviewer-email and skip-network sequence without turning rehearsal into proof", () => {
    const rows = extractMarkdownTableRows(getMarkdownSection(runbook, "Checklist"));

    expect(rows.map((row) => row[0])).toEqual(requiredChecklistSteps);
    expect(runbook).toContain("--reviewer-email <allowlisted-email>");
    expect(runbook).toContain("--skip-network");
    expect(runbook).toContain("do not treat as final buyer/pilot proof");
    expect(runbook).toContain("OPENPLAN_PROD_ADMIN_OPERATIONS_ALLOW_MAGIC_LINK=1");
    expect(runbook).toContain("not approval to mutate production app data");
    expect(runbook).toContain("Supervised action triage");
    expect(runbook).toContain("no-write action activity posture");
  });

  it("limits acceptable evidence to buyer-safe, non-PII facts", () => {
    const evidenceSection = getMarkdownSection(runbook, "Evidence Template");

    expect(evidenceSection).toContain("reviewer masked:");
    expect(evidenceSection).toContain("supervised action triage visible: yes/no");
    expect(evidenceSection).toContain("no-write action posture visible: yes/no");
    expect(evidenceSection).toContain("prospect PII captured: no");
    expect(evidenceSection).toContain("rows changed: no");
    expect(evidenceSection).toContain("provisioning clicks: no");
    expect(evidenceSection).toContain("emails sent: no");
    expect(evidenceSection).toContain("workspaces/invitations/billing actions: no");

    expect(runbook).not.toMatch(/self-serve onboarding proof/i);
    expect(runbook).not.toMatch(/automatic provisioning proof/i);
    expect(runbook).not.toMatch(/capture prospect (?:details|data|rows)/i);
  });
});
