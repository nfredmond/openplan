import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The upload, publication, and removal route for engagement context layers.
 *
 * The assertions that matter most are about what the route REFUSES and what it
 * refuses to assume:
 *
 *   - an upload never publishes, whatever the client sends;
 *   - a projected shapefile is refused with the projection named, because a
 *     layer silently reprojected onto the wrong street gets believed;
 *   - the deployment's byte ceiling is described as the operator's setting, not
 *     as a plan the planner could upgrade — OpenPlan sells nothing;
 *   - a write that matched no rows is a 404, not a 200 over nothing.
 */

const loadCampaignAccess = vi.fn();
const getUser = vi.fn();

const insertSingle = vi.fn();
const updateMaybeSingle = vi.fn();
const deleteMaybeSingle = vi.fn();
const listResolve = vi.fn();

const insertPayloads: Array<Record<string, unknown>> = [];
const updatePayloads: Array<Record<string, unknown>> = [];

const fakeSupabase = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table !== "engagement_context_layers") throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: Record<string, unknown>) => {
        insertPayloads.push(payload);
        return { select: () => ({ single: insertSingle }) };
      },
      update: (payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: updateMaybeSingle }) }) }) };
      },
      delete: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: deleteMaybeSingle }) }) }) }),
      select: () => ({ eq: () => ({ order: () => ({ order: listResolve }) }) }),
    };
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeSupabase),
  createServiceRoleClient: vi.fn(() => fakeSupabase),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccess(...args),
}));

import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/context-layers/route";
import { DELETE, PATCH } from "@/app/api/engagement/campaigns/[campaignId]/context-layers/[layerId]/route";
import { CONTEXT_LAYER_BYTE_CAP_ENV } from "@/lib/engagement/context-layers";
import { buildProjectedShapefileZip } from "./fixtures/context-layer-uploads";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const LAYER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const listCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
const layerCtx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID, layerId: LAYER_ID }) };

const LINE_GEOJSON = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-95.1, 29.7], [-95.2, 29.8]] } },
  ],
});

function uploadRequest(body: string | Uint8Array, query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers?${search}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: typeof body === "string" ? body : (body as unknown as BodyInit),
  });
}

function patchRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers/${LAYER_ID}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

function deleteRequest() {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers/${LAYER_ID}`,
    { method: "DELETE" }
  );
}

const ORIGINAL_BYTE_CAP = process.env[CONTEXT_LAYER_BYTE_CAP_ENV];

beforeEach(() => {
  vi.clearAllMocks();
  insertPayloads.length = 0;
  updatePayloads.length = 0;
  delete process.env[CONTEXT_LAYER_BYTE_CAP_ENV];
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCampaignAccess.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    error: null,
    allowed: true,
  });
  insertSingle.mockResolvedValue({ data: { id: LAYER_ID, name: "Proposed alignment" }, error: null });
  updateMaybeSingle.mockResolvedValue({
    data: { id: LAYER_ID, name: "Proposed alignment", visible_to_participants: true },
    error: null,
  });
  deleteMaybeSingle.mockResolvedValue({ data: { id: LAYER_ID }, error: null });
  listResolve.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  if (ORIGINAL_BYTE_CAP === undefined) delete process.env[CONTEXT_LAYER_BYTE_CAP_ENV];
  else process.env[CONTEXT_LAYER_BYTE_CAP_ENV] = ORIGINAL_BYTE_CAP;
});

describe("uploading a context layer", () => {
  it("stores it hidden, whatever the client asks for", async () => {
    const response = await POST(
      uploadRequest(LINE_GEOJSON, { filename: "alignment.geojson", name: "Proposed alignment" }),
      listCtx
    );

    expect(response.status).toBe(201);
    // Uploading is not publishing. There is no query parameter, no body field,
    // and no code path here that can make a new layer public.
    expect(insertPayloads[0].visible_to_participants).toBe(false);
    expect(insertPayloads[0].name).toBe("Proposed alignment");
    expect(insertPayloads[0].workspace_id).toBe(WORKSPACE_ID);
    expect(insertPayloads[0].srs_basis).toBe("geojson_rfc7946_default");
    expect(insertPayloads[0].feature_count).toBe(1);

    // The operator is told what the file said about its own coordinate system,
    // before deciding whether to publish it.
    const payload = (await response.json()) as { srsSummary: string };
    expect(payload.srsSummary).toContain("RFC 7946");
  });

  it("names the layer from the file when the operator did not type one", async () => {
    await POST(uploadRequest(LINE_GEOJSON, { filename: "existing bike network.geojson" }), listCtx);
    expect(insertPayloads[0].name).toBe("existing bike network");
  });

  it("carries the operator's legend note through to the row a resident reads", async () => {
    await POST(
      uploadRequest(LINE_GEOJSON, {
        filename: "alignment.geojson",
        name: "Proposed alignment",
        description: "Centreline as designed at 30% plans",
      }),
      listCtx
    );
    expect(insertPayloads[0].description).toBe("Centreline as designed at 30% plans");
  });

  it("refuses a projected shapefile with the projection named", async () => {
    const response = await POST(
      uploadRequest(buildProjectedShapefileZip(), { filename: "corridor.zip", name: "Corridor" }),
      listCtx
    );

    // 422: the file was read and cannot be placed honestly. Distinct from 415,
    // which means "this is not a format I read" — a planner needs to know which
    // of those two problems they have.
    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: string; reason: string };
    expect(payload.reason).toBe("srs_unsupported");
    expect(payload.error).toContain("NAD83 / UTM zone 10N");
    expect(insertPayloads).toHaveLength(0);
  });

  it("answers 415 for a file it does not read at all", async () => {
    const response = await POST(uploadRequest("just some notes", { filename: "notes.txt" }), listCtx);
    expect(response.status).toBe(415);
  });

  it("names the operator, not a plan, when the deployment's own ceiling is hit", async () => {
    process.env[CONTEXT_LAYER_BYTE_CAP_ENV] = "16";

    const response = await POST(uploadRequest(LINE_GEOJSON, { filename: "alignment.geojson" }), listCtx);

    expect(response.status).toBe(413);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Contact whoever operates this deployment");
    expect(payload.error).toContain("no usage tiers");
    // The words that must never appear in a refusal from a free product.
    // Spelled out rather than as a loose /plan/ — the product is called
    // OpenPlan, and a regex that cannot tell the name from the noun would fail
    // on every honest message and get deleted.
    expect(payload.error).not.toMatch(/upgrade|subscription|pricing|paid tier/i);
    expect(payload.error).not.toMatch(/\byour plan\b|\bcurrent plan\b/i);
  });

  it("is unlimited when the operator has set no ceiling", async () => {
    const response = await POST(uploadRequest(LINE_GEOJSON, { filename: "alignment.geojson" }), listCtx);
    expect(response.status).toBe(201);
  });

  it("refuses a signed-out caller and a role that cannot write", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(uploadRequest(LINE_GEOJSON, { filename: "a.geojson" }), listCtx)).status).toBe(401);

    loadCampaignAccess.mockResolvedValueOnce({
      campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });
    expect((await POST(uploadRequest(LINE_GEOJSON, { filename: "a.geojson" }), listCtx)).status).toBe(403);
    expect(insertPayloads).toHaveLength(0);
  });

  it("asks for engagement.write, which is the action the role matrix denies a viewer", async () => {
    await POST(uploadRequest(LINE_GEOJSON, { filename: "a.geojson" }), listCtx);
    expect(loadCampaignAccess).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, "user-1", "engagement.write");
  });
});

describe("publishing and removing a context layer", () => {
  it("echoes the publication consequence when a layer goes public", async () => {
    const response = await PATCH(patchRequest({ visibleToParticipants: true }), layerCtx);

    expect(response.status).toBe(200);
    expect(updatePayloads[0].visible_to_participants).toBe(true);
    const payload = (await response.json()) as { publicationWarning: string | null };
    expect(payload.publicationWarning).toContain("public link");
  });

  it("says nothing about publication when a layer is being hidden again", async () => {
    updateMaybeSingle.mockResolvedValueOnce({
      data: { id: LAYER_ID, name: "Parcels", visible_to_participants: false },
      error: null,
    });
    const response = await PATCH(patchRequest({ visibleToParticipants: false }), layerCtx);
    const payload = (await response.json()) as { publicationWarning: string | null };
    expect(payload.publicationWarning).toBeNull();
  });

  it("answers 404 rather than success when the write matched no rows", async () => {
    // The defect `write-outcome.ts` exists for: PostgREST reports "changed
    // nothing" as `data: null` with no error, and a route that ignores it
    // reports success over a layer that does not exist.
    updateMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await PATCH(patchRequest({ name: "Renamed" }), layerCtx)).status).toBe(404);

    deleteMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await DELETE(deleteRequest(), layerCtx)).status).toBe(404);
  });

  it("refuses a viewer's publish attempt at the route as well as at the database", async () => {
    loadCampaignAccess.mockResolvedValueOnce({
      campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });
    expect((await PATCH(patchRequest({ visibleToParticipants: true }), layerCtx)).status).toBe(403);
    expect(updatePayloads).toHaveLength(0);
  });
});

describe("listing context layers", () => {
  it("reports a failed read as a failure, never as an empty campaign", async () => {
    listResolve.mockResolvedValueOnce({ data: null, error: { message: "permission denied for table" } });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers`),
      listCtx
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("permission denied");
  });

  it("lets a viewer read the list", async () => {
    loadCampaignAccess.mockResolvedValueOnce({
      campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: true,
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/context-layers`),
      listCtx
    );

    expect(response.status).toBe(200);
    expect(loadCampaignAccess).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, "user-1", "engagement.read");
  });
});
