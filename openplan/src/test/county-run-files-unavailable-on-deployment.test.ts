// @vitest-environment node
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A COPY OF OPENPLAN THAT CANNOT SEE THE WORKER'S DISK.
 *
 * The hosted installation serves these routes from a serverless bundle with no
 * county worker beside it. A run's manifest still records paths on the
 * worker's machine, so every read of those paths fails and every write meets a
 * read-only filesystem. These tests stand that up with a run folder that is
 * never created and, for the save, the EROFS a read-only bundle returns. They
 * pin two things: the planner gets a plain "unavailable here" answer, and the
 * run's stored state is not touched on the strength of a file that was never
 * read or written.
 *
 * The boundary is pinned from the other side too. A folder this process CAN
 * see, holding no file yet or a file with bad content, keeps the route's
 * existing answer, because on a shared disk that is a real finding about the
 * run and not a deployment limit.
 *
 * Node environment on purpose: under jsdom this file's mock of
 * node:fs/promises did not reach the routes, and a save escaped to the real
 * disk. `mkdirMock` is asserted as called wherever the mock carries the case.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mkdirMock = vi.fn();
const writeFileMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

// Reads go to the real filesystem. Writes pass through to it unless a test
// makes them meet the read-only error a serverless bundle gives.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mkdir = (...args: Parameters<typeof actual.mkdir>) => mkdirMock(...args);
  const writeFile = (...args: Parameters<typeof actual.writeFile>) => writeFileMock(...args);
  return { ...actual, default: { ...actual, mkdir, writeFile }, mkdir, writeFile };
});

import {
  GET as getScaffold,
  POST as postScaffold,
} from "@/app/api/county-runs/[countyRunId]/scaffold/route";
import { POST as refreshValidation } from "@/app/api/county-runs/[countyRunId]/validate/refresh/route";
import { POST as prepareValidation } from "@/app/api/county-runs/[countyRunId]/validate/route";
import {
  COUNTY_RUN_FILES_UNAVAILABLE_CODE,
  describeCountyRunFilesUnavailable,
} from "@/lib/api/county-onramp-run-files";

// This file's own imports of node:fs/promises are mocked too, so the real
// functions come from the original module.
const { mkdir: realMkdir, rm, writeFile: realWriteFile } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const countyRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const folders: string[] = [];

/** A worker's run folder: absolute, and never created on this machine. */
function folderNotOnThisHost() {
  return path.join(tmpdir(), `openplan-worker-run-not-on-this-host-${randomUUID()}`);
}

/** A run folder this process can see, with its validation folder made. */
async function folderOnThisHost() {
  const runDir = path.join(tmpdir(), `openplan-worker-run-on-this-host-${randomUUID()}`);
  folders.push(runDir);
  await realMkdir(path.join(runDir, "validation"), { recursive: true });
  return runDir;
}

function manifest(runDir: string) {
  return {
    schema_version: "openplan.county_onramp_manifest.v1",
    generated_at: "2026-03-24T23:00:00Z",
    name: "worker-run",
    county_fips: "06057",
    county_prefix: "RUN",
    run_dir: runDir,
    mode: "existing-run",
    stage: "validation-scaffolded",
    artifacts: {
      scaffold_csv: path.join(runDir, "validation", "scaffold.csv"),
      review_packet_md: path.join(runDir, "review.md"),
      run_summary_json: path.join(runDir, "run_summary.json"),
      bundle_manifest_json: path.join(runDir, "bundle_manifest.json"),
      validation_summary_json: null,
    },
    runtime: {
      keep_project: true,
      force: false,
      overall_demand_scalar: 0.369,
      external_demand_scalar: null,
      hbw_scalar: null,
      hbo_scalar: null,
      nhb_scalar: null,
    },
    summary: {
      run: {
        zone_count: 26,
        population_total: 102345,
        jobs_total: 45678,
        loaded_links: 3174,
        final_gap: 0.0091,
        total_trips: 231828.75,
      },
      validation: null,
      bundle_validation: null,
      scaffold: {
        station_count: 1,
        observed_volume_filled_count: 1,
        observed_volume_missing_count: 0,
        source_agency_filled_count: 1,
        source_agency_tbd_count: 0,
        source_description_filled_count: 1,
        source_description_missing_count: 0,
        ready_station_count: 1,
        next_action_label: "Validation can run next.",
      },
    },
  };
}

type Write = { table: string; op: string; payload?: unknown };

/** Records every database write so a test can assert that none happened. */
function installClient(runManifest: ReturnType<typeof manifest>) {
  const writes: Write[] = [];
  const row = {
    id: countyRunId,
    workspace_id: "11111111-1111-4111-8111-111111111111",
    geography_type: "county_fips",
    geography_id: "06057",
    geography_label: "Run County",
    run_name: "worker-run",
    stage: "validation-scaffolded",
    status_label: "Validation pending scaffold edits",
    enqueue_status: "prepared",
    last_enqueued_at: null,
    requested_runtime_json: {},
    manifest_json: runManifest,
    validation_summary_json: null,
  };
  const selectColumns: string[] = [];
  const from = (table: string) => {
    if (table === "county_runs") {
      return {
        select: (columns: string) => {
          selectColumns.push(columns);
          return { eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
        },
        update: (payload: unknown) => {
          writes.push({ table, op: "update", payload });
          return { eq: () => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }) };
        },
        insert: (payload: unknown) => {
          writes.push({ table, op: "insert", payload });
          return { select: async () => ({ data: [], error: null }) };
        },
      };
    }
    if (table === "county_run_artifacts") {
      const chain = {
        eq: () => chain,
        then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
      };
      return {
        delete: () => {
          writes.push({ table, op: "delete" });
          return chain;
        },
        insert: (payload: unknown) => {
          writes.push({ table, op: "insert", payload });
          return { select: async () => ({ data: [], error: null }) };
        },
        select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      };
    }
    if (table === "workspace_members") {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "member" }, error: null }) }) }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  createClientMock.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: "123e4567-e89b-12d3-a456-426614174000" } } }),
    },
    from,
  });
  return { writes, selectColumns };
}

function routeContext() {
  return { params: Promise.resolve({ countyRunId }) };
}

function getRequest() {
  return new NextRequest(`http://localhost/api/county-runs/${countyRunId}/scaffold`, { method: "GET" });
}

function postRequest(routePath: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/county-runs/${countyRunId}/${routePath}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function erofs(): NodeJS.ErrnoException {
  const error = new Error("EROFS: read-only file system, mkdir") as NodeJS.ErrnoException;
  error.code = "EROFS";
  return error;
}

const COUNTS_CSV = "station_id,observed_volume,source_agency,source_description\nA,700,State DOT,PM 1\n";

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "");
  mkdirMock.mockImplementation(realMkdir);
  writeFileMock.mockImplementation(realWriteFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("county run routes on a copy that cannot reach the worker's files", () => {
  it("opening counts says the files are unavailable here, not that the run is missing them", async () => {
    const { writes } = installClient(manifest(folderNotOnThisHost()));

    const response = await getScaffold(getRequest(), routeContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: describeCountyRunFilesUnavailable("open-counts", false),
      code: COUNTY_RUN_FILES_UNAVAILABLE_CODE,
    });
    expect(writes).toEqual([]);
  });

  it("names the shared folder instead when this copy does have a county worker", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example.test/jobs");
    installClient(manifest(folderNotOnThisHost()));

    const response = await getScaffold(getRequest(), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe(describeCountyRunFilesUnavailable("open-counts", true));
    expect(payload.error).not.toBe(describeCountyRunFilesUnavailable("open-counts", false));
  });

  it("saving counts on a read-only bundle refuses plainly and writes nothing to the run", async () => {
    const runDir = folderNotOnThisHost();
    const { writes, selectColumns } = installClient(manifest(runDir));
    mkdirMock.mockRejectedValue(erofs());

    const response = await postScaffold(postRequest("scaffold", { csvContent: COUNTS_CSV }), routeContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: describeCountyRunFilesUnavailable("save-counts", false),
      code: COUNTY_RUN_FILES_UNAVAILABLE_CODE,
    });
    // The write gate needs the workspace and the save needs the manifest.
    expect(selectColumns[0]).toContain("workspace_id");
    expect(selectColumns[0]).toContain("manifest_json");
    // The mock carried this case: the save reached the folder and was refused.
    expect(mkdirMock).toHaveBeenCalledWith(path.join(runDir, "validation"), { recursive: true });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("bringing in validation results finds no file and leaves the run's stage alone", async () => {
    const { writes } = installClient(manifest(folderNotOnThisHost()));

    const response = await refreshValidation(postRequest("validate/refresh"), routeContext());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: describeCountyRunFilesUnavailable("bring-in-validation", false),
      code: COUNTY_RUN_FILES_UNAVAILABLE_CODE,
    });
    expect(writes).toEqual([]);
  });

  it("the readiness check says this copy cannot see the run's files, and stays not ready", async () => {
    installClient(manifest(folderNotOnThisHost()));

    const response = await prepareValidation(postRequest("validate"), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ready).toBe(false);
    expect(payload.command).toBeNull();
    expect(payload.reasons).toEqual([describeCountyRunFilesUnavailable("check-validation", false)]);
  });
});

describe("county run routes on a copy that can see the run's folder", () => {
  it("opening counts that are not written yet keeps the not-found answer", async () => {
    installClient(manifest(await folderOnThisHost()));

    const response = await getScaffold(getRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Registered scaffold CSV file was not found" });
  });

  it("bringing in validation results that are not written yet keeps the not-found answer", async () => {
    const { writes } = installClient(manifest(await folderOnThisHost()));

    const response = await refreshValidation(postRequest("validate/refresh"), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Validation summary file was not found on disk" });
    expect(writes).toEqual([]);
  });

  it("before the first validation, a run folder with no validation folder yet keeps the not-found answer", async () => {
    // The worker creates <run_dir>/validation only when validation runs, so on
    // a shared disk its absence means "not run yet", not "unreachable".
    const runDir = await folderOnThisHost();
    await rm(path.join(runDir, "validation"), { recursive: true, force: true });
    const { writes } = installClient(manifest(runDir));

    const response = await refreshValidation(postRequest("validate/refresh"), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Validation summary file was not found on disk" });
    expect(writes).toEqual([]);
  });

  it("validation results with bad content keep the invalid-file answer and change nothing", async () => {
    const runDir = await folderOnThisHost();
    await realWriteFile(path.join(runDir, "validation", "validation_summary.json"), "{ not json", "utf8");
    const { writes } = installClient(manifest(runDir));

    const response = await refreshValidation(postRequest("validate/refresh"), routeContext());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Validation summary file is invalid or unreadable" });
    expect(writes).toEqual([]);
  });

  it("saving counts into a folder this copy can write still saves them", async () => {
    const runDir = await folderOnThisHost();
    const { writes } = installClient(manifest(runDir));

    const response = await postScaffold(postRequest("scaffold", { csvContent: COUNTS_CSV }), routeContext());

    expect(response.status).toBe(200);
    expect(writeFileMock).toHaveBeenCalledWith(path.join(runDir, "validation", "scaffold.csv"), COUNTS_CSV, "utf8");
    expect(writes.map((write) => `${write.table}.${write.op}`)).toEqual(["county_runs.update"]);
  });

  it("the readiness check names missing output as missing, not as unreachable", async () => {
    installClient(manifest(await folderOnThisHost()));

    const response = await prepareValidation(postRequest("validate"), routeContext());
    const payload = await response.json();

    expect(payload.ready).toBe(false);
    expect(payload.reasons).toEqual([
      "County run output directory is missing, so the validator cannot be prepared yet.",
      "Registered scaffold CSV file was not found on disk.",
    ]);
  });
});
