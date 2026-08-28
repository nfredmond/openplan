import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildEvidenceDescriptor } from "@/lib/evidence/evidence-descriptor";
import {
  buildProjectGeoPackage,
  type ProjectGeoPackageProject,
} from "@/lib/projects/project-geopackage";

const OHIO_PROJECT: ProjectGeoPackageProject = {
  id: "81111111-1111-4111-8111-111111111111",
  workspace_id: "82222222-2222-4222-8222-222222222222",
  name: "River district mobility plan",
  summary: "A project outside the original pilot geography",
  status: "active",
  plan_type: "area_plan",
  delivery_phase: "planning",
  latitude: 39.1031,
  longitude: -84.512,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-26T00:00:00.000Z",
  place_source: "census-tigerweb",
  place_kind: "county",
  place_ref: "39061",
  place_label: "Hamilton County, Ohio",
  place_country_code: "US",
  place_subdivision_code: "OH",
  place_min_lon: -84.82,
  place_min_lat: 38.95,
  place_max_lon: -84.25,
  place_max_lat: 39.32,
  place_geometry_geojson: {
    type: "Polygon",
    coordinates: [[
      [-84.7, 39.0],
      [-84.4, 39.0],
      [-84.4, 39.2],
      [-84.7, 39.0],
    ]],
  },
  place_set_at: "2026-08-25T00:00:00.000Z",
};

function suppliedDescriptor(method: string, revisionToken: string) {
  return buildEvidenceDescriptor({
    identity: { method, revisionToken },
    source: {
      kind: "model_run_artifact",
      label: `${method} retained network`,
      citation: `artifact://${method}/${revisionToken}`,
    },
    asOfDate: "2026-08-26T00:00:00.000Z",
    retrievedAt: "2026-08-27T00:00:00.000Z",
    evidenceStatus: "modeled",
    claimTier: "screening_model_output",
    uncertainty: ["The methods remain separate."],
    limits: ["Only exact retained-network geometry is included."],
    revisionToken,
    checksumSha256: null,
    numericClaim: true,
  });
}

describe("project GeoPackage supplied GIS layers", () => {
  it("writes exact Ohio model and land-use features while preserving method and evidence identity", () => {
    const aequilibraeEvidence = suppliedDescriptor("aequilibrae", "aeq-revision-1");
    const activitysimEvidence = suppliedDescriptor("activitysim", "asim-revision-1");
    const landUseEvidence = buildEvidenceDescriptor({
      identity: { source: "adopted-designations", revision: "2026-07" },
      source: {
        kind: "adopted_land_use_designations",
        label: "Adopted land-use designation GIS",
        citation: "record://adopted-designations/2026-07",
      },
      asOfDate: "2026-07-15",
      retrievedAt: "2026-08-27T00:00:00.000Z",
      evidenceStatus: "reference",
      claimTier: "adopted_record",
      uncertainty: [],
      limits: ["Designation geometry is reproduced without reinterpretation."],
      revisionToken: "2026-07",
      checksumSha256: null,
      numericClaim: true,
    });

    const artifact = buildProjectGeoPackage({
      project: OHIO_PROJECT,
      corridors: [],
      generatedAt: new Date("2026-08-27T12:00:00.000Z"),
      modelLayers: {
        aequilibrae: {
          detail: "AequilibraE artifact and retained network were matched by the caller",
          evidenceId: "aeq-artifact-42",
          evidenceDescriptor: aequilibraeEvidence,
          features: [{
            id: "aeq-link-101",
            geometry: {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [[-84.58, 39.08], [-84.5, 39.11]],
              },
            },
            attributes: { run_id: "aeq-run-42", link_id: 101, daily_volume: 1250.5 },
          }],
        },
        activitysim: {
          detail: "ActivitySim artifact and retained network were matched by the caller",
          evidenceDescriptor: activitysimEvidence,
          features: [{
            id: "asim-link-101",
            geometry: {
              type: "LineString",
              coordinates: [[-84.58, 39.08], [-84.5, 39.11]],
            },
            attributes: { run_id: "asim-run-42", link_id: 101, daily_volume: 980.25 },
          }],
        },
      },
      landUseDesignations: {
        detail: "The adopted designation source was examined",
        evidenceDescriptor: landUseEvidence,
        features: [{
          id: "designation-mu-7",
          geometry: {
            type: "MultiPolygon",
            coordinates: [[[
              [-84.56, 39.08],
              [-84.52, 39.08],
              [-84.52, 39.12],
              [-84.56, 39.08],
            ]]],
          },
          attributes: { designation: "Mixed use", ordinance: "2026-17", adopted: true },
        }],
      },
    });

    const db = new Database(artifact.bytes, { readonly: true });
    try {
      expect(db.prepare("SELECT feature_id, attributes_json FROM aequilibrae_links").get())
        .toEqual({
          feature_id: "aeq-link-101",
          attributes_json: '{"daily_volume":1250.5,"link_id":101,"run_id":"aeq-run-42"}',
        });
      expect(db.prepare("SELECT feature_id, attributes_json FROM activitysim_links").get())
        .toEqual({
          feature_id: "asim-link-101",
          attributes_json: '{"daily_volume":980.25,"link_id":101,"run_id":"asim-run-42"}',
        });
      expect(db.prepare("SELECT feature_id, attributes_json FROM land_use_designations").get())
        .toEqual({
          feature_id: "designation-mu-7",
          attributes_json: '{"adopted":true,"designation":"Mixed use","ordinance":"2026-17"}',
        });
      expect(db.prepare(`
        SELECT layer_key, status, record_count, stable_evidence_id, source_kind
        FROM openplan_layer_status
        WHERE layer_key IN ('aequilibrae_links', 'activitysim_links', 'land_use_designations')
        ORDER BY layer_key
      `).all()).toEqual([
        {
          layer_key: "activitysim_links",
          status: "included",
          record_count: 1,
          stable_evidence_id: activitysimEvidence.stableEvidenceId,
          source_kind: "model_run_artifact",
        },
        {
          layer_key: "aequilibrae_links",
          status: "included",
          record_count: 1,
          stable_evidence_id: "aeq-artifact-42",
          source_kind: "model_run_artifact",
        },
        {
          layer_key: "land_use_designations",
          status: "included",
          record_count: 1,
          stable_evidence_id: landUseEvidence.stableEvidenceId,
          source_kind: "adopted_land_use_designations",
        },
      ]);
      expect(db.prepare("SELECT min_x, max_x, min_y, max_y FROM gpkg_contents WHERE table_name = 'aequilibrae_links'").get())
        .toEqual({ min_x: -84.58, max_x: -84.5, min_y: 39.08, max_y: 39.11 });
      expect(db.prepare("SELECT country_code, subdivision_code FROM project_area").get())
        .toEqual({ country_code: "US", subdivision_code: "OH" });
    } finally {
      db.close();
    }
  });

  it("marks unexamined and malformed supplied layers unavailable without false zeroes", () => {
    const artifact = buildProjectGeoPackage({
      project: OHIO_PROJECT,
      corridors: [],
      layerStatuses: [{
        layerKey: "caller_claimed_empty_layer",
        status: "included",
        recordCount: 0,
        evidenceId: null,
        detail: "Caller claimed that an empty layer was included.",
      }],
      modelLayers: {
        aequilibrae: {
          detail: "The exact AequilibraE source was examined",
          features: [
            {
              id: "outside-wgs84",
              geometry: { type: "LineString", coordinates: [[-84.5, 39.1], [200, 39.2]] },
              attributes: { daily_volume: 100 },
            },
            {
              id: "wrong-geometry-kind",
              geometry: { type: "Polygon", coordinates: [[[-84.5, 39.1], [-84.4, 39.1], [-84.5, 39.1], [-84.5, 39.1]]] },
              attributes: { daily_volume: 200 },
            },
          ],
        },
      },
      landUseDesignations: {
        detail: "The land-use source was examined",
        features: [{
          id: "unclosed-designation",
          geometry: {
            type: "Polygon",
            coordinates: [[[-84.6, 39.0], [-84.4, 39.0], [-84.4, 39.2], [-84.6, 39.2]]],
          },
          attributes: { designation: "Employment" },
        }],
      },
    });

    const db = new Database(artifact.bytes, { readonly: true });
    try {
      expect(db.prepare("SELECT count(*) FROM aequilibrae_links").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM activitysim_links").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM land_use_designations").pluck().get()).toBe(0);
      expect(db.prepare("SELECT status, record_count, detail FROM openplan_layer_status WHERE layer_key = 'aequilibrae_links'").get())
        .toEqual({
          status: "unavailable",
          record_count: null,
          detail: "The exact AequilibraE source was examined. The source was examined, but no exact qualifying AequilibraE link geometry was supplied. 2 supplied features were malformed or used an unsupported geometry and were omitted.",
        });
      expect(db.prepare("SELECT status, record_count, detail FROM openplan_layer_status WHERE layer_key = 'activitysim_links'").get())
        .toEqual({
          status: "unavailable",
          record_count: null,
          detail: "No ActivitySim link source was examined for this export.",
        });
      expect(db.prepare("SELECT status, record_count FROM openplan_layer_status WHERE layer_key = 'land_use_designations'").get())
        .toEqual({ status: "unavailable", record_count: null });
      expect(db.prepare("SELECT status, record_count FROM openplan_layer_status WHERE layer_key = 'caller_claimed_empty_layer'").get())
        .toEqual({ status: "unavailable", record_count: null });
      expect(db.prepare("SELECT count(*) FROM openplan_layer_status WHERE status = 'unavailable' AND record_count IS NOT NULL").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM openplan_layer_status WHERE status = 'included' AND record_count <= 0").pluck().get()).toBe(0);
    } finally {
      db.close();
    }
    expect(artifact.summary.coverageLimits).toContain(
      "2 supplied AequilibraE link features were malformed or unsupported; omitted",
    );
    expect(artifact.summary.coverageLimits).toContain(
      "1 supplied land-use designation feature was malformed or unsupported; omitted",
    );
  });
});
