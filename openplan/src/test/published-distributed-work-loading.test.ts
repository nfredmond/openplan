import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadPublishedDistributedWorkLoadingStudy, readPublishedDistributedWorkLoadingDownload } from "@/lib/models/published-distributed-work-loading";

describe("published distributed work loading", () => {
  it("loads fourteen separate inconclusive records", async () => {
    const study = await loadPublishedDistributedWorkLoadingStudy();
    expect(study.version).toBe("0.44.0");
    expect(study.releaseSha).toBe("a7c2afa71debdf3d61af8fe3967d8198e4f4ae09");
    expect(study.scientificOutcome).toBe("inconclusive");
    expect(study.records).toHaveLength(14);
    expect(new Set(study.records.map((record) => record.method))).toEqual(new Set(["aequilibrae", "activitysim"]));
    for (const record of study.records) {
      expect(record.distributedWorkTrips + record.retainedWorkTrips).toBeCloseTo(record.originalWorkTrips, 6);
    }
  });

  it("serves exact logical bytes with geography-and-method filenames", async () => {
    const download = await readPublishedDistributedWorkLoadingDownload(["06007", "aequilibrae", "pre-output-audit-v1.json"]);
    expect(download?.filename).toBe("06007-aequilibrae-pre-output-audit-v1.json");
    expect(download?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(download?.bytes.toString("utf8") ?? "{}").assignment_output_bytes_read).toBe(false);
    expect(await readPublishedDistributedWorkLoadingDownload(["..", "package.json"])).toBeNull();
  });

  it("independently verifies every published method artifact", async () => {
    const study = await loadPublishedDistributedWorkLoadingStudy();
    for (const record of study.records) {
      const artifacts = [
        ["distributed-work-loading-input-v1.json", record.inputSha256],
        ["pre-output-audit-v1.json", record.auditSha256],
        ["development-comparison-v1.json", record.comparisonSha256],
      ] as const;
      for (const [name, expectedSha256] of artifacts) {
        const download = await readPublishedDistributedWorkLoadingDownload([
          record.geographyId,
          record.method,
          name,
        ]);
        expect(download?.filename).toBe(`${record.geographyId}-${record.method}-${name}`);
        expect(download?.sha256).toBe(expectedSha256);
      }
    }
  });
});
