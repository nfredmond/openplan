import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { describeIncompleteIngest, validateFeatureBatch } from "@/lib/workspace-gis/ingest";

/**
 * A LAYER WITH HOLES IN IT MUST NEVER LOOK FINISHED.
 *
 * The upload is chunked because the files are 200 MB, which makes a browser
 * that closes mid-upload a normal event rather than an exceptional one. The
 * failure to avoid is not the interrupted upload — it is the interrupted upload
 * that draws: a parcel layer missing its last forty thousand shapes, with
 * nothing on the map to say so, in front of a planner who will believe it.
 *
 * Three mechanisms make that impossible, and the outer two are what this file
 * drives. (1) A version is `ready` only when the count that arrived equals the
 * count declared — a CHECK in 20260812000015, asserted by the migration test.
 * (2) This route refuses to finalize early and says which shapes are missing.
 * (3) A layer may only draw a `ready` version — a trigger, also in the
 * migration test. Any one of them alone would be a convention.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const versionMaybeSingleMock = vi.fn();
const updateMaybeSingleMock = vi.fn();
const layerUpdateMock = vi.fn();
const rpcMock = vi.fn();

let capturedVersionUpdate: Record<string, unknown> | null = null;
let capturedLayerUpdate: Record<string, unknown> | null = null;

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

import { POST as finalize } from "@/app/api/workspace-gis/ingests/[versionId]/finalize/route";
import { POST as appendFeatures } from "@/app/api/workspace-gis/ingests/[versionId]/features/route";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const LAYER_ID = "11111111-1111-4111-8111-111111111111";

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    layer_id: LAYER_ID,
    version_number: 1,
    source_format: "shapefile_zip",
    source_filename: "parcels.zip",
    source_byte_size: 1_000,
    storage_bucket: null,
    srs_authority: "EPSG",
    srs_code: "2226",
    srs_name: "NAD83 / California zone 3, US survey feet",
    srs_basis: "prj_file",
    srs_asserted_by: null,
    srs_asserted_at: null,
    reprojection_engine: "openplan",
    datum_shift_note: null,
    datum_acknowledged_by: null,
    geometry_kinds: ["Polygon"],
    attribute_fields: [],
    attribute_encoding: null,
    attribute_encoding_is_fallback: false,
    declared_feature_count: 100,
    feature_count: 100,
    source_feature_count: 100,
    dropped_feature_count: 0,
    truncated: false,
    bbox: null,
    ingest_status: "receiving",
    ingest_failure_reason: null,
    created_at: "2026-08-12T00:00:00.000Z",
    finalized_at: null,
    ...overrides,
  };
}

function fakeClient() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      if (table === "workspace_gis_layer_versions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: versionMaybeSingleMock }) }),
          update: (values: Record<string, unknown>) => {
            capturedVersionUpdate = values;
            return {
              eq: () => ({
                eq: () => ({ select: () => ({ maybeSingle: updateMaybeSingleMock }) }),
              }),
            };
          },
        };
      }
      if (table === "workspace_gis_layers") {
        return {
          update: (values: Record<string, unknown>) => {
            capturedLayerUpdate = values;
            return { eq: () => ({ eq: () => ({ select: layerUpdateMock }) }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  };
}

const context = () => ({ params: Promise.resolve({ versionId: VERSION_ID }) });

function finalizeRequest(body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/workspace-gis/ingests/${VERSION_ID}/finalize`, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedVersionUpdate = null;
  capturedLayerUpdate = null;
  authGetUserMock.mockResolvedValue({
    data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
  });
  layerUpdateMock.mockResolvedValue({ data: [{ id: LAYER_ID }], error: null });
  createClientMock.mockResolvedValue(fakeClient());
});

describe("what a batch must carry", () => {
  it("requires the index that makes a retry harmless", () => {
    const result = validateFeatureBatch({ features: [{ geometry: {} }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/which feature of the file it starts at/i);
  });

  it("refuses a feature with no geometry and names which one", () => {
    const result = validateFeatureBatch({
      startIndex: 4_000,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] } }, { properties: {} }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The index is absolute in the FILE, not in the batch: "feature 1" would
    // send a planner to the wrong row of a 200,000-row file.
    expect(result.message).toContain("4001");
    expect(result.message).toMatch(/Nothing from this batch was stored/i);
  });

  it("accepts a well-formed batch", () => {
    const result = validateFeatureBatch({
      startIndex: 0,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { a: 1 } }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("the incomplete-upload sentence", () => {
  it("says how many arrived, how many did not, and that nothing is drawn", () => {
    const message = describeIncompleteIngest(160_000, 214_391);
    expect(message).toContain("160,000");
    expect(message).toContain("214,391");
    expect(message).toContain("54,391");
    expect(message).toMatch(/never drawn/i);
  });
});

describe("POST /api/workspace-gis/ingests/[versionId]/finalize", () => {
  it("refuses to finish an upload whose features have not all arrived", async () => {
    versionMaybeSingleMock.mockResolvedValue({
      data: versionRow({ feature_count: 60, declared_feature_count: 100 }),
      error: null,
    });
    // The update path is armed deliberately, so that a route which SKIPPED the
    // completeness check would answer a cheerful 200 rather than crashing. A
    // mutation that fails by exception proves less than one that fails by
    // succeeding at the wrong thing.
    updateMaybeSingleMock.mockResolvedValue({
      data: versionRow({ feature_count: 60, ingest_status: "ready" }),
      error: null,
    });

    const response = await finalize(finalizeRequest(), context());
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.featureCount).toBe(60);
    expect(body.declaredFeatureCount).toBe(100);
    expect(body.error).toContain("40");

    expect(capturedVersionUpdate, "nothing may be marked ready").toBeNull();
    expect(capturedLayerUpdate, "and no layer may start drawing it").toBeNull();
  });

  it("finishes a complete upload and makes the layer draw it", async () => {
    versionMaybeSingleMock.mockResolvedValue({ data: versionRow(), error: null });
    updateMaybeSingleMock.mockResolvedValue({
      data: versionRow({ ingest_status: "ready", finalized_at: "2026-08-12T00:05:00.000Z" }),
      error: null,
    });

    const response = await finalize(finalizeRequest(), context());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.version.ingestStatus).toBe("ready");
    expect(body.becameCurrent).toBe(true);
    expect(capturedVersionUpdate).toMatchObject({ ingest_status: "ready" });
    expect(capturedLayerUpdate).toMatchObject({ current_version_id: VERSION_ID });
  });

  /**
   * A FAILURE IS RECORDED FROM A FIXED VOCABULARY. The client may say THAT it
   * failed; it may not author the explanation a planner reads, which is written
   * from the reason code in `describeIngestFailure`.
   */
  it("records a failure only from the known reasons", async () => {
    versionMaybeSingleMock.mockResolvedValue({ data: versionRow(), error: null });

    const rejected = await finalize(
      finalizeRequest({ failed: true, reason: "the network was flaky" }),
      context()
    );
    expect(rejected.status).toBe(400);
    expect(capturedVersionUpdate).toBeNull();

    updateMaybeSingleMock.mockResolvedValue({
      data: versionRow({ ingest_status: "failed", ingest_failure_reason: "abandoned" }),
      error: null,
    });
    const accepted = await finalize(
      finalizeRequest({ failed: true, reason: "abandoned" }),
      context()
    );
    expect(accepted.status).toBe(200);
    expect(capturedVersionUpdate).toMatchObject({
      ingest_status: "failed",
      ingest_failure_reason: "abandoned",
    });
    expect(capturedLayerUpdate, "a failed upload never becomes what a layer draws").toBeNull();
  });

  it("answers a repeated finalize with the finished version rather than an error", async () => {
    versionMaybeSingleMock.mockResolvedValue({
      data: versionRow({ ingest_status: "ready", finalized_at: "2026-08-12T00:05:00.000Z" }),
      error: null,
    });

    const response = await finalize(finalizeRequest(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).becameCurrent).toBe(false);
    expect(capturedVersionUpdate).toBeNull();
  });
});

describe("POST /api/workspace-gis/ingests/[versionId]/features", () => {
  it("reports a retried batch as zero inserted, not as a failure", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    versionMaybeSingleMock.mockResolvedValue({
      data: { feature_count: 2_000, declared_feature_count: 5_000 },
      error: null,
    });

    const response = await appendFeatures(
      new NextRequest(`http://localhost/api/workspace-gis/ingests/${VERSION_ID}/features`, {
        method: "POST",
        body: JSON.stringify({
          startIndex: 0,
          features: [{ geometry: { type: "Point", coordinates: [1, 1] } }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
      context()
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insertedCount).toBe(0);
    // The progress a client shows is the DATABASE's count, never its own tally
    // of what it believes it sent.
    expect(body.featureCount).toBe(2_000);
    expect(body.declaredFeatureCount).toBe(5_000);
  });

  it("passes the start index straight through to the append function", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    versionMaybeSingleMock.mockResolvedValue({
      data: { feature_count: 1, declared_feature_count: 5_000 },
      error: null,
    });

    await appendFeatures(
      new NextRequest(`http://localhost/api/workspace-gis/ingests/${VERSION_ID}/features`, {
        method: "POST",
        body: JSON.stringify({
          startIndex: 8_000,
          features: [{ geometry: { type: "Point", coordinates: [1, 1] } }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
      context()
    );

    expect(rpcMock).toHaveBeenCalledWith("workspace_gis_append_features", {
      p_version_id: VERSION_ID,
      p_start_index: 8_000,
      p_features: [{ geometry: { type: "Point", coordinates: [1, 1] } }],
    });
  });
});
