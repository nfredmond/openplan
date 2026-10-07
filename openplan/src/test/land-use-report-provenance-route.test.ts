import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/reports/[reportId]/provenance/route";
import { REPORT_ACCESS_COLUMNS } from "@/lib/reports/api";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn() }) }));
const id = (n: number) => `34000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [reportId, planId, versionId, workspaceId, userId, releaseId, otherId] = Array.from({ length: 7 }, (_, n) => id(n + 1));
let rows: Record<string, Record<string, unknown> | null>;
let errors: Record<string, { message: string }>;
let user: { id: string } | null;
let authError: { message: string } | null;
let metadata: Record<string, unknown>;
let frozen: Record<string, unknown>;
let manifest: Record<string, unknown>;
let snapshot: Record<string, unknown>;
let queries: Array<{ table: string; projection?: string; filters: Array<[string, unknown]>; order?: [string, unknown]; limit?: number }>;
const request = (value = reportId) => GET(new NextRequest(`http://localhost/api/reports/${value}/provenance`), { params: Promise.resolve({ reportId: value }) });

beforeEach(() => {
  vi.clearAllMocks();
  frozen = { plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community", title: "SYNTHETIC adopted plan", authorityLabel: "SYNTHETIC authority", geographyLabel: "SYNTHETIC area" },
    version: { id: versionId, versionNumber: 2 }, nodes: [], relationships: [], designations: [], implementationActions: [] };
  manifest = { planId, versionId, versionContentHash: hashFrozenRecord(frozen), reviewReleaseId: releaseId,
    decision: { kind: "adoption", body: "SYNTHETIC council", instrumentType: "SYNTHETIC resolution", instrumentIdentifier: "TEST-1", vote: null, decidedOn: "2026-10-07", effectiveOn: null }, supportingDocuments: [] };
  metadata = { landUsePlanId: planId, versionId, contentHash: hashFrozenRecord(frozen), frozenSnapshot: frozen,
    adoptionManifest: manifest, adoptionManifestHash: "a".repeat(64), reviewReleaseId: releaseId };
  rows = {
    reports: { id: reportId, workspace_id: workspaceId, land_use_plan_id: planId, report_type: "land_use_plan_packet", title: "SYNTHETIC report" },
    workspace_members: { workspace_id: workspaceId, role: "viewer" },
    report_artifacts: { id: id(8), artifact_kind: "html", generated_at: "2026-10-07T00:00:00Z", metadata_json: metadata },
    land_use_plan_versions: { id: versionId, workspace_id: workspaceId, plan_id: planId, version_number: 2, state: "adopted", content_hash: metadata.contentHash, published_report_id: reportId, frozen_snapshot: frozen },
    land_use_plan_decisions: { plan_id: planId, version_id: versionId, version_content_hash: metadata.contentHash, review_release_id: releaseId, adoption_manifest: structuredClone(manifest), adoption_manifest_hash: metadata.adoptionManifestHash },
  };
  errors = {}; queries = []; user = { id: userId }; authError = null;
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: authError }) }, from(table: string) {
    const query: (typeof queries)[number] = { table, filters: [] }; queries.push(query);
    const chain = {
      select(value: string) { query.projection = value; return chain; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      order(key: string, options: unknown) { query.order = [key, options]; return chain; },
      limit(value: number) { query.limit = value; return chain; },
      async maybeSingle() { return { data: rows[table] ?? null, error: errors[table] ?? null }; },
    }; return chain;
  } });
});

function implementation() {
  rows.reports!.report_type = "land_use_plan_implementation_report";
  snapshot = { planId, adoptedVersionId: versionId, adoptedVersionContentHash: hashFrozenRecord(frozen), reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-10-07",
    actions: [{ id: otherId, title: "SYNTHETIC saved action", description: null, responsible_party: "SYNTHETIC staff", due_on: null, status: "not_started", project_id: null, program_id: null, evidence_document_id: null, updated_at: "2026-10-06T12:00:00+00:00" }] };
  metadata = { kind: "land_use_plan_implementation_report", landUsePlanId: planId, contentHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), snapshot, summary: null };
  rows.report_artifacts!.metadata_json = metadata;
  rows.land_use_plan_implementation_reports = { id: id(9), workspace_id: workspaceId, plan_id: planId, adopted_version_id: versionId, reporting_period_start: "2026-01-01", reporting_period_end: "2026-10-07", summary: null,
    action_status_snapshot: structuredClone(snapshot.actions), content_hash: metadata.contentHash, report_id: reportId };
}
async function refusal(status = 503) {
  const response = await request(); expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  const body = await response.json(); expect(Object.keys(body)).toEqual(["error"]);
  expect(JSON.stringify(body)).not.toMatch(/SYNTHETIC|ALTERED|PRIVATE/);
  return response;
}

describe("direct report source download", () => {
  it.each(["adopted", "superseded", "repealed"])("downloads the retained %s plan and complete decision", async state => {
    rows.land_use_plan_versions!.state = state;
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: rows.reports, artifact: rows.report_artifacts });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="openplan-report-${reportId}-provenance.json"`);
    expect(queries).toEqual([
      { table: "reports", projection: REPORT_ACCESS_COLUMNS, filters: [["id", reportId]] },
      { table: "workspace_members", projection: "workspace_id, role", filters: [["workspace_id", workspaceId], ["user_id", userId]] },
      { table: "report_artifacts", projection: "id, artifact_kind, generated_at, metadata_json", filters: [["report_id", reportId]], order: ["generated_at", { ascending: false }], limit: 1 },
      { table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, published_report_id", filters: [["id", versionId], ["plan_id", planId], ["workspace_id", workspaceId]] },
      { table: "land_use_plan_decisions", projection: "plan_id, version_id, version_content_hash, review_release_id, adoption_manifest, adoption_manifest_hash", filters: [["plan_id", planId], ["version_id", versionId], ["adoption_manifest_hash", "a".repeat(64)]] },
    ]);
  });
  it("downloads legacy content without inventing absent adoption details", async () => {
    delete metadata.adoptionManifest; delete metadata.adoptionManifestHash; delete metadata.reviewReleaseId;
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: rows.reports, artifact: rows.report_artifacts });
    expect(queries.some(q => q.table === "land_use_plan_decisions")).toBe(false);
  });
  it("accepts harmless native JSON key reordering", async () => {
    rows.land_use_plan_decisions!.adoption_manifest = Object.fromEntries(Object.entries(manifest).reverse());
    expect((await request()).status).toBe(200);
  });
  it.each(["adopted", "superseded", "repealed"])("downloads saved statuses for a %s edition without current action reads", async state => {
    implementation(); rows.land_use_plan_versions!.state = state;
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: rows.reports, artifact: rows.report_artifacts });
    expect(queries.map(q => q.table)).toEqual(["reports", "workspace_members", "report_artifacts", "land_use_plan_implementation_reports", "land_use_plan_versions"]);
    expect(queries[3]).toEqual({ table: "land_use_plan_implementation_reports", projection: "id, workspace_id, plan_id, adopted_version_id, reporting_period_start, reporting_period_end, summary, action_status_snapshot, content_hash, report_id", filters: [["report_id", reportId], ["plan_id", planId], ["workspace_id", workspaceId]] });
    expect(queries[4]).toEqual({ table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, frozen_snapshot", filters: [["id", versionId], ["plan_id", planId], ["workspace_id", workspaceId]] });
  });
  it.each([
    ["missing register", () => { rows.land_use_plan_implementation_reports = null; }],
    ["register read failure", () => { errors.land_use_plan_implementation_reports = { message: "PRIVATE failure" }; }],
    ["changed saved status", () => { (snapshot.actions as Record<string, unknown>[])[0].status = "completed"; }],
    ["changed registered workspace", () => { rows.land_use_plan_implementation_reports!.workspace_id = otherId; }],
    ["changed retained adopted content", () => { (frozen.plan as Record<string, unknown>).title = "ALTERED"; }],
  ] as const)("withholds implementation download with %s", async (_label, change) => {
    implementation(); change(); expect((await refusal()).headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    ["plan link alone", () => { rows.reports!.report_type = "project_report"; rows.report_artifacts!.metadata_json = {}; }],
    ["plan type alone", () => { rows.reports!.land_use_plan_id = null; rows.report_artifacts!.metadata_json = {}; }],
    ["implementation type alone", () => { rows.reports!.report_type = "land_use_plan_implementation_report"; rows.reports!.land_use_plan_id = null; rows.report_artifacts!.metadata_json = {}; }],
    ["missing plan link", () => { rows.reports!.land_use_plan_id = null; }],
    ["wrong kind with plan link", () => { rows.reports!.report_type = "project_report"; }],
    ["wrong kind with artifact plan", () => { rows.reports!.report_type = "project_report"; rows.reports!.land_use_plan_id = null; }],
    ["wrong kind with artifact kind", () => { rows.reports!.report_type = "project_report"; rows.reports!.land_use_plan_id = null; delete metadata.landUsePlanId; metadata.kind = "land_use_plan_implementation_report"; }],
    ["wrong report pointer", () => { rows.land_use_plan_versions!.published_report_id = otherId; }],
    ["changed plan content", () => { (frozen.plan as Record<string, unknown>).title = "ALTERED"; }],
    ["unreadable version", () => { errors.land_use_plan_versions = { message: "PRIVATE" }; }],
    ["missing decision", () => { rows.land_use_plan_decisions = null; }],
    ["unreadable decision", () => { errors.land_use_plan_decisions = { message: "PRIVATE" }; }],
    ["changed retained decision", () => { (manifest.decision as Record<string, unknown>).body = "ALTERED"; }],
    ["changed ancillary evidence", () => { manifest.supportingDocuments = [{ title: "ALTERED" }]; }],
    ["absent manifest hash", () => { delete metadata.adoptionManifestHash; }],
    ["absent manifest", () => { delete metadata.adoptionManifest; }],
    ["array metadata", () => { rows.report_artifacts!.metadata_json = [metadata]; }],
    ["missing metadata", () => { rows.report_artifacts!.metadata_json = null; }],
  ] as const)("withholds adoption download with %s", async (_label, change) => { change(); await refusal(); });
  it.each([
    ["signed out", 401, () => { user = null; }],
    ["failed authentication with user present", 401, () => { authError = { message: "PRIVATE" }; }],
    ["report error", 500, () => { errors.reports = { message: "PRIVATE" }; }],
    ["missing report", 404, () => { rows.reports = null; }],
    ["membership error", 500, () => { errors.workspace_members = { message: "PRIVATE" }; }],
    ["missing membership", 403, () => { rows.workspace_members = null; }],
    ["unrecognized role", 403, () => { rows.workspace_members!.role = "outsider"; }],
    ["artifact error", 500, () => { errors.report_artifacts = { message: "PRIVATE" }; }],
    ["missing artifact", 404, () => { rows.report_artifacts = null; }],
  ] as const)("withholds %s before retained content reads", async (_label, status, change) => {
    change(); await refusal(status); expect(queries.some(q => q.table.startsWith("land_use_plan"))).toBe(false);
  });
  it("rejects invalid report id before opening a client", async () => {
    expect((await request("invalid")).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves unrelated report downloads without land-use reads", async () => {
    rows.reports!.report_type = "project_report"; rows.reports!.land_use_plan_id = null;
    rows.report_artifacts!.metadata_json = { sources: ["SYNTHETIC project source"] };
    const response = await request(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: rows.reports, artifact: rows.report_artifacts });
    expect(queries.map(q => q.table)).toEqual(["reports", "workspace_members", "report_artifacts"]);
  });
});
