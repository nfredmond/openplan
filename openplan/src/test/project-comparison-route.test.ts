import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => createApiAuditLoggerMock() }));

import { POST } from "@/app/api/models/project-comparison/route";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

function fakeClient(role: string | null = "member") {
  const tables: Record<string, Row[]> = {
    projects: [{ id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Main Street" }],
    workspace_members: role ? [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role }] : [],
    scenario_sets: [],
    scenario_entries: [],
    models: [],
    model_runs: [],
    model_run_artifacts: [],
  };
  let id = 0;

  class Query implements PromiseLike<{ data: unknown; error: null }> {
    private filters: Array<[string, unknown | unknown[]]> = [];
    private action: "select" | "insert" | "update" = "select";
    private payload: Row | Row[] | null = null;
    private returnSingle = false;
    private limitCount: number | null = null;

    constructor(private readonly table: string) {}
    select(_columns?: string) { return this; }
    insert(payload: Row | Row[]) { this.action = "insert"; this.payload = payload; return this; }
    update(payload: Row) { this.action = "update"; this.payload = payload; return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    in(column: string, values: unknown[]) { this.filters.push([column, values]); return this; }
    order() { return this; }
    limit(count: number) { this.limitCount = count; return this; }
    single() { this.returnSingle = true; return Promise.resolve(this.execute()); }
    maybeSingle() { this.returnSingle = true; return Promise.resolve(this.execute()); }
    then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }
    private matches(row: Row) {
      return this.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
    }
    private execute() {
      if (this.action === "insert") {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const created = incoming.map((row) => ({ id: `generated-${++id}`, ...row }));
        tables[this.table].push(...created);
        return { data: this.returnSingle ? created[0] : created, error: null } as const;
      }
      if (this.action === "update") {
        const updated = tables[this.table].filter((candidate) => this.matches(candidate));
        for (const row of updated) {
          Object.assign(row, this.payload);
        }
        return { data: this.returnSingle ? updated[0] ?? null : updated, error: null } as const;
      }
      let rows = tables[this.table].filter((row) => this.matches(row));
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
      return { data: this.returnSingle ? rows[0] ?? null : rows, error: null } as const;
    }
  }

  return {
    tables,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: (table: string) => new Query(table),
    },
  };
}

function request(buildAssumption?: { autoTripChangePct: number; basis: string }) {
  return new NextRequest("http://localhost/api/models/project-comparison", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, ...(buildAssumption ? { buildAssumption } : {}) }),
  });
}

describe("project comparison starter route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one baseline, one build, and two explicitly empty method records, idempotently", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(fake.tables.scenario_sets).toHaveLength(1);
    expect(fake.tables.scenario_entries.map((row) => row.entry_type)).toEqual(["baseline", "alternative"]);
    expect(fake.tables.models).toHaveLength(2);
    expect(fake.tables.models.map((row) => row.model_family)).toEqual(["travel_demand", "activity_based_model"]);
    expect(fake.tables.models.every((row) => row.output_summary === "No modeled output yet.")).toBe(true);
    expect(fake.tables.models.every((row) => {
      const config = row.config_json as Record<string, unknown>;
      return (config.networkBasis as Record<string, unknown>).identity === "network_state_digest";
    })).toBe(true);
    expect(await first.json()).toMatchObject({
      networkBasis: "worker_osm_snapshot",
      state: "ready_for_run",
      nextRun: {
        method: "aequilibrae",
        scenario: "baseline",
      },
    });

    const aequilibrae = fake.tables.models.find((row) => row.model_family === "travel_demand");
    const baseline = fake.tables.scenario_entries.find((row) => row.entry_type === "baseline");
    fake.tables.model_runs.push({
      id: "run-baseline-aeq",
      model_id: aequilibrae?.id,
      scenario_entry_id: baseline?.id,
      status: "succeeded",
      created_at: "2026-08-26T00:00:00Z",
    });
    const statusOnly = await POST(request());
    expect(await statusOnly.json()).toMatchObject({
      state: "ready_for_run",
      nextRun: { method: "aequilibrae", scenario: "baseline" },
    });
    fake.tables.model_run_artifacts.push({
      run_id: "run-baseline-aeq",
      artifact_type: "link_volumes",
      file_url: "storage://run-artifacts/run-baseline-aeq.csv",
      file_size_bytes: 100,
      content_hash: "a".repeat(64),
    });
    const afterBaseline = await POST(request());
    expect(await afterBaseline.json()).toMatchObject({
      state: "needs_build_assumption",
      buildAssumptionRequired: true,
      nextRun: null,
    });

    const withAssumption = await POST(request({
      autoTripChangePct: -8,
      basis: "Local corridor mode-shift study, 2025",
    }));
    expect(await withAssumption.json()).toMatchObject({
      state: "ready_for_run",
      buildAssumptionRequired: false,
      buildAssumption: {
        kind: "assigned_auto_trip_change_pct",
        autoTripChangePct: -8,
      },
      nextRun: { method: "aequilibrae", scenario: "build" },
    });
    expect(fake.tables.scenario_entries.find((row) => row.entry_type === "alternative")?.assumptions_json)
      .toMatchObject({ guidedProjectChange: { autoTripChangePct: -8 } });
  });

  it("does not reuse a successful build run after its assumption changes", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    await POST(request({ autoTripChangePct: -8, basis: "Reviewed local study" }));
    const aeq = fake.tables.models.find((row) => row.model_family === "travel_demand");
    const baseline = fake.tables.scenario_entries.find((row) => row.entry_type === "baseline");
    const build = fake.tables.scenario_entries.find((row) => row.entry_type === "alternative");
    fake.tables.model_runs.push(
      { id: "baseline", model_id: aeq?.id, scenario_entry_id: baseline?.id, status: "succeeded", assumption_snapshot_json: {} },
      {
        id: "old-build",
        model_id: aeq?.id,
        scenario_entry_id: build?.id,
        status: "succeeded",
        assumption_snapshot_json: { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -8, basis: "Reviewed local study" } },
      },
    );
    fake.tables.model_run_artifacts.push(
      {
        run_id: "baseline",
        artifact_type: "link_volumes",
        file_url: "storage://run-artifacts/baseline.csv",
        file_size_bytes: 100,
        content_hash: "a".repeat(64),
      },
      {
        run_id: "old-build",
        artifact_type: "link_volumes",
        file_url: "storage://run-artifacts/old-build.csv",
        file_size_bytes: 100,
        content_hash: "b".repeat(64),
      },
    );

    const response = await POST(request({ autoTripChangePct: -12, basis: "Updated board-reviewed study" }));
    expect(await response.json()).toMatchObject({
      nextRun: { method: "aequilibrae", scenario: "build" },
    });
  });

  it("shows successful ActivitySim preflight separately and requires all four verified outputs", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    await POST(request({ autoTripChangePct: -8, basis: "Reviewed local study" }));
    const aeq = fake.tables.models.find((row) => row.model_family === "travel_demand");
    const asim = fake.tables.models.find((row) => row.model_family === "activity_based_model");
    const baseline = fake.tables.scenario_entries.find((row) => row.entry_type === "baseline");
    const build = fake.tables.scenario_entries.find((row) => row.entry_type === "alternative");
    const assumption = { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -8, basis: "Reviewed local study" } };
    fake.tables.model_runs.push(
      { id: "aeq-base", model_id: aeq?.id, scenario_entry_id: baseline?.id, status: "succeeded", assumption_snapshot_json: {} },
      { id: "aeq-build", model_id: aeq?.id, scenario_entry_id: build?.id, status: "succeeded", assumption_snapshot_json: assumption },
      { id: "asim-base", model_id: asim?.id, scenario_entry_id: baseline?.id, status: "succeeded", assumption_snapshot_json: {} },
    );
    fake.tables.model_run_artifacts.push(
      { run_id: "aeq-base", artifact_type: "link_volumes", file_url: "storage://run-artifacts/aeq-base.csv", file_size_bytes: 10, content_hash: "a".repeat(64) },
      { run_id: "aeq-build", artifact_type: "link_volumes", file_url: "storage://run-artifacts/aeq-build.csv", file_size_bytes: 10, content_hash: "b".repeat(64) },
    );

    const preflight = await POST(request());
    expect(await preflight.json()).toMatchObject({
      state: "needs_activitysim_runtime",
      nextRun: { method: "activitysim", scenario: "baseline" },
      activitysimPreflightRuns: [{ runId: "asim-base", scenario: "baseline", status: "preflight_succeeded" }],
    });

    fake.tables.model_run_artifacts.push({
      run_id: "asim-base",
      artifact_type: "activitysim_link_volumes",
      file_url: "storage://run-artifacts/asim-base.csv",
      file_size_bytes: 10,
      content_hash: "c".repeat(64),
    });
    fake.tables.model_runs.push({
      id: "asim-build",
      model_id: asim?.id,
      scenario_entry_id: build?.id,
      status: "succeeded",
      assumption_snapshot_json: assumption,
    });
    fake.tables.model_run_artifacts.push({
      run_id: "asim-build",
      artifact_type: "activitysim_link_volumes",
      file_url: "storage://run-artifacts/asim-build.csv",
      file_size_bytes: 10,
      content_hash: "d".repeat(64),
    });

    const ready = await POST(request());
    expect(await ready.json()).toMatchObject({
      state: "ready_for_validation",
      nextRun: null,
      verifiedOutputs: expect.arrayContaining([
        expect.objectContaining({ method: "activitysim", scenario: "build", artifactSha256: "d".repeat(64) }),
      ]),
    });
  });

  it("refuses a project whose workspace membership is absent", async () => {
    const fake = fakeClient(null);
    createClientMock.mockResolvedValue(fake.client);

    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(fake.tables.scenario_sets).toHaveLength(0);
  });
});
