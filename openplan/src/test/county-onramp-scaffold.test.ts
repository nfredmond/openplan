import { describe, expect, it } from "vitest";
import {
  CountyValidationScaffoldCsvError,
  normalizeCountyValidationScaffoldCsvContent,
  summarizeCountyValidationScaffoldCsv,
} from "@/lib/api/county-onramp-scaffold";

describe("county onramp scaffold helpers", () => {
  it("summarizes validator readiness from scaffold CSV content", () => {
    const summary = summarizeCountyValidationScaffoldCsv(`station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\nB,,TBD,Seeded from runtime\n`);

    expect(summary).toEqual({
      station_count: 2,
      observed_volume_filled_count: 1,
      observed_volume_missing_count: 1,
      source_agency_filled_count: 1,
      source_agency_tbd_count: 1,
      source_description_filled_count: 2,
      source_description_missing_count: 0,
      ready_station_count: 1,
      next_action_label: "Complete source metadata and observed counts for the remaining 1 starter stations.",
    });
  });

  it("normalizes line endings and rejects empty content", () => {
    expect(normalizeCountyValidationScaffoldCsvContent("a,b\r\n1,2")).toBe("a,b\n1,2\n");
    expect(() => normalizeCountyValidationScaffoldCsvContent("   ")).toThrow(CountyValidationScaffoldCsvError);
  });

  it("rejects scaffold CSVs without the required observed-count columns", () => {
    expect(() => summarizeCountyValidationScaffoldCsv("station_id,label\nA,Mainline\n")).toThrow(
      "Scaffold CSV is missing required columns: observed_volume, source_agency, source_description"
    );
  });
});
