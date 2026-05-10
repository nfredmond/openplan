import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractMarkdownTableRows,
  getMarkdownSection,
  unresolvedLocalMarkdownLinks,
} from "./markdown-proof-helpers";

const repoRoot = path.resolve(process.cwd(), "..");
const proofMapPath = path.join(repoRoot, "docs/sales/2026-05-10-openplan-managed-support-proof-map.md");
const proofMap = readFileSync(proofMapPath, "utf8");

const managedSupportDocs = [
  proofMapPath,
  path.join(repoRoot, "docs/sales/2026-05-01-openplan-managed-hosting-service-description.md"),
  path.join(repoRoot, "docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md"),
  path.join(repoRoot, "docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md"),
  path.join(repoRoot, "docs/sales/2026-05-01-openplan-demo-workspace-script.md"),
];

const requiredClaims = [
  "Nat Ford can operate a hosted OpenPlan workspace with a clear support path.",
  "Request-access, reviewer triage, provisioning, and owner invitation have proof, but onboarding remains supervised.",
  "Backup and restore posture can be discussed as an operator procedure plus completed staging drill.",
  "Billing/support ledger posture is available for managed hosting conversations.",
  "A supervised first workflow can be packaged for pilot diligence and closeout.",
];

describe("managed support proof map", () => {
  it("ties every managed-support claim to proof, caveats, and buyer reliance checks", () => {
    const claimTable = getMarkdownSection(proofMap, "Claim-To-Proof Map");
    const rows = extractMarkdownTableRows(claimTable);

    expect(rows.map((row) => row[0])).toEqual(requiredClaims);

    for (const [claim, proofArtifacts, caveatBoundary, buyerReliance] of rows) {
      expect(proofArtifacts, `${claim} needs at least one linked proof artifact`).toMatch(/\[[^\]]+\]\([^)]+\)/);
      expect(caveatBoundary, `${claim} needs a concrete caveat boundary`).toMatch(
        /not|no |unless|per-engagement|supervised|waiver/i,
      );
      expect(buyerReliance, `${claim} needs buyer-specific reliance conditions`).toMatch(
        /fill|confirm|decide|scope|classify|before/i,
      );
    }
  });

  it("keeps every local proof artifact link resolvable", () => {
    const unresolved = managedSupportDocs.flatMap((documentPath) =>
      unresolvedLocalMarkdownLinks(documentPath, readFileSync(documentPath, "utf8")),
    );

    expect(unresolved).toEqual([]);
  });

  it("preserves the support/onboarding caveat boundaries buyers need", () => {
    expect(proofMap).toContain("Apache-2.0 OpenPlan core plus Nat Ford managed hosting");
    expect(proofMap).toContain("supervised planning workbench, not a broad self-serve municipal SaaS platform");
    expect(proofMap).toContain("RPO/RTO commitments are per-engagement schedule fields, not global product promises");
    expect(proofMap).toContain("no fresh same-cycle paid checkout canary is claimed");
    expect(proofMap).toContain("not automatic public self-serve workspace activation");
  });

  it("does not introduce global SLA, recovery, billing, or self-serve overclaims", () => {
    expect(proofMap).not.toMatch(/\b\d+(?:\.\d+)?%\s+uptime\b/i);
    expect(proofMap).not.toMatch(/\bRPO\s*[:=]\s*\d/i);
    expect(proofMap).not.toMatch(/\bRTO\s*[:=]\s*\d/i);
    expect(proofMap).not.toMatch(/\bguaranteed\s+(?:uptime|availability|resolution|RPO|RTO)\b/i);
    expect(proofMap).not.toMatch(/fresh same-cycle paid checkout canary (?:is|was) (?:proven|re-proven|completed)/i);
    expect(proofMap).not.toMatch(/automatic public self-serve workspace activation is supported/i);
  });
});
