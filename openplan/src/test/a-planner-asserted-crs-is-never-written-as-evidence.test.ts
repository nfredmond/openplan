import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  resolveWorkspaceGisCrs,
  type WorkspaceGisCrsEntry,
} from "@/lib/workspace-gis/crs-resolution";

/**
 * THE SHARPEST LINE IN THIS LANE: a coordinate system a PERSON chose is not the
 * same kind of fact as one the file declared.
 *
 * A State Plane shapefile with no .prj is the common case in a planning
 * department, not the exotic one. OpenPlan will not guess for it — a wrong
 * guess lands the layer forty kilometres away and looks exactly like a right
 * one — so it asks, and records the answer as the planner's assertion, with
 * their name and the time on it.
 *
 * What must therefore be impossible: writing that assertion as though the file
 * had said it. That is a claim-tier promotion, and it is invisible after the
 * fact — the row would simply read `prj_file` and nobody would ever know a
 * human guessed. Three things stop it, and this test drives all three: the
 * resolver never takes a basis as INPUT, the route attributes only assertions,
 * and the database refuses either half without the other (asserted in
 * `workspace-gis-migration.test.ts`).
 */

/**
 * TWO CURATED SYSTEMS, NOT THE REAL REGISTRY, AND DELIBERATELY SO.
 *
 * What this file is about is the CLAIM TIER — that a person's guess can never
 * be written as the file's testimony — and that argument is clearest against a
 * registry small enough to read. The real registry reaching this route is a
 * different property with its own test:
 * `the-crs-registry-reaches-the-ingest-route.test.ts` drives the same route
 * with a real State Plane .prj and no mock at all, which is what proves the
 * production wiring these entries stand in for.
 *
 * Hoisted because `vi.mock` factories run before module-level consts exist.
 */
const { fakeRegistry } = vi.hoisted(() => {
  const caZone3: WorkspaceGisCrsEntry = {
    authority: "EPSG",
    code: "2226",
    name: "NAD83 / California zone 3, US survey feet",
    unit: "US survey foot",
    kind: "projected",
    datum: "NAD83",
    requiresDatumAcknowledgement: false,
    datumShiftNote: null,
  };
  const nad27: WorkspaceGisCrsEntry = {
    authority: "EPSG",
    code: "26743",
    name: "NAD27 / California zone III",
    unit: "US survey foot",
    kind: "projected",
    datum: "NAD27",
    requiresDatumAcknowledgement: true,
    datumShiftNote:
      "This file uses the NAD27 datum. OpenPlan has no NADCON grid, so shapes can sit up to about 100 m from where they belong in the western United States.",
  };
  return {
    /** A registry with two entries. Adding a system is adding a row, not a branch. */
    fakeRegistry: {
      fromPrj: (prjText: string) => {
        if (/California_zone_3|California zone 3/i.test(prjText)) return caZone3;
        if (/NAD27/i.test(prjText)) return nad27;
        return null;
      },
      byCode: (code: string) => {
        if (code === "EPSG:2226") return caZone3;
        if (code === "EPSG:26743") return nad27;
        return null;
      },
    },
  };
});

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const versionMaybeSingleMock = vi.fn();
const insertSingleMock = vi.fn();

let capturedInsert: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/workspace-gis/crs-registry-binding", () => ({
  WORKSPACE_GIS_CRS_REGISTRY: fakeRegistry,
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
    workspace: null,
  }),
}));

import { POST as openIngest } from "@/app/api/workspace-gis/ingests/route";

const LAYER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function fakeClient() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      if (table === "workspace_gis_layers") {
        // The route's ownership read (2026-08-16): the layer exists in the
        // caller's workspace. Cross-workspace refusal is pinned in
        // the-crs-registry-reaches-the-ingest-route.test.ts, not here.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: LAYER_ID }, error: null }) }),
            }),
          }),
        };
      }
      if (table === "workspace_gis_layer_versions") {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: versionMaybeSingleMock }) }) }),
          }),
          insert: (row: Record<string, unknown>) => {
            capturedInsert = row;
            return { select: () => ({ single: insertSingleMock }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function openRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/workspace-gis/ingests", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    layerId: LAYER_ID,
    sourceFormat: "shapefile_zip",
    sourceFilename: "parcels.zip",
    sourceByteSize: 120_000_000,
    declaredFeatureCount: 3,
    sourceFeatureCount: 3,
    droppedFeatureCount: 0,
    geometryKinds: ["Polygon"],
    attributeFields: [{ name: "APN", type: "C" }],
    reprojectionEngine: "openplan",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInsert = null;
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  versionMaybeSingleMock.mockResolvedValue({ data: null, error: null });
  insertSingleMock.mockImplementation(async () => ({
    data: {
      ...(capturedInsert ?? {}),
      id: "22222222-2222-4222-8222-222222222222",
      feature_count: 0,
      created_at: "2026-08-12T00:00:00.000Z",
      finalized_at: null,
      storage_bucket: null,
    },
    error: null,
  }));
  createClientMock.mockResolvedValue(fakeClient());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolving a coordinate system", () => {
  it("reads the file's own .prj as evidence", () => {
    const result = resolveWorkspaceGisCrs(
      {
        sourceFormat: "shapefile_zip",
        prjText: 'PROJCS["NAD_1983_StatePlane_California_zone_3_FIPS_0403_Feet",…]',
      },
      fakeRegistry
    );
    expect(result.ok && result.basis).toBe("prj_file");
    expect(result.ok && result.entry.code).toBe("2226");
  });

  /**
   * EVIDENCE BEATS ASSERTION, and the order matters: a stale picker in the
   * upload wizard must never override what the file itself says.
   */
  it("prefers the file's .prj over anything the planner picked", () => {
    const result = resolveWorkspaceGisCrs(
      {
        sourceFormat: "shapefile_zip",
        prjText: 'PROJCS["NAD_1983_StatePlane_California_zone_3_FIPS_0403_Feet",…]',
        assertedSrsCode: "EPSG:26743",
      },
      fakeRegistry
    );
    expect(result.ok && result.basis).toBe("prj_file");
    expect(result.ok && result.entry.datum).toBe("NAD83");
  });

  it("asks rather than guessing when the shapefile has no .prj", () => {
    const result = resolveWorkspaceGisCrs({ sourceFormat: "shapefile_zip" }, fakeRegistry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("crs_evidence_missing");
    // The refusal has to teach: what is missing, and why OpenPlan will not
    // pick for them.
    expect(result.message).toContain(".prj");
    expect(result.message).toMatch(/will not guess/i);
  });

  it("names the system it cannot carry instead of using a nearby zone", () => {
    const result = resolveWorkspaceGisCrs(
      {
        sourceFormat: "shapefile_zip",
        prjText: 'PROJCS["Guam_1963_Yap_Islands",…]',
      },
      fakeRegistry
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("crs_not_in_registry");
    expect(result.message).toContain("Guam_1963_Yap_Islands");
    expect(result.message).toMatch(/neighbouring zone/i);
  });

  it("takes GeoJSON and KML from their specifications, not from a registry", () => {
    for (const [format, basis] of [
      ["geojson", "geojson_rfc7946_default"],
      ["kml", "kml_specification"],
      ["kmz", "kml_specification"],
    ] as const) {
      // Null registry on purpose: these formats fix their coordinate system by
      // specification, so a deployment with no registry at all still takes them.
      const result = resolveWorkspaceGisCrs({ sourceFormat: format }, null);
      expect(result.ok && result.basis, `${format}`).toBe(basis);
    }
  });

  /**
   * NO REGISTRY MEANS AN HONEST REFUSAL, NEVER A SILENT WGS84. This is the
   * state of a deployment whose CRS registry has not been wired in, and the
   * worst possible behaviour would be to treat State Plane feet as degrees.
   */
  it("refuses a projected file when no registry is available", () => {
    const result = resolveWorkspaceGisCrs(
      {
        sourceFormat: "shapefile_zip",
        prjText: 'PROJCS["NAD_1983_StatePlane_California_zone_3_FIPS_0403_Feet",…]',
      },
      null
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("crs_registry_unavailable");
  });
});

describe("POST /api/workspace-gis/ingests", () => {
  it("records an asserted system with the asserter's name and time", async () => {
    const response = await openIngest(openRequest(baseBody({ assertedSrsCode: "EPSG:2226" })));
    expect(response.status).toBe(201);

    expect(capturedInsert).toMatchObject({
      srs_basis: "planner_asserted",
      srs_asserted_by: USER_ID,
      srs_code: "2226",
    });
    expect(typeof capturedInsert?.srs_asserted_at).toBe("string");

    // And the planner is told, wherever the layer appears, that a person chose
    // this — not the file.
    const body = await response.json();
    expect(body.notes.join(" ")).toMatch(/carried no coordinate system/i);
    expect(body.notes.join(" ")).toContain("California zone 3");
  });

  /**
   * THE NOTE MAY NOT PROMISE A CORRECTION PATH THAT DOES NOT EXIST.
   *
   * It used to end "If it lands in the wrong place, that is the setting to
   * change." There is no such setting, and there cannot be one until uploads
   * are retained: re-placing a layer means re-projecting the ORIGINAL
   * coordinates, and what OpenPlan stores is geometry already converted to
   * longitude/latitude. `storage_bucket`/`storage_path` sit on the version row
   * with nothing writing them, deliberately (migration 20260812000015).
   *
   * A planner who believes there is a setting goes looking for it, does not
   * find it, and concludes they have missed something. Naming the real remedy —
   * upload it again — is the whole fix, and this asserts BOTH halves: the
   * remedy is present and the promise is gone.
   */
  it("tells the planner how to actually fix a wrong system, and promises no setting", async () => {
    const response = await openIngest(openRequest(baseBody({ assertedSrsCode: "EPSG:2226" })));
    const notes: string[] = (await response.json()).notes;
    const note = notes.join(" ");

    expect(note).toMatch(/upload the file again/i);
    expect(note).toMatch(/does not keep the original file/i);
    expect(note).not.toMatch(/the setting to change/i);
  });

  it("records evidence from a .prj with NO asserter at all", async () => {
    const response = await openIngest(
      openRequest(
        baseBody({ prjText: 'PROJCS["NAD_1983_StatePlane_California_zone_3_FIPS_0403_Feet",…]' })
      )
    );
    expect(response.status).toBe(201);

    expect(capturedInsert).toMatchObject({ srs_basis: "prj_file" });
    // The whole promotion defence: evidence carries no author. A row with both
    // would be a person's guess wearing the file's testimony.
    expect(capturedInsert?.srs_asserted_by).toBeNull();
    expect(capturedInsert?.srs_asserted_at).toBeNull();

    const body = await response.json();
    expect(body.notes.join(" ")).not.toMatch(/carried no coordinate system/i);
  });

  /**
   * THE CLIENT MAY NOT DECLARE THE ANSWER. `srsBasis` is not an input to the
   * open request at all, and a payload trying to smuggle one in must not reach
   * the row — otherwise a stale tab or a hand-made request could write
   * `prj_file` onto a layer whose file said nothing.
   */
  it("ignores a basis the client tried to declare", async () => {
    await openIngest(
      openRequest(
        baseBody({ assertedSrsCode: "EPSG:2226", srsBasis: "prj_file", srsAssertedBy: null })
      )
    );
    expect(capturedInsert).toMatchObject({
      srs_basis: "planner_asserted",
      srs_asserted_by: USER_ID,
    });
  });

  /**
   * A DATUM THAT CAN BE 100 m OUT IS ACCEPTED — refusing would strand exactly
   * the legacy files this feature exists for — but only after a person says
   * they accept it, and the caveat then rides with the layer permanently.
   */
  it("will not store a NAD27 layer until someone acknowledges the shift", async () => {
    const refused = await openIngest(
      openRequest(baseBody({ prjText: 'PROJCS["NAD27_California_zone_III",…]' }))
    );
    expect(refused.status).toBe(409);
    const refusal = await refused.json();
    expect(refusal.reason).toBe("datum_acknowledgement_required");
    expect(refusal.error).toContain("100 m");
    expect(capturedInsert, "nothing may be written before the acknowledgement").toBeNull();

    const accepted = await openIngest(
      openRequest(
        baseBody({ prjText: 'PROJCS["NAD27_California_zone_III",…]', datumAcknowledged: true })
      )
    );
    expect(accepted.status).toBe(201);
    expect(capturedInsert?.datum_acknowledged_by).toBe(USER_ID);
    expect(capturedInsert?.datum_shift_note).toContain("100 m");

    const body = await accepted.json();
    expect(body.notes.join(" ")).toContain("100 m");
  });

  it("refuses counts that do not add up rather than storing them", async () => {
    const response = await openIngest(
      openRequest(
        baseBody({
          assertedSrsCode: "EPSG:2226",
          declaredFeatureCount: 10,
          droppedFeatureCount: 2,
          sourceFeatureCount: 5,
        })
      )
    );
    expect(response.status).toBe(400);
    expect(capturedInsert).toBeNull();
  });

  it("records a partial upload as truncated when the client kept fewer than the file held", async () => {
    await openIngest(
      openRequest(
        baseBody({
          assertedSrsCode: "EPSG:2226",
          declaredFeatureCount: 2,
          droppedFeatureCount: 0,
          sourceFeatureCount: 3,
        })
      )
    );
    expect(capturedInsert).toMatchObject({ truncated: true });
  });
});
