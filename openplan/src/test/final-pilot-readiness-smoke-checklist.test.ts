import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractMarkdownTableRows,
  getMarkdownSection,
  unresolvedLocalMarkdownLinks,
} from "./markdown-proof-helpers";

const repoRoot = path.resolve(process.cwd(), "..");
const checklistPath = path.join(repoRoot, "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md");
const checklist = readFileSync(checklistPath, "utf8");

const requiredSmokeItems = [
  "Product and sales posture",
  "Known-issue alignment",
  "Baseline release gate",
  "Workspace and admin support",
  "Workspace isolation",
  "Shared planning spine",
  "RTP and adoption posture",
  "Grants and funding posture",
  "Engagement handoff",
  "Data Hub lineage",
  "Scenario and modeling posture",
  "Aerial and field evidence",
  "Report artifact traceability",
  "Command center and release proof",
  "Buyer demo script",
  "Managed support and operations",
];

const requiredProofLanes = [
  "Managed support diligence",
  "County-run manifest proof",
  "Modeling evidence exports",
  "Data Hub lineage readiness",
  "RTP adoption record proof",
  "Grants evidence readiness",
  "Engagement public review guard",
  "Scenario source context",
  "Aerial provenance",
  "Release proof synchronization",
  "Production health evidence logger",
  "Buyer demo evidence links",
];

const caveatPattern = /\b(?:not|no|supervised|caveat|waiver|per-engagement|before|only|separate|unsupported|future proof|does not)\b/i;

describe("final pilot readiness smoke checklist", () => {
  it("keeps every local markdown and proof link resolvable", () => {
    expect(unresolvedLocalMarkdownLinks(checklistPath, checklist)).toEqual([]);
  });

  it("indexes the expected final smoke checks with proof links and caveats", () => {
    const rows = extractMarkdownTableRows(getMarkdownSection(checklist, "Final Smoke Checklist"));

    expect(rows.map((row) => row[0])).toEqual(requiredSmokeItems);

    for (const [smokeItem, operatorCheck, proofLinks, caveat] of rows) {
      expect(operatorCheck, `${smokeItem} needs an operator check`).toMatch(/confirm|re-run|use|check/i);
      expect(proofLinks, `${smokeItem} needs linked proof`).toMatch(/\[[^\]]+\]\([^)]+\)/);
      expect(caveat, `${smokeItem} needs an explicit caveat boundary`).toMatch(caveatPattern);
    }
  });

  it("indexes the latest proof lanes with links and caveat boundaries", () => {
    const rows = extractMarkdownTableRows(getMarkdownSection(checklist, "Latest Proof-Lane Index"));

    expect(rows.map((row) => row[0])).toEqual(requiredProofLanes);

    for (const [lane, whatItAdds, proofLink, caveat] of rows) {
      expect(whatItAdds, `${lane} needs a proof-lane summary`).toMatch(/ties|makes|carries|surfaces|adds|tightens|preserves|clarifies|keeps|ensures/i);
      expect(proofLink, `${lane} needs a linked proof artifact`).toMatch(/\[[^\]]+\]\([^)]+\)/);
      expect(caveat, `${lane} needs a caveat boundary`).toMatch(caveatPattern);
    }
  });

  it("preserves buyer-safe product truth and stop-list language", () => {
    expect(checklist).toContain("Apache-2.0 OpenPlan core plus Nat Ford managed hosting");
    expect(checklist).toContain("PASS for a supervised pilot-readiness conversation");
    expect(checklist).toContain("not** a launch certificate for a finished planning suite");
    expect(checklist).toContain("Do not use this checklist to claim any of the following");
    expect(checklist).toContain("validated behavioral forecasting");
    expect(checklist).toContain("legal-grade LAPM/compliance automation");
    expect(checklist).toContain("autonomous AI planning");
    expect(checklist).toContain("fresh same-cycle paid checkout proof");
    expect(checklist).toContain("global RPO/RTO/SLA commitments");
    expect(checklist).toContain("survey-grade, engineering-grade, photogrammetry, orthomosaic, point-cloud, or centimeter-level aerial output");
  });

  it("does not introduce promotional overclaims while summarizing caveats", () => {
    expect(checklist).not.toMatch(/\b(?:is|as|provides|offers|supports)\s+(?:a\s+)?fully self-serve municipal SaaS\b/i);
    expect(checklist).not.toMatch(/\bvalidated behavioral forecasting (?:is|was|ready|available|supported|provided)\b/i);
    expect(checklist).not.toMatch(/\blegal-grade LAPM\/compliance automation (?:is|was|ready|available|supported|provided)\b/i);
    expect(checklist).not.toMatch(/\bautonomous AI planning (?:is|was|ready|available|supported|provided)\b/i);
    expect(checklist).not.toMatch(/\bfresh same-cycle paid checkout proof (?:is|was|ready|available|supported|provided|claimed)\b/i);
    expect(checklist).not.toMatch(/\bguaranteed\s+(?:\d+(?:\.\d+)?%\s+)?(?:uptime|SLA|RPO|RTO)\b/i);
  });
});
