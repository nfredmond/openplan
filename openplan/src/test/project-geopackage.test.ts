import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  buildProjectGeoPackage,
  projectGeoPackageFilename,
  type ProjectGeoPackageProject,
} from "@/lib/projects/project-geopackage";
import type { ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";

const PROJECT: ProjectGeoPackageProject = {
  id: "44444444-4444-4444-8444-444444444444",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  name: "Main Street & 3rd Avenue",
  summary: "Safer crossings and better transit access",
  status: "active",
  plan_type: "corridor_plan",
  delivery_phase: "planning",
  latitude: 39.9612,
  longitude: -82.9988,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-26T00:00:00.000Z",
  place_source: "census-tigerweb",
  place_kind: "county",
  place_ref: "39049",
  place_label: "Franklin County, Ohio",
  place_country_code: "US",
  place_subdivision_code: "OH",
  place_min_lon: -83.2,
  place_min_lat: 39.8,
  place_max_lon: -82.8,
  place_max_lat: 40.1,
  place_geometry_geojson: {
    type: "Polygon",
    coordinates: [[[-83.1, 39.9], [-82.9, 39.9], [-82.9, 40.0], [-83.1, 39.9]]],
  },
  place_set_at: "2026-08-25T00:00:00.000Z",
};

const CORRIDORS: ProjectCorridorRow[] = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    workspace_id: PROJECT.workspace_id,
    project_id: PROJECT.id,
    name: "Main Street",
    corridor_type: "arterial",
    los_grade: "D",
    geometry_geojson: { type: "LineString", coordinates: [[-83.1, 39.9], [-83.0, 40.0]] },
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    workspace_id: PROJECT.workspace_id,
    project_id: PROJECT.id,
    name: "Broken imported line",
    corridor_type: "other",
    los_grade: null,
    geometry_geojson: { type: "LineString", coordinates: [[-83, 95], [-82.9, 40]] },
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  },
];

describe("project GeoPackage", () => {
  it("creates a valid SQLite GeoPackage with real WGS84 features and an explicit manifest", () => {
    const artifact = buildProjectGeoPackage({
      project: PROJECT,
      corridors: CORRIDORS,
      generatedAt: new Date("2026-08-26T12:34:56.000Z"),
    });
    const db = new Database(artifact.bytes, { readonly: true });
    try {
      expect(db.pragma("application_id", { simple: true })).toBe(0x47504b47);
      expect(db.pragma("user_version", { simple: true })).toBe(10400);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.prepare("SELECT table_name, data_type, srs_id FROM gpkg_contents ORDER BY table_name").all())
        .toEqual([
          { table_name: "project_area", data_type: "features", srs_id: 4326 },
          { table_name: "project_corridors", data_type: "features", srs_id: 4326 },
          { table_name: "project_info", data_type: "attributes", srs_id: null },
          { table_name: "project_location", data_type: "features", srs_id: 4326 },
        ]);
      expect(db.prepare("SELECT count(*) AS count FROM project_area").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT count(*) AS count FROM project_location").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT corridor_name FROM project_corridors").all()).toEqual([
        { corridor_name: "Main Street" },
      ]);
      expect(
        ["project_area", "project_location", "project_corridors"].map((table) =>
          (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>)
            .find((column) => column.name === "geom")?.type
        )
      ).toEqual(["GEOMETRY", "POINT", "LINESTRING"]);
      expect(db.prepare("SELECT corridor_count, omitted_corridor_count, coverage_limits FROM project_info").get())
        .toEqual({
          corridor_count: 1,
          omitted_corridor_count: 1,
          coverage_limits: "Only stored project area, location, and cartographic corridors are included; linked datasets, documents, and analysis evidence are not included; 1 corridor was recorded but invalid; omitted",
        });
      const geometry = db.prepare("SELECT geom FROM project_area").pluck().get() as Buffer;
      expect(geometry.subarray(0, 2).toString("ascii")).toBe("GP");
      expect(geometry.readInt32LE(4)).toBe(4326);
    } finally {
      db.close();
    }
    expect(artifact.summary).toEqual({
      projectAreaCount: 1,
      projectLocationCount: 1,
      corridorCount: 1,
      omittedCorridorCount: 1,
      coverageLimits: [
        "Only stored project area, location, and cartographic corridors are included; linked datasets, documents, and analysis evidence are not included",
        "1 corridor was recorded but invalid; omitted",
      ],
    });
  });

  it("keeps absent and malformed geometry visible instead of inventing features", () => {
    const artifact = buildProjectGeoPackage({
      project: {
        ...PROJECT,
        latitude: null,
        longitude: null,
        place_geometry_geojson: { type: "Polygon", coordinates: [[[-83, 40], [-82, 40], [-83, 41]]] },
      },
      corridors: [],
    });
    const db = new Database(artifact.bytes, { readonly: true });
    try {
      expect(db.prepare("SELECT count(*) FROM project_area").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM project_location").pluck().get()).toBe(0);
      expect(db.prepare("SELECT project_area_coverage, project_location_coverage FROM project_info").get())
        .toEqual({
          project_area_coverage: "Project area recorded but invalid; omitted",
          project_location_coverage: "Project location not recorded",
        });
    } finally {
      db.close();
    }
  });

  it("creates a filesystem-safe, dated filename", () => {
    expect(projectGeoPackageFilename("  Côte / Main St.  ", new Date("2026-08-26T20:00:00Z")))
      .toBe("openplan-cote-main-st-2026-08-26.gpkg");
  });
});
