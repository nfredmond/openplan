import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");
const salesDir = path.join(repoRoot, "docs/sales");

const salesProofDocuments = readdirSync(salesDir)
  .filter((filename) => /\.(?:md|html)$/i.test(filename))
  .map((filename) => path.join(salesDir, filename));

const anchorProofDocuments = [
  "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md",
  "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md",
  "docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md",
  "openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md",
].map((relativePath) => path.join(repoRoot, relativePath));

const monitoredDocuments = [...salesProofDocuments, ...anchorProofDocuments];

const claimBoundaryDocs = [
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
  "docs/sales/2026-05-10-openplan-managed-support-proof-map.md",
  "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md",
  "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md",
  "docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md",
].map((relativePath) => path.join(repoRoot, relativePath));

const boundaryMatchers = [
  {
    label: "no broad self-serve SaaS posture",
    pattern: /not (?:a )?(?:broad |fully )?self[- ]serve|no (?:broad )?self[- ]serve|does not claim[^.]*self[- ]serve/i,
  },
  {
    label: "no legal/LAPM automation posture",
    pattern: /not (?:sold as )?(?:legal[- ]grade )?(?:LAPM|legal|compliance)[^.]*automation|not (?:a )?claim[^.]*(?:legal|LAPM|compliance)[^.]*(?:automation|sign[- ]off)|not [^.]*legal[- ]compliance engine|does\s+\*{0,2}not\*{0,2}\s+make[^.]*(?:legal|LAPM|compliance)[^.]*automation|does not claim[^.]*(?:legal|LAPM|compliance)[^.]*(?:automation|sign[- ]off)|no [^.]*legal[^.]*automation|do not imply[^.]*(?:legal|LAPM)[^.]*(?:automation|sign[- ]off)/i,
  },
  {
    label: "no grant prediction posture",
    pattern: /no grant (?:award )?prediction|not [^.]*grant[- ]award predictor|not (?:a )?claim[^.]*grant[- ]award prediction|not award prediction|does not (?:claim|predict)[^.]*grant|no [^.]*award prediction/i,
  },
  {
    label: "no autonomous AI/planning posture",
    pattern: /not (?:sold as )?(?:an? )?autonomous (?:AI )?planning|no autonomous (?:AI )?planning|does\s+\*{0,2}not\*{0,2}\s+make[^.]*autonomous (?:AI )?planning|does not claim[^.]*autonomous|do not use[^.]*autonomous (?:AI )?planning|not [^.]*autonomous planning/i,
  },
];

const overclaimPatterns = [
  {
    label: "self-serve SaaS",
    pattern: /\bOpenPlan\s+(?:is|provides|offers|supports|delivers|enables|operates as|is ready for|can run as)\s+(?:already\s+)?(?:an?\s+)?(?:fully\s+|broad\s+)?self[- ]serve(?:\s+municipal)?\s+SaaS\b/i,
  },
  {
    label: "legal/LAPM automation",
    pattern: /\bOpenPlan\s+(?:is|provides|offers|supports|delivers|enables|automates|handles)\s+(?:complete\s+|legal[- ]grade\s+)?(?:LAPM|legal|compliance|procurement|grant[- ]submission)[^.!?\n|;]{0,80}\b(?:automation|sign[- ]off|approval|completion)\b/i,
  },
  {
    label: "grant prediction",
    pattern: /\bOpenPlan\s+(?:predicts?|guarantees?|certifies?|scores?)\s+(?:grant\s+)?(?:awards?|funding|competitiveness|likelihood|success)\b/i,
  },
  {
    label: "autonomous AI planning",
    pattern: /\bOpenPlan\s+(?:is|provides|offers|supports|delivers|enables)\s+(?:autonomous\s+AI\s+planning|autonomous\s+planning(?:\s+decisions)?|AI\s+planning\s+automation)\b/i,
  },
];

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

function nonExampleLines(documentText: string): string[] {
  const lines = documentText.split(/\r?\n/);

  return lines.filter((line, index) => {
    const trimmed = line.trim();
    const previousMeaningfulLine = [...lines]
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.trim().length > 0)
      ?.trim();

    return !(trimmed.startsWith(">") && /^Avoid:?$/i.test(previousMeaningfulLine ?? ""));
  });
}

function candidateClaimChunks(documentPath: string, documentText: string): string[] {
  const text = documentPath.endsWith(".html") ? stripHtml(documentText) : nonExampleLines(documentText).join("\n");
  const chunks = text.split(/(?<=[.!?])\s+|\r?\n/).map((chunk) => chunk.trim()).filter(Boolean);

  return chunks.filter(
    (chunk) =>
      !/\b(?:not|no|does not|do not|avoid|without|unless|not sold as|not a replacement|doesn['’]t)\b/i.test(chunk),
  );
}

describe("sales/proof claim-boundary guard", () => {
  it("monitors the expected sales and proof materials", () => {
    expect(salesProofDocuments.length).toBeGreaterThanOrEqual(10);

    for (const documentPath of monitoredDocuments) {
      expect(existsSync(documentPath), `${path.relative(repoRoot, documentPath)} should exist`).toBe(true);
    }
  });

  it("keeps the core claim-boundary documents explicit about what is not being sold", () => {
    for (const documentPath of claimBoundaryDocs) {
      const documentText = readFileSync(documentPath, "utf8");
      const searchableText = documentPath.endsWith(".html") ? stripHtml(documentText) : documentText;

      for (const { label, pattern } of boundaryMatchers) {
        expect(searchableText, `${path.relative(repoRoot, documentPath)} needs ${label}`).toMatch(pattern);
      }
    }
  });

  it("rejects affirmative self-serve, legal automation, grant prediction, and autonomous AI overclaims", () => {
    const failures: string[] = [];

    for (const documentPath of monitoredDocuments) {
      const rawText = readFileSync(documentPath, "utf8");
      const chunks = candidateClaimChunks(documentPath, rawText);

      for (const { label, pattern } of overclaimPatterns) {
        const matchedChunk = chunks.find((chunk) => pattern.test(chunk));

        if (matchedChunk) {
          failures.push(
            `${path.relative(repoRoot, documentPath)} trips ${label} overclaim guard: ${matchedChunk}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
