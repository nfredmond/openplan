import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  MAP_FEATURE_LAYER_LIMIT,
  POSTGREST_MAX_ROWS_PER_REQUEST,
} from "@/lib/cartographic/layer-disclosure";
import {
  WORKSPACE_GIS_BBOX_DRAW_LIMIT,
  describeWorkspaceLayerCoverage,
} from "@/lib/workspace-gis/coverage";

/**
 * A PARCEL FABRIC WITH HOLES IN IT IS WORSE THAN NO PARCEL FABRIC.
 *
 * Every other `/api/map-features/*` layer draws up to its cap and discloses the
 * truncation: "showing 500 of 2,000". That sentence works for projects and
 * corridors, which a planner reads as individual records. It fails for a
 * continuous fabric: 1,000 arbitrary parcels of 214,391 draw as a lattice of
 * gaps, the planner reads the gaps as unparcelled land, and the disclosure
 * sentence at the bottom of a panel does not undo what the map just showed
 * them. So above the cap this layer draws NOTHING and says how many are there.
 *
 * This is the test for that decision, at both ends: the sentence, and the route
 * that has to produce zero features while still reporting the true count.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const layerMaybeSingleMock = vi.fn();
const rpcMock = vi.fn();

let capturedLayerSelect = "";
let capturedRpcArgs: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "@/app/api/map-features/workspace-gis/[layerId]/route";

const LAYER_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function layerRow() {
  return {
    id: LAYER_ID,
    workspace_id: "33333333-3333-4333-8333-333333333333",
    project_id: null,
    name: "Parcels",
    description: null,
    display_color: "#94a3b8",
    display_opacity: 0.8,
    display_line_width: 1.5,
    label_field: null,
    default_visible: false,
    sort_order: 0,
    current_version_id: VERSION_ID,
    archived_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
    current_version: {
      id: VERSION_ID,
      layer_id: LAYER_ID,
      version_number: 1,
      source_format: "shapefile_zip",
      source_filename: "parcels.zip",
      source_byte_size: 120_000_000,
      storage_bucket: null,
      srs_authority: "EPSG",
      srs_code: "2226",
      srs_name: "NAD83 / California zone 3 (ftUS)",
      srs_basis: "prj_file",
      srs_asserted_by: null,
      srs_asserted_at: null,
      reprojection_engine: "openplan",
      datum_shift_note: null,
      datum_acknowledged_by: null,
      geometry_kinds: ["Polygon"],
      attribute_fields: [{ name: "APN", type: "C" }],
      attribute_encoding: "UTF-8",
      attribute_encoding_is_fallback: false,
      declared_feature_count: 214_391,
      feature_count: 214_391,
      source_feature_count: 214_391,
      dropped_feature_count: 0,
      truncated: false,
      bbox: [-121.1, 39.1, -120.9, 39.3],
      ingest_status: "ready",
      ingest_failure_reason: null,
      created_at: "2026-08-12T00:00:00.000Z",
      finalized_at: "2026-08-12T00:05:00.000Z",
    },
  };
}

function fakeClient() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      if (table === "workspace_gis_layers") {
        return {
          select: (columns: string) => {
            capturedLayerSelect = columns;
            return { eq: () => ({ maybeSingle: layerMaybeSingleMock }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      capturedRpcArgs = { name, ...args };
      return rpcMock(name, args);
    },
  };
}

function requestFor(bbox: string) {
  return new NextRequest(
    `http://localhost/api/map-features/workspace-gis/${LAYER_ID}?bbox=${bbox}`
  );
}

const context = () => ({ params: Promise.resolve({ layerId: LAYER_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  capturedLayerSelect = "";
  capturedRpcArgs = null;
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  layerMaybeSingleMock.mockResolvedValue({ data: layerRow(), error: null });
  createClientMock.mockResolvedValue(fakeClient());
});

describe("the draw limit itself", () => {
  /**
   * The cap is DERIVED, and the derivation is the assertion — restating 1000
   * here would pass whatever the code said. What matters is the relationship:
   * one viewport read must fit in one PostgREST response, because the platform
   * truncates anything larger SILENTLY, and a silent truncation is precisely
   * what this layer must never do.
   */
  it("fits inside one PostgREST response", () => {
    expect(WORKSPACE_GIS_BBOX_DRAW_LIMIT).toBe(MAP_FEATURE_LAYER_LIMIT * 2);
    expect(WORKSPACE_GIS_BBOX_DRAW_LIMIT).toBeLessThanOrEqual(POSTGREST_MAX_ROWS_PER_REQUEST);
  });
});

describe("the too-dense sentence", () => {
  it("names the layer, the count, and what to do — and never says 'showing N of M'", () => {
    const [note, ...rest] = describeWorkspaceLayerCoverage({
      layerName: "Parcels",
      returnedCount: 0,
      matchedCount: 214_391,
      droppedCount: 0,
      limit: 1000,
      tooDenseToDraw: true,
    });

    expect(rest).toEqual([]);
    expect(note).toContain("Parcels");
    expect(note).toContain("214,391");
    expect(note).toContain("Zoom in");
    // The truncation sentence would be a lie here: nothing is being shown.
    expect(note).not.toMatch(/showing 0 of/i);
  });

  it("still discloses a platform-side truncation below the cap", () => {
    const [note] = describeWorkspaceLayerCoverage({
      layerName: "Bike network",
      returnedCount: 400,
      matchedCount: 900,
      droppedCount: 0,
      limit: 1000,
      tooDenseToDraw: false,
    });
    expect(note).toContain("showing 400 of 900");
  });
});

describe("GET /api/map-features/workspace-gis/[layerId]", () => {
  it("draws nothing and reports the true count when the view is too dense", async () => {
    // What the function answers above the cap: one row, no geometry, the count.
    rpcMock.mockResolvedValue({
      data: [
        {
          id: null,
          feature_index: null,
          geometry_geojson: null,
          properties: null,
          matched_count: 214_391,
        },
      ],
      error: null,
    });

    const response = await GET(requestFor("-121.1,39.1,-120.9,39.3"), context());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.tooDenseToDraw).toBe(true);
    expect(body.features).toEqual([]);
    expect(body.returnedCount).toBe(0);
    // The count is the point: a refusal that could not say how many is a
    // refusal a planner cannot act on.
    expect(body.matchedCount).toBe(214_391);
    expect(body.coverageNotes.join(" ")).toContain("214,391");

    // The bbox reached the function unaltered — a viewport read that quietly
    // widened its window would draw a different area than the map is showing.
    expect(capturedRpcArgs).toMatchObject({
      name: "workspace_gis_features_in_bbox",
      p_version_id: VERSION_ID,
      p_west: -121.1,
      p_south: 39.1,
      p_east: -120.9,
      p_north: 39.3,
      p_limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT,
    });
  });

  it("draws the features when the view holds fewer than the cap", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          feature_index: 0,
          geometry_geojson: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
          properties: { APN: "001-020-030" },
          matched_count: 2,
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          feature_index: 1,
          geometry_geojson: { type: "Polygon", coordinates: [[[1, 1], [1, 2], [2, 2], [1, 1]]] },
          properties: { APN: "001-020-031" },
          matched_count: 2,
        },
      ],
      error: null,
    });

    const response = await GET(requestFor("-121.1,39.1,-120.9,39.3"), context());
    const body = await response.json();

    expect(body.tooDenseToDraw).toBe(false);
    expect(body.features).toHaveLength(2);
    expect(body.matchedCount).toBe(2);
    expect(body.truncated).toBe(false);
    // The attributes travel with the shape: the inspector shows the file's own
    // columns, which is the whole reason the .dbf is read at all.
    expect(body.features[0].properties.attributes).toEqual({ APN: "001-020-030" });
    expect(body.features[0].properties.kind).toBe("workspace_gis_feature");
  });

  it("refuses a whole-layer fetch rather than answering one", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/map-features/workspace-gis/${LAYER_ID}`),
      context()
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("bbox=west,south,east,north");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a bbox outside the world instead of clamping it", async () => {
    const response = await GET(requestFor("-200,39.1,-120.9,39.3"), context());
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says a layer with no finished upload is not drawn, rather than showing it empty", async () => {
    const row = layerRow();
    row.current_version_id = null as unknown as string;
    (row as Record<string, unknown>).current_version = null;
    layerMaybeSingleMock.mockResolvedValue({ data: row, error: null });

    const response = await GET(requestFor("-121.1,39.1,-120.9,39.3"), context());
    const body = await response.json();

    expect(body.features).toEqual([]);
    expect(body.coverageNotes.join(" ")).toContain("no finished upload");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  /**
   * THE PROJECTION IS THE ASSERTION. The Supabase clients are untyped, so a
   * column dropped from this string leaves every mocked test green while the
   * real map loses a caveat — the asserted-CRS note, the datum note, the
   * geometry it draws.
   */
  it("selects every column the layer contract needs", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await GET(requestFor("-121.1,39.1,-120.9,39.3"), context());

    for (const column of [
      "current_version_id",
      "display_color",
      "label_field",
      "srs_basis",
      "srs_asserted_by",
      "datum_shift_note",
      "ingest_status",
      "declared_feature_count",
      "attribute_fields",
    ]) {
      expect(capturedLayerSelect, `the projection must carry ${column}`).toContain(column);
    }
  });
});
