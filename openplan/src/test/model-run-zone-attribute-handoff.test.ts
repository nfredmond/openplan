/**
 * A worker-backed model run can be built from the LAUNCHING WORKSPACE's own
 * Census key.
 *
 * The AequilibraE worker used to read `CENSUS_API_KEY` from its own host, so a
 * self-serve workspace that had configured a key in the integrations wizard
 * still died at the first ACS call — and the error told the planner to edit a
 * server env file. These checks pin the replacement: the APP reads the
 * demographics with the workspace's key and hands the worker a table, the key
 * itself never leaves the app, and every failure carries a reason.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceIntegrationKeyMock = vi.fn<(provider: string) => string | null>(() => null);
const fetchJsonWithRetryMock = vi.fn();
const createServiceRoleClientMock = vi.fn();

vi.mock("@/lib/integrations/context", () => ({
  workspaceIntegrationKey: (provider: string) => workspaceIntegrationKeyMock(provider),
}));

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

import {
  prepareWorkerZoneAttributes,
  prepareZoneAttributeHandoff,
  zoneAttributeBboxFromGeojson,
  ZONE_ATTRIBUTE_PAYLOAD_VERSION,
  type ZoneAttributePayload,
} from "@/lib/models/zone-attribute-payload";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_KEY = "workspace-census-key-abcd";
const DEPLOYMENT_KEY = "deployment-census-key-wxyz";

/** A small square corridor — any place; no jurisdiction is baked in anywhere. */
const CORRIDOR = {
  type: "Polygon",
  coordinates: [
    [
      [-121.1, 39.2],
      [-121.0, 39.2],
      [-121.0, 39.3],
      [-121.1, 39.3],
      [-121.1, 39.2],
    ],
  ],
};

const TIGER_RESPONSE = {
  features: [
    { attributes: { GEOID: "060570001001" } },
    { attributes: { GEOID: "060570001002" } },
    { attributes: { GEOID: "060570002001" } },
  ],
};

const TRACT_ACS_RESPONSE = [
  [
    "B01003_001E",
    "B11001_001E",
    "B17001_001E",
    "B17001_002E",
    "B03002_001E",
    "B03002_003E",
    "B25044_001E",
    "B25044_003E",
    "B25044_010E",
    "state",
    "county",
    "tract",
  ],
  ["3200", "1250", "3100", "620", "3200", "1920", "1250", "50", "75", "06", "057", "000100"],
  ["2100", "830", "2000", "200", "2100", "1680", "830", "10", "23", "06", "057", "000200"],
];

const BLOCK_GROUP_ACS_RESPONSE = [
  [
    "B01003_001E",
    "C17002_001E",
    "C17002_002E",
    "C17002_003E",
    "B03002_001E",
    "B03002_003E",
    "B25044_001E",
    "B25044_003E",
    "B25044_010E",
    "state",
    "county",
    "tract",
    "block group",
  ],
  ["1600", "1500", "120", "180", "1600", "960", "620", "20", "40", "06", "057", "000100", "1"],
];

type Upload = { path: string; body: string };

function fakeUploader(result: { error: { message: string } | null } = { error: null }) {
  const uploads: Upload[] = [];
  return {
    uploads,
    uploader: {
      storage: {
        from: (bucket: string) => ({
          // `body` stays wide so the fake is assignable to the real uploader
          // signature; this module only ever uploads a JSON string.
          upload: async (path: string, body: unknown) => {
            uploads.push({ path: `${bucket}/${path}`, body: String(body) });
            return result;
          },
        }),
      },
    },
  };
}

/** Route the two upstreams by URL, so the test never depends on call order. */
function routeFetch(options: { tiger?: unknown; tractAcs?: unknown; blockGroupAcs?: unknown }) {
  fetchJsonWithRetryMock.mockImplementation(async (url: string) => {
    if (url.includes("tigerweb")) return options.tiger ?? null;
    if (url.includes("block%20group")) return options.blockGroupAcs ?? null;
    if (url.includes("api.census.gov")) return options.tractAcs ?? null;
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function parseUpload(uploads: Upload[]): ZoneAttributePayload {
  expect(uploads).toHaveLength(1);
  return JSON.parse(uploads[0].body) as ZoneAttributePayload;
}

describe("a worker-backed run's demographics come from the workspace's own key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceIntegrationKeyMock.mockReturnValue(null);
    delete process.env.CENSUS_API_KEY;
  });

  it("builds the zone table the worker needs and records that the workspace key paid for it", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploads, uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("supplied");
    expect(stamp.keyOrigin).toBe("workspace");
    expect(stamp.demographics).toMatchObject({ status: "supplied", geographies: 2 });
    expect(stamp.storageRef).toBe(
      `storage://run-artifacts/model-runs/${RUN_ID}/zone-attributes.json`
    );

    const payload = parseUpload(uploads);
    expect(payload.version).toBe(ZONE_ATTRIBUTE_PAYLOAD_VERSION);
    expect(payload.tables.demographics).toMatchObject({ status: "supplied" });
    if (payload.tables.demographics.status !== "supplied") throw new Error("unreachable");
    const table = payload.tables.demographics.table;
    // Keyed by the 11-digit tract GEOID the worker looks up, with population
    // and households positional against `measures`.
    expect(table.measures).toEqual(["population", "households"]);
    expect(table.rows["06057000100"]).toEqual([3200, 1250]);
    expect(table.rows["06057000200"]).toEqual([2100, 830]);
  });

  it("never writes the Census key into the payload the worker can read", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploads, uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    // The whole reason the fetch is inverted rather than the key forwarded:
    // a plaintext third-party credential in a run-readable place would defeat
    // the AES-256-GCM envelope the key is stored under.
    expect(JSON.stringify(stamp)).not.toContain(WORKSPACE_KEY);
    expect(uploads[0].body).not.toContain(WORKSPACE_KEY);
  });

  it("keeps the bulk table out of the run row so evidence packets stay small", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploads, uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    // input_snapshot_json is copied verbatim into every evidence packet, so the
    // stamp must be a pointer plus counts — never the rows themselves.
    const stampJson = JSON.stringify(stamp);
    expect(stampJson).not.toContain("06057000100");
    expect(stampJson.length).toBeLessThan(uploads[0].body.length);
  });

  it("falls back to the deployment key and says which key answered", async () => {
    process.env.CENSUS_API_KEY = DEPLOYMENT_KEY;
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("supplied");
    expect(stamp.keyOrigin).toBe("deployment_env");
  });

  it("publishes equity measures at the run's own zone geography", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({
      tiger: TIGER_RESPONSE,
      tractAcs: TRACT_ACS_RESPONSE,
      blockGroupAcs: BLOCK_GROUP_ACS_RESPONSE,
    });
    const { uploads, uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "block_group",
      uploader,
    });

    expect(stamp.equity).toMatchObject({ status: "supplied", level: "block_group", geographies: 1 });
    // Demographics stay at tract geography: the worker builds tract zones and
    // disaggregates them by keyless LODES residence share.
    expect(stamp.demographics.status).toBe("supplied");

    const payload = parseUpload(uploads);
    if (payload.tables.equity.status !== "supplied") throw new Error("unreachable");
    expect(payload.tables.equity.table.level).toBe("block_group");
    // 12-digit block-group GEOID, and the poverty pair comes from C17002
    // because B17001 is not published at block-group geography.
    expect(payload.tables.equity.table.rows["060570001001"]).toEqual([
      1600, 1500, 300, 1600, 640, 620, 60,
    ]);
  });
});

describe("an unavailable source states its reason instead of an empty table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceIntegrationKeyMock.mockReturnValue(null);
    delete process.env.CENSUS_API_KEY;
  });

  it("names the missing Census key and where a planner can add one", async () => {
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploads, uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("unavailable");
    expect(stamp.keyOrigin).toBe("none");
    expect(stamp.demographics.reason).toMatch(/Census API key/i);
    // The action a planner can take, not a server file they cannot reach.
    expect(stamp.demographics.reason).toMatch(/Settings -> Integrations/);
    expect(stamp.demographics.reason).not.toMatch(/\.env\.local/);
    // Nothing useful was read, so nothing is parked in Storage for the worker.
    expect(uploads).toHaveLength(0);
  });

  it("states the source's coverage limit rather than reporting an empty area", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({ tiger: { features: [] } });
    const { uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("unavailable");
    // "No geographies here" must read as a coverage statement, never as
    // "nothing found" — a study area outside the source is not an empty one.
    expect(stamp.demographics.reason).toMatch(/United States/);
  });

  it("distinguishes a failed handoff from a missing key", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploader } = fakeUploader({ error: { message: "bucket unavailable" } });

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/bucket unavailable/);
    // The demographics WERE read — conflating that with "no key" would send a
    // planner to fix a setting that is already correct.
    expect(stamp.demographics.status).toBe("supplied");
  });

  it("refuses a run with no usable study-area geometry", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    const { uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: { type: "Polygon", coordinates: [] },
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/study-area geometry/);
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
  });

  it("never throws out of a launch, whatever the source does", async () => {
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    fetchJsonWithRetryMock.mockRejectedValue(new Error("upstream exploded"));
    const { uploader } = fakeUploader();

    const stamp = await prepareZoneAttributeHandoff({
      runId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
      uploader,
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/upstream exploded/);
  });
});

/**
 * The one entry point both launch paths use. The initial launch and the
 * relaunch call THIS, not `prepareZoneAttributeHandoff` directly, because the
 * relaunch route re-queueing a run without rebuilding its stamp is exactly how
 * "add a Census key, then relaunch" became an instruction that could not work.
 */
describe("the launch-path entry point never costs a planner their run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceIntegrationKeyMock.mockReturnValue(WORKSPACE_KEY);
    delete process.env.CENSUS_API_KEY;
    createServiceRoleClientMock.mockImplementation(() => fakeUploader().uploader);
  });

  it("builds the table both launch paths hand to the worker", async () => {
    routeFetch({ tiger: TIGER_RESPONSE, tractAcs: TRACT_ACS_RESPONSE });
    const { uploads, uploader } = fakeUploader();
    createServiceRoleClientMock.mockReturnValue(uploader);

    const stamp = await prepareWorkerZoneAttributes({
      modelRunId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
    });

    expect(stamp.status).toBe("supplied");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe(`run-artifacts/model-runs/${RUN_ID}/zone-attributes.json`);
  });

  it("names a missing service-role key instead of blaming the demographics", async () => {
    // A deployment with no service-role key cannot park the table in Storage at
    // all. That is real and operator-fixable, and reporting it as "no
    // demographics" would send a planner to add a Census key they already have.
    createServiceRoleClientMock.mockImplementation(() => {
      throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    });

    const stamp = await prepareWorkerZoneAttributes({
      modelRunId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/service-role key/);
    expect(stamp.reason).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
  });

  it("returns a stated failure rather than throwing into the launch route", async () => {
    // Both callers await this in the middle of creating or re-queueing a run.
    // A throw here would cost the planner the run itself; a degraded run that
    // says why is the honest outcome, and the worker's own key may still cover.
    fetchJsonWithRetryMock.mockRejectedValue(new Error("upstream exploded"));
    const { uploader } = fakeUploader();
    createServiceRoleClientMock.mockReturnValue(uploader);

    const stamp = await prepareWorkerZoneAttributes({
      modelRunId: RUN_ID,
      corridorGeojson: CORRIDOR,
      zoneGeography: "tract",
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/upstream exploded/);
  });
});

describe("study-area extent", () => {
  it("reads both Polygon and MultiPolygon nesting", () => {
    expect(zoneAttributeBboxFromGeojson(CORRIDOR)).toEqual({
      minLon: -121.1,
      minLat: 39.2,
      maxLon: -121.0,
      maxLat: 39.3,
    });
    expect(
      zoneAttributeBboxFromGeojson({ type: "MultiPolygon", coordinates: [CORRIDOR.coordinates] })
    ).toEqual({ minLon: -121.1, minLat: 39.2, maxLon: -121.0, maxLat: 39.3 });
  });

  it("returns null rather than substituting a geography", () => {
    expect(zoneAttributeBboxFromGeojson(null)).toBeNull();
    expect(zoneAttributeBboxFromGeojson({ type: "Polygon", coordinates: [[]] })).toBeNull();
  });
});
