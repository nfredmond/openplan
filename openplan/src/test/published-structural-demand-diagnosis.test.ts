import { describe, expect, it } from "vitest";

import { loadPublishedStructuralDemandDiagnosis, readPublishedStructuralDemandDownload } from "@/lib/models/published-structural-demand-diagnosis";

describe("published structural demand diagnosis", () => {
  it("loads fourteen separate inconclusive method records", async () => {
    const study = await loadPublishedStructuralDemandDiagnosis();
    expect(study.scientificOutcome).toBe("inconclusive");
    expect(study.records).toHaveLength(14);
    expect(new Set(study.records.map((item) => item.geographyId)).size).toBe(7);
    expect(new Set(study.records.map((item) => item.method))).toEqual(new Set(["aequilibrae", "activitysim"]));
  });

  it("serves exact audit and compressed diagnosis bytes", async () => {
    const audit = await readPublishedStructuralDemandDownload(["06007", "aequilibrae", "model-structural-input-audit-v1.json"]);
    expect(audit?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(audit?.bytes.toString("utf8") ?? "{}").model_output_bytes_read).toBe(false);
    const diagnosis = await readPublishedStructuralDemandDownload(["06007", "activitysim", "model-validation-structural-diagnosis-v3.json"]);
    expect(diagnosis?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(diagnosis?.bytes.toString("utf8") ?? "{}").record_coverage.unloaded).toBeGreaterThan(0);
    expect(await readPublishedStructuralDemandDownload(["..", "package.json"])).toBeNull();
  });
});
