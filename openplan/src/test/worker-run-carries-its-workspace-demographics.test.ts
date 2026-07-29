/**
 * A queued worker-backed run leaves the launch route carrying the demographics
 * its workspace paid for — or a stated reason it does not.
 *
 * The AequilibraE worker cannot see per-workspace secrets, so before this the
 * only Census key it could use was one on the worker HOST. A self-serve
 * workspace's own key never reached a model build, and the run died at the
 * first ACS call. These checks pin the wiring that carries it across: the
 * pointer is stamped on the run row for the worker-backed engines only, it
 * survives the large-study-area reroute, and an unavailable table is stamped
 * with its reason rather than omitted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const prepareWorkerZoneAttributesMock = vi.fn();
const fetchCensusForCorridorMock = vi.fn();
const fetchLODESForCorridorMock = vi.fn();

const modelMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const modelRunInsertMock = vi.fn();
const modelRunUpdateEqMock = vi.fn();
// Typed payload so the reroute assertion below can read the update it captured.
const modelRunUpdateMock = vi.fn((payload: Record<string, unknown>) => {
  void payload;
  return { eq: modelRunUpdateEqMock };
});
const modelRunStagesInsertMock = vi.fn();
const modelRunKpisInsertMock = vi.fn();
const modelUpdateEqMock = vi.fn();
const quotaGteMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  switch (table) {
    case "models":
      return {
        select: () => ({ eq: () => ({ maybeSingle: modelMaybeSingleMock }) }),
        update: () => ({ eq: modelUpdateEqMock }),
      };
    case "workspace_members":
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }) };
    case "model_runs":
      return {
        insert: modelRunInsertMock,
        update: modelRunUpdateMock,
        select: () => ({ eq: () => ({ gte: quotaGteMock }) }),
      };
    case "model_run_stages":
      return { insert: modelRunStagesInsertMock };
    case "model_run_kpis":
      return { insert: modelRunKpisInsertMock };
    case "workspace_integration_keys":
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    default:
      throw new Error(`Unexpected table: ${table}`);
  }
});

const supabaseStub = { auth: { getUser: vi.fn() }, from: fromMock };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub,
  createServiceRoleClient: () => supabaseStub,
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/data-sources/census", () => ({
  fetchCensusForCorridor: (...args: unknown[]) => fetchCensusForCorridorMock(...args),
}));

vi.mock("@/lib/data-sources/lodes", () => ({
  fetchLODESForCorridor: (...args: unknown[]) => fetchLODESForCorridorMock(...args),
}));

// `prepareWorkerZoneAttributes` is the single entry point BOTH launch paths use
// (initial and relaunch), so it is the seam this route test stands on. Its own
// contract — never throw, always return a stamp with a reason — is pinned in
// model-run-zone-attribute-handoff.test.ts, next to the implementation.
vi.mock("@/lib/models/zone-attribute-payload", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prepareWorkerZoneAttributes: (...args: unknown[]) => prepareWorkerZoneAttributesMock(...args),
  };
});

import { POST as postModelRun } from "@/app/api/models/[modelId]/runs/route";

const CORRIDOR = {
  type: "Polygon",
  coordinates: [
    [
      [-121.5, 39.1],
      [-121.4, 39.1],
      [-121.4, 39.2],
      [-121.5, 39.1],
    ],
  ],
};

const SUPPLIED_STAMP = {
  version: "zone-attributes-v1",
  status: "supplied",
  storageRef: "storage://run-artifacts/model-runs/pending/zone-attributes.json",
  sourceId: "us_census_acs5",
  sourceLabel: "American Community Survey 2023 5-year (US Census Bureau)",
  vintage: "2023",
  keyOrigin: "workspace",
  demographics: { status: "supplied", geographies: 42, reason: null },
  equity: { status: "supplied", level: "tract", geographies: 42, reason: null },
  reason: null,
  geographyIndexTruncated: false,
};

function launchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function insertedSnapshot(): Record<string, unknown> {
  const row = modelRunInsertMock.mock.calls[0][0] as {
    input_snapshot_json: Record<string, unknown>;
  };
  return row.input_snapshot_json;
}

describe("a worker-backed run leaves the launch route with its demographics", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    supabaseStub.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: null,
        title: "Any-place mobility model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: { runTemplate: { queryText: "Screen the corridor", corridorGeojson: CORRIDOR } },
      },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
    });
    modelRunInsertMock.mockResolvedValue({ error: null });
    modelRunStagesInsertMock.mockResolvedValue({ error: null });
    modelRunUpdateEqMock.mockResolvedValue({ error: null });
    modelUpdateEqMock.mockResolvedValue({ error: null });
    modelRunKpisInsertMock.mockResolvedValue({ error: null });
    quotaGteMock.mockResolvedValue({ count: 0, error: null });
    prepareWorkerZoneAttributesMock.mockResolvedValue(SUPPLIED_STAMP);
  });

  it("stamps the pointer to the workspace's demographics on an AequilibraE run", async () => {
    const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    expect(response.status).toBe(201);
    expect(insertedSnapshot().zoneAttributes).toEqual(SUPPLIED_STAMP);

    // Built for THIS run's id and study area, at the geography it will model.
    const call = prepareWorkerZoneAttributesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.corridorGeojson).toEqual(CORRIDOR);
    expect(call.zoneGeography).toBe("tract");
    expect(call.modelRunId).toEqual(expect.any(String));

    // And the stamp AGREES with the fetch. The worker's resolve_zone_geography
    // falls through to its own AEQ_ZONE_GEOGRAPHY env when this field is
    // missing, so an unstamped run could build zones at one resolution against
    // a table the app read at another — and the equity overlay, published at
    // the zone geography, would be refused for a mismatch the app caused.
    expect(insertedSnapshot().zoneGeography).toBe("tract");
  });

  it("asks for equity measures at the geography a block-group run will use", async () => {
    await postModelRun(launchRequest({ engineKey: "aequilibrae", zoneGeography: "block_group" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    const call = prepareWorkerZoneAttributesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.zoneGeography).toBe("block_group");
    expect(insertedSnapshot().zoneGeography).toBe("block_group");
  });

  it("carries the same handoff into the ActivitySim preflight lane", async () => {
    await postModelRun(launchRequest({ engineKey: "behavioral_demand" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    // behavioral_demand runs its screening stages in the SAME AequilibraE
    // worker, so it hits the identical zone-building path.
    expect(prepareWorkerZoneAttributesMock).toHaveBeenCalledTimes(1);
    expect(insertedSnapshot().zoneAttributes).toEqual(SUPPLIED_STAMP);
    // Including the resolution the table was read at. This engine used to be
    // handed a table at one geography and no stamp at all, so the worker
    // resolved its own env and could build zones at a different one.
    expect(insertedSnapshot().zoneGeography).toBe("tract");
  });

  it("records why demographics are missing instead of omitting the stamp", async () => {
    const reason =
      "No US Census API key is available. A workspace owner or admin can add a free key under Settings -> Integrations.";
    prepareWorkerZoneAttributesMock.mockResolvedValue({
      ...SUPPLIED_STAMP,
      status: "unavailable",
      storageRef: null,
      keyOrigin: "none",
      demographics: { status: "unavailable", geographies: 0, reason },
      equity: { status: "unavailable", level: null, geographies: 0, reason },
      reason: null,
    });

    const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    // The launch still succeeds — the worker may have its own key — but the run
    // now carries the reason, so its failure can name something actionable
    // rather than pointing at a server file the planner cannot reach.
    expect(response.status).toBe(201);
    const stamp = insertedSnapshot().zoneAttributes as { demographics: { reason: string } };
    expect(stamp.demographics.reason).toBe(reason);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "zone_attribute_handoff_unavailable",
      expect.objectContaining({ reason })
    );
  });

  it("does not build a table for the in-process lanes, which already see the key", async () => {
    fetchCensusForCorridorMock.mockResolvedValue({
      tracts: [{ geoid: "06021010100", population: 3200, totalHouseholds: 1250 }],
      totalPopulation: 3200,
      totalCommuters: 1400,
      pctTransit: 2,
      pctWalk: 4,
      pctBike: 1,
      pctWfh: 8,
      pctZeroVehicle: 6,
      pctMinority: 30,
      pctBelowPoverty: 12,
      medianIncomeWeighted: 62000,
    });
    fetchLODESForCorridorMock.mockResolvedValue({ totalJobs: 1800 });

    await postModelRun(launchRequest({ engineKey: "sketch_abm" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    // sketch_abm runs inside withWorkspaceIntegrationContext, so censusApiKey()
    // already honors the workspace key; a handoff would be dead weight.
    expect(prepareWorkerZoneAttributesMock).not.toHaveBeenCalled();
    expect("zoneAttributes" in insertedSnapshot()).toBe(false);
  });

  it("hands demographics to a sketch run rerouted onto the worker for size", async () => {
    // A study area above the in-process zone cap becomes a WORKER run, so it
    // needs the same table a directly-launched worker run gets — otherwise the
    // reroute reintroduces the very failure this handoff removes.
    fetchCensusForCorridorMock.mockResolvedValue({
      tracts: Array.from({ length: 200 }, (_, index) => ({
        geoid: `060210101${String(index).padStart(2, "0")}`,
        population: 1000,
        totalHouseholds: 400,
      })),
      totalPopulation: 200000,
      totalCommuters: 90000,
      pctTransit: 2,
      pctWalk: 4,
      pctBike: 1,
      pctWfh: 8,
      pctZeroVehicle: 6,
      pctMinority: 30,
      pctBelowPoverty: 12,
      medianIncomeWeighted: 62000,
    });

    const response = await postModelRun(launchRequest({ engineKey: "sketch_abm" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ engineKey: "aequilibrae", reroutedFrom: "sketch_abm" });
    expect(prepareWorkerZoneAttributesMock).toHaveBeenCalledTimes(1);

    const rerouteUpdate = modelRunUpdateMock.mock.calls[0][0];
    const rerouteSnapshot = rerouteUpdate.input_snapshot_json as Record<string, unknown>;
    expect(rerouteSnapshot.zoneAttributes).toEqual(SUPPLIED_STAMP);
    // The rerouted row is a WORKER run now, so the resolution the table was
    // read at has to travel with it. A sketch launch stamps no zoneGeography,
    // so without this the reroute handed the worker a table at one geography
    // and let it resolve another from its own environment.
    expect(rerouteSnapshot.zoneGeography).toBe("tract");
  });

  it("does not fail a launch when the deployment cannot store the table", async () => {
    // The handoff answers with a stated failure rather than throwing (its own
    // contract, pinned in model-run-zone-attribute-handoff.test.ts). What this
    // asserts is what the ROUTE does with that answer.
    prepareWorkerZoneAttributesMock.mockResolvedValue({
      ...SUPPLIED_STAMP,
      status: "handoff_failed",
      storageRef: null,
      reason:
        "The demographics for this run were read but could not be stored for the worker (storage exploded).",
    });

    const response = await postModelRun(launchRequest({ engineKey: "aequilibrae" }), {
      params: Promise.resolve({ modelId: MODEL_ID }),
    });

    // A handoff failure is a degraded run, not a refused one: the worker's own
    // env key may still cover it. What must not happen is a 500 with no run.
    expect(response.status).toBe(201);
    const stamp = insertedSnapshot().zoneAttributes as { status: string; reason: string };
    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/storage exploded/);
  });
});
