// @vitest-environment node
/**
 * The first proven job's record (PR 483) is evidence and cannot be edited:
 * its record, six PDFs, README and inputs are pinned by SHA-256 in the
 * capability registry. Any rule added to the proven job checker may refuse
 * only what that record does not do. This test runs the committed record
 * through the current checker with the six committed PDFs, read by Poppler's
 * pdftotext and with each map page rendered by Poppler's pdftoppm, and
 * requires it to be accepted; it also requires every file the registry pins
 * to still have its pinned bytes.
 *
 * The map pages' highlight-red counts and PPM hashes below were measured on
 * November 14, 2026 with Poppler 25.07 on Windows and Poppler 24.02 in an
 * ubuntu:24.04 container (the image CI's ubuntu-latest runs and the
 * poppler-utils it installs): both gave the same bytes. A Poppler release
 * that rasterizes differently fails the last test here, and the record's
 * README and KI-2026-11-14-303 must say so before the values change.
 *
 * Skips the checker runs where `pdftotext` or `pdftoppm` on PATH is not
 * Poppler's (Git Bash's xpdf, or none), as the real-PDF reader test in
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
import { MIN_RED_PIXELS, analyzePpm, popplerPagePpm } from "../../scripts/lib/poppler-pixels.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOB_ID = "safety-action-plan-and-ss4a-in-three-places";
const RECORD_PATH = "docs/product/capability-evidence/first-proven-job.v1.json";

const registry = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"), "utf8"));
const entry = registry.provenJobs.find((job: { jobId: string }) => job.jobId === JOB_ID);
const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(REPO_ROOT, path))).digest("hex");
const hasPoppler = ["pdftotext", "pdftoppm"].every((tool) => pdfToolVersion(tool).poppler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record is untyped JSON
type Json = any;
const mapItem = (pdf: Json) => pdf.items.find((item: Json) => item.item === "high-injury-map");

/** Each map page at 72 dpi: page, highlight-red pixels, SHA-256 of the PPM bytes. Same on Poppler 25.07 (Windows) and 24.02 (Ubuntu 24.04). */
const MAP_PAGES: Record<string, [number, number, string]> = {
  "california-county-safety-action-plan.pdf": [17, 1012, "8b38bdb4055df4dd6677c84727a5ecab422fbed542b6be8db755d613d9bb1ff2"],
  "california-county-ss4a-application.pdf": [9, 1015, "a8ee3cce2ac62acd440565941880f230236e1d1c0f3bf6ec11c9dc67ea3dc722"],
  "nevada-county-safety-action-plan.pdf": [15, 600, "3aba5c19a7163833b923640d242f9c43f1dd5d2f63be41a2b9975fc4f271d10d"],
  "nevada-county-ss4a-application.pdf": [9, 600, "a828078188cb7e8d316bd09771b1260229bfe6c035f97532919cecfcd7aa297e"],
  "tribal-area-safety-action-plan.pdf": [14, 154, "f7953ec731b521685de5aeabc7f5549ed282c9f028c0bc371d3623cc0f50704a"],
  "tribal-area-ss4a-application.pdf": [9, 154, "ee46c4d56bf93423b507bc4f87ce6ef9a9b926b211cc16d614c83141b370b333"],
};

describe("the committed first proven job record", () => {
  it("keeps every file the registry pins at its pinned bytes", () => {
    expect(entry, "the registry lists the first proven job").toBeTruthy();
    const pinned = entry.evidence as Array<{ path: string; sha256: string }>;
    expect(pinned.map(({ path }) => path)).toContain(RECORD_PATH);
    expect(pinned.filter(({ path }) => path.endsWith(".pdf"))).toHaveLength(6);
    for (const file of pinned) expect(sha256(file.path), file.path).toBe(file.sha256);
  });

  it.skipIf(!hasPoppler)("is accepted by the current checker with its six committed PDFs (needs Poppler's pdftotext and pdftoppm)", () => {
    const record = JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
    expect(record.jobId).toBe(JOB_ID);
    expect(record.journeys.flatMap((journey: { pdfs: unknown[] }) => journey.pdfs)).toHaveLength(6);
    expect(() => validateProvenJobRecord(record, { repoRoot: REPO_ROOT })).not.toThrow();
  });

  it.skipIf(!hasPoppler)("renders each recorded map page to the pixels measured on Windows and Ubuntu (needs Poppler's pdftoppm)", () => {
    const record = JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
    const found: Record<string, [number, number, string]> = {};
    for (const pdf of record.journeys.flatMap((journey: Json) => journey.pdfs)) {
      const page = mapItem(pdf).page;
      const ppm = popplerPagePpm(resolve(REPO_ROOT, pdf.path), page);
      found[pdf.path.split("/").pop()] = [page, analyzePpm(ppm).redPixels, createHash("sha256").update(ppm).digest("hex")];
    }
    expect(found).toEqual(MAP_PAGES);
    for (const [, count] of Object.values(found)) expect(count).toBeGreaterThanOrEqual(MIN_RED_PIXELS);
  });

  it.skipIf(!hasPoppler)("is accepted with each map item's pixel hash added, and refused when one is wrong (needs Poppler's pdftoppm)", () => {
    const record = JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
    for (const pdf of record.journeys.flatMap((journey: Json) => journey.pdfs)) mapItem(pdf).pixelSha256 = MAP_PAGES[pdf.path.split("/").pop()][2];
    expect(() => validateProvenJobRecord(structuredClone(record), { repoRoot: REPO_ROOT })).not.toThrow();
    mapItem(record.journeys[2].pdfs[1]).pixelSha256 = MAP_PAGES["tribal-area-safety-action-plan.pdf"][2];
    expect(() => validateProvenJobRecord(record, { repoRoot: REPO_ROOT })).toThrow(
      /tribal-area journey ss4a-application PDF high-injury-map page 9 renders to pixels with SHA-256 ee46c4d5\w+; the record says f7953ec7/,
    );
  });
});
