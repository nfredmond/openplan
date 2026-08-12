/**
 * A shapefile's attributes reach the map, aligned to the right shapes, in the
 * right text encoding — and where they cannot, OpenPlan says so.
 *
 * ═══ THE GAP THIS CLOSES ═══
 *
 * The shared importer read a shapefile's geometry and ignored its `.dbf`
 * entirely: every feature came out with `properties: {}`. A bike-network layer
 * imported that way draws correctly and clicks through to an empty popup, which
 * is a layer nobody can actually work with — no street name, no route number,
 * no way to label anything.
 *
 * ═══ THE TWO WAYS ATTRIBUTES GO SILENTLY WRONG ═══
 *
 * A shapefile joins geometry to attributes BY POSITION and by nothing else.
 * There is no key. So an off-by-one — caused by a null shape, an undrawable
 * MultiPatch, a deleted record, or a `.dbf` that simply disagrees about how
 * many records exist — labels every parcel with its neighbour's owner, and
 * nothing on screen looks wrong.
 *
 * And a `.dbf` stores BYTES, not text. `Cañada` in windows-1252 and `Cañada` in
 * UTF-8 are different byte sequences, and reading one as the other produces
 * either mojibake or a replacement character. Only a `.cpg` file states which,
 * so when there is no `.cpg` OpenPlan is guessing and has to say so.
 */

import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildDbf, buildShp, buildZip, windows1252 } from "./fixtures/context-layer-uploads";
import { importSpatialFile, type InflateRawSync } from "@/lib/geo/spatial-file-import";

const encoder = new TextEncoder();
const nodeInflate: InflateRawSync = (compressed, declared) =>
  new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(declared, 1) }));

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

type ShpShape = Parameters<typeof buildShp>[0][number];

function upload(parts: { shp: ShpShape[]; dbf?: Uint8Array; cpg?: string }) {
  const entries = [
    { name: "bikes.shp", data: buildShp(parts.shp) },
    { name: "bikes.prj", data: encoder.encode(WGS84_PRJ) },
  ];
  if (parts.dbf) entries.push({ name: "bikes.dbf", data: parts.dbf });
  if (parts.cpg) entries.push({ name: "bikes.cpg", data: encoder.encode(parts.cpg) });
  return importSpatialFile(
    { filename: "bikes.zip", bytes: buildZip(entries), featureCap: null },
    nodeInflate
  );
}

const POINT_A: ShpShape = { type: "point", position: [-121.49, 38.58] };
const POINT_B: ShpShape = { type: "point", position: [-121.48, 38.57] };
const POINT_C: ShpShape = { type: "point", position: [-121.47, 38.56] };

describe("shapefile attributes reach the features", () => {
  it("puts each record's attributes on its own shape", () => {
    const result = upload({
      shp: [POINT_A, POINT_B],
      dbf: buildDbf({
        fields: [
          { name: "NAME", type: "C", length: 12 },
          { name: "LANES", type: "N", length: 4 },
        ],
        records: [
          [encoder.encode("J Street"), encoder.encode("2")],
          [encoder.encode("P Street"), encoder.encode("4")],
        ],
      }),
    });

    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.featureCollection.features.map((feature) => feature.properties)).toEqual([
      { NAME: "J Street", LANES: 2 },
      { NAME: "P Street", LANES: 4 },
    ]);
  });

  it("reports the columns, so a caller can offer a label field", () => {
    const result = upload({
      shp: [POINT_A],
      dbf: buildDbf({
        fields: [
          { name: "NAME", type: "C", length: 8 },
          { name: "LENGTH_MI", type: "N", length: 8 },
          { name: "BUILT", type: "D", length: 8 },
          { name: "IS_CLASS_I", type: "L", length: 1 },
          { name: "NOTES", type: "M", length: 10 },
        ],
        records: [[encoder.encode("J St"), encoder.encode("1.25"), encoder.encode("20190401"), encoder.encode("T"), encoder.encode("1")]],
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeFields).toEqual([
      { name: "NAME", type: "text" },
      { name: "LENGTH_MI", type: "number" },
      { name: "BUILT", type: "date" },
      { name: "IS_CLASS_I", type: "boolean" },
      { name: "NOTES", type: "unreadable" },
    ]);
    expect(result.featureCollection.features[0].properties).toEqual({
      NAME: "J St",
      LENGTH_MI: 1.25,
      BUILT: "2019-04-01",
      IS_CLASS_I: true,
      // A memo field points into a .dbt this reader does not open. Null rather
      // than the raw block number: a number that looks like data and is not is
      // worse than an empty cell.
      NOTES: null,
    });
  });

  it("keeps alignment when a record the map cannot draw sits between two it can", () => {
    // THE OFF-BY-ONE THIS SUITE EXISTS FOR. A MultiPatch is a real record with
    // a real .dbf row and no drawable geometry. Indexing the attribute table by
    // position among the DRAWN features would give the third point the second
    // point's name, and the map would look perfectly fine.
    const result = upload({
      shp: [POINT_A, { type: "multipatch", bbox: [-121.5, 38.5, -121.4, 38.6] }, POINT_C],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 10 }],
        records: [[encoder.encode("first")], [encoder.encode("surface")], [encoder.encode("third")]],
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCollection.features.map((feature) => feature.properties?.NAME)).toEqual([
      "first",
      "third",
    ]);
    expect(result.droppedFeatureCount).toBe(1);
  });

  it("keeps alignment when a record is marked deleted", () => {
    // dBASE tombstones a record in place rather than removing it. Dropping the
    // row instead of keeping its slot shifts every later row onto the wrong
    // shape — the same defect, from a different direction.
    const result = upload({
      shp: [POINT_A, POINT_B, POINT_C],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 10 }],
        records: [[encoder.encode("first")], [encoder.encode("gone")], [encoder.encode("third")]],
        deleted: [1],
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.featureCollection.features.map((feature) => feature.properties?.NAME);
    expect(names[0]).toBe("first");
    expect(names[2]).toBe("third");
  });

  it("attaches nothing at all when the two files disagree about how many records exist", () => {
    // No alignment is defensible here, so none is invented. The geometry still
    // loads — it is not the part that is in doubt — and the reason is stated.
    const result = upload({
      shp: [POINT_A, POINT_B, POINT_C],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 10 }],
        records: [[encoder.encode("first")], [encoder.encode("second")]],
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCollection.features.map((feature) => feature.properties)).toEqual([{}, {}, {}]);
    expect(result.attributeFields).toEqual([]);
    expect(result.attributesUnavailableReason).toContain("2");
    expect(result.attributesUnavailableReason).toContain("3");
    expect(result.attributesUnavailableReason).toContain("by position");
  });
});

describe("shapefile attribute text is decoded with a stated encoding", () => {
  it("uses the encoding a .cpg states, and says that is where it came from", () => {
    const result = upload({
      shp: [POINT_A],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 12 }],
        records: [[encoder.encode("Cañada Road")]],
      }),
      cpg: "UTF-8",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeEncoding).toEqual({ label: "utf-8", basis: "cpg_file" });
    expect(result.featureCollection.features[0].properties?.NAME).toBe("Cañada Road");
  });

  it("reads a bare code page number, which is what a .cpg usually contains", () => {
    const result = upload({
      shp: [POINT_A],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 12 }],
        records: [[windows1252("Cañada Road")]],
      }),
      cpg: "1252",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeEncoding).toEqual({ label: "windows-1252", basis: "cpg_file" });
    expect(result.featureCollection.features[0].properties?.NAME).toBe("Cañada Road");
  });

  it("falls back to the .dbf's own language driver when there is no .cpg", () => {
    const result = upload({
      shp: [POINT_A],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 12 }],
        records: [[windows1252("Cañada Road")]],
        languageDriver: 0x03,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeEncoding).toEqual({ label: "windows-1252", basis: "dbf_language_driver" });
    expect(result.featureCollection.features[0].properties?.NAME).toBe("Cañada Road");
  });

  it("discloses the fallback when nothing in the file states an encoding", () => {
    // The basis is the whole point of this assertion. Reading windows-1252 is a
    // reasonable default; presenting the result as simply what the file says,
    // when nothing in the file said it, is not.
    const result = upload({
      shp: [POINT_A],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 12 }],
        records: [[windows1252("Cañada Road")]],
        languageDriver: 0,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeEncoding?.basis).toBe("fallback");
    expect(result.attributeEncoding?.label).toBe("windows-1252");
  });

  it("does not read past the end of a .dbf that overstates its record count", () => {
    // A truncated download, or a writer that never updated its header. Trusting
    // the header would decode whatever bytes follow as attribute text and
    // invent rows, which then trips the alignment check for the wrong reason.
    const result = upload({
      shp: [POINT_A, POINT_B],
      dbf: buildDbf({
        fields: [{ name: "NAME", type: "C", length: 10 }],
        records: [[encoder.encode("first")], [encoder.encode("second")]],
        declaredRecordCount: 900,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.featureCollection.features.map((feature) => feature.properties?.NAME)).toEqual([
      "first",
      "second",
    ]);
  });

  it("leaves features unattributed, and says nothing was wrong, when there is no .dbf at all", () => {
    const result = upload({ shp: [POINT_A] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attributeFields).toEqual([]);
    expect(result.attributeEncoding).toBeNull();
    expect(result.attributesUnavailableReason).toBeNull();
    expect(result.featureCollection.features[0].properties).toEqual({});
  });
});
