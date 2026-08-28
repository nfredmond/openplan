import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  loadPublishedStructuralDiagnosisStudy,
  readPublishedStructuralDiagnosisDownload,
} from "@/lib/models/published-structural-diagnosis";

describe("published frozen structural diagnosis", () => {
  it("exposes all seven counties and both methods without combining them", async () => {
    const study = await loadPublishedStructuralDiagnosisStudy();
    expect(study.appVersion).toBe("0.40.0");
    expect(study.scientificOutcome).toBe("inconclusive");
    expect(new Set(study.records.map((record) => record.geographyId))).toHaveLength(7);
    expect(study.records).toHaveLength(14);
    expect(new Set(study.records.map((record) => record.method))).toEqual(
      new Set(["aequilibrae", "activitysim"]),
    );
  });

  it("downloads only manifest-selected exact bytes", async () => {
    const study = await loadPublishedStructuralDiagnosisStudy();
    const record = study.records[0];
    const download = await readPublishedStructuralDiagnosisDownload([
      record.geographyId,
      record.method,
      "structural-diagnosis.json",
    ]);
    expect(download?.sha256).toBe(record.diagnosisSha256);
    expect(JSON.parse(download!.bytes.toString("utf8"))).toMatchObject({
      scientific_outcome: "inconclusive",
      match_changes: 0,
      method_aggregation: "separate",
    });
    expect(await readPublishedStructuralDiagnosisDownload(["..", "package.json"])).toBeNull();
  });
});
