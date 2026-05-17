import { buildPilotReadinessPacket } from "@/app/(app)/admin/pilot-readiness/ExportButton";
import { buildAdminPilotReadinessProofPacketMarkdown } from "@/lib/operations/pilot-readiness-packet";
import {
  buyerDemoCommandCenterHandoff,
  releaseProofCaveatItems,
  releaseProofCopyBlock,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");

const requiredCaveatFragments = [
  "No fresh same-cycle paid canary is claimed",
  "Onboarding remains a supervised implementation step",
  "RPO/RTO commitments are filled per managed-hosting engagement",
  "no validated behavioral forecasting claim is made",
  "not sold as legal-grade LAPM/compliance automation or autonomous AI planning",
  "no grant award prediction claim is made",
] as const;

const buyerSafeTermFragments = [
  "Apache-2.0 planning workbench",
  "managed hosting",
  "supervised planning workbench",
] as const;

const handoffNoWriteFragments = [
  "No production writes",
  "provisioning",
  "outbound email",
  "checkout",
  "self-serve activation",
] as const;

const handoffStepHrefs = ["/admin/pilot-readiness", "/request-access", "/examples"] as const;

const caveatContextPattern = /\b(no|not|never|without|avoid|unsupported|boundary|caveat|waiver|supervised|stop-list|behind explicit proof gates|not sold as|not broad|not instant|no validated|no .* claim|do not|before external use|current proof boundary|historical|non-money-moving)\b/i;

const unsupportedClaimConcepts = [
  {
    label: "fully self-serve SaaS",
    pattern: /\b(?:fully\s+)?self[- ]serve\b[^.\n;]*\bSaaS\b|\bSaaS\b[^.\n;]*\bself[- ]serve\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "legal/compliance automation",
    pattern: /\b(?:legal(?:-grade)?|compliance|LAPM)\b[^.\n;]*(?:automation|automated|AI|legal|compliance)|\bLAPM\b[^.\n;]*\bautomation\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "autonomous AI planning",
    pattern: /\bautonomous\b[^.\n;]*(?:AI|planning)|\bAI\b[^.\n;]*\bautonomous\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "validated behavioral forecasting",
    pattern: /\bvalidated\b[^.\n;]*(?:behavioral\s+)?forecast(?:ing)?|(?:behavioral\s+)?forecast(?:ing)?[^.\n;]*\bvalidated\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "grant award prediction",
    pattern:
      /\bgrant\s+award\s+prediction\b|\bpredicts?\b[^.\n;]*\bgrant\s+awards?\b|\bcertified\s+grant\s+scoring\b|\bgrant\s+scoring\b[^.\n;]*\bcertified\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "fresh paid-canary proof",
    pattern: /\b(?:fresh\s+)?(?:same-cycle\s+)?paid[- ]canary\b|\blive payment evidence\b/i,
    mustAppearCaveated: true,
  },
  {
    label: "survey-grade overclaims",
    pattern: /\bsurvey[- ]grade\b|\bengineering[- ]grade\b|\bcentimeter[- ]level\b/i,
    mustAppearCaveated: false,
  },
  {
    label: "photogrammetry overclaims",
    pattern: /\bphotogrammetry\b|\bphotogrammetric\b|\borthomosaic\b|\bpoint cloud\b/i,
    mustAppearCaveated: false,
  },
] as const;

function buildPilotReadinessExportFixture() {
  return buildPilotReadinessPacket(
    [
      {
        lane: "Release proof packet",
        status: "PASS",
        lastRun: "2026-05-10",
        details: "docs/ops/2026-05-01-openplan-release-to-sale-plan.md",
      },
    ],
    "2026-05-10T00:00:00.000Z",
  );
}

function splitBuyerCopyStatements(text: string) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split(/[\n.]/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function expectRequiredCaveats(text: string) {
  for (const caveat of releaseProofCaveatItems) {
    expect(text).toContain(caveat.text);
    expect(text).toContain(caveat.sourceArtifact);
  }

  for (const fragment of requiredCaveatFragments) {
    expect(text).toContain(fragment);
  }
}

function expectBuyerSafeBaseline(text: string) {
  for (const fragment of buyerSafeTermFragments) {
    expect(text).toContain(fragment);
  }

  expectRequiredCaveats(text);
}

function expectUnsupportedClaimsOnlyAsCaveats(text: string) {
  const statements = splitBuyerCopyStatements(text);

  for (const { label, pattern, mustAppearCaveated } of unsupportedClaimConcepts) {
    const matches = statements.filter((statement) => pattern.test(statement));

    if (mustAppearCaveated) {
      expect(matches.length, `${label} should appear as explicit caveat/boundary copy`).toBeGreaterThan(0);
    }

    for (const statement of matches) {
      expect(
        caveatContextPattern.test(statement),
        `${label} appears without caveat/negation context: ${statement}`,
      ).toBe(true);
    }
  }
}

function expectAnyUnsupportedClaimsAreCaveated(text: string) {
  const statements = splitBuyerCopyStatements(text);

  for (const { label, pattern } of unsupportedClaimConcepts) {
    for (const statement of statements.filter((candidate) => pattern.test(candidate))) {
      expect(
        caveatContextPattern.test(statement),
        `${label} appears without caveat/negation context: ${statement}`,
      ).toBe(true);
    }
  }
}

function expectBuyerSafeTerms(text: string) {
  expectBuyerSafeBaseline(text);
  expectUnsupportedClaimsOnlyAsCaveats(text);
}

describe("release proof copy guards", () => {
  it("keeps the shared release proof posture inside supervised sale and pilot readiness caveats", () => {
    const postureText = [
      releaseProofPosture.summary,
      releaseProofPosture.wedge,
      ...releaseProofPosture.proofItems.flatMap((item) => [
        item.headline,
        item.detail,
        item.artifact,
        item.readinessRole,
        item.operatorCheck,
      ]),
      ...releaseProofPosture.caveatItems.flatMap((caveat) => [caveat.label, caveat.text, caveat.sourceArtifact]),
    ].join("\n");

    expectBuyerSafeTerms(postureText);
  });

  it("keeps buyer-safe terms across the reusable release proof copy block", () => {
    const copyBlock = releaseProofCopyBlock();

    expectBuyerSafeTerms(copyBlock);
  });

  it("keeps the buyer demo handoff sequenced through readiness, supervised intake, and examples without write claims", () => {
    const copyBlock = releaseProofCopyBlock();

    expect(buyerDemoCommandCenterHandoff.steps.map((step) => step.href)).toEqual(handoffStepHrefs);
    expect(buyerDemoCommandCenterHandoff.steps[0]?.detail).toContain("caveat sheet before demo language");
    expect(buyerDemoCommandCenterHandoff.steps[1]?.detail).toContain("triaged/supervised");
    expect(buyerDemoCommandCenterHandoff.steps[2]?.detail).toContain("Use examples only after the proof boundary is clean");

    for (const fragment of handoffNoWriteFragments) {
      expect(buyerDemoCommandCenterHandoff.boundary).toContain(fragment);
      expect(copyBlock).toContain(fragment);
    }

    expectAnyUnsupportedClaimsAreCaveated(
      [
        buyerDemoCommandCenterHandoff.headline,
        buyerDemoCommandCenterHandoff.detail,
        buyerDemoCommandCenterHandoff.boundary,
        ...buyerDemoCommandCenterHandoff.steps.flatMap((step) => [step.label, step.href, step.detail]),
      ].join("\n"),
    );
  });

  it("keeps buyer-safe terms across the pilot readiness export", () => {
    const packet = buildPilotReadinessExportFixture();

    expect(packet).toContain("Treat PASS lanes as citeable only when the named source document is available");
    expect(packet).toContain("Re-run or refresh any FAIL, PENDING, or UNKNOWN lane before using this packet");
    expectBuyerSafeTerms(packet);
  });

  it("keeps the generated Admin Pilot Readiness sales packet inside buyer-safe claim boundaries", () => {
    const packet = buildAdminPilotReadinessProofPacketMarkdown();

    expect(packet).toContain("Buyer-Safe Summary");
    expect(packet).toContain("Implementation-Specific Items Still To Scope");
    expect(packet).toContain("Buyer-Safe Language");
    expectBuyerSafeTerms(packet);
  });

  it("keeps checked-in static Admin Pilot Readiness sales packets inside the same claim boundaries", () => {
    const staticMarkdown = readFileSync(
      path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md"),
      "utf8",
    );
    const staticHtml = readFileSync(
      path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html"),
      "utf8",
    );

    expectBuyerSafeTerms(staticMarkdown);
    expectBuyerSafeTerms(staticHtml);
  });
});
