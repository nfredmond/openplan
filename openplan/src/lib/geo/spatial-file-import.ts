/**
 * Reading a planner's GIS file into GeoJSON features — the ONE place OpenPlan
 * understands spatial upload formats.
 *
 * Extracted from the engagement context-layer importer (2026-08-10) so that
 * every surface accepting a GIS file — an engagement context layer, a corridor
 * study boundary, whatever comes next — reads formats through the same code. A
 * format bug can then exist in exactly one place. This module knows nothing
 * about engagement, corridors, campaigns, or any other caller's concepts.
 *
 * ENVIRONMENT-NEUTRAL, DELIBERATELY. The engagement importer is node-only; the
 * corridor upload runs in the browser. The only operation that differs between
 * those environments is inflating a deflated zip entry, so that one step is
 * injected: `importSpatialFile` takes a synchronous inflate (node passes
 * `zlib.inflateRawSync`), and `importSpatialFileAsync` defaults to
 * `webInflateRaw`, built on `DecompressionStream` — a global in every modern
 * browser and in Node 18+. Everything else in this file is plain computation.
 *
 * ZERO NEW DEPENDENCIES, DELIBERATELY. `shpjs`, `togeojson` and `proj4` would
 * each be a reasonable choice; none of them is in this project's package.json,
 * and adding a dependency is a decision with a supply-chain tail that outlives
 * this feature. What is here instead is narrow on purpose: the three container
 * formats a planner actually hands you, read strictly, refusing anything outside
 * what it can prove it understands.
 *
 * ═══ THE COORDINATE REFERENCE SYSTEM RULE ═══
 *
 * OpenPlan does not ask the planner to pick a projection. EngagementHQ does, and
 * that question has a wrong answer available to someone who does not know their
 * own SRS — which is most planners, because their GIS has always handled it. So
 * this importer establishes the SRS from evidence:
 *
 *   - a shapefile's `.prj`, parsed as WKT;
 *   - a legacy GeoJSON `crs` member, when one is present;
 *   - the SPECIFICATION, where the specification settles it: RFC 7946 fixes
 *     GeoJSON to WGS84, and OGC KML 2.2 fixes KML to WGS84. Relying on a
 *     specification is not a guess, and `srs.basis` records which of these it
 *     was so the two are never confused later.
 *
 * When none of those applies — a shapefile with no `.prj`, a projected CRS, a
 * geographic CRS in units this importer cannot confirm are degrees — the upload
 * is REFUSED, by name, with what to do about it. It is never reprojected on a
 * hunch: an alignment drawn fifty metres off the street it describes is worse
 * than a layer that did not load, because the first one gets believed.
 *
 * Reprojection would mean adding `proj4` and is a deliberate future decision,
 * not an omission to work around. Every refusal below says so where it is true.
 *
 * ═══ THE SECOND NET ═══
 *
 * Every coordinate is range-checked against WGS84 bounds after parsing. A
 * projected file that somehow reached the normalizer has easting/northing values
 * in the millions and every feature is dropped rather than drawn in the Gulf of
 * Guinea; when NOTHING survives, the whole upload is refused with that as the
 * stated reason.
 *
 * ═══ A SHAPE IT CANNOT DRAW IS SKIPPED AND SAID, NEVER APPROXIMATED ═══
 *
 * The same rule governs geometry it does not understand. A shapefile MultiPatch
 * record (type 31) is a 3D surface with no 2D reading that is true, so it is not
 * drawn — and it is COUNTED, so the caller's own disclosure reports it as a
 * shape that is in the file and not on the map. See `READABLE_SHAPE_TYPES` for
 * why the obvious modulo shortcut turns that skip into a wrong dot instead.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Upload formats the importer can read. */
export const SPATIAL_FILE_FORMATS = ["geojson", "kml", "kmz", "shapefile_zip"] as const;
export type SpatialFileFormat = (typeof SPATIAL_FILE_FORMATS)[number];

/**
 * How the file's coordinate reference system was established.
 *
 * There is deliberately no member meaning "assumed". The importer reads the
 * answer from the file, or from a specification that fixes it, or it refuses.
 */
export const SPATIAL_FILE_SRS_BASES = [
  /** Read from a shapefile's `.prj` WKT. */
  "prj_file",
  /** A legacy (GeoJSON 2008) `crs` member naming CRS84 / EPSG:4326. */
  "geojson_crs_member",
  /** RFC 7946 §4: GeoJSON coordinates are WGS84 unless a `crs` member says otherwise. */
  "geojson_rfc7946_default",
  /** OGC KML 2.2 §6.1: KML coordinates are WGS84. */
  "kml_specification",
] as const;
export type SpatialFileSrsBasis = (typeof SPATIAL_FILE_SRS_BASES)[number];

export type SpatialFileSrs = {
  /** Registry that issued the code, e.g. "EPSG". Null when the file named none. */
  authority: string | null;
  /** Code within that registry, e.g. "4326". Null when the file named none. */
  code: string | null;
  /** What a planner reads: "WGS 84", "NAD83 / California zone 2 (ftUS)". */
  name: string;
  basis: SpatialFileSrsBasis;
};

/** Geometry kinds a normalized import can carry. */
export type SpatialFileGeometryKind = "Point" | "LineString" | "Polygon";

export type SpatialFileFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
};

// ── Result contract ──────────────────────────────────────────────────────────

export type SpatialFileImportRefusalReason =
  | "unsupported_format"
  | "unreadable"
  | "empty"
  | "srs_undetermined"
  | "srs_unsupported"
  | "no_drawable_features";

export type SpatialFileImportRefusal = {
  ok: false;
  reason: SpatialFileImportRefusalReason;
  /** Shown to the planner. Always names the real cause and the next step. */
  message: string;
};

export type SpatialFileImport = {
  ok: true;
  format: SpatialFileFormat;
  srs: SpatialFileSrs;
  featureCollection: SpatialFileFeatureCollection;
  geometryKinds: SpatialFileGeometryKind[];
  /** Shapes stored — one GeoJSON Feature each, which is what the map draws. */
  featureCount: number;
  /**
   * Every shape the file yielded, before the cap and before drops.
   *
   * COUNTED IN SHAPES, NOT IN SOURCE FEATURES, and the two are not always the
   * same number. A GeoJSON Feature carrying a GeometryCollection is expanded
   * into one shape per member (Mapbox will not draw a GeometryCollection), so a
   * file with four Features can legitimately yield twelve shapes. This is the
   * denominator of "showing N of M", and the numerator is stored shapes, so both
   * sides have to be in the same unit — which is why a disclosure sentence built
   * from these numbers must say "shapes" and not "features".
   */
  sourceFeatureCount: number;
  /** Shapes present in the file that are not in the result: unusable
   * coordinates, or a shape type this reader refuses to draw rather than draw
   * wrongly. */
  droppedFeatureCount: number;
  truncated: boolean;
  bbox: [number, number, number, number] | null;
};

export type SpatialFileImportResult = SpatialFileImport | SpatialFileImportRefusal;

function refuse(reason: SpatialFileImportRefusalReason, message: string): SpatialFileImportRefusal {
  return { ok: false, reason, message };
}

// ── Format detection ─────────────────────────────────────────────────────────

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * What this file is, from its name AND its bytes.
 *
 * The extension is a hint, not evidence: a zip renamed `.geojson` must not be
 * fed to `JSON.parse`, and a `.zip` that is really a KMZ should still draw. So
 * the container is confirmed from the magic bytes and, for zips, from what is
 * actually inside.
 */
export function detectSpatialFileFormat(filename: string, bytes: Uint8Array): SpatialFileFormat | null {
  const extension = extensionOf(filename);

  if (looksLikeZip(bytes)) {
    const archive = readZipEntryNames(bytes);
    if (archive.some((name) => name.toLowerCase().endsWith(".shp"))) return "shapefile_zip";
    if (archive.some((name) => name.toLowerCase().endsWith(".kml"))) return "kmz";
    // A zip we cannot classify by contents falls back to the extension so the
    // refusal downstream can name what was missing rather than "unknown file".
    return extension === "kmz" ? "kmz" : extension === "zip" ? "shapefile_zip" : null;
  }

  if (extension === "geojson" || extension === "json") return "geojson";
  if (extension === "kml") return "kml";
  return null;
}

// ── Entry points ─────────────────────────────────────────────────────────────

export type SpatialFileImportInput = {
  filename: string;
  bytes: Uint8Array;
  /** Most features to store, or null for unlimited (operator configuration). */
  featureCap: number | null;
};

/**
 * Inflate one raw-deflate stream, throwing on failure OR on output exceeding
 * `declaredByteLength` — the zip's own central directory states the size, so a
 * stream that inflates past it is lying, and holding it to the declaration is
 * what turns a zip bomb into a named refusal instead of an out-of-memory kill.
 * `declaredByteLength` can legally be 0; an implementation must still accept a
 * zero-byte result rather than refusing a legal empty entry.
 */
export type InflateRawSync = (compressed: Uint8Array, declaredByteLength: number) => Uint8Array;
export type InflateRawAsync = (
  compressed: Uint8Array,
  declaredByteLength: number
) => Uint8Array | Promise<Uint8Array>;

/**
 * Synchronous import, for environments with a synchronous inflate — node, where
 * the caller passes `zlib.inflateRawSync` (see the engagement adapter).
 */
export function importSpatialFile(input: SpatialFileImportInput, inflateRaw: InflateRawSync): SpatialFileImportResult {
  const plan = planImport(input);
  if (plan.kind === "refusal") return plan.refusal;
  if (plan.kind === "direct") return completeImport(input, plan.format, null);

  const inflated = inflateEntriesSync(plan.entries, inflateRaw);
  if (!inflated.ok) return inflated;
  return completeImport(input, plan.format, inflated.files);
}

/**
 * Asynchronous import for the browser, where the only inflate available —
 * `DecompressionStream` — is async. The default `webInflateRaw` also works in
 * node 18+, where `DecompressionStream` is a global.
 */
export async function importSpatialFileAsync(
  input: SpatialFileImportInput,
  inflateRaw: InflateRawAsync = webInflateRaw
): Promise<SpatialFileImportResult> {
  const plan = planImport(input);
  if (plan.kind === "refusal") return plan.refusal;
  if (plan.kind === "direct") return completeImport(input, plan.format, null);

  const files: ZipFile[] = [];
  for (const entry of plan.entries) {
    if (entry.method === 0) {
      files.push({ name: entry.name, bytes: entry.raw });
      continue;
    }
    try {
      files.push({ name: entry.name, bytes: await inflateRaw(entry.raw, entry.uncompressedSize) });
    } catch {
      return inflateFailureRefusal(entry.name, entry.uncompressedSize);
    }
  }
  return completeImport(input, plan.format, files);
}

/** The browser/universal inflate: `DecompressionStream` over a raw deflate
 * stream, bounded by the size the archive itself declares. */
export async function webInflateRaw(compressed: Uint8Array, declaredByteLength: number): Promise<Uint8Array> {
  const bound = Math.max(declaredByteLength, 0);
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  // DecompressionStream's lib type declares its writable side as BufferSource,
  // which TS will not unify with a Uint8Array source stream; the object is the
  // same transform either way, so the cast narrows, never widens.
  const inflater = new DecompressionStream("deflate-raw") as unknown as {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  const reader = source.pipeThrough(inflater).getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > bound) {
      await reader.cancel().catch(() => undefined);
      throw new Error("inflated content exceeds the size the archive declares");
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

type ImportPlan =
  | { kind: "refusal"; refusal: SpatialFileImportRefusal }
  | { kind: "direct"; format: "geojson" | "kml" }
  | { kind: "archive"; format: "kmz" | "shapefile_zip"; entries: RawZipEntry[] };

function planImport(input: SpatialFileImportInput): ImportPlan {
  if (input.bytes.byteLength === 0) {
    return { kind: "refusal", refusal: refuse("empty", "The uploaded file is empty.") };
  }

  const format = detectSpatialFileFormat(input.filename, input.bytes);
  if (!format) {
    return {
      kind: "refusal",
      refusal: refuse(
        "unsupported_format",
        "OpenPlan reads GeoJSON (.geojson/.json), KML (.kml), KMZ (.kmz), and zipped shapefiles (.zip containing " +
          ".shp and .prj). This file matched none of those. Export the layer from your GIS in one of those formats."
      ),
    };
  }

  if (format === "geojson" || format === "kml") return { kind: "direct", format };

  const entries = collectRawZipEntries(input.bytes);
  if (!entries.ok) return { kind: "refusal", refusal: entries };
  return { kind: "archive", format, entries: entries.entries };
}

function completeImport(
  input: SpatialFileImportInput,
  format: SpatialFileFormat,
  files: ZipFile[] | null
): SpatialFileImportResult {
  const read =
    format === "geojson"
      ? readGeoJsonUpload(input.bytes)
      : format === "kml"
        ? readKmlUpload(decodeUtf8(input.bytes))
        : format === "kmz"
          ? readKmzUpload(files ?? [])
          : readShapefileUpload(files ?? []);

  if (!read.ok) return read;

  return normalize(format, read.srs, read.candidates, input.featureCap, read.undrawableCount ?? 0);
}

// ── Normalization, bounds, and the disclosure counts ─────────────────────────

type Candidate = {
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
};

type ReaderResult =
  | {
      ok: true;
      srs: SpatialFileSrs;
      candidates: Candidate[];
      /**
       * Shapes the reader positively identified and deliberately did not turn
       * into a candidate — a MultiPatch, or a record of a shape type this reader
       * does not know. They are real content of the file, so they belong in the
       * counts even though no geometry of theirs exists to normalize; leaving
       * them out would make the caller's own disclosure say the file ended where
       * they began.
       */
      undrawableCount?: number;
    }
  | SpatialFileImportRefusal;

/** ~0.1 m at the equator. Enough for any planning geometry, and far smaller. */
const COORDINATE_DECIMALS = 6;

function roundCoordinate(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}

function isDrawableLngLat(position: unknown): position is number[] {
  if (!Array.isArray(position) || position.length < 2) return false;
  const [lng, lat] = position;
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

type Bounds = { west: number; south: number; east: number; north: number };

/**
 * Round every position, verify it is a plausible WGS84 lon/lat, and — only if
 * the WHOLE geometry survives — grow the shared bounds.
 *
 * THE MERGE IS DEFERRED DELIBERATELY. Growing `bounds` while walking meant a
 * geometry rejected at its last position had already widened the layer's
 * extent, so the stored bbox described ground the layer never drew on and the
 * display map opened framed on it. A bounding box has to be the box of what was
 * KEPT, or it is a quiet claim about where the project reaches.
 *
 * The bounds are grown from the ROUNDED positions, so the stored box provably
 * contains the stored coordinates rather than the pre-rounding ones.
 *
 * Returns null for a geometry with any unusable position — partial geometry is
 * not drawn, because half a parcel boundary is a wrong parcel boundary rather
 * than an incomplete one.
 */
function normalizeGeometry(geometry: GeoJSON.Geometry, bounds: Bounds): GeoJSON.Geometry | null {
  const kept: Bounds = { west: 180, south: 90, east: -180, north: -90 };

  const walk = (value: unknown, depth: number): unknown => {
    if (depth === 0) {
      if (!isDrawableLngLat(value)) return null;
      const [lng, lat] = (value as number[]).map(roundCoordinate);
      kept.west = Math.min(kept.west, lng);
      kept.east = Math.max(kept.east, lng);
      kept.south = Math.min(kept.south, lat);
      kept.north = Math.max(kept.north, lat);
      return [lng, lat];
    }
    if (!Array.isArray(value) || value.length === 0) return null;
    const mapped: unknown[] = [];
    for (const entry of value) {
      const next = walk(entry, depth - 1);
      if (next === null) return null;
      mapped.push(next);
    }
    return mapped;
  };

  const depthByType: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  };

  const depth = depthByType[geometry.type];
  if (depth === undefined) return null;

  const coordinates = walk((geometry as { coordinates: unknown }).coordinates, depth);
  if (coordinates === null) return null;

  bounds.west = Math.min(bounds.west, kept.west);
  bounds.east = Math.max(bounds.east, kept.east);
  bounds.south = Math.min(bounds.south, kept.south);
  bounds.north = Math.max(bounds.north, kept.north);

  return { type: geometry.type, coordinates } as GeoJSON.Geometry;
}

const BASE_KIND: Record<string, SpatialFileGeometryKind> = {
  Point: "Point",
  MultiPoint: "Point",
  LineString: "LineString",
  MultiLineString: "LineString",
  Polygon: "Polygon",
  MultiPolygon: "Polygon",
};

function normalize(
  format: SpatialFileFormat,
  srs: SpatialFileSrs,
  candidates: Candidate[],
  featureCap: number | null,
  undrawableCount: number
): SpatialFileImportResult {
  const bounds: Bounds = { west: 180, south: 90, east: -180, north: -90 };
  const features: GeoJSON.Feature[] = [];
  const kinds = new Set<SpatialFileGeometryKind>();
  // Shapes the reader identified and refused to draw start the drop count.
  // They are in the file and they are not on the map, which is exactly what the
  // dropped disclosure exists to say.
  let dropped = undrawableCount;
  let truncated = false;

  for (const candidate of candidates) {
    if (featureCap !== null && features.length >= featureCap) {
      // Everything from here on is counted but not stored, so the caller can say
      // "showing N of M" instead of quietly ending early.
      truncated = true;
      continue;
    }

    const geometry = normalizeGeometry(candidate.geometry, bounds);
    if (!geometry) {
      dropped += 1;
      continue;
    }

    kinds.add(BASE_KIND[geometry.type]);
    features.push({ type: "Feature", geometry, properties: candidate.properties });
  }

  if (candidates.length === 0) {
    return refuse(
      "no_drawable_features",
      `This ${describeSpatialFileFormat(format)} carried no point, line, or area geometry that OpenPlan could read, so there ` +
        "is nothing to draw. Check that the layer you exported contains features rather than only styling or metadata."
    );
  }

  if (features.length === 0) {
    return refuse(
      "no_drawable_features",
      `Every feature in this ${describeSpatialFileFormat(format)} had coordinates outside the valid longitude/latitude range, ` +
        "so none of them could be placed on the map. That usually means the file is in a projected coordinate " +
        "system (feet or metres) rather than degrees. Re-export it as WGS 84 / EPSG:4326."
    );
  }

  return {
    ok: true,
    format,
    srs,
    featureCollection: { type: "FeatureCollection", features },
    geometryKinds: [...kinds],
    featureCount: features.length,
    sourceFeatureCount: candidates.length + undrawableCount,
    droppedFeatureCount: dropped,
    truncated,
    bbox: [bounds.west, bounds.south, bounds.east, bounds.north].map(roundCoordinate) as [
      number,
      number,
      number,
      number,
    ],
  };
}

export function describeSpatialFileFormat(format: SpatialFileFormat): string {
  switch (format) {
    case "geojson":
      return "GeoJSON file";
    case "kml":
      return "KML file";
    case "kmz":
      return "KMZ file";
    case "shapefile_zip":
      return "shapefile";
  }
}

// ── GeoJSON ──────────────────────────────────────────────────────────────────

const WGS84: Omit<SpatialFileSrs, "basis"> = { authority: "EPSG", code: "4326", name: "WGS 84" };

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Whether a GeoJSON 2008 `crs` member names WGS84.
 *
 * The member was REMOVED in RFC 7946, so a file that still carries one is old,
 * and old files are exactly the ones that might not be in degrees. The named
 * forms below are the ones the OGC and legacy exporters actually emit.
 */
const WGS84_CRS_NAMES = new Set([
  "urn:ogc:def:crs:ogc:1.3:crs84",
  "urn:ogc:def:crs:ogc:2:84",
  "urn:ogc:def:crs:epsg::4326",
  "epsg:4326",
  "crs84",
  "wgs84",
  "ogc:crs84",
]);

function readGeoJsonUpload(bytes: Uint8Array): ReaderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes));
  } catch {
    return refuse("unreadable", "This file is not valid JSON, so it could not be read as GeoJSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    return refuse("unreadable", "This file does not contain a GeoJSON object.");
  }

  const root = parsed as Record<string, unknown>;

  // The legacy crs member. Present and not WGS84 → refuse; this importer does
  // not reproject, and a file that bothered to declare a CRS meant it.
  const crs = root.crs as { properties?: { name?: unknown; href?: unknown } } | undefined;
  let basis: SpatialFileSrs["basis"] = "geojson_rfc7946_default";
  if (crs && typeof crs === "object") {
    const declared = crs.properties?.name ?? crs.properties?.href;
    if (typeof declared === "string" && declared.trim().length > 0) {
      const normalized = declared.trim().toLowerCase();
      if (!WGS84_CRS_NAMES.has(normalized)) {
        return refuse(
          "srs_unsupported",
          `This GeoJSON declares the coordinate system "${declared.trim()}". OpenPlan reads longitude/latitude ` +
            "(WGS 84 / EPSG:4326) data and does not reproject, so it will not place this file rather than place it " +
            "wrongly. Re-export it as WGS 84 / EPSG:4326."
        );
      }
      basis = "geojson_crs_member";
    }
  }

  const candidates: Candidate[] = [];
  const pushGeometry = (geometry: unknown, properties: Record<string, unknown>) => {
    if (!geometry || typeof geometry !== "object") return;
    const typed = geometry as GeoJSON.Geometry;
    if (typed.type === "GeometryCollection") {
      // Expanded rather than dropped: a GeometryCollection is a drawing
      // instruction Mapbox will not honour, but its members are perfectly good
      // features and the operator meant all of them.
      for (const member of (typed as GeoJSON.GeometryCollection).geometries ?? []) {
        pushGeometry(member, properties);
      }
      return;
    }
    if (typeof typed.type !== "string") return;
    candidates.push({ geometry: typed, properties });
  };

  const pushFeature = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const feature = value as { type?: unknown; geometry?: unknown; properties?: unknown };
    if (feature.type === "Feature") {
      const properties =
        feature.properties && typeof feature.properties === "object"
          ? (feature.properties as Record<string, unknown>)
          : {};
      pushGeometry(feature.geometry, properties);
      return;
    }
    pushGeometry(value, {});
  };

  if (root.type === "FeatureCollection" && Array.isArray(root.features)) {
    for (const feature of root.features) pushFeature(feature);
  } else {
    pushFeature(root);
  }

  return { ok: true, srs: { ...WGS84, basis }, candidates };
}

// ── KML / KMZ ────────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

/** `<kml:Placemark>` and `<Placemark>` are the same element. */
function tagPattern(tag: string, flags = "gi"): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}\\s*>`, flags);
}

/** KML coordinate lists are whitespace-separated `lon,lat[,alt]` tuples. */
function parseKmlCoordinates(text: string): number[][] {
  const positions: number[][] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lng = Number.parseFloat(parts[0]);
    const lat = Number.parseFloat(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    positions.push([lng, lat]);
  }
  return positions;
}

function firstMatch(source: string, tag: string): string | null {
  const match = tagPattern(tag, "i").exec(source);
  return match ? match[1] : null;
}

function readKmlUpload(text: string): ReaderResult {
  // No DTD, no entity declarations. This reader never expands an entity it did
  // not write, so an entity-expansion or external-entity payload is refused at
  // the door rather than defended against downstream.
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    return refuse(
      "unreadable",
      "This KML declares an XML document type or entity. OpenPlan reads plain KML only and will not process " +
        "declarations, so this file was not read. Re-export it from Google Earth or your GIS."
    );
  }

  if (!/<(?:[A-Za-z0-9_.-]+:)?kml\b/i.test(text) && !/<(?:[A-Za-z0-9_.-]+:)?Placemark\b/i.test(text)) {
    return refuse("unreadable", "This file does not look like KML — it contains no <kml> or <Placemark> element.");
  }

  const candidates: Candidate[] = [];

  for (const placemark of text.matchAll(tagPattern("Placemark"))) {
    const body = placemark[1];
    const rawName = firstMatch(body, "name");
    const properties: Record<string, unknown> = {};
    if (rawName) {
      const name = decodeXmlText(rawName).trim();
      if (name) properties.name = name;
    }

    for (const point of body.matchAll(tagPattern("Point"))) {
      const positions = parseKmlCoordinates(firstMatch(point[1], "coordinates") ?? "");
      if (positions.length >= 1) {
        candidates.push({ geometry: { type: "Point", coordinates: positions[0] }, properties });
      }
    }

    for (const line of body.matchAll(tagPattern("LineString"))) {
      const positions = parseKmlCoordinates(firstMatch(line[1], "coordinates") ?? "");
      if (positions.length >= 2) {
        candidates.push({ geometry: { type: "LineString", coordinates: positions }, properties });
      }
    }

    for (const polygon of body.matchAll(tagPattern("Polygon"))) {
      const rings: number[][][] = [];
      const outer = firstMatch(polygon[1], "outerBoundaryIs");
      if (outer) {
        const ring = closeRing(parseKmlCoordinates(firstMatch(outer, "coordinates") ?? ""));
        if (ring) rings.push(ring);
      }
      for (const inner of polygon[1].matchAll(tagPattern("innerBoundaryIs"))) {
        const ring = closeRing(parseKmlCoordinates(firstMatch(inner[1], "coordinates") ?? ""));
        if (ring) rings.push(ring);
      }
      if (rings.length > 0) {
        candidates.push({ geometry: { type: "Polygon", coordinates: rings }, properties });
      }
    }
  }

  // KML's coordinate reference system is not something the file states — OGC KML
  // 2.2 §6.1 fixes it to WGS84 for every conforming document. Reading it as that
  // is following the specification, not assuming, and `srs.basis` says which.
  return { ok: true, srs: { ...WGS84, basis: "kml_specification" }, candidates };
}

function closeRing(positions: number[][]): number[][] | null {
  if (positions.length < 3) return null;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return positions;
  return [...positions, first];
}

function readKmzUpload(files: ZipFile[]): ReaderResult {
  const kml = files.find((file) => file.name.toLowerCase().endsWith(".kml"));
  if (!kml) {
    return refuse(
      "unreadable",
      "This KMZ archive contains no .kml document, so there is nothing to read. Re-save it from Google Earth."
    );
  }

  return readKmlUpload(decodeUtf8(kml.bytes));
}

// ── Zip container ────────────────────────────────────────────────────────────

type ZipFile = { name: string; bytes: Uint8Array };
type ZipResult = { ok: true; files: ZipFile[] } | SpatialFileImportRefusal;

/**
 * One file inside the archive, still compressed. The container walk below has
 * already refused everything this importer will not read (encryption, zip64,
 * unknown compression), so the only step left — and the only step that differs
 * between node and the browser — is inflating `raw` when `method` is 8.
 */
type RawZipEntry = { name: string; method: 0 | 8; raw: Uint8Array; uncompressedSize: number };
type RawZipResult = { ok: true; entries: RawZipEntry[] } | SpatialFileImportRefusal;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD is 22 bytes plus a comment of at most 65,535. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const earliest = Math.max(0, length - MAX_EOCD_SEARCH);
  for (let offset = length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Entry names only — enough to classify an archive without inflating it. */
function readZipEntryNames(bytes: Uint8Array): string[] {
  const entries = collectRawZipEntries(bytes, { namesOnly: true });
  return entries.ok ? entries.entries.map((entry) => entry.name) : [];
}

/**
 * A deliberately small zip reader: stored and deflated entries, no zip64, no
 * encryption. Everything outside that is refused by name — a reader that
 * quietly skipped an entry it could not inflate would produce a layer missing
 * features nobody was told about.
 *
 * Inflation is NOT done here: it is the one environment-specific step, so the
 * entries come back raw and the caller inflates them with whichever inflate its
 * environment has (see `InflateRawSync` / `InflateRawAsync`).
 */
function collectRawZipEntries(bytes: Uint8Array, options: { namesOnly?: boolean } = {}): RawZipResult {
  const view = viewOf(bytes);
  const eocd = findEndOfCentralDirectory(view, bytes.byteLength);
  if (eocd === -1) {
    return refuse("unreadable", "This zip archive is damaged — its central directory could not be found.");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: RawZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return refuse("unreadable", "This zip archive is damaged — its central directory entries could not be read.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    cursor += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no data.
    if (name.endsWith("/")) continue;

    if (options.namesOnly) {
      entries.push({ name, method: 0, raw: new Uint8Array(0), uncompressedSize: 0 });
      continue;
    }

    if ((flags & 0x0001) !== 0) {
      return refuse(
        "unreadable",
        `The archive entry "${name}" is password-protected. Re-create the zip without encryption.`
      );
    }

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return refuse(
        "unreadable",
        "This archive uses the zip64 extension, which OpenPlan does not read. Re-create it as a standard zip, " +
          "or simplify the layer so it fits in one."
      );
    }

    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      return refuse("unreadable", `The archive entry "${name}" points outside the file, so the zip is damaged.`);
    }

    if (method !== 0 && method !== 8) {
      return refuse(
        "unreadable",
        `The archive entry "${name}" uses compression method ${method}, which OpenPlan does not read. Re-create ` +
          "the zip with standard deflate compression."
      );
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    entries.push({ name, method, raw, uncompressedSize });
  }

  return { ok: true, entries };
}

function inflateFailureRefusal(name: string, uncompressedSize: number): SpatialFileImportRefusal {
  return refuse(
    "unreadable",
    `The archive entry "${name}" could not be decompressed, so the zip is damaged — its contents do not match ` +
      `the ${uncompressedSize.toLocaleString()} bytes its own directory declares.`
  );
}

function inflateEntriesSync(entries: RawZipEntry[], inflateRaw: InflateRawSync): ZipResult {
  const files: ZipFile[] = [];
  for (const entry of entries) {
    if (entry.method === 0) {
      files.push({ name: entry.name, bytes: entry.raw });
      continue;
    }
    try {
      // BOUNDED BY WHAT THE ARCHIVE ITSELF DECLARES — see `InflateRawSync`: an
      // unbounded inflate will expand whatever the compressed stream says to,
      // and deflate reaches roughly a thousand to one on repetitive input. The
      // central directory already states the uncompressed size, so holding the
      // inflate to it turns a lying header into a named refusal instead of an
      // out-of-memory kill. It does NOT bound an archive that honestly declares
      // a huge entry; that is the caller's byte ceiling's job.
      files.push({ name: entry.name, bytes: inflateRaw(entry.raw, entry.uncompressedSize) });
    } catch {
      return inflateFailureRefusal(entry.name, entry.uncompressedSize);
    }
  }
  return { ok: true, files };
}

// ── Shapefile ────────────────────────────────────────────────────────────────

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

/** macOS zips carry a `__MACOSX/` shadow tree of AppleDouble stubs. */
function isArchiveNoise(name: string): boolean {
  const base = baseName(name);
  return name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store";
}

function readShapefileUpload(files: ZipFile[]): ReaderResult {
  const usable = files.filter((file) => !isArchiveNoise(file.name));
  const shp = usable.find((file) => file.name.toLowerCase().endsWith(".shp"));
  if (!shp) {
    return refuse(
      "unreadable",
      "This zip contains no .shp file. A shapefile upload must be a zip of the whole shapefile — at least the " +
        ".shp and the .prj, and normally the .shx and .dbf as well."
    );
  }

  const stem = stripExtension(baseName(shp.name)).toLowerCase();
  const prj = usable.find(
    (file) =>
      file.name.toLowerCase().endsWith(".prj") && stripExtension(baseName(file.name)).toLowerCase() === stem
  );

  if (!prj) {
    return refuse(
      "srs_undetermined",
      `This shapefile has no .prj file, so its coordinate system cannot be established. OpenPlan will not guess a ` +
        `projection — a layer placed on a guess can be tens of metres from where it belongs and still look right. ` +
        `Re-export "${baseName(shp.name)}" from your GIS with its .prj included, or supply the layer as GeoJSON.`
    );
  }

  const srs = readPrj(decodeUtf8(prj.bytes));
  if (!srs.ok) return srs;

  const geometry = readShpGeometry(shp.bytes);
  if (!geometry.ok) return geometry;

  return { ok: true, srs: srs.srs, candidates: geometry.candidates, undrawableCount: geometry.undrawableCount };
}

// ── .prj → SRS ───────────────────────────────────────────────────────────────

type PrjResult = { ok: true; srs: SpatialFileSrs } | SpatialFileImportRefusal;

/** The quoted name that follows a WKT keyword, e.g. `PROJCS["…"`. */
function wktNameAfter(wkt: string, keyword: string): string | null {
  const match = new RegExp(`\\b${keyword}\\s*\\[\\s*"([^"]*)"`, "i").exec(wkt);
  return match ? match[1] : null;
}

/** The last `AUTHORITY["EPSG","4326"]` in the string — WKT puts it outermost. */
function wktAuthority(wkt: string): { authority: string; code: string } | null {
  let found: { authority: string; code: string } | null = null;
  for (const match of wkt.matchAll(/\b(?:AUTHORITY|ID)\s*\[\s*"([^"]*)"\s*,\s*"?([^",\]]*)"?/gi)) {
    found = { authority: match[1], code: match[2].trim() };
  }
  return found;
}

/**
 * Read a shapefile's `.prj` and decide whether OpenPlan can place the layer.
 *
 * ACCEPTS a geographic CRS (a `GEOGCS` / `GEOGCRS`), whose coordinates are
 * already longitude/latitude degrees. The datum is recorded rather than
 * converted: NAD83 and WGS 84 differ by one to two metres in North America,
 * which is below the resolution of anything a resident draws on a portal map,
 * and stating the datum is honest where silently "correcting" it would not be.
 *
 * REFUSES a projected CRS (a `PROJCS` / `PROJCRS`) by name. Converting State
 * Plane feet or a UTM zone to degrees is real work with real failure modes, and
 * doing it wrong puts the alignment in the wrong street. It needs a projection
 * library — adding one is a deliberate decision about a dependency, not
 * something to improvise inside an import path.
 */
export function readPrj(wktRaw: string): PrjResult {
  // ESRI writes .prj files with a UTF-8 byte-order mark often enough that a
  // leading U+FEFF would otherwise push every keyword out of reach of the
  // anchored reads below.
  const wkt = wktRaw.replace(/\uFEFF/g, "").trim();

  if (!wkt) {
    return refuse(
      "srs_undetermined",
      "This shapefile's .prj file is empty, so its coordinate system cannot be established. OpenPlan will not " +
        "guess a projection. Re-export the layer from your GIS, or supply it as GeoJSON."
    );
  }

  const projectedName = wktNameAfter(wkt, "PROJCS") ?? wktNameAfter(wkt, "PROJCRS");
  if (projectedName) {
    const authority = wktAuthority(wkt);
    const identifier = authority ? ` (${authority.authority}:${authority.code})` : "";
    return refuse(
      "srs_unsupported",
      `This shapefile is in a projected coordinate system: ${projectedName}${identifier}. OpenPlan reads ` +
        `longitude/latitude data and does not reproject, so it will not place this layer rather than place it ` +
        `wrongly. In your GIS, re-export the layer with the coordinate system set to WGS 84 (EPSG:4326) — in ` +
        `ArcGIS that is "Project", in QGIS it is "Export → Save Features As…" with a different CRS.`
    );
  }

  const geographicName = wktNameAfter(wkt, "GEOGCS") ?? wktNameAfter(wkt, "GEOGCRS") ?? wktNameAfter(wkt, "GEODCRS");
  if (!geographicName) {
    return refuse(
      "srs_undetermined",
      "This shapefile's .prj file does not describe a coordinate system OpenPlan recognises, so the layer cannot " +
        "be placed. Re-export the layer as WGS 84 (EPSG:4326), or supply it as GeoJSON."
    );
  }

  // A geographic CRS whose angular unit is not degrees (gradians, or a WKT that
  // states no unit at all) cannot be read as lon/lat without a conversion this
  // importer will not improvise.
  const unit = wktNameAfter(wkt, "UNIT") ?? wktNameAfter(wkt, "ANGLEUNIT");
  if (unit && !/^deg/i.test(unit.trim())) {
    return refuse(
      "srs_unsupported",
      `This shapefile's coordinate system (${geographicName}) is expressed in ${unit} rather than degrees, which ` +
        "OpenPlan does not convert. Re-export the layer as WGS 84 (EPSG:4326)."
    );
  }

  const authority = wktAuthority(wkt);
  return {
    ok: true,
    srs: {
      authority: authority?.authority ?? null,
      code: authority?.code ?? null,
      name: geographicName,
      basis: "prj_file",
    },
  };
}

// ── .shp geometry ────────────────────────────────────────────────────────────

const SHP_FILE_CODE = 9994;
const SHP_HEADER_BYTES = 100;

/**
 * Every shape type whose record begins with the x/y layout this reader knows —
 * the 2D types and their Z and M variants, which prefix the same geometry and
 * trail their extra ordinates after the parts that are read.
 *
 * ENUMERATED RATHER THAN DERIVED BY MODULO, and that is the whole point. The
 * obvious `shapeType % 10` shortcut classifies 31 — MultiPatch, the 3D surface
 * ArcGIS writes for buildings and TINs — as a Point, because 31 % 10 is 1. A
 * MultiPatch record does not begin with a point: it begins with its bounding
 * box, so the eight bytes a Point reader takes for a coordinate are the box's
 * Xmin/Ymin. The result is not a dropped feature but a WRONG one — a whole
 * building surface collapsed to a dot in the south-west corner of its own
 * extent, drawn convincingly on a map a resident is being asked to comment on.
 *
 * A shape type that is absent from this set is refused and DISCLOSED rather
 * than guessed at, which is the same trade this importer makes about
 * projections: a stated omission beats a plausible wrong answer, because only
 * one of the two gets believed.
 */
const READABLE_SHAPE_TYPES = new Set([
  1, 11, 21, // Point, PointZ, PointM
  3, 13, 23, // PolyLine, PolyLineZ, PolyLineM
  5, 15, 25, // Polygon, PolygonZ, PolygonM
  8, 18, 28, // MultiPoint, MultiPointZ, MultiPointM
]);

/** The shapefile null shape: a legal record that carries no geometry at all. */
const SHP_NULL_SHAPE_TYPE = 0;

/**
 * What one .shp record yielded.
 *
 * `undrawable` is separate from `absent` because the two owe the operator
 * different things. A null shape is a feature the surveyor deliberately left
 * without geometry — the same statement a GeoJSON Feature with a null geometry
 * makes, and neither is a failure worth reporting. An undrawable record is real
 * geometry this reader will not place, and every one of those has to reach the
 * caller's disclosure or the map quietly ends where they were.
 */
type ShpRecord =
  | { kind: "geometry"; geometry: GeoJSON.Geometry }
  | { kind: "absent" }
  | { kind: "undrawable" };

const SHP_ABSENT: ShpRecord = { kind: "absent" };
const SHP_UNDRAWABLE: ShpRecord = { kind: "undrawable" };

type ShpResult =
  | { ok: true; candidates: Candidate[]; undrawableCount: number }
  | SpatialFileImportRefusal;

/**
 * Ring orientation, by the shoelace sum the shapefile specification uses.
 *
 * Positive means clockwise with x to the right and y up, which the
 * specification defines as an OUTER ring; negative is a hole. This is the only
 * way to tell them apart — a shapefile polygon record is a flat list of rings
 * with no nesting information at all.
 */
function ringIsOuter(ring: number[][]): boolean {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum >= 0;
}

function readShpGeometry(bytes: Uint8Array): ShpResult {
  if (bytes.byteLength < SHP_HEADER_BYTES) {
    return refuse("unreadable", "The .shp file in this archive is too short to be a shapefile.");
  }

  const view = viewOf(bytes);
  if (view.getInt32(0, false) !== SHP_FILE_CODE) {
    return refuse("unreadable", "The .shp file in this archive does not carry a shapefile header.");
  }

  // The header length is in 16-bit words, and it counts the header itself.
  const declaredLength = view.getInt32(24, false) * 2;
  const end = Math.min(declaredLength > 0 ? declaredLength : bytes.byteLength, bytes.byteLength);

  const candidates: Candidate[] = [];
  let undrawableCount = 0;
  let cursor = SHP_HEADER_BYTES;

  while (cursor + 8 <= end) {
    const contentLength = view.getInt32(cursor + 4, false) * 2;
    const contentStart = cursor + 8;
    if (contentLength <= 0 || contentStart + contentLength > end) break;

    const record = readShpRecord(view, contentStart, contentLength);
    if (record.kind === "geometry") {
      candidates.push({ geometry: record.geometry, properties: {} });
    } else if (record.kind === "undrawable") {
      undrawableCount += 1;
    }

    cursor = contentStart + contentLength;
  }

  if (candidates.length === 0) {
    // Naming MultiPatch matters here. An operator whose whole export is 3D
    // surfaces needs to know WHICH thing OpenPlan will not draw; without it the
    // only conclusion available to them is that their file is broken.
    return refuse(
      "no_drawable_features",
      undrawableCount > 0
        ? `The .shp file in this archive holds ${undrawableCount.toLocaleString()} ` +
          `${undrawableCount === 1 ? "record" : "records"} of a shape type OpenPlan does not draw — usually ` +
          `MultiPatch, the 3D surface type ArcGIS writes for buildings and TINs — and no point, line, or area ` +
          `records at all. OpenPlan will not flatten a 3D surface onto a guess. Re-export the layer as points, ` +
          `lines, or polygons and upload it again.`
        : "The .shp file in this archive contains no point, line, or area records that OpenPlan could read."
    );
  }

  return { ok: true, candidates, undrawableCount };
}

function readShpRecord(view: DataView, start: number, length: number): ShpRecord {
  const shapeType = view.getInt32(start, true);
  const readPoint = (offset: number): number[] => [view.getFloat64(offset, true), view.getFloat64(offset + 8, true)];
  const drawn = (geometry: GeoJSON.Geometry): ShpRecord => ({ kind: "geometry", geometry });

  if (shapeType === SHP_NULL_SHAPE_TYPE) return SHP_ABSENT;

  // THE WHITELIST COMES FIRST, BEFORE ANY MODULO. See READABLE_SHAPE_TYPES: a
  // MultiPatch is type 31, and 31 % 10 is 1, so deriving the base type before
  // this check is what turns a 3D surface into a point at the corner of its own
  // bounding box. Anything not on the list is refused and counted, never
  // approximated.
  if (!READABLE_SHAPE_TYPES.has(shapeType)) return SHP_UNDRAWABLE;

  // Z and M variants prefix the same x/y layout, so the base type is all this
  // reader needs; the extra ordinates trail the parts it reads and are ignored.
  const baseType = shapeType % 10;

  if (baseType === 1) {
    if (length < 20) return SHP_UNDRAWABLE;
    return drawn({ type: "Point", coordinates: readPoint(start + 4) });
  }

  if (baseType === 8) {
    if (length < 44) return SHP_UNDRAWABLE;
    const numPoints = view.getInt32(start + 36, true);
    const pointsAt = start + 40;
    if (numPoints <= 0 || pointsAt + numPoints * 16 > start + length) return SHP_UNDRAWABLE;
    const coordinates: number[][] = [];
    for (let index = 0; index < numPoints; index += 1) coordinates.push(readPoint(pointsAt + index * 16));
    return drawn({ type: "MultiPoint", coordinates });
  }

  if (length < 44) return SHP_UNDRAWABLE;
  const numParts = view.getInt32(start + 36, true);
  const numPoints = view.getInt32(start + 40, true);
  const partsAt = start + 44;
  const pointsAt = partsAt + numParts * 4;
  if (numParts <= 0 || numPoints <= 0 || pointsAt + numPoints * 16 > start + length) return SHP_UNDRAWABLE;

  const parts: number[][][] = [];
  for (let part = 0; part < numParts; part += 1) {
    const from = view.getInt32(partsAt + part * 4, true);
    const to = part + 1 < numParts ? view.getInt32(partsAt + (part + 1) * 4, true) : numPoints;
    if (from < 0 || to > numPoints || to <= from) continue;
    const ring: number[][] = [];
    for (let index = from; index < to; index += 1) ring.push(readPoint(pointsAt + index * 16));
    parts.push(ring);
  }

  if (parts.length === 0) return SHP_UNDRAWABLE;

  if (baseType === 3) {
    const usable = parts.filter((part) => part.length >= 2);
    if (usable.length === 0) return SHP_UNDRAWABLE;
    return drawn(
      usable.length === 1
        ? { type: "LineString", coordinates: usable[0] }
        : { type: "MultiLineString", coordinates: usable }
    );
  }

  // Polygons: rings arrive flat, outer first, each hole following the ring it
  // belongs to. Reversed on the way out because the shapefile winding (outer
  // clockwise) is the opposite of the RFC 7946 right-hand rule.
  const polygons: number[][][][] = [];
  for (const ring of parts) {
    if (ring.length < 4) continue;
    const reversed = [...ring].reverse();
    if (ringIsOuter(ring) || polygons.length === 0) {
      polygons.push([reversed]);
    } else {
      polygons[polygons.length - 1].push(reversed);
    }
  }

  if (polygons.length === 0) return SHP_UNDRAWABLE;
  return drawn(
    polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons }
  );
}
