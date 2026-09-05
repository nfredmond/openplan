import { describe, expect, it } from "vitest";
import { hasCompleteCrashCustody, buildSafetyCrashEvidenceMap, foldCrashEvidenceCounts,
  readSafetyCrashEvidenceIngest, SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION,
} from "@/lib/safety/crash-evidence";

describe("acquisition custody is distinct from zero crashes", () => {
  it.each([
    [4, false, null, 0, false], [4, false, null, 3, false],
    [4, false, null, 4, true], [0, false, null, 0, true],
    [40, true, null, 4, false], [40, true, 4, 4, true],
    [40, true, 4, 0, false], [4, false, 4, null, false],
  ])("reported %s truncated %s stored %s retained %s => %s", (geocodedCount, truncated, storedCount, retained, complete) => {
    expect(hasCompleteCrashCustody({ geocodedCount, truncated, storedCount }, retained)).toBe(complete);
  });

  it("withholds missing historical records across evidence consumers without changing source totals", () => {
    const ingest = readSafetyCrashEvidenceIngest({ id: "legacy", status: "ready",
      crash_count: 5, geocoded_count: 4, severity_completeness: "kabco_full" })!;
    const item = buildSafetyCrashEvidenceMap([ingest], foldCrashEvidenceCounts([])).get("legacy")!;
    expect(item.reportedTotal).toBe(5);
    expect(item.mappedTotal).toBe(4);
    expect(item.ksi).toBeNull();
    expect(item.severityCounts).toBeNull();
    expect(item.caveats.join(" ")).toContain("Missing records are not zero");
  });

  it("projects and parses the stored denominator instead of substituting the source total", () => {
    expect(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION.split(", ")).toContain("stored_count");
    expect(readSafetyCrashEvidenceIngest({ id: "partial", stored_count: 7 })?.storedCount).toBe(7);
  });
  it("does not report zero people when crash custody survives but person rows are missing", () => {
    const ingest = readSafetyCrashEvidenceIngest({ id: "people", status: "ready",
      crash_count: 1, geocoded_count: 1, party_completeness: "retrieved", party_count: 2 })!;
    const counts = foldCrashEvidenceCounts([{ ingest_id: "people", dimension: "severity", value: "fatal", record_count: 1 }]);
    const item = buildSafetyCrashEvidenceMap([ingest], counts).get("people")!;
    expect(item.severityCounts?.fatal).toBe(1);
    expect(item.roleCounts).toBeNull();
    expect(item.caveats.join(" ")).toContain("Missing people are not zero");
  });
});
