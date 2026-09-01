import { describe, expect, it } from "vitest";

import {
  loadPublishedComparableObservationStudy,
  readPublishedComparableObservationDownload,
  verifyPublishedComparableObservationHash,
} from "@/lib/models/published-comparable-observation-study";

describe("published comparable observation study", () => {
  it("loads the exact fourteen-record inconclusive release", async () => {
    const study = await loadPublishedComparableObservationStudy();
    expect(study.version).toBe("0.41.0");
    expect(study.releaseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(study.scientificOutcome).toBe("inconclusive");
    expect(study.diagnoses).toHaveLength(14);
  });

  it("serves manifest-selected files with their exact hashes", async () => {
    const inputBundle = await readPublishedComparableObservationDownload([
      "06007", "aequilibrae", "validation-input-bundle-v2.json",
    ]);
    expect(inputBundle?.filename).toBe("06007-aequilibrae-validation-input-bundle-v2.json");
    expect(inputBundle?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(inputBundle?.bytes.toString("utf8") ?? "{}").release.version).toBe("0.41.0");
    const diagnosis = await readPublishedComparableObservationDownload([
      "06007", "aequilibrae", "structural-diagnosis-v2.json",
    ]);
    expect(diagnosis?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(diagnosis?.bytes.toString("utf8") ?? "{}").release.version).toBe("0.41.0");
    const report = await readPublishedComparableObservationDownload(["study-report.md"]);
    expect(report?.contentType).toContain("text/markdown");
    expect(report?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never resolves caller text as a filesystem path", async () => {
    expect(await readPublishedComparableObservationDownload(["..", "package.json"])).toBeNull();
  });

  it("refuses missing or changed hashes for manifest-selected downloads", () => {
    const bytes = Buffer.from("exact artifact bytes");
    expect(() => verifyPublishedComparableObservationHash(bytes, null, true)).toThrow(/omitted an artifact hash/);
    expect(() => verifyPublishedComparableObservationHash(bytes, "0".repeat(64), true)).toThrow(/bytes changed/);
    expect(verifyPublishedComparableObservationHash(bytes, null, false)).toMatch(/^[0-9a-f]{64}$/);
  });
});
