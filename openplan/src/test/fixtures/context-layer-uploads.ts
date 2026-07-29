import { deflateRawSync } from "node:zlib";

/**
 * Real GIS upload bytes, built here rather than checked in as binaries.
 *
 * Two reasons this is a builder and not a `.zip` in the repo. A binary fixture
 * is unreviewable — nobody can read a diff of it, so nobody can tell whether the
 * shapefile it contains is the one the test claims. And the byte layouts below
 * ARE the specification the importer is being held to: writing them out means a
 * reader can check the parser against the writer without leaving the file.
 *
 * Shared by the importer's own suite and by the upload route's, so the two
 * cannot drift into testing different shapefiles.
 */

const encoder = new TextEncoder();

export type ZipEntry = { name: string; data: Uint8Array; deflate?: boolean };

/** A minimal, real zip archive: local headers, central directory, EOCD. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const stored = entry.deflate ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + stored.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(stored, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export type ShpShape =
  | { type: "polyline"; parts: number[][][] }
  | { type: "polygon"; rings: number[][] }
  | { type: "point"; position: number[] }
  /**
   * A shapefile MultiPatch record (shape type 31) — the 3D surface type ArcGIS
   * writes for buildings and TINs.
   *
   * Written out because its LAYOUT is the whole hazard: a MultiPatch record
   * opens with its bounding box, so the first sixteen bytes after the type are
   * Xmin/Ymin, and any reader that classifies it by `31 % 10 === 1` reads that
   * corner as a point coordinate. The importer must never produce a feature
   * from this, and a fixture that carries a box distinguishable from any real
   * geometry is what makes "it did not" checkable.
   */
  | { type: "multipatch"; bbox: [number, number, number, number] };

/** A real .shp byte stream: 100-byte header, then one record per shape. */
export function buildShp(shapes: ShpShape[]): Uint8Array {
  const records: Uint8Array[] = [];

  shapes.forEach((shape, index) => {
    let content: Uint8Array;

    if (shape.type === "point") {
      content = new Uint8Array(20);
      const view = new DataView(content.buffer);
      view.setInt32(0, 1, true);
      view.setFloat64(4, shape.position[0], true);
      view.setFloat64(12, shape.position[1], true);
    } else if (shape.type === "multipatch") {
      // Type, then Box[4], then NumParts/NumPoints — the real MultiPatch
      // preamble. Everything after it (part types, points, Z range, Z array) is
      // omitted: a reader that gets this far has already gone wrong, and the
      // record is long enough that no length guard can be what saves it.
      content = new Uint8Array(44);
      const view = new DataView(content.buffer);
      view.setInt32(0, 31, true);
      shape.bbox.forEach((value, index) => view.setFloat64(4 + index * 8, value, true));
      view.setInt32(36, 1, true);
      view.setInt32(40, 4, true);
    } else {
      const rings = shape.type === "polyline" ? shape.parts : [shape.rings];
      const points = rings.flat();
      content = new Uint8Array(44 + rings.length * 4 + points.length * 16);
      const view = new DataView(content.buffer);
      view.setInt32(0, shape.type === "polyline" ? 3 : 5, true);
      view.setInt32(36, rings.length, true);
      view.setInt32(40, points.length, true);
      let running = 0;
      rings.forEach((ring, ringIndex) => {
        view.setInt32(44 + ringIndex * 4, running, true);
        running += ring.length;
      });
      points.forEach((position, pointIndex) => {
        const at = 44 + rings.length * 4 + pointIndex * 16;
        view.setFloat64(at, position[0], true);
        view.setFloat64(at + 8, position[1], true);
      });
    }

    const record = new Uint8Array(8 + content.length);
    const recordView = new DataView(record.buffer);
    recordView.setInt32(0, index + 1, false);
    recordView.setInt32(4, content.length / 2, false);
    record.set(content, 8);
    records.push(record);
  });

  return wrapShpRecords(records);
}

/** One polygon record carrying an outer ring and a hole, as two parts. */
export function buildShpPolygonWithHole(outer: number[][], inner: number[][]): Uint8Array {
  const rings = [outer, inner];
  const points = rings.flat();
  const content = new Uint8Array(44 + rings.length * 4 + points.length * 16);
  const view = new DataView(content.buffer);
  view.setInt32(0, 5, true);
  view.setInt32(36, rings.length, true);
  view.setInt32(40, points.length, true);
  let running = 0;
  rings.forEach((ring, index) => {
    view.setInt32(44 + index * 4, running, true);
    running += ring.length;
  });
  points.forEach((position, index) => {
    const at = 44 + rings.length * 4 + index * 16;
    view.setFloat64(at, position[0], true);
    view.setFloat64(at + 8, position[1], true);
  });

  const record = new Uint8Array(8 + content.length);
  const recordView = new DataView(record.buffer);
  recordView.setInt32(0, 1, false);
  recordView.setInt32(4, content.length / 2, false);
  record.set(content, 8);

  return wrapShpRecords([record]);
}

function wrapShpRecords(records: Uint8Array[]): Uint8Array {
  const body = records.reduce((sum, record) => sum + record.length, 0);
  const out = new Uint8Array(100 + body);
  const view = new DataView(out.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, (100 + body) / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);

  let cursor = 100;
  for (const record of records) {
    out.set(record, cursor);
    cursor += record.length;
  }
  return out;
}

export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/**
 * A real projected system a planner would plausibly have on disk. It lives only
 * inside this fixture string: nothing about any place, zone, or agency is baked
 * into the product, and the importer reads whatever the uploaded .prj says.
 */
export const PROJECTED_PRJ =
  'PROJCS["NAD83 / UTM zone 10N",GEOGCS["NAD83",DATUM["North_American_Datum_1983",' +
  'SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],' +
  'PROJECTION["Transverse_Mercator"],UNIT["metre",1],AUTHORITY["EPSG","26910"]]';

/** A shapefile the importer must refuse: readable, but in metres. */
export function buildProjectedShapefileZip(): Uint8Array {
  return buildZip([
    { name: "corridor.shp", data: buildShp([{ type: "point", position: [500000, 4000000] }]) },
    { name: "corridor.prj", data: encoder.encode(PROJECTED_PRJ) },
  ]);
}
