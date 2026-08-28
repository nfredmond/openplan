import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { isCorridorLineGeoJson, type CorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";
import type { ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import { buildEvidenceDescriptor, type EvidenceDescriptorV1 } from "@/lib/evidence/evidence-descriptor";
import type { ProjectPlaceRow } from "@/lib/projects/project-place";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

const GPKG_APPLICATION_ID = 0x47504b47;
const GPKG_USER_VERSION = 10400;
const WGS84_SRS_ID = 4326;

type Position = readonly [number, number];
type PolygonCoordinates = Position[][];
type AreaGeometry =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: PolygonCoordinates[] };

export type ProjectGeoPackageProject = ProjectPlaceRow & {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
};

type ProjectGeoPackageSummary = {
  projectAreaCount: number;
  projectLocationCount: number;
  corridorCount: number;
  omittedCorridorCount: number;
  coverageLimits: string[];
};

export type ProjectGeoPackage = {
  bytes: Buffer;
  summary: ProjectGeoPackageSummary;
};

export type OpenPlanLayerStatus = {
  layerKey: string;
  status: "included" | "unavailable" | "reference_only" | "not_selected";
  recordCount: number | null;
  evidenceId: string | null;
  evidenceDescriptor?: EvidenceDescriptorV1;
  detail: string;
};

export type ProjectGeoPackageCrash = {
  id: string;
  longitude: number;
  latitude: number;
  severity: string;
  sourceId: string;
  collisionDate: string | null;
};

export type ProjectGeoPackageEngagementGeometry = {
  id: string;
  geometry: unknown;
  longitude: number | null;
  latitude: number | null;
  sourceType: string;
  createdAt: string;
};

export type ProjectGeoPackageFeatureAttribute = string | number | boolean | null;

export type ProjectGeoPackageModelLinkFeature = {
  id: string;
  geometry: unknown;
  attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>>;
};

export type ProjectGeoPackageLandUseFeature = {
  id: string;
  geometry: unknown;
  attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>>;
};

/**
 * Supplying this object means the caller examined the named source. Omitting
 * it means OpenPlan did not examine that source for this export. The builder
 * derives availability from the exact features it can write, never from a
 * caller-provided count.
 */
export type ProjectGeoPackageSuppliedFeatureLayer<TFeature> = {
  features: readonly TFeature[];
  evidenceId?: string | null;
  evidenceDescriptor?: EvidenceDescriptorV1;
  detail: string;
};

export type ProjectGeoPackageModelLayers = {
  aequilibrae?: ProjectGeoPackageSuppliedFeatureLayer<ProjectGeoPackageModelLinkFeature>;
  activitysim?: ProjectGeoPackageSuppliedFeatureLayer<ProjectGeoPackageModelLinkFeature>;
};

type ParsedFeatureGeometry = {
  wkb: Buffer;
  positions: Position[];
};

type PreparedSuppliedFeature<TFeature extends { id: string; attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>> }> = {
  feature: TFeature;
  geometry: ParsedFeatureGeometry;
};

type PreparedSuppliedLayer<TFeature extends { id: string; attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>> }> = {
  supplied: ProjectGeoPackageSuppliedFeatureLayer<TFeature> | undefined;
  features: PreparedSuppliedFeature<TFeature>[];
  omittedCount: number;
};

function isPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [longitude, latitude] = value;
  return (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function isClosedRing(value: unknown): value is Position[] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition)) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isPolygonCoordinates(value: unknown): value is PolygonCoordinates {
  return Array.isArray(value) && value.length > 0 && value.every(isClosedRing);
}

function geometryValue(value: unknown): { type?: unknown; coordinates?: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; coordinates?: unknown; geometry?: unknown };
  if (candidate.type === "Feature") return geometryValue(candidate.geometry);
  return candidate;
}

function hasExactAttributes(
  value: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((attribute) =>
    attribute === null ||
    typeof attribute === "string" ||
    typeof attribute === "boolean" ||
    (typeof attribute === "number" && Number.isFinite(attribute))
  );
}

/**
 * Accept only a complete WGS84 polygon carried by the project record.
 *
 * An invalid ring is not repaired here: closing or clipping it would turn an
 * export into a new geography decision. The manifest instead reports that the
 * stored area could not be represented.
 */
function parseAreaGeometry(value: unknown): AreaGeometry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; coordinates?: unknown; geometry?: unknown };
  if (candidate.type === "Feature") return parseAreaGeometry(candidate.geometry);
  if (candidate.type === "Polygon" && isPolygonCoordinates(candidate.coordinates)) {
    return { type: "Polygon", coordinates: candidate.coordinates };
  }
  if (
    candidate.type === "MultiPolygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(isPolygonCoordinates)
  ) {
    return { type: "MultiPolygon", coordinates: candidate.coordinates };
  }
  return null;
}

function wkbHeader(type: number, byteLength: number): Buffer {
  const buffer = Buffer.alloc(byteLength);
  buffer.writeUInt8(1, 0);
  buffer.writeUInt32LE(type, 1);
  return buffer;
}

function pointWkb(position: Position): Buffer {
  const buffer = wkbHeader(1, 21);
  buffer.writeDoubleLE(position[0], 5);
  buffer.writeDoubleLE(position[1], 13);
  return buffer;
}

function lineStringWkb(coordinates: readonly Position[]): Buffer {
  const buffer = wkbHeader(2, 9 + coordinates.length * 16);
  buffer.writeUInt32LE(coordinates.length, 5);
  coordinates.forEach(([longitude, latitude], index) => {
    const offset = 9 + index * 16;
    buffer.writeDoubleLE(longitude, offset);
    buffer.writeDoubleLE(latitude, offset + 8);
  });
  return buffer;
}

function polygonWkb(rings: PolygonCoordinates): Buffer {
  const size = 9 + rings.reduce((total, ring) => total + 4 + ring.length * 16, 0);
  const buffer = wkbHeader(3, size);
  buffer.writeUInt32LE(rings.length, 5);
  let offset = 9;
  for (const ring of rings) {
    buffer.writeUInt32LE(ring.length, offset);
    offset += 4;
    for (const [longitude, latitude] of ring) {
      buffer.writeDoubleLE(longitude, offset);
      buffer.writeDoubleLE(latitude, offset + 8);
      offset += 16;
    }
  }
  return buffer;
}

function multiPolygonWkb(polygons: PolygonCoordinates[]): Buffer {
  const children = polygons.map(polygonWkb);
  const buffer = wkbHeader(6, 9 + children.reduce((total, child) => total + child.length, 0));
  buffer.writeUInt32LE(children.length, 5);
  let offset = 9;
  for (const child of children) {
    child.copy(buffer, offset);
    offset += child.length;
  }
  return buffer;
}

function parseModelLinkGeometry(value: unknown): ParsedFeatureGeometry | null {
  const geometry = geometryValue(value);
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2 ||
    !geometry.coordinates.every(isPosition)
  ) {
    return null;
  }
  return {
    wkb: lineStringWkb(geometry.coordinates),
    positions: [...geometry.coordinates],
  };
}

function parseLandUseGeometry(value: unknown): ParsedFeatureGeometry | null {
  const geometry = geometryValue(value);
  if (geometry?.type === "Point" && isPosition(geometry.coordinates)) {
    return { wkb: pointWkb(geometry.coordinates), positions: [geometry.coordinates] };
  }
  if (
    geometry?.type === "LineString" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(isPosition)
  ) {
    return {
      wkb: lineStringWkb(geometry.coordinates),
      positions: [...geometry.coordinates],
    };
  }
  if (geometry?.type === "Polygon" && isPolygonCoordinates(geometry.coordinates)) {
    return {
      wkb: polygonWkb(geometry.coordinates),
      positions: geometry.coordinates.flatMap((ring) => ring),
    };
  }
  if (
    geometry?.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length > 0 &&
    geometry.coordinates.every(isPolygonCoordinates)
  ) {
    return {
      wkb: multiPolygonWkb(geometry.coordinates),
      positions: geometry.coordinates.flatMap((polygon) => polygon.flatMap((ring) => ring)),
    };
  }
  return null;
}

function prepareSuppliedLayer<
  TFeature extends {
    id: string;
    geometry: unknown;
    attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>>;
  },
>(
  supplied: ProjectGeoPackageSuppliedFeatureLayer<TFeature> | undefined,
  parseGeometry: (value: unknown) => ParsedFeatureGeometry | null,
): PreparedSuppliedLayer<TFeature> {
  if (!supplied) return { supplied: undefined, features: [], omittedCount: 0 };
  const features = supplied.features.flatMap((feature) => {
    const geometry = parseGeometry(feature.geometry);
    if (!feature.id.trim() || !hasExactAttributes(feature.attributes) || !geometry) return [];
    return [{ feature, geometry }];
  });
  return {
    supplied,
    features,
    omittedCount: supplied.features.length - features.length,
  };
}

function geoPackageGeometry(wkb: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write("GP", 0, "ascii");
  header.writeUInt8(0, 2);
  // Little endian, standard (not extended), and no envelope.
  header.writeUInt8(1, 3);
  header.writeInt32LE(WGS84_SRS_ID, 4);
  return Buffer.concat([header, wkb]);
}

function boundsOfPositions(positions: readonly Position[]) {
  return positions.reduce(
    (bounds, [longitude, latitude]) => ({
      minX: Math.min(bounds.minX, longitude),
      minY: Math.min(bounds.minY, latitude),
      maxX: Math.max(bounds.maxX, longitude),
      maxY: Math.max(bounds.maxY, latitude),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function areaPositions(area: AreaGeometry): Position[] {
  const polygons = area.type === "Polygon" ? [area.coordinates] : area.coordinates;
  return polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));
}

function mergeBounds(
  bounds: ReturnType<typeof boundsOfPositions>[],
): ReturnType<typeof boundsOfPositions> | null {
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

function createCoreTables(db: Database.Database) {
  db.exec(`
    PRAGMA application_id = ${GPKG_APPLICATION_ID};
    PRAGMA user_version = ${GPKG_USER_VERSION};
    PRAGMA foreign_keys = ON;

    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x DOUBLE,
      min_y DOUBLE,
      max_x DOUBLE,
      max_y DOUBLE,
      srs_id INTEGER,
      CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );

    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
      CONSTRAINT uk_gc_table_name UNIQUE (table_name),
      CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
      CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );
  `);

  const insertSrs = db.prepare(`
    INSERT INTO gpkg_spatial_ref_sys
      (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertSrs.run("Undefined Cartesian SRS", -1, "NONE", -1, "undefined", "undefined Cartesian coordinate reference system");
  insertSrs.run("Undefined geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic coordinate reference system");
  insertSrs.run(
    "WGS 84 geodetic",
    WGS84_SRS_ID,
    "EPSG",
    WGS84_SRS_ID,
    'GEOGCS["WGS 84",DATUM["World Geodetic System 1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
    "longitude/latitude coordinates on the WGS 84 datum"
  );
}

function registerContents(
  db: Database.Database,
  options: {
    table: string;
    dataType: "features" | "attributes";
    identifier: string;
    description: string;
    generatedAt: string;
    bounds?: ReturnType<typeof boundsOfPositions> | null;
  }
) {
  const bounds = options.bounds ?? null;
  db.prepare(`
    INSERT INTO gpkg_contents
      (table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.table,
    options.dataType,
    options.identifier,
    options.description,
    options.generatedAt,
    bounds?.minX ?? null,
    bounds?.minY ?? null,
    bounds?.maxX ?? null,
    bounds?.maxY ?? null,
    options.dataType === "features" ? WGS84_SRS_ID : null
  );
}

function registerGeometry(db: Database.Database, table: string, geometryType: string) {
  db.prepare(`
    INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id, z, m)
    VALUES (?, 'geom', ?, ?, 0, 0)
  `).run(table, geometryType, WGS84_SRS_ID);
}

function coverageLabel(present: boolean, recorded: boolean, noun: string): string {
  if (present) return `${noun} included`;
  return recorded ? `${noun} recorded but invalid; omitted` : `${noun} not recorded`;
}

function sourceDetailPrefix(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? `${trimmed} ` : `${trimmed}. `;
}

function suppliedLayerStatus<
  TFeature extends { id: string; attributes: Readonly<Record<string, ProjectGeoPackageFeatureAttribute>> },
>(options: {
  layerKey: string;
  featureNoun: string;
  layer: PreparedSuppliedLayer<TFeature>;
}): OpenPlanLayerStatus {
  const { layer } = options;
  if (!layer.supplied) {
    return {
      layerKey: options.layerKey,
      status: "unavailable",
      recordCount: null,
      evidenceId: null,
      detail: `No ${options.featureNoun} source was examined for this export.`,
    };
  }

  const prefix = sourceDetailPrefix(layer.supplied.detail);
  const omitted = layer.omittedCount > 0
    ? ` ${layer.omittedCount} supplied feature${layer.omittedCount === 1 ? " was" : "s were"} malformed or used an unsupported geometry and ${layer.omittedCount === 1 ? "was" : "were"} omitted.`
    : "";
  if (layer.features.length === 0) {
    return {
      layerKey: options.layerKey,
      status: "unavailable",
      recordCount: null,
      evidenceId: layer.supplied.evidenceId ?? null,
      evidenceDescriptor: layer.supplied.evidenceDescriptor,
      detail: `${prefix}The source was examined, but no exact qualifying ${options.featureNoun} geometry was supplied.${omitted}`,
    };
  }
  return {
    layerKey: options.layerKey,
    status: "included",
    recordCount: layer.features.length,
    evidenceId: layer.supplied.evidenceId ?? null,
    evidenceDescriptor: layer.supplied.evidenceDescriptor,
    detail: `${prefix}${layer.features.length} exact ${options.featureNoun} feature${layer.features.length === 1 ? "" : "s"} included.${omitted}`,
  };
}

function normalizeLayerStatus(layer: OpenPlanLayerStatus): OpenPlanLayerStatus {
  if (layer.status === "unavailable") return { ...layer, recordCount: null };
  if (layer.status === "reference_only" || layer.status === "not_selected") {
    return { ...layer, recordCount: null };
  }
  if (!Number.isInteger(layer.recordCount) || (layer.recordCount ?? 0) <= 0) {
    return {
      ...layer,
      status: "unavailable",
      recordCount: null,
      detail: `${layer.detail} The layer had no positive written-feature count, so OpenPlan treated it as unavailable.`,
    };
  }
  return layer;
}

/**
 * Build a standards-readable GeoPackage without a tile service or remote API.
 *
 * The package is a handoff, not a new source of truth. It carries the project's
 * stored geometry and only exact supplied evidence geometry. The layer-status
 * table makes unexamined, absent, and invalid geometry visible to the recipient.
 */
export function buildProjectGeoPackage(input: {
  project: ProjectGeoPackageProject;
  corridors: ProjectCorridorRow[];
  generatedAt?: Date;
  layerStatuses?: OpenPlanLayerStatus[];
  crashes?: ProjectGeoPackageCrash[];
  engagementGeometries?: ProjectGeoPackageEngagementGeometry[];
  modelLayers?: ProjectGeoPackageModelLayers;
  landUseDesignations?: ProjectGeoPackageSuppliedFeatureLayer<ProjectGeoPackageLandUseFeature>;
}): ProjectGeoPackage {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const area = parseAreaGeometry(input.project.place_geometry_geojson);
  const hasRecordedArea = input.project.place_geometry_geojson != null;
  const location: Position | null =
    isPosition([input.project.longitude, input.project.latitude])
      ? [input.project.longitude as number, input.project.latitude as number]
      : null;
  const hasRecordedLocation = input.project.longitude != null || input.project.latitude != null;
  const validCorridors = input.corridors.filter(
    (corridor): corridor is ProjectCorridorRow & { geometry_geojson: CorridorLineGeoJson } =>
      isCorridorLineGeoJson(corridor.geometry_geojson)
  );
  const omittedCorridorCount = input.corridors.length - validCorridors.length;
  const crashes = (input.crashes ?? []).filter((crash) => isPosition([crash.longitude, crash.latitude]));
  const aequilibraeLinks = prepareSuppliedLayer(
    input.modelLayers?.aequilibrae,
    parseModelLinkGeometry,
  );
  const activitysimLinks = prepareSuppliedLayer(
    input.modelLayers?.activitysim,
    parseModelLinkGeometry,
  );
  const landUseDesignations = prepareSuppliedLayer(
    input.landUseDesignations,
    parseLandUseGeometry,
  );
  const engagementGeometries = (input.engagementGeometries ?? []).flatMap((item) => {
    const geometry = item.geometry && typeof item.geometry === "object"
      ? item.geometry as { type?: unknown; coordinates?: unknown }
      : null;
    if (geometry?.type === "Point" && isPosition(geometry.coordinates)) {
      return [{ item, wkb: pointWkb(geometry.coordinates) }];
    }
    if (geometry?.type === "LineString" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(isPosition)) {
      return [{ item, wkb: lineStringWkb(geometry.coordinates) }];
    }
    if (geometry?.type === "Polygon" && isPolygonCoordinates(geometry.coordinates)) {
      return [{ item, wkb: polygonWkb(geometry.coordinates) }];
    }
    if (isPosition([item.longitude, item.latitude])) {
      return [{ item, wkb: pointWkb([item.longitude as number, item.latitude as number]) }];
    }
    return [];
  });
  const coverageLimits = [
    "Stored project geometry and exact supplied crash/KSI, model-link, land-use, and approved engagement geometry are included when available; every expected layer is disclosed in openplan_layer_status",
    ...(area ? [] : [coverageLabel(false, hasRecordedArea, "Project area")]),
    ...(location ? [] : [coverageLabel(false, hasRecordedLocation, "Project location")]),
    ...(omittedCorridorCount > 0
      ? [`${omittedCorridorCount} corridor${omittedCorridorCount === 1 ? " was" : "s were"} recorded but invalid; omitted`]
      : []),
    ...(aequilibraeLinks.omittedCount > 0
      ? [`${aequilibraeLinks.omittedCount} supplied AequilibraE link feature${aequilibraeLinks.omittedCount === 1 ? " was" : "s were"} malformed or unsupported; omitted`]
      : []),
    ...(activitysimLinks.omittedCount > 0
      ? [`${activitysimLinks.omittedCount} supplied ActivitySim link feature${activitysimLinks.omittedCount === 1 ? " was" : "s were"} malformed or unsupported; omitted`]
      : []),
    ...(landUseDesignations.omittedCount > 0
      ? [`${landUseDesignations.omittedCount} supplied land-use designation feature${landUseDesignations.omittedCount === 1 ? " was" : "s were"} malformed or unsupported; omitted`]
      : []),
  ];

  const db = new Database(":memory:");
  try {
    db.transaction(() => {
      createCoreTables(db);
      db.exec(`
        CREATE TABLE project_info (
          fid INTEGER PRIMARY KEY,
          project_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          project_name TEXT NOT NULL,
          project_summary TEXT,
          project_status TEXT NOT NULL,
          plan_type TEXT NOT NULL,
          delivery_phase TEXT NOT NULL,
          project_created_at DATETIME NOT NULL,
          project_updated_at DATETIME NOT NULL,
          crs TEXT NOT NULL,
          generated_at DATETIME NOT NULL,
          project_area_coverage TEXT NOT NULL,
          project_location_coverage TEXT NOT NULL,
          corridor_count INTEGER NOT NULL,
          omitted_corridor_count INTEGER NOT NULL,
          coverage_limits TEXT NOT NULL
        );

        CREATE TABLE project_area (
          fid INTEGER PRIMARY KEY,
          geom GEOMETRY,
          project_id TEXT NOT NULL,
          project_name TEXT NOT NULL,
          project_status TEXT NOT NULL,
          place_label TEXT,
          place_source TEXT,
          place_kind TEXT,
          place_ref TEXT,
          country_code TEXT,
          subdivision_code TEXT,
          place_set_at DATETIME
        );

        CREATE TABLE project_location (
          fid INTEGER PRIMARY KEY,
          geom POINT,
          project_id TEXT NOT NULL,
          project_name TEXT NOT NULL,
          project_status TEXT NOT NULL,
          updated_at DATETIME NOT NULL
        );

        CREATE TABLE project_corridors (
          fid INTEGER PRIMARY KEY,
          geom LINESTRING,
          corridor_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          corridor_name TEXT NOT NULL,
          corridor_type TEXT NOT NULL,
          los_grade TEXT,
          updated_at DATETIME NOT NULL
        );

        CREATE TABLE openplan_layer_status (
          fid INTEGER PRIMARY KEY,
          layer_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('included', 'unavailable', 'reference_only', 'not_selected')),
          record_count INTEGER,
          stable_evidence_id TEXT,
          evidence_schema_version TEXT NOT NULL,
          source_kind TEXT,
          source_label TEXT NOT NULL,
          source_citation TEXT,
          as_of_date TEXT,
          retrieved_at TEXT,
          evidence_status TEXT NOT NULL,
          claim_tier TEXT,
          uncertainty_json TEXT NOT NULL,
          limits_json TEXT NOT NULL,
          revision_token TEXT,
          checksum_sha256 TEXT,
          support_status TEXT NOT NULL,
          support_reason TEXT,
          detail TEXT NOT NULL,
          generated_at DATETIME NOT NULL
        );

        CREATE TABLE safety_crash_ksi (
          fid INTEGER PRIMARY KEY,
          geom POINT,
          crash_id TEXT NOT NULL,
          severity TEXT NOT NULL,
          source_id TEXT NOT NULL,
          collision_date TEXT,
          evidence_status TEXT NOT NULL DEFAULT 'observed'
        );

        CREATE TABLE engagement_geometry (
          fid INTEGER PRIMARY KEY,
          geom GEOMETRY,
          engagement_item_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          created_at DATETIME NOT NULL,
          moderation_status TEXT NOT NULL DEFAULT 'approved'
        );

        CREATE TABLE aequilibrae_links (
          fid INTEGER PRIMARY KEY,
          geom LINESTRING,
          feature_id TEXT NOT NULL,
          attributes_json TEXT NOT NULL
        );

        CREATE TABLE activitysim_links (
          fid INTEGER PRIMARY KEY,
          geom LINESTRING,
          feature_id TEXT NOT NULL,
          attributes_json TEXT NOT NULL
        );

        CREATE TABLE land_use_designations (
          fid INTEGER PRIMARY KEY,
          geom GEOMETRY,
          feature_id TEXT NOT NULL,
          attributes_json TEXT NOT NULL
        );
      `);

      const areaBounds = area ? boundsOfPositions(areaPositions(area)) : null;
      const locationBounds = location ? boundsOfPositions([location]) : null;
      const corridorBounds = mergeBounds(
        validCorridors.map((corridor) => boundsOfPositions(corridor.geometry_geojson.coordinates))
      );
      const aequilibraeBounds = mergeBounds(
        aequilibraeLinks.features.map((feature) => boundsOfPositions(feature.geometry.positions))
      );
      const activitysimBounds = mergeBounds(
        activitysimLinks.features.map((feature) => boundsOfPositions(feature.geometry.positions))
      );
      const landUseBounds = mergeBounds(
        landUseDesignations.features.map((feature) => boundsOfPositions(feature.geometry.positions))
      );

      registerContents(db, {
        table: "project_info",
        dataType: "attributes",
        identifier: "OpenPlan project export manifest",
        description: "Contents, coordinate reference system, and explicit geometry coverage limits",
        generatedAt,
      });
      registerContents(db, {
        table: "safety_crash_ksi",
        dataType: "features",
        identifier: "Observed project crash and KSI points",
        description: "Approved project-scoped observed collision points; empty is disclosed in openplan_layer_status",
        generatedAt,
        bounds: crashes.length ? boundsOfPositions(crashes.map((crash) => [crash.longitude, crash.latitude])) : null,
      });
      registerContents(db, {
        table: "engagement_geometry",
        dataType: "features",
        identifier: "Publishable approved engagement geometry",
        description: "Geometry only. Comment text, submitter identity, moderation notes, and private records are excluded.",
        generatedAt,
      });
      registerContents(db, {
        table: "aequilibrae_links",
        dataType: "features",
        identifier: "Supplied AequilibraE link results",
        description: "Exact supplied AequilibraE link geometries and attributes; never combined with ActivitySim",
        generatedAt,
        bounds: aequilibraeBounds,
      });
      registerContents(db, {
        table: "activitysim_links",
        dataType: "features",
        identifier: "Supplied ActivitySim link results",
        description: "Exact supplied ActivitySim link geometries and attributes; never combined with AequilibraE",
        generatedAt,
        bounds: activitysimBounds,
      });
      registerContents(db, {
        table: "land_use_designations",
        dataType: "features",
        identifier: "Supplied land-use designations",
        description: "Exact supplied land-use designation geometries and attributes",
        generatedAt,
        bounds: landUseBounds,
      });
      registerContents(db, {
        table: "openplan_layer_status",
        dataType: "attributes",
        identifier: "OpenPlan layer availability and selection status",
        description: "Explicitly distinguishes included, unavailable, reference-only, and not-selected evidence so absence never reads as zero",
        generatedAt,
      });
      registerContents(db, {
        table: "project_area",
        dataType: "features",
        identifier: "Project study area",
        description: "Stored project place-of-record boundary; empty when unavailable",
        generatedAt,
        bounds: areaBounds,
      });
      registerContents(db, {
        table: "project_location",
        dataType: "features",
        identifier: "Project location",
        description: "Stored project site marker; empty when unavailable",
        generatedAt,
        bounds: locationBounds,
      });
      registerContents(db, {
        table: "project_corridors",
        dataType: "features",
        identifier: "Project corridors",
        description: "Stored project cartographic corridors; invalid shapes are disclosed in project_info",
        generatedAt,
        bounds: corridorBounds,
      });
      registerGeometry(db, "project_area", "GEOMETRY");
      registerGeometry(db, "project_location", "POINT");
      registerGeometry(db, "project_corridors", "LINESTRING");
      registerGeometry(db, "safety_crash_ksi", "POINT");
      registerGeometry(db, "engagement_geometry", "GEOMETRY");
      registerGeometry(db, "aequilibrae_links", "LINESTRING");
      registerGeometry(db, "activitysim_links", "LINESTRING");
      registerGeometry(db, "land_use_designations", "GEOMETRY");

      db.prepare(`
        INSERT INTO project_info
          (project_id, workspace_id, project_name, project_summary, project_status, plan_type,
           delivery_phase, project_created_at, project_updated_at, crs, generated_at,
           project_area_coverage, project_location_coverage, corridor_count,
           omitted_corridor_count, coverage_limits)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.project.id,
        input.project.workspace_id,
        input.project.name,
        input.project.summary,
        input.project.status,
        input.project.plan_type,
        input.project.delivery_phase,
        input.project.created_at,
        input.project.updated_at,
        "EPSG:4326 (WGS 84 longitude/latitude)",
        generatedAt,
        coverageLabel(Boolean(area), hasRecordedArea, "Project area"),
        coverageLabel(Boolean(location), hasRecordedLocation, "Project location"),
        validCorridors.length,
        omittedCorridorCount,
        coverageLimits.join("; ")
      );

      if (area) {
        const areaWkb = area.type === "Polygon" ? polygonWkb(area.coordinates) : multiPolygonWkb(area.coordinates);
        db.prepare(`
          INSERT INTO project_area
            (geom, project_id, project_name, project_status, place_label, place_source, place_kind,
             place_ref, country_code, subdivision_code, place_set_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          geoPackageGeometry(areaWkb),
          input.project.id,
          input.project.name,
          input.project.status,
          input.project.place_label,
          input.project.place_source,
          input.project.place_kind,
          input.project.place_ref,
          input.project.place_country_code,
          input.project.place_subdivision_code,
          input.project.place_set_at
        );
      }

      if (location) {
        db.prepare(`
          INSERT INTO project_location
            (geom, project_id, project_name, project_status, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          geoPackageGeometry(pointWkb(location)),
          input.project.id,
          input.project.name,
          input.project.status,
          input.project.updated_at
        );
      }

      const insertCorridor = db.prepare(`
        INSERT INTO project_corridors
          (geom, corridor_id, project_id, corridor_name, corridor_type, los_grade, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const corridor of validCorridors) {
        insertCorridor.run(
          geoPackageGeometry(lineStringWkb(corridor.geometry_geojson.coordinates)),
          corridor.id,
          input.project.id,
          corridor.name,
          corridor.corridor_type,
          corridor.los_grade,
          corridor.updated_at
        );
      }
      const insertCrash = db.prepare(`
        INSERT INTO safety_crash_ksi
          (geom, crash_id, severity, source_id, collision_date)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const crash of crashes) {
        insertCrash.run(
          geoPackageGeometry(pointWkb([crash.longitude, crash.latitude])),
          crash.id,
          crash.severity,
          crash.sourceId,
          crash.collisionDate,
        );
      }
      const insertEngagement = db.prepare(`
        INSERT INTO engagement_geometry
          (geom, engagement_item_id, source_type, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const feature of engagementGeometries) {
        insertEngagement.run(
          geoPackageGeometry(feature.wkb),
          feature.item.id,
          feature.item.sourceType,
          feature.item.createdAt,
        );
      }

      const insertAequilibraeLink = db.prepare(`
        INSERT INTO aequilibrae_links (geom, feature_id, attributes_json)
        VALUES (?, ?, ?)
      `);
      for (const feature of aequilibraeLinks.features) {
        insertAequilibraeLink.run(
          geoPackageGeometry(feature.geometry.wkb),
          feature.feature.id,
          canonicalizeActionPayload(feature.feature.attributes),
        );
      }

      const insertActivitysimLink = db.prepare(`
        INSERT INTO activitysim_links (geom, feature_id, attributes_json)
        VALUES (?, ?, ?)
      `);
      for (const feature of activitysimLinks.features) {
        insertActivitysimLink.run(
          geoPackageGeometry(feature.geometry.wkb),
          feature.feature.id,
          canonicalizeActionPayload(feature.feature.attributes),
        );
      }

      const insertLandUseDesignation = db.prepare(`
        INSERT INTO land_use_designations (geom, feature_id, attributes_json)
        VALUES (?, ?, ?)
      `);
      for (const feature of landUseDesignations.features) {
        insertLandUseDesignation.run(
          geoPackageGeometry(feature.geometry.wkb),
          feature.feature.id,
          canonicalizeActionPayload(feature.feature.attributes),
        );
      }

      const managedLayerStatuses: OpenPlanLayerStatus[] = [
        {
          layerKey: "project_area",
          status: area ? "included" : "unavailable",
          recordCount: area ? 1 : null,
          evidenceId: null,
          detail: coverageLabel(Boolean(area), hasRecordedArea, "Project area"),
        },
        {
          layerKey: "project_location",
          status: location ? "included" : "unavailable",
          recordCount: location ? 1 : null,
          evidenceId: null,
          detail: coverageLabel(Boolean(location), hasRecordedLocation, "Project location"),
        },
        {
          layerKey: "project_corridors",
          status: validCorridors.length > 0 ? "included" : "unavailable",
          recordCount: validCorridors.length > 0 ? validCorridors.length : null,
          evidenceId: null,
          detail: validCorridors.length > 0 ? "Stored valid project corridors included." : "No valid project corridor is stored.",
        },
        {
          layerKey: "crash_ksi",
          status: crashes.length > 0 ? "included" : "unavailable",
          recordCount: crashes.length > 0 ? crashes.length : null,
          evidenceId: null,
          detail: crashes.length > 0
            ? "Observed project-scoped crash/KSI points included."
            : input.crashes
              ? "The project crash/KSI source was examined, but no exact qualifying point was supplied."
              : "No project crash/KSI source was examined for this export.",
        },
        suppliedLayerStatus({
          layerKey: "aequilibrae_links",
          featureNoun: "AequilibraE link",
          layer: aequilibraeLinks,
        }),
        suppliedLayerStatus({
          layerKey: "activitysim_links",
          featureNoun: "ActivitySim link",
          layer: activitysimLinks,
        }),
        {
          layerKey: "engagement_geometry",
          status: engagementGeometries.length > 0 ? "included" : "unavailable",
          recordCount: engagementGeometries.length > 0 ? engagementGeometries.length : null,
          evidenceId: null,
          detail: engagementGeometries.length > 0
            ? "Approved publishable geometry included without comment text or personal identifiers."
            : input.engagementGeometries
              ? "The publishable engagement source was examined, but no exact qualifying geometry was supplied."
              : "No publishable engagement source was examined for this export.",
        },
        suppliedLayerStatus({
          layerKey: "land_use_designations",
          featureNoun: "land-use designation",
          layer: landUseDesignations,
        }),
      ];
      const statusesByLayer = new Map<string, OpenPlanLayerStatus>();
      for (const layer of input.layerStatuses ?? []) {
        statusesByLayer.set(layer.layerKey, normalizeLayerStatus(layer));
      }
      for (const layer of managedLayerStatuses) {
        statusesByLayer.set(layer.layerKey, normalizeLayerStatus(layer));
      }
      const layerStatuses = [...statusesByLayer.values()];
      const revisionMaterial: Record<string, unknown> = {
        project_area: area,
        project_location: location,
        project_corridors: validCorridors.map((corridor) => ({
          id: corridor.id,
          geometry: corridor.geometry_geojson,
          updatedAt: corridor.updated_at,
        })),
        crash_ksi: crashes,
        aequilibrae_links: aequilibraeLinks.features.map((feature) => feature.feature),
        activitysim_links: activitysimLinks.features.map((feature) => feature.feature),
        engagement_geometry: engagementGeometries.map((feature) => feature.item),
        land_use_designations: landUseDesignations.features.map((feature) => feature.feature),
      };
      const describedLayerStatuses = layerStatuses.map((layer) => {
        const modeled = layer.layerKey === "aequilibrae_links" || layer.layerKey === "activitysim_links";
        const observed = layer.layerKey === "crash_ksi" || layer.layerKey === "engagement_geometry";
        const reference = layer.layerKey === "land_use_designations";
        const revisionToken = createHash("sha256").update(canonicalizeActionPayload({
          projectId: input.project.id,
          projectRevision: input.project.updated_at,
          layerKey: layer.layerKey,
          status: layer.status,
          recordCount: layer.recordCount,
          detail: layer.detail,
          records: revisionMaterial[layer.layerKey] ?? null,
        })).digest("hex");
        const evidenceDescriptor = layer.evidenceDescriptor ?? buildEvidenceDescriptor({
          identity: { projectId: input.project.id, layerKey: layer.layerKey, revisionToken },
          source: {
            kind: modeled
              ? "model_run_artifact"
              : observed
                ? "project_observation"
                : reference
                  ? "land_use_designation"
                  : "project_record",
            label: `GeoPackage layer status: ${layer.layerKey}`,
            citation: null,
          },
          asOfDate: observed ? generatedAt : input.project.updated_at,
          retrievedAt: layer.status === "included" ? generatedAt : null,
          evidenceStatus: modeled ? "modeled" : observed ? "observed" : reference ? "reference" : "administrative",
          claimTier: layer.recordCount === null
            ? null
            : modeled
              ? "model_output_record"
              : observed
                ? "observed_screening"
                : "administrative_record",
          uncertainty: [],
          limits: [layer.detail],
          revisionToken,
          checksumSha256: null,
          numericClaim: layer.recordCount !== null,
        });
        return { ...layer, evidenceDescriptor };
      });
      const insertLayerStatus = db.prepare(`
        INSERT INTO openplan_layer_status
          (layer_key, status, record_count, stable_evidence_id, evidence_schema_version,
           source_kind, source_label, source_citation, as_of_date, retrieved_at,
           evidence_status, claim_tier, uncertainty_json, limits_json, revision_token,
           checksum_sha256, support_status, support_reason, detail, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const layer of describedLayerStatuses) {
        const evidence = layer.evidenceDescriptor;
        insertLayerStatus.run(
          layer.layerKey,
          layer.status,
          layer.recordCount,
          layer.evidenceId ?? evidence.stableEvidenceId,
          evidence.schemaVersion,
          evidence.source.kind,
          evidence.source.label,
          evidence.source.citation,
          evidence.asOfDate,
          evidence.retrievedAt,
          evidence.evidenceStatus,
          evidence.claimTier,
          JSON.stringify(evidence.uncertainty),
          JSON.stringify(evidence.limits),
          evidence.revisionToken,
          evidence.checksumSha256,
          evidence.support.status,
          evidence.support.reason,
          layer.detail,
          generatedAt,
        );
      }
    })();

    const foreignKeyProblems = db.pragma("foreign_key_check") as unknown[];
    if (foreignKeyProblems.length > 0) throw new Error("GeoPackage foreign-key validation failed");
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`GeoPackage integrity validation failed: ${String(integrity)}`);

    return {
      bytes: db.serialize(),
      summary: {
        projectAreaCount: area ? 1 : 0,
        projectLocationCount: location ? 1 : 0,
        corridorCount: validCorridors.length,
        omittedCorridorCount,
        coverageLimits,
      },
    };
  } finally {
    db.close();
  }
}

export function projectGeoPackageFilename(projectName: string, date = new Date()): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "project";
  return `openplan-${slug}-${date.toISOString().slice(0, 10)}.gpkg`;
}
