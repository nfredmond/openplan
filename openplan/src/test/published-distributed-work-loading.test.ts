import { describe, expect, it } from "vitest";

import { loadPublishedDistributedWorkLoadingStudy, readPublishedDistributedWorkLoadingDownload } from "@/lib/models/published-distributed-work-loading";

describe("published distributed work loading", () => {
  it("loads fourteen separate inconclusive records", async () => {
    const study = await loadPublishedDistributedWorkLoadingStudy();
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
});
