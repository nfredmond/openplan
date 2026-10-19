import { beforeEach, describe, expect, it, vi } from "vitest";
import { guidedManagedReportFixture, guidedReportFixture, REPORT_PROJECT, REPORT_SET, REPORT_SNAPSHOT, REPORT_WORKSPACE, reportId, encodeRecord, hashBytes, type EvidenceRow } from "@/test/fixtures/guided-report-evidence";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), bytes: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/models/artifact-source", () => ({ loadArtifactBytes: mocks.bytes, workerLocalRoot: () => null, resolveRunWorkDir: () => { throw new Error("Unexpected local read"); } }));
import {
  GUIDED_REPORT_ARTIFACT_COLUMNS, GUIDED_REPORT_KPI_COLUMNS, GUIDED_REPORT_LINK_COLUMNS, GUIDED_REPORT_RUN_COLUMNS,
  loadGuidedReportOptions, verifyGuidedComparisonReport,
} from "@/lib/reports/guided-comparison-server";

type QueryLog = { table: string; columns: string; filters: Array<[string, unknown]>; order: string[]; range?: [number, number] };
/** Filters and projections apply to the returned rows, not just a call log. */
function database(tables: Record<string, EvidenceRow[]>) {
  const log: QueryLog[] = [];
  return { log, from(table: string) { return { select(columns: string) {
    const query: QueryLog = { table, columns, filters: [], order: [] }; log.push(query);
    const predicates: Array<(row: EvidenceRow) => boolean> = [];
    function result() {
      if (!tables[table]) throw new Error(`Unexpected table ${table}`);
      let rows = tables[table].filter((row) => predicates.every((predicate) => predicate(row)));
      for (const key of [...query.order].reverse()) rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
      return rows.map((row) => Object.fromEntries(columns.split(",").map((key) => {
        const field = key.trim();
        if (!(field in row)) throw new Error(`Fixture lacks projected ${table}.${field}`);
        return [field, row[field]];
      })));
    }
    const builder = {
      eq(column: string, value: unknown) { query.filters.push([column, value]); predicates.push((row) => row[column] === value); return builder; },
      in(column: string, values: unknown[]) { query.filters.push([column, values]); predicates.push((row) => values.includes(row[column])); return builder; },
      order(column: string) { query.order.push(column); return builder; },
      range(from: number, to: number) { query.range = [from, to]; return builder; },
      async maybeSingle() { const rows = result(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length > 1 ? { message: "Ambiguous row" } : null }; },
      then(resolve: (result: { data: EvidenceRow[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve().then(() => ({ data: result(), error: null as null })).then(resolve, reject);
      },
    };
    return builder;
  } }; } };
}

function setup(managed = false) {
  const fixture = managed ? guidedManagedReportFixture() : guidedReportFixture();
  const db = database(fixture.tables);
  mocks.bytes.mockImplementation(async (file: string, scope: { bucket: string; objectPathPrefix: string }) => {
    expect(scope.bucket).toBe("run-artifacts");
    expect(file.startsWith(`storage://${scope.bucket}/${scope.objectPathPrefix}`)).toBe(true);
    const bytes = fixture.bytes.get(file);
    if (!bytes) throw new Error("Unreadable artifact");
    return bytes;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === "read_common_population_stage_custody") return { error: null, data: {
      schema: "openplan.common-population-stage-custody.v1", custody: "legacy_stage_snapshot", eligible: true,
      workspace_id: args.p_workspace, run_id: args.p_run, stage_id: args.p_stage, artifact_id: args.p_artifact,
    } };
    if (name === "read_guided_comparison_report_kpi_custody") {
      const kpi = fixture.tables.model_run_kpis.find((row) => row.id === args.p_kpi)!;
      const stage = fixture.tables.model_run_stages.find((row) => row.run_id === args.p_run && row.stage_name ===
        (kpi.kpi_name === "activitysim_trips" ? "ActivitySim Bundle & Preflight" : String(kpi.kpi_name).startsWith("activitysim") ? "ActivitySim Network Assignment" : "Artifact Extraction"))!;
      return { error: null, data: { schema: "openplan.guided-report-kpi-custody.v1", custody: "legacy_stage_snapshot", eligible: true,
        workspace_id: args.p_workspace, project_id: args.p_project, snapshot_id: args.p_snapshot, run_id: args.p_run, kpi_id: args.p_kpi, stage_id: stage.id,
        kpi: Object.fromEntries(Object.entries(kpi).filter(([key]) => key !== "created_at")) } };
    }
    if (name === "read_model_attempt_outputs") return { error: null, data: { run_id: args.p_run_id, run_status: "succeeded", outputs: [
      ...fixture.tables.model_run_artifacts.filter((row) => row.run_id === args.p_run_id).map((record) => ({ kind: "artifact", ownership_state: "current_completed", record })),
      ...fixture.tables.model_run_kpis.filter((row) => row.run_id === args.p_run_id).map((record) => ({ kind: "kpi", ownership_state: "current_completed", record })),
    ] } };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const input = { client: db as unknown as Parameters<typeof verifyGuidedComparisonReport>[0]["client"], workspaceId: REPORT_WORKSPACE,
    projectId: REPORT_PROJECT, reportType: "analysis_summary", snapshotId: REPORT_SNAPSHOT };
  return { ...fixture, db, input, verify: () => verifyGuidedComparisonReport(input) };
}

/** Compare identities by method/role, independent of SQL collation. */
function expectExactSources(sealed: Awaited<ReturnType<typeof verifyGuidedComparisonReport>>, f: ReturnType<typeof setup>) {
  expect(sealed.payload.sources).toHaveLength(4);
  const cells = Object.fromEntries(sealed.payload.sources.map((source) => [`${source.method}:${source.role}`, {
    runId: source.runId, track: source.decision.track,
    kpis: source.kpis.map((kpi) => ({ id: kpi.id, name: kpi.kpi_name, value: kpi.value, unit: kpi.unit })),
  }]));
  expect(cells).toEqual(Object.fromEntries(f.tables.scenario_comparison_model_run_links.map((link) => [`${link.method}:${link.scenario_role}`, {
    runId: link.model_run_id, track: link.method === "aequilibrae" ? "assignment" : "behavioral_demand",
    kpis: f.tables.model_run_kpis.filter((kpi) => kpi.run_id === link.model_run_id)
      .map((kpi) => ({ id: kpi.id, name: kpi.kpi_name, value: kpi.value, unit: kpi.unit })),
  }])));
}

/** Change synthetic retained bytes and their registered hash together, so a
 * refusal tests the document contract rather than the outer byte-hash check. */
function editAssessment(f: ReturnType<typeof setup>, edit: (document: EvidenceRow) => void) {
  const row = f.tables.modeling_validation_assessments[0];
  const artifact = f.tables.model_run_artifacts.find((item) => item.id === row.model_validation_assessment_artifact_id)!;
  const document = JSON.parse(new TextDecoder().decode(f.bytes.get(String(artifact.file_url))!)) as EvidenceRow;
  edit(document);
  const bytes = encodeRecord(document);
  f.bytes.set(String(artifact.file_url), bytes);
  artifact.content_hash = hashBytes(bytes); artifact.file_size_bytes = bytes.byteLength;
}

beforeEach(() => vi.clearAllMocks());

describe("exact saved guided comparison report verifier", () => {
  it("reports an exact current managed instrument at prototype/inconclusive without legacy scientific projections", async () => {
    const f = setup(true);
    const sealed = await f.verify();
    expect(sealed.payload.sources).toHaveLength(4);
    expect(sealed.payload.sources.every((source) => source.decision.claim_status === "prototype_only" && source.validation.scientific_outcome === "inconclusive")).toBe(true);
    expectExactSources(sealed, f);
    for (const source of sealed.payload.sources) {
      const instrument = f.tables.model_attempt_instrument_custody.find((row) => row.model_run_id === source.runId)!;
      // The resolver must preserve the former read-only projection byte for byte
      // when serialized into the retained report binding.
      expect(source.decision).toEqual({
        id: instrument.id, workspace_id: REPORT_WORKSPACE, model_run_id: source.runId,
        track: source.method === "aequilibrae" ? "assignment" : "behavioral_demand",
        claim_status: "prototype_only",
        status_reason: "The exact attempt-bound validation instrument is inconclusive; no stronger scientific projection is authorized.",
        source: "model_attempt_instrument_custody",
      });
    }
    expect(mocks.rpc.mock.calls.some(([name]) => name === "read_guided_comparison_report_kpi_custody")).toBe(false);
    expect(f.db.log).toEqual(expect.arrayContaining([expect.objectContaining({ table: "model_attempt_instrument_custody", filters: expect.arrayContaining([["workspace_id", REPORT_WORKSPACE]]) })]));
  });
  it("retains the supplied four VMT values separately, exact KPI identities and limited claims", async () => {
    const f = setup();
    // A newer decoy cannot change this explicitly selected historical comparison.
    f.tables.model_runs.push({ ...f.tables.model_runs[0], id: reportId(999), status: "failed" });
    f.tables.modeling_claim_decisions.push({ ...f.tables.modeling_claim_decisions[0], id: reportId(998), track: "behavioral_demand", claim_status: "claim_grade_passed" });
    const sealed = await f.verify();
    expectExactSources(sealed, f);
    expect(sealed.payload.sources.every((source) => source.decision.claim_status === "prototype_only")).toBe(true);
    const values = sealed.payload.results.map((result) => result.metrics.find((metric) => metric.key === "daily_vmt"));
    expect(values).toEqual([
      expect.objectContaining({ baseline: 450909.6, build: 443317.9, delta: expect.closeTo(-7591.7, 5), percentDelta: expect.closeTo(-1.6836, 3) }),
      expect.objectContaining({ baseline: 401455.9, build: 398090.6, delta: expect.closeTo(-3365.3, 5), percentDelta: expect.closeTo(-0.8383, 3) }),
    ]);
    expect(sealed.payload.results[1].metrics[0]).toMatchObject({ label: "ActivitySim person-trip table rows", unit: "trips" });
    expect(sealed.payload.sources.find((source) => source.method === "aequilibrae" && source.role === "baseline")!.kpis[0]).toMatchObject({ id: f.tables.model_run_kpis[0].id, custody: { eligible: true } });
    expect(mocks.rpc).toHaveBeenCalledWith("read_guided_comparison_report_kpi_custody", expect.objectContaining({ p_workspace: REPORT_WORKSPACE, p_project: REPORT_PROJECT, p_snapshot: REPORT_SNAPSHOT, p_run: f.runs[0], p_kpi: f.tables.model_run_kpis[0].id }));
    await expect(verifyGuidedComparisonReport({ ...f.input, saved: sealed })).resolves.toEqual(sealed);
    for (const query of f.db.log.filter((query) => ["model_runs", "model_run_kpis"].includes(query.table))) {
      const ids = query.filters.find(([column]) => column === (query.table === "model_runs" ? "id" : "run_id"))![1] as string[];
      expect(ids).toHaveLength(4);
      expect(new Set(ids)).toEqual(new Set(f.runs));
    }
    expect(f.db.log).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "model_runs", columns: GUIDED_REPORT_RUN_COLUMNS, filters: expect.arrayContaining([["workspace_id", REPORT_WORKSPACE], ["project_id", REPORT_PROJECT], ["scenario_set_id", REPORT_SET], ["id", expect.arrayContaining(f.runs)]]) }),
      expect.objectContaining({ table: "model_run_kpis", columns: GUIDED_REPORT_KPI_COLUMNS, filters: expect.arrayContaining([["run_id", expect.arrayContaining(f.runs)]]) }),
      expect.objectContaining({ table: "model_run_artifacts", columns: GUIDED_REPORT_ARTIFACT_COLUMNS }),
      expect.objectContaining({ table: "scenario_comparison_model_run_links", columns: GUIDED_REPORT_LINK_COLUMNS, filters: expect.arrayContaining([["comparison_snapshot_id", REPORT_SNAPSHOT], ["workspace_id", REPORT_WORKSPACE]]) }),
    ]));
  });

  it("reads the actual uncontracted rules-v4 shape without inventing a named input field", async () => {
    const f = setup();
    const sealed = await f.verify();
    expectExactSources(sealed, f);
    for (const source of sealed.payload.sources) {
      const assessment = source.validation.assessment as EvidenceRow;
      const exact = assessment.exact_inputs as EvidenceRow;
      expect(exact).not.toHaveProperty("validation_input_bundle_sha256");
      expect(exact.observation_sha256).toEqual([source.validationArtifacts[0].content_hash]);
      expect(exact.comparison_basis_sha256).toBe(source.validationArtifacts[1].content_hash);
      expect(exact.model_output_artifact_id).toBe(source.output.id);
      expect(exact.model_output_sha256).toBe(source.output.content_hash);
      expect(assessment.scientific_outcome).toBe("inconclusive");
    }
  });

  it("accepts a contracted rules-v4 named input binding without using the legacy alias", async () => {
    const f = setup();
    editAssessment(f, (assessment) => {
      const exact = assessment.exact_inputs as EvidenceRow;
      exact.validation_input_bundle_sha256 = (exact.observation_sha256 as string[])[0];
      exact.observation_sha256 = ["a".repeat(64), "b".repeat(64)];
      assessment.comparability_findings = {};
    });
    expectExactSources(await f.verify(), f);
  });

  it.each(["wrong input", "wrong basis", "wrong output ID", "wrong output hash", "wrong outcome", "missing input", "multiple observations", "unknown format", "contracted shape without named hash", "wrong version", "named mismatch"])(
    "refuses legacy assessment %s even with matching registered bytes", async (cause) => {
      const f = setup();
      editAssessment(f, (assessment) => {
        const exact = assessment.exact_inputs as EvidenceRow;
        if (cause === "wrong input") exact.observation_sha256 = ["f".repeat(64)];
        if (cause === "wrong basis") exact.comparison_basis_sha256 = "f".repeat(64);
        if (cause === "wrong output ID") exact.model_output_artifact_id = reportId(999);
        if (cause === "wrong output hash") exact.model_output_sha256 = "f".repeat(64);
        if (cause === "wrong outcome") assessment.scientific_outcome = "pass";
        if (cause === "missing input") delete exact.observation_sha256;
        if (cause === "multiple observations") exact.observation_sha256 = [...(exact.observation_sha256 as string[]), "f".repeat(64)];
        if (cause === "unknown format") assessment.schema = "unknown";
        if (cause === "contracted shape without named hash") assessment.comparability_findings = {};
        if (cause === "wrong version") assessment.rules_version = 5;
        if (cause === "named mismatch") exact.validation_input_bundle_sha256 = "f".repeat(64);
      });
      await expect(f.verify()).rejects.toThrow("validation does not bind this exact output and outcome");
    });

  it.each(["missing", "wrong"])("keeps the named input hash strict for a managed contract: %s", async (cause) => {
    const f = setup(true);
    const instrument = f.tables.model_attempt_instrument_custody[0];
    const artifact = f.tables.model_run_artifacts.find((row) => row.id === instrument.assessment_artifact_id)!;
    const assessment = JSON.parse(new TextDecoder().decode(f.bytes.get(String(artifact.file_url))!));
    if (cause === "missing") delete assessment.exact_inputs.validation_input_bundle_sha256;
    else assessment.exact_inputs.validation_input_bundle_sha256 = "f".repeat(64);
    // Even a plausible observation-array alias cannot replace the named field.
    assessment.exact_inputs.observation_sha256 = [instrument.input_bundle_sha256];
    const bytes = encodeRecord(assessment);
    f.bytes.set(String(artifact.file_url), bytes);
    artifact.content_hash = hashBytes(bytes); artifact.file_size_bytes = bytes.byteLength;
    instrument.assessment_sha256 = artifact.content_hash;
    await expect(f.verify()).rejects.toThrow("validation does not bind this exact output and outcome");
  });

  it.each([
    ["foreign workspace", (f: ReturnType<typeof setup>) => { f.input.workspaceId = reportId(990); }],
    ["foreign project", (f: ReturnType<typeof setup>) => { f.tables.scenario_sets[0].project_id = reportId(990); }],
    ["missing snapshot", (f: ReturnType<typeof setup>) => { f.input.snapshotId = reportId(990); }],
    ["missing role", (f: ReturnType<typeof setup>) => { f.tables.scenario_comparison_model_run_links.pop(); }],
    ["duplicate role", (f: ReturnType<typeof setup>) => { f.tables.scenario_comparison_model_run_links[1].scenario_role = "baseline"; }],
    ["duplicate KPI", (f: ReturnType<typeof setup>) => { f.tables.model_run_kpis.push({ ...f.tables.model_run_kpis[0], id: reportId(990) }); }],
    ["unknown KPI", (f: ReturnType<typeof setup>) => { f.tables.model_run_kpis[0].kpi_name = "guess"; }],
    ["null KPI", (f: ReturnType<typeof setup>) => { f.tables.model_run_kpis[0].value = null; }],
    ["unit ambiguity", (f: ReturnType<typeof setup>) => { f.tables.model_run_kpis[4].unit = "vehicle-trips/day"; }],
    ["local KPI scope", (f: ReturnType<typeof setup>) => { f.tables.model_run_kpis[0].geometry_ref = "a road"; }],
    ["artifact hash drift", (f: ReturnType<typeof setup>) => { f.outputs[0].content_hash = "f".repeat(64); }],
    ["foreign artifact", (f: ReturnType<typeof setup>) => { f.tables.scenario_comparison_model_run_links[0].model_run_artifact_id = reportId(999); }],
    ["altered bytes", (f: ReturnType<typeof setup>) => { f.bytes.set(f.outputs[0].file_url, new TextEncoder().encode("different")); }],
    ["unreadable bytes", (f: ReturnType<typeof setup>) => { f.bytes.delete(f.outputs[0].file_url); }],
    ["assumption drift", (f: ReturnType<typeof setup>) => { f.tables.scenario_entries[1].assumptions_json = {}; }],
    ["population drift", (f: ReturnType<typeof setup>) => { (f.outputs[0].metadata_json as EvidenceRow).population_basis_digest = "e".repeat(64); }],
    ["population companion missing", (f: ReturnType<typeof setup>) => { f.tables.model_run_artifacts = f.tables.model_run_artifacts.filter((row) => row.artifact_type !== "common_population_persons"); }],
    ["stronger inconclusive claim", (f: ReturnType<typeof setup>) => { f.tables.modeling_claim_decisions[0].claim_status = "claim_grade_passed"; }],
    ["wrong validation track", (f: ReturnType<typeof setup>) => { f.tables.modeling_validation_assessments[0].track = "behavioral_demand"; }],
  ])("refuses %s without selecting replacement evidence", async (label, breakFixture) => {
    const f = setup(); breakFixture(f);
    const reasons: Record<string, string> = {
      "foreign workspace": "project is unavailable", "foreign project": "snapshot belongs to another project", "missing snapshot": "exact saved snapshot is unavailable",
      "missing role": "four unique exact", "duplicate role": "four unique exact", "duplicate KPI": "headline KPI is missing or ambiguous", "unknown KPI": "headline KPI is missing or ambiguous",
      "null KPI": "headline KPI has a null value", "unit ambiguity": "headline KPI has a null value", "local KPI scope": "headline KPI has a null value",
      "artifact hash drift": "retained artifact bytes differ", "altered bytes": "retained artifact bytes differ", "unreadable bytes": "Unreadable artifact",
      "foreign artifact": "selected artifact is missing or belongs to another run",
      "assumption drift": "fixed-population build assumption", "population drift": "output fingerprints or population identity changed",
      "population companion missing": "population companion is missing or ambiguous", "stronger inconclusive claim": "stronger claim contradicts", "wrong validation track": "exact output validation custody",
    };
    await expect(f.verify()).rejects.toThrow(reasons[label]);
  });

  it("refuses a missing legacy receipt", async () => {
    const f = setup();
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, args) => name === "read_guided_comparison_report_kpi_custody"
      ? { data: null, error: { message: "Receipt missing" } } : original(name, args));
    await expect(f.verify()).rejects.toThrow("legacy KPI receipt");
  });

  it.each(["foreign scope", "changed numeric fingerprint"])("refuses an attestation with %s", async (cause) => {
    const f = setup(); const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args);
      if (name === "read_guided_comparison_report_kpi_custody") {
        if (cause === "foreign scope") result.data.workspace_id = reportId(999);
        else result.data.kpi.value = 999;
      }
      return result;
    });
    await expect(f.verify()).rejects.toThrow(cause === "foreign scope" ? "legacy KPI receipt" : "different KPI value");
  });

  it.each(["retained_inactive", "current_in_progress", "invalid_binding"])("refuses managed ownership %s", async (state) => {
    const f = setup(); f.tables.model_runs[0].attempt_managed = true;
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, args) => name === "read_model_attempt_outputs"
      ? { error: null, data: { run_id: f.runs[0], run_status: "succeeded", outputs: [{ kind: "artifact", ownership_state: state, record: f.outputs[0] }] } } : original(name, args));
    await expect(f.verify()).rejects.toThrow("managed attempt");
  });

  it("detects a KPI change between save and generation and preserves zero", async () => {
    const f = setup(); f.tables.model_run_kpis[0].value = 0;
    const saved = await f.verify();
    expect(saved.payload.results[0].metrics[0].percentDelta).toBeNull();
    f.tables.model_run_kpis[0].value = 1;
    await expect(verifyGuidedComparisonReport({ ...f.input, saved })).rejects.toThrow("saved evidence changed");
  });

  it("pages snapshot discovery and never chooses a default", async () => {
    const f = setup();
    await expect(loadGuidedReportOptions(f.input.client, REPORT_WORKSPACE, REPORT_PROJECT)).resolves.toEqual([{ id: REPORT_SNAPSHOT, projectId: REPORT_PROJECT, label: "Exact saved packet" }]);
    expect(f.db.log.some((query) => query.table === "scenario_comparison_snapshots" && query.range?.[0] === 1)).toBe(true);
  });
});
