import { describe, expect, it } from "vitest";
import {
  CASUALTY_BLANK_NOTE,
  LIVE_READ_EXPORT_NOTE,
  buildCrashExportCsv,
  buildCrashExportGeoJson,
  crashExportFilename,
  describeCrashExportFilters,
  type CrashExportInput,
} from "@/lib/safety/crash-export";
import { CRASH_FILTER_FACETS, facetValueLabel } from "@/lib/safety/crash-filters";
import { SEVERITY_LABELS } from "@/lib/safety/client-types";
import type { SafetyCrashFeature } from "@/lib/safety/client-types";

/**
 * A CRASH EXPORT IS A CLAIM THAT OUTLIVES THE SCREEN IT CAME FROM.
 *
 * The file goes into a grant appendix, an engineer's inbox, a consultant's GIS
 * project. Six months later nobody can ask the map what filters were on. So the
 * two failures this guards are:
 *
 *   1. A FILTERED FILE THAT DOES NOT SAY IT IS FILTERED. "247 crashes" gets
 *      quoted as the county total when it was one corridor after dark.
 *   2. A TRUNCATED FILE THAT LOOKS COMPLETE. The map draws a capped subset; a
 *      file that silently inherited the cap is a partial count with a whole
 *      count's authority.
 *
 * Plus the two this module shares with the rest of Safety: nothing is a blank
 * that should be a sentence, and nothing executes when the planner opens their
 * own export.
 */

function feature(over: Partial<SafetyCrashFeature["properties"]> = {}): SafetyCrashFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-121.0611, 39.2191] },
    properties: {
      kind: "safety_crash",
      id: "crash-1",
      externalId: "EXT-1",
      sourceId: "ccrs-ca",
      collisionDate: "2024-11-02",
      collisionYear: 2024,
      severity: "fatal",
      killedCount: 1,
      injuredCount: 2,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionType: "head_on",
      lighting: "dark_unlighted",
      weather: "rain",
      ...over,
    },
  };
}

function input(over: Partial<CrashExportInput> = {}): CrashExportInput {
  return {
    features: [feature()],
    selection: { severity: ["fatal", "severe_injury"], lighting: ["dark_unlighted"] },
    provenance: {
      lane: "stored",
      sourceLabel: "Statewide crash reporting system",
      attribution: "Source agency (public domain).",
      ingestId: "ingest-7",
      matchedCount: 1,
      studyAreaLabel: "Nevada County",
      boundingBox: { minLon: -121.5, minLat: 39.0, maxLon: -120.5, maxLat: 39.5 },
    },
    caveats: ["Coverage varies by source and year."],
    generatedAt: "2026-08-11T20:00:00.000Z",
    ...over,
  };
}

function csvLines(over: Partial<CrashExportInput> = {}): string[] {
  return buildCrashExportCsv(input(over)).split("\n");
}

describe("the export states which subset it is", () => {
  it("names every facet, narrowed or not, so silence is never mistaken for a filter", () => {
    const lines = describeCrashExportFilters({
      severity: ["fatal", "severe_injury"],
      yearFrom: 2021,
      yearTo: 2025,
    });
    // Every facet in the registry gets a line. A facet that appeared in the
    // query and not in this list is a filter the file does not disclose.
    for (const facet of CRASH_FILTER_FACETS) {
      expect(lines.some((line) => line.startsWith(`${facet.label}:`)), facet.label).toBe(true);
    }
    expect(lines).toContain("Severity: Fatal, Serious injury");
    expect(lines).toContain("Collision year: 2021–2025");
    // Unconstrained facets say so IN WORDS rather than being absent, because an
    // absent line reads as "this dimension was filtered somehow".
    expect(lines.some((line) => /^Lighting: all \(no filter applied\)$/.test(line))).toBe(true);
  });

  it("describes what the file CONTAINS, not which boxes were ticked", () => {
    // Ticking every value applies no predicate at all, so the file also holds
    // rows whose column is NULL — the ones from a source with no such field.
    // Listing the ticked boxes would describe the file as narrower than it is.
    const everySeverity = CRASH_FILTER_FACETS.find((facet) => facet.id === "severity")!;
    const lines = describeCrashExportFilters({
      severity: [...everySeverity.kind === "in" ? everySeverity.values : []],
    });
    expect(lines).toContain("Severity: all (no filter applied)");
  });

  it("writes every facet's filter line into the FILE, not merely into a helper", () => {
    // The mutation that motivated this: deleting the loop that pushes the filter
    // rows into the CSV left `describeCrashExportFilters` correct and the whole
    // suite green, while the actual download disclosed nothing. Testing the
    // helper is not testing the artefact.
    const lines = csvLines();
    for (const facet of CRASH_FILTER_FACETS) {
      expect(
        lines.some((line) => line.startsWith("Filter,") && line.includes(`${facet.label}:`)),
        `${facet.label} is missing from the exported file's header`
      ).toBe(true);
    }
    expect(lines.some((line) => line.includes("Severity: Fatal, Serious injury"))).toBe(true);
    // And the GeoJSON metadata carries the same list, so the two formats cannot
    // describe different queries.
    expect(JSON.parse(buildCrashExportGeoJson(input())).openplan.filters).toEqual(
      describeCrashExportFilters(input().selection)
    );
  });

  it("says INCOMPLETE, with both numbers, when more matched than were exported", () => {
    const lines = csvLines({
      features: [feature(), feature({ id: "crash-2", externalId: "EXT-2" })],
      provenance: { ...input().provenance, matchedCount: 20_512 },
    });
    const incomplete = lines.find((line) => line.includes("INCOMPLETE"));
    expect(incomplete).toBeDefined();
    expect(incomplete).toContain("20,512 collisions matched");
    expect(incomplete).toContain("2 were exported");
  });

  it("says nothing about a remainder when there is none", () => {
    expect(buildCrashExportCsv(input())).not.toContain("INCOMPLETE");
  });

  it("carries the source, the attribution, the acquisition, the extent and the caveats", () => {
    const csv = buildCrashExportCsv(input());
    expect(csv).toContain("Statewide crash reporting system");
    expect(csv).toContain("Source agency (public domain).");
    expect(csv).toContain("ingest-7");
    expect(csv).toContain("Nevada County");
    expect(csv).toContain("-121.5, 39 to -120.5, 39.5");
    expect(csv).toContain("Coverage varies by source and year.");
    // Matched on a quote-free fragment: the note itself contains double quotes,
    // which RFC 4180 escaping doubles, so the raw constant is not a substring of
    // its own escaped cell.
    expect(CASUALTY_BLANK_NOTE).toContain("it does not mean zero");
    expect(csv).toContain("it does not mean zero");
  });

  it("marks a live read as never saved, because the file outlives the browser tab", () => {
    const csv = buildCrashExportCsv(input({ provenance: { ...input().provenance, lane: "live" } }));
    expect(csv).toContain(LIVE_READ_EXPORT_NOTE);
    expect(buildCrashExportGeoJson(input({ provenance: { ...input().provenance, lane: "live" } }))).toContain(
      LIVE_READ_EXPORT_NOTE
    );
  });
});

describe("the export invents nothing, including by leaving a cell blank", () => {
  it("writes a sentence where the SOURCE has no such field", () => {
    // NULL means the feed has no lighting column. A blank cell in a spreadsheet
    // is read as "no" — and "no lighting problem here" is a finding this data
    // cannot support.
    const csv = buildCrashExportCsv(input({ features: [feature({ lighting: null })] }));
    expect(csv).toContain("Not recorded by this source");
  });

  it("distinguishes 'the source said nothing here' from 'the source has no such field'", () => {
    // Both are absences, and they are different absences: one is about the
    // collision, the other about the feed.
    const saidNothing = buildCrashExportCsv(input({ features: [feature({ weather: "unknown" })] }));
    expect(saidNothing).toContain("Not reported");
    expect(saidNothing).not.toContain("Not recorded by this source");

    const noSuchField = buildCrashExportCsv(input({ features: [feature({ weather: null })] }));
    expect(noSuchField).toContain("Not recorded by this source");
  });

  it("keeps the unclassified-severity band's own words, not a generic 'not reported'", () => {
    // `unknown` severity is NOT "the source said nothing about severity" — it is
    // the band for a collision reported with no casualty count at all, and its
    // label has to say the classification is missing rather than that the
    // outcome was mild. A generic absent-value sentence erased exactly that.
    const csv = buildCrashExportCsv(input({ features: [feature({ severity: "unknown" })] }));
    expect(csv).toContain(SEVERITY_LABELS.unknown);
  });

  it("never writes a zero for a casualty count the source did not supply", () => {
    const rows = csvLines({
      features: [feature({ severity: "unknown", killedCount: null, injuredCount: null })],
    });
    const dataRow = rows[rows.length - 2];
    expect(dataRow).not.toMatch(/,0,0,/);
    // The blank is only safe because the severity cell on the same row says so
    // in words. That pairing is the whole justification for the one blank the
    // export allows — see CASUALTY_BLANK_NOTE.
    expect(dataRow).toContain(SEVERITY_LABELS.unknown);
  });

  it("does not report an involvement flag's absence as an absence of the person", () => {
    const csv = buildCrashExportCsv(input({ features: [feature({ pedestrianInvolved: false })] }));
    // "Not reported", never "No": the flags are positive reports, and measured
    // against a live file they undercount person records by up to 17%.
    expect(csv).toContain("Not reported");
    expect(csv).not.toMatch(/,No,/);
  });
});

describe("the columns come from the facet registry", () => {
  it("gives every facet a column, so a new facet exports itself", () => {
    const header = csvLines()[csvLines().findIndex((line) => line.startsWith("Collision date"))];
    for (const facet of CRASH_FILTER_FACETS) {
      if (facet.kind === "in") {
        expect(header, facet.label).toContain(facet.label);
      } else {
        for (const option of facet.options) {
          expect(header, option.label).toContain(`${option.label} involved`);
        }
      }
    }
  });

  it("writes the human LABEL in the CSV, never the product's internal spelling", () => {
    const lightingFacet = CRASH_FILTER_FACETS.find((facet) => facet.id === "lighting")!;
    const csv = buildCrashExportCsv(input());
    expect(csv).toContain(facetValueLabel(lightingFacet, "dark_unlighted"));
    // The neutral token is fine in a machine file and wrong on an agency's
    // letterhead. Split deliberately; see the module header.
    const dataRow = csv.split("\n").slice(-2)[0];
    expect(dataRow).not.toContain("dark_unlighted");
  });

  it("keeps the NEUTRAL values in the GeoJSON, so a round-trip does not rename them", () => {
    const parsed = JSON.parse(buildCrashExportGeoJson(input()));
    expect(parsed.features[0].properties.lighting).toBe("dark_unlighted");
    expect(parsed.features[0].properties.severity).toBe("fatal");
    expect(parsed.openplan.filters).toContain("Severity: Fatal, Serious injury");
    expect(parsed.openplan.exportedCount).toBe(1);
    expect(parsed.openplan.complete).toBe(true);
  });

  it("reports incompleteness in the GeoJSON metadata too", () => {
    const parsed = JSON.parse(
      buildCrashExportGeoJson(input({ provenance: { ...input().provenance, matchedCount: 900 } }))
    );
    expect(parsed.openplan.complete).toBe(false);
    expect(parsed.openplan.matchedCount).toBe(900);
  });
});

describe("the export cannot execute on the planner's machine", () => {
  it("neutralizes a formula that arrived in a source label", () => {
    // Source labels and attributions are agency free text, and a planner opening
    // their OWN export is the exact victim of CSV injection. This must be the
    // shared escaper in `src/lib/export/csv.ts` — a private one here would be
    // the fourth copy, and the first three each missed this.
    const csv = buildCrashExportCsv(
      input({
        provenance: {
          ...input().provenance,
          sourceLabel: '=HYPERLINK("http://evil.example","click")',
        },
      })
    );
    // The value is its own cell, so the escaper's formula lead check applies to
    // it and prefixes the quote. Concatenated into a sentence it would sit
    // mid-cell, inert only by accident of the prefix in front of it.
    expect(csv).toMatch(/^Source,"'=HYPERLINK/m);
  });

  it("neutralizes a formula that arrived in the planner's own study-area label", () => {
    const csv = buildCrashExportCsv(
      input({ provenance: { ...input().provenance, studyAreaLabel: "@SUM(A1:A9)" } })
    );
    expect(csv).toMatch(/^Study area,'@SUM\(A1:A9\)$/m);
  });

  it("keeps real numbers computable — a longitude is not text", () => {
    // The numeric-column decision in `src/lib/export/csv.ts`: a machine-written
    // negative number must stay a number a spreadsheet can compute with. A
    // longitude prefixed with a quote breaks every map that reads the file.
    const dataRow = csvLines()[csvLines().length - 2];
    expect(dataRow).toContain("-121.0611");
    expect(dataRow).not.toContain("'-121.0611");
  });
});

describe("the filename says what the file is", () => {
  it("stamps the date and the format", () => {
    expect(crashExportFilename("csv", "2026-08-11T20:00:00.000Z")).toBe(
      "openplan-crashes-2026-08-11.csv"
    );
    expect(crashExportFilename("geojson", "2026-08-11T20:00:00.000Z")).toBe(
      "openplan-crashes-2026-08-11.geojson"
    );
  });
});
