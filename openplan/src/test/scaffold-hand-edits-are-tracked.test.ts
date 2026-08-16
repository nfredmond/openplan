import { describe, expect, it } from "vitest";

import { diffCountyValidationScaffoldEdits } from "@/lib/api/county-onramp-scaffold";

/**
 * A COUNT SOMEONE TYPED AND A COUNT A STATE DOT PUBLISHED LOOK IDENTICAL.
 *
 * Observed traffic counts reach a run two ways: fetched from a published feed,
 * or entered by a planner. Once they share a CSV column nothing distinguishes
 * them — and they carry completely different authority. "Caltrans measured
 * 27,000 here in 2023" and "someone at the agency believed it was about 27,000"
 * are not the same evidence, and a figure in a funding application rests on one
 * or the other.
 *
 * This differ is what lets the appendix say which. Its failure modes both
 * mislead: missing an edit presents a typed number as a published one, and
 * inventing an edit casts doubt on a figure nobody touched.
 */

const HEADER = "station_id,observed_volume,source_agency,source_description,notes";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("edits a person made to the count worksheet", () => {
  it("reports a changed count, and which field moved", () => {
    const before = csv("S1,TBD,TBD,TBD,x", "S2,5000,Caltrans,SR 20,y");
    const after = csv("S1,12000,TBD,TBD,x", "S2,5000,Caltrans,SR 20,y");

    expect(diffCountyValidationScaffoldEdits(before, after)).toEqual([
      { stationId: "S1", fields: ["observed_volume"] },
    ]);
  });

  it("reports every field that moved on one station", () => {
    const before = csv("S1,TBD,TBD,TBD,x");
    const after = csv("S1,12000,County of Example,Counted at the bridge,x");

    expect(diffCountyValidationScaffoldEdits(before, after)).toEqual([
      { stationId: "S1", fields: ["observed_volume", "source_agency", "source_description"] },
    ]);
  });

  it("reports nothing when a save changed nothing", () => {
    // THE ONE THAT MATTERS MOST for not overstating. Re-saving an untouched
    // worksheet must not make every count look hand-entered.
    const unchanged = csv("S1,5000,Caltrans,SR 20,x", "S2,7000,Caltrans,SR 49,y");
    expect(diffCountyValidationScaffoldEdits(unchanged, unchanged)).toEqual([]);
  });

  it("ignores a column nobody is claiming provenance for", () => {
    const before = csv("S1,5000,Caltrans,SR 20,first note");
    const after = csv("S1,5000,Caltrans,SR 20,second note");
    // `notes` is a planner's scratch space, not evidence about the count.
    expect(diffCountyValidationScaffoldEdits(before, after)).toEqual([]);
  });

  it("treats whitespace-only changes as no change", () => {
    const before = csv("S1,5000,Caltrans,SR 20,x");
    const after = csv("S1, 5000 ,Caltrans,SR 20,x");
    expect(diffCountyValidationScaffoldEdits(before, after)).toEqual([]);
  });

  it("does not report a station that did not exist before", () => {
    // A station added by regenerating the worksheet was not edited by a person;
    // it arrived with whatever the generator gave it.
    const before = csv("S1,5000,Caltrans,SR 20,x");
    const after = csv("S1,5000,Caltrans,SR 20,x", "S2,TBD,TBD,TBD,y");
    expect(diffCountyValidationScaffoldEdits(before, after)).toEqual([]);
  });

  it("reports nothing when there is no previous version to compare", () => {
    // The first save has nothing to differ against. Claiming every row was
    // hand-edited would overstate a person's involvement in a record used to
    // qualify evidence.
    const after = csv("S1,12000,Caltrans,SR 20,x");
    expect(diffCountyValidationScaffoldEdits(null, after)).toEqual([]);
    expect(diffCountyValidationScaffoldEdits("", after)).toEqual([]);
  });

  it("reports nothing when the previous version cannot be read", () => {
    // An unreadable old copy cannot say what changed. Reporting no edits is the
    // honest answer; the alternative marks untouched counts as hand-entered.
    const after = csv("S1,12000,Caltrans,SR 20,x");
    expect(diffCountyValidationScaffoldEdits("not,a,valid\nscaffold", after)).toEqual([]);
  });

  it("matches stations by id, not by row order", () => {
    // A worksheet re-sorted in a spreadsheet is not a worksheet of edits.
    const before = csv("S1,5000,Caltrans,SR 20,x", "S2,7000,Caltrans,SR 49,y");
    const reordered = csv("S2,7000,Caltrans,SR 49,y", "S1,5000,Caltrans,SR 20,x");
    expect(diffCountyValidationScaffoldEdits(before, reordered)).toEqual([]);
  });
});
