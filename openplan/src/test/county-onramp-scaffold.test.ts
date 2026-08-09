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

  /**
   * MEASURED 2026-08-09 and closed the same day. A mutation sample of this
   * file — the oldest test in the county lane, last touched 2026-04-04 —
   * killed 2 of 8. All six survivors were re-run against the whole
   * 7,800-test suite and survived that too, so "nothing guards this" is
   * measured rather than inferred.
   *
   * WHY IT MATTERS, in one line: `ready_station_count` is what
   * `/api/county-runs/[id]/validate` checks before it will even prepare the
   * validate command ("Only N of M starter stations are validator-ready"). If a
   * placeholder counts as ready, an operator is handed a command that compares
   * modelled link volumes against stations whose observed volume is literally
   * "TBD" — and the gate that comes out the other side is what
   * `isPassingCountyRunGateStatus` turns into passing modeling evidence. A
   * parsing slip here reaches a claim.
   */
  it("does not count a station ready while any required field is a placeholder", () => {
    // Each row is complete EXCEPT one field, so each isolates one conjunct.
    // Dropping any one of the three from the readiness test survived the whole
    // suite before this existed.
    const summary = summarizeCountyValidationScaffoldCsv(
      [
        "station_id,observed_volume,source_agency,source_description",
        "complete,123,Caltrans,PM 1.2",
        "no-volume,TBD,Caltrans,PM 1.3",
        "no-agency,456,TBD,PM 1.4",
        "no-description,789,Caltrans,TBD",
        "",
      ].join("\n")
    );

    expect(summary.station_count).toBe(4);
    expect(summary.ready_station_count).toBe(1);
    // ...and each per-field tally reports its own gap rather than the readiness
    // total, which is a different number and was interchangeable before.
    expect(summary.observed_volume_filled_count).toBe(3);
    expect(summary.observed_volume_missing_count).toBe(1);
    expect(summary.source_agency_filled_count).toBe(3);
    expect(summary.source_agency_tbd_count).toBe(1);
    expect(summary.source_description_filled_count).toBe(3);
    expect(summary.source_description_missing_count).toBe(1);
  });

  it("treats a placeholder as a placeholder however it is typed", () => {
    /**
     * The tokens are matched upper-cased and trimmed, and BOTH of those
     * survived removal. A scaffold a person filled in by hand is exactly where
     * " tbd " and "n/a" appear, so case-sensitive or untrimmed matching would
     * let the most likely real-world spellings count as sourced observed counts.
     */
    const summary = summarizeCountyValidationScaffoldCsv(
      [
        "station_id,observed_volume,source_agency,source_description",
        "lower,tbd,caltrans,pm 1.2",
        "padded,  TBD  ,Caltrans,PM 1.3",
        "slashed,n/a,Caltrans,PM 1.4",
        "unknown,Unknown,Caltrans,PM 1.5",
        "blank, ,Caltrans,PM 1.6",
        "",
      ].join("\n")
    );

    expect(summary.station_count).toBe(5);
    // Not one of them has an observed count.
    expect(summary.observed_volume_filled_count).toBe(0);
    expect(summary.ready_station_count).toBe(0);
  });

  it("still counts a fully sourced station as ready", () => {
    // The positive case, so none of the assertions above can be satisfied by a
    // summariser that simply never reports anything ready.
    const summary = summarizeCountyValidationScaffoldCsv(
      [
        "station_id,observed_volume,source_agency,source_description",
        "a,45500,Caltrans,SR 20 PM 12.2",
        "b,26000,Caltrans,SR 49 PM 3.1",
        "",
      ].join("\n")
    );

    expect(summary.ready_station_count).toBe(2);
    expect(summary.station_count).toBe(2);
    expect(summary.next_action_label).toMatch(/then run validation/i);
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
