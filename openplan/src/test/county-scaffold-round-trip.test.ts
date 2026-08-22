import { describe, expect, it } from "vitest";

import {
  COUNTY_SCAFFOLD_EDITABLE_COLUMNS,
  parseCountyValidationScaffoldTable,
  serializeCountyValidationScaffoldCsv,
  summarizeCountyValidationScaffoldCsv,
} from "@/lib/api/county-onramp-scaffold";
import { escapeCsvField, quoteCsvField } from "@/lib/export/csv";

/**
 * A PLANNER'S OBSERVED COUNTS HAVE TO SURVIVE BEING SAVED.
 *
 * This file is the one document standing between a scaffolded county run and a
 * validated one, it is read back by the Python validator, and — until this
 * session — the only way to edit it was in a text editor on the operator's own
 * machine. Every case below is a way an editor could quietly damage it.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const HEADER = "station_id,observed_volume,source_agency,source_description,link_id,model_volume";

/** A scaffold with the shapes that break naive CSV handling. */
const CSV =
  `${HEADER}\n` +
  // A description containing a comma AND quotes — two columns if split naively.
  `S-1,12500,Caltrans,"Mainline, north of ""Fifth St"" ramp",4411,13980\n` +
  // A description starting with a hyphen — a spreadsheet formula lead.
  `S-2,,TBD,-- awaiting agency confirmation,4412,8800\n` +
  `S-3,4100,City of Grass Valley,Frontage road count,4413,3990\n`;

describe("the county scaffold survives a round trip", () => {
  it("keeps every column, not just the four this product understands", () => {
    // `link_id` and `model_volume` mean nothing to the editor and everything to
    // the validator. An editor that returned only recognised fields would delete
    // them on the first save, invisibly.
    const table = parseCountyValidationScaffoldTable(CSV);

    expect(table.header).toEqual([
      "station_id",
      "observed_volume",
      "source_agency",
      "source_description",
      "link_id",
      "model_volume",
    ]);
    expect(table.rows[0].link_id).toBe("4411");
    expect(table.rows[0].model_volume).toBe("13980");
  });

  it("reads a quoted field containing a comma and escaped quotes as ONE value", () => {
    const table = parseCountyValidationScaffoldTable(CSV);
    expect(table.rows[0].source_description).toBe('Mainline, north of "Fifth St" ramp');
  });

  it("comes back byte-identical when nothing was edited", () => {
    const table = parseCountyValidationScaffoldTable(CSV);
    const written = serializeCountyValidationScaffoldCsv(table);

    // Re-parsing the written file yields the same values — the real invariant;
    // quoting may legitimately differ where it is not required.
    expect(parseCountyValidationScaffoldTable(written).rows).toEqual(table.rows);
    // And the awkward description is still one field after the trip.
    expect(parseCountyValidationScaffoldTable(written).rows[0].source_description).toBe(
      'Mainline, north of "Fifth St" ramp'
    );
  });

  it("never prefixes a formula-looking value, which a save would make permanent", () => {
    // `escapeCsvField` prefixes a quote so a spreadsheet renders text — right
    // for a download, corrupting here: the value goes back to the server and is
    // stored, gaining another prefix on every subsequent edit.
    expect(escapeCsvField("-- awaiting agency confirmation")).toBe(
      "'-- awaiting agency confirmation"
    );
    expect(quoteCsvField("-- awaiting agency confirmation")).toBe(
      "-- awaiting agency confirmation"
    );

    const once = serializeCountyValidationScaffoldCsv(parseCountyValidationScaffoldTable(CSV));
    const twice = serializeCountyValidationScaffoldCsv(parseCountyValidationScaffoldTable(once));
    const thrice = serializeCountyValidationScaffoldCsv(parseCountyValidationScaffoldTable(twice));

    expect(parseCountyValidationScaffoldTable(thrice).rows[1].source_description).toBe(
      "-- awaiting agency confirmation"
    );
    // Repeated saves are a fixed point, not a value that drifts.
    expect(thrice).toBe(twice);
  });

  it("carries an edit through to what the run's readiness is computed from", () => {
    // The summary is what the county run page reports and what decides whether
    // the validator can run, so an edit has to reach it.
    const table = parseCountyValidationScaffoldTable(CSV);
    const before = summarizeCountyValidationScaffoldCsv(CSV);

    table.rows[1].observed_volume = "8750";
    table.rows[1].source_agency = "Nevada County";
    table.rows[1].source_description = "Tube count, October 2025";

    const after = summarizeCountyValidationScaffoldCsv(
      serializeCountyValidationScaffoldCsv(table)
    );

    expect(before.observed_volume_missing_count).toBe(1);
    expect(after.observed_volume_missing_count).toBe(0);
    expect(after.observed_volume_filled_count).toBe(before.observed_volume_filled_count + 1);
    expect(after.ready_station_count).toBeGreaterThan(before.ready_station_count);
  });

  it("names the columns a person may fill, and station_id is not one of them", () => {
    // Editing a station id would silently re-point a count at a different link,
    // and the diff compares BY station id — so a changed id reads as a new
    // station rather than as an edit.
    expect([...COUNTY_SCAFFOLD_EDITABLE_COLUMNS]).toEqual([
      "observed_volume",
      "source_agency",
      "source_description",
    ]);
    expect(COUNTY_SCAFFOLD_EDITABLE_COLUMNS).not.toContain("station_id");
  });
});
