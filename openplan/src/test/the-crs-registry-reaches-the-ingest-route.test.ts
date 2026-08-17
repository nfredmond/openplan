import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE TEST THAT WOULD HAVE CAUGHT IT: does the REAL coordinate-system registry
 * actually reach the route that decides what a file is?
 *
 * ═══ WHAT SHIPPED ═══
 *
 * `crs-resolution.ts` resolved against a registry that was expected to REGISTER
 * ITSELF at startup. Nothing ever performed that registration — the only
 * callers of `registerWorkspaceGisCrsRegistry` were tests. So on a running
 * deployment the resolver held nothing, every projected shapefile came back
 * `crs_registry_unavailable`, and the ingest route answered 422. A State Plane
 * shapefile in US survey feet is the commonest legacy file in an American
 * planning department and the entire reason this lane exists, so the headline
 * capability was unreachable in production.
 *
 * Nothing looked wrong. The refusal was honest, the registry was complete and
 * tested, the store was complete and tested, and every test in the lane
 * injected its own registry — which is precisely why none of them could see
 * that the product had none. This is the shipped-invisible defect class: a
 * complete, tested capability no planner can reach.
 *
 * ═══ WHY THIS TEST IS SHAPED THE WAY IT IS ═══
 *
 * It drives the ROUTE, end to end, with a real ESRI `.prj` — the literal bytes
 * ArcGIS writes beside a shapefile — and NO registry fake anywhere. The mock of
 * the binding module delegates to the real one (`importOriginal`), so the
 * generated 6,688-entry table, the WKT reader and the name index all really
 * run; the indirection exists only so that one case can prove the honest
 * refusal is still what a registry-less deployment does.
 *
 * A test that injected a fake registry here could not fail for the reason this
 * one exists to catch, however thorough it looked.
 */

const registryState = vi.hoisted(() => ({ absent: false }));

vi.mock("@/lib/workspace-gis/crs-registry-binding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace-gis/crs-registry-binding")>();
  return {
    // A getter rather than a value: the route reads this at call time, so one
    // test can remove the registry without disturbing the others, and the
    // default path is the genuine article rather than a stand-in.
    get WORKSPACE_GIS_CRS_REGISTRY() {
      return registryState.absent ? null : actual.WORKSPACE_GIS_CRS_REGISTRY;
    },
  };
});

const authGetUserMock = vi.fn();
const createClientMock = vi.fn();
const versionMaybeSingleMock = vi.fn();
const insertSingleMock = vi.fn();
const layerMaybeSingleMock = vi.fn();

let capturedInsert: Record<string, unknown> | null = null;
let layerReadFilters: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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

/**
 * A real `.prj`, verbatim from PROJ 9.7.1 (`projinfo -o WKT1_ESRI EPSG:2226`).
 *
 * California zone 2 in US SURVEY FEET, on NAD83 — a county parcels or
 * centreline file from anywhere between Sacramento and the Oregon border. Note
 * what it does NOT contain: an `AUTHORITY` node. ESRI writes the name and the
 * parameters and no code at all, so identifying it exercises the registry's
 * name index and its unit-preference tie-break, not a dictionary lookup. That
 * is the real difficulty of the common case.
 */
const CALIFORNIA_ZONE_2_FTUS_PRJ =
  'PROJCS["NAD_1983_StatePlane_California_II_FIPS_0402_Feet",' +
  'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",' +
  'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],' +
  'UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],' +
  'PARAMETER["False_Easting",6561666.667],PARAMETER["False_Northing",1640416.667],' +
  'PARAMETER["Central_Meridian",-122.0],PARAMETER["Standard_Parallel_1",39.8333333333333],' +
  'PARAMETER["Standard_Parallel_2",38.3333333333333],PARAMETER["Latitude_Of_Origin",37.6666666666667],' +
  'UNIT["US survey foot",0.304800609601219]]';

function fakeClient() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      if (table === "workspace_gis_layers") {
        // The ownership read (added 2026-08-16): the route must ask for the
        // layer scoped to the caller's own workspace before accepting an
        // upload against it. The recorded eq columns are the assertion.
        return {
          select: () => ({
            eq: (column: string) => {
              layerReadFilters.push(column);
              return {
                eq: (column2: string) => {
                  layerReadFilters.push(column2);
                  return { maybeSingle: layerMaybeSingleMock };
                },
              };
            },
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
  layerReadFilters = [];
  registryState.absent = false;
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  layerMaybeSingleMock.mockResolvedValue({ data: { id: LAYER_ID }, error: null });
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

describe("POST /api/workspace-gis/ingests, against the registry OpenPlan really ships", () => {
  it("accepts a State Plane survey-feet shapefile and records the file's own testimony", async () => {
    const response = await openIngest(
      openRequest(baseBody({ prjText: CALIFORNIA_ZONE_2_FTUS_PRJ }))
    );

    // The whole finding in one assertion: this was 422 in production.
    expect(response.status).toBe(201);

    expect(capturedInsert).toMatchObject({
      srs_authority: "EPSG",
      srs_code: "2226",
      srs_basis: "prj_file",
    });

    // Read from the file, so no person is named as having claimed it.
    expect(capturedInsert?.srs_asserted_by).toBeNull();
    expect(capturedInsert?.srs_asserted_at).toBeNull();

    // The UNIT has to survive, because feet-read-as-metres is the mistake this
    // lane exists to catch and the version record is what can say which it was.
    expect(capturedInsert?.srs_name).toContain("ftUS");
  });

  it("accepts a system the planner picked by code, and records it as their statement", async () => {
    const response = await openIngest(
      openRequest(baseBody({ assertedSrsCode: "EPSG:2226" }))
    );

    expect(response.status).toBe(201);
    expect(capturedInsert).toMatchObject({
      srs_code: "2226",
      srs_basis: "planner_asserted",
      srs_asserted_by: USER_ID,
    });
  });

  /**
   * The datum caveat is MEASURED by the registry generator against PROJ, not
   * written by hand — so this also proves the real generated notes reach the
   * row rather than a fixture's approximation of one.
   */
  it("carries the real measured datum caveat for a NAD27 file", async () => {
    const refused = await openIngest(
      openRequest(baseBody({ assertedSrsCode: "EPSG:26743" }))
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).reason).toBe("datum_acknowledgement_required");
    expect(capturedInsert, "nothing may be written before the acknowledgement").toBeNull();

    const accepted = await openIngest(
      openRequest(baseBody({ assertedSrsCode: "EPSG:26743", datumAcknowledged: true }))
    );
    expect(accepted.status).toBe(201);
    expect(capturedInsert?.datum_acknowledged_by).toBe(USER_ID);
    expect(String(capturedInsert?.datum_shift_note)).toMatch(/North American Datum 1927/);
  });

  /**
   * A system genuinely outside the registry is still REFUSED BY NAME. The fix
   * for the missing wiring must not have turned the resolver into something
   * that finds a nearby zone — a neighbouring zone lands the layer a hundred
   * kilometres away and nothing on screen would say so.
   */
  it("still refuses a system the registry does not carry, and names it", async () => {
    const response = await openIngest(
      openRequest(baseBody({ prjText: 'PROJCS["Totally_Invented_Zone_9",…]' }))
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.reason).toBe("crs_not_in_registry");
    expect(body.error).toContain("Totally_Invented_Zone_9");
    expect(capturedInsert).toBeNull();
  });

  /**
   * AND THE HONEST REFUSAL SURVIVES. A deployment with no registry must still
   * say so and refuse — never fall back to WGS 84, which would read survey feet
   * as degrees and put a California parcel fabric in the Gulf of Guinea.
   */
  it("refuses honestly, naming the cause, when the deployment has no registry", async () => {
    registryState.absent = true;

    const response = await openIngest(
      openRequest(baseBody({ prjText: CALIFORNIA_ZONE_2_FTUS_PRJ }))
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.reason).toBe("crs_registry_unavailable");
    expect(body.error).toMatch(/no coordinate-system registry/i);
    expect(capturedInsert).toBeNull();
  });
});

describe("a layer in another workspace cannot take an upload", () => {
  /**
   * Found 2026-08-16: the route inserted a version row with a CLIENT-SUPPLIED
   * layer id and the caller's own workspace id, and never asked whether that
   * layer belongs to the caller's workspace. RLS could not catch it — the row
   * satisfied the caller's own INSERT policy, and Postgres checks the layer FK
   * with table-owner rights. The rogue row then squatted the owning
   * workspace's (layer_id, version_number) slots invisibly, jamming its future
   * uploads. The route's side of the fix is the ownership read these tests
   * pin; the database's side is the composite (layer_id, workspace_id) FK in
   * migration 20260816000001.
   */
  it("refuses a layer id the caller's workspace cannot see, before any insert", async () => {
    layerMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await openIngest(
      openRequest(baseBody({ assertedSrsCode: "EPSG:2226" }))
    );

    expect(response.status).toBe(404);
    // Refused BEFORE the insert: a 404 that still wrote the row would be the
    // same defect with better manners.
    expect(capturedInsert).toBeNull();
  });

  it("asks for the layer scoped to the caller's workspace, not by id alone", async () => {
    await openIngest(openRequest(baseBody({ assertedSrsCode: "EPSG:2226" })));

    // Id alone would find another workspace's layer on a permissive read; the
    // workspace column is the half that makes the read an authorization.
    expect(layerReadFilters).toContain("id");
    expect(layerReadFilters).toContain("workspace_id");
  });

  it("a failed layer read refuses the upload rather than assuming ownership", async () => {
    layerMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await openIngest(
      openRequest(baseBody({ assertedSrsCode: "EPSG:2226" }))
    );

    expect(response.status).toBe(500);
    expect(capturedInsert).toBeNull();
  });
});
