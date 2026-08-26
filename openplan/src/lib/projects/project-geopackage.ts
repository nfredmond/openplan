import Database from "better-sqlite3";
import { isCorridorLineGeoJson, type CorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";
import type { ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import type { ProjectPlaceRow } from "@/lib/projects/project-place";

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

/**
 * Build a standards-readable GeoPackage without a tile service or remote API.
 *
 * The package is a handoff, not a new source of truth: it carries only the
 * project's stored marker, area, and corridors, plus a manifest that makes
 * absent or invalid geometry visible to the recipient.
 */
export function buildProjectGeoPackage(input: {
  project: ProjectGeoPackageProject;
  corridors: ProjectCorridorRow[];
  generatedAt?: Date;
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
  const coverageLimits = [
    "Only stored project area, location, and cartographic corridors are included; linked datasets, documents, and analysis evidence are not included",
    ...(area ? [] : [coverageLabel(false, hasRecordedArea, "Project area")]),
    ...(location ? [] : [coverageLabel(false, hasRecordedLocation, "Project location")]),
    ...(omittedCorridorCount > 0
      ? [`${omittedCorridorCount} corridor${omittedCorridorCount === 1 ? " was" : "s were"} recorded but invalid; omitted`]
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
      `);

      const areaBounds = area ? boundsOfPositions(areaPositions(area)) : null;
      const locationBounds = location ? boundsOfPositions([location]) : null;
      const corridorBounds = mergeBounds(
        validCorridors.map((corridor) => boundsOfPositions(corridor.geometry_geojson.coordinates))
      );

      registerContents(db, {
        table: "project_info",
        dataType: "attributes",
        identifier: "OpenPlan project export manifest",
        description: "Contents, coordinate reference system, and explicit geometry coverage limits",
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
