import { buildPilotReadinessPacket } from "@/app/(app)/admin/pilot-readiness/ExportButton";
import {
  releaseProofCaveatItems,
  releaseProofCopyBlock,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";
import { describe, expect, it } from "vitest";

const requiredCaveatFragments = [
  "No fresh same-cycle paid canary is claimed",
  "Onboarding remains a supervised implementation step",
  "RPO/RTO commitments are filled per managed-hosting engagement",
  "no validated behavioral forecasting claim is made",
  "not sold as legal-grade LAPM/compliance automation or autonomous AI planning",
] as const;

const buyerSafeTermFragments = [
  "Apache-2.0 planning workbench",
  "managed hosting",
  "supervised planning workbench",
] as const;

const caveatContextPattern = /\b(no|not|never|without|avoid|unsupported|boundary|caveat|waiver|supervised|stop-list|behind explicit proof gates|not sold as|not broad|not instant|no validated|no .* claim|do not|before external use|current proof boundary)\b/i;

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

  it("keeps buyer-safe terms across the pilot readiness export", () => {
    const packet = buildPilotReadinessExportFixture();

    expect(packet).toContain("Treat PASS lanes as citeable only when the named source document is available");
    expect(packet).toContain("Re-run or refresh any FAIL, PENDING, or UNKNOWN lane before using this packet");
    expectBuyerSafeTerms(packet);
  });
});
