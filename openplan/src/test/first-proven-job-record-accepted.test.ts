// @vitest-environment node
/**
 * The first proven job's record (PR 483) is evidence and cannot be edited:
 * its record, six PDFs, README and inputs are pinned by SHA-256 in the
 * capability registry. Any rule added to the proven job checker may refuse
 * only what that record does not do. This test runs the committed record
 * through the current checker with the six committed PDFs, read by Poppler's
 * pdftotext, and requires it to be accepted; it also requires every file the
 * registry pins to still have its pinned bytes.
 *
 * Skips the checker run where `pdftotext` on PATH is not Poppler's (Git
 * Bash's xpdf, or none), as the real-PDF reader test in
 * capability-evidence.test.ts does: another extractor splits words
 * differently, so a refusal there would say nothing about the record. CI
 * installs Poppler (KI-2026-11-14-101).
 *
 * Blind category: this shows the checker accepts the record, not that the
 * record is true. What the checker cannot see is listed in
 * docs/product/capability-evidence/first-proven-job/README.md and
 * KI-2026-11-14-303.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOB_ID = "safety-action-plan-and-ss4a-in-three-places";
const RECORD_PATH = "docs/product/capability-evidence/first-proven-job.v1.json";

const registry = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"), "utf8"));
const entry = registry.provenJobs.find((job: { jobId: string }) => job.jobId === JOB_ID);
const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(REPO_ROOT, path))).digest("hex");
const hasPoppler = pdfToolVersion("pdftotext").poppler;

describe("the committed first proven job record", () => {
  it("keeps every file the registry pins at its pinned bytes", () => {
    expect(entry, "the registry lists the first proven job").toBeTruthy();
    const pinned = entry.evidence as Array<{ path: string; sha256: string }>;
    expect(pinned.map(({ path }) => path)).toContain(RECORD_PATH);
    expect(pinned.filter(({ path }) => path.endsWith(".pdf"))).toHaveLength(6);
    for (const file of pinned) expect(sha256(file.path), file.path).toBe(file.sha256);
  });

  it.skipIf(!hasPoppler)("is accepted by the current checker with its six committed PDFs (needs Poppler's pdftotext)", () => {
    const record = JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
    expect(record.jobId).toBe(JOB_ID);
    expect(record.journeys.flatMap((journey: { pdfs: unknown[] }) => journey.pdfs)).toHaveLength(6);
    expect(() => validateProvenJobRecord(record, { repoRoot: REPO_ROOT })).not.toThrow();
  });
});
