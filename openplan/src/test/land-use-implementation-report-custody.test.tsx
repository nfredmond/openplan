import { createHash } from "node:crypto";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandUsePlanReportPage } from "@/components/reports/land-use-plan-report-page";
import { loadImplementationReportSnapshot } from "@/lib/land-use-plans/implementation-report-snapshot";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
const planId = "23000000-0000-4000-8000-000000000001";
const versionId = "23000000-0000-4000-8000-000000000002";
const reportId = "23000000-0000-4000-8000-000000000003";
const workspaceId = "23000000-0000-4000-8000-000000000004";
const otherId = "23000000-0000-4000-8000-000000000005";
const report = { id: reportId, workspace_id: workspaceId, land_use_plan_id: planId, title: "SYNTHETIC implementation report", report_type: "land_use_plan_implementation_report", summary: "SYNTHETIC later report summary", generated_at: "2026-10-07" };
let frozen: Record<string, unknown>;
let snapshot: Record<string, unknown>;
let metadata: Record<string, unknown>;
let rows: Record<string, Record<string, unknown> | null>;
let errors: Record<string, { message: string } | null>;
let queries: Array<{ table: string; projection?: string; filters: Array<[string, unknown]> }>;
const action = () => (snapshot.actions as Array<Record<string, unknown>>)[0];
const native = () => rows.land_use_plan_implementation_reports!;
const version = () => rows.land_use_plan_versions!;
function anchor() {
  metadata.contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  native().content_hash = metadata.contentHash;
  native().action_status_snapshot = structuredClone(snapshot.actions);
}

beforeEach(() => {
  vi.clearAllMocks();
  frozen = { plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community", title: "SYNTHETIC adopted title", authorityLabel: "SYNTHETIC adopted authority", geographyLabel: "SYNTHETIC adopted geography" },
    version: { id: versionId, versionNumber: 2 }, planContext: syntheticPlanContext(), nodes: [], relationships: [], designations: [], implementationActions: [{ title: "OLD frozen action", status: "not_started" }] };
  snapshot = { planId, adoptedVersionId: versionId, adoptedVersionContentHash: hashFrozenRecord(frozen), reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-09-30",
    actions: [{ id: otherId, title: "SYNTHETIC saved action", description: "Retained implementation detail", responsible_party: "SYNTHETIC responsible team", due_on: "2026-12-01", status: "completed", project_id: null, program_id: null, evidence_document_id: null, updated_at: "2026-09-29T12:34:56+00:00" }] };
  metadata = { kind: "land_use_plan_implementation_report", landUsePlanId: planId, contentHash: "", snapshot, summary: "SYNTHETIC retained summary" };
  rows = {
    land_use_plans: { id: planId, title: "SYNTHETIC later title", authority_label: "SYNTHETIC later authority", geography_label: "SYNTHETIC later geography" },
    report_artifacts: { id: "artifact", generated_at: "2026-10-07", metadata_json: metadata },
    land_use_plan_implementation_reports: { id: otherId, workspace_id: workspaceId, plan_id: planId, adopted_version_id: versionId, reporting_period_start: "2026-01-01", reporting_period_end: "2026-09-30", summary: metadata.summary, content_hash: "", report_id: reportId },
    land_use_plan_versions: { id: versionId, workspace_id: workspaceId, plan_id: planId, version_number: 2, state: "adopted", content_hash: hashFrozenRecord(frozen), frozen_snapshot: frozen },
  };
  anchor(); errors = {}; queries = [];
  mocks.create.mockResolvedValue({ from(table: string) {
    const query: (typeof queries)[number] = { table, filters: [] }; queries.push(query);
    const chain = {
      select(value: string) { query.projection = value; return chain; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      order() { return chain; }, limit() { return chain; },
      async maybeSingle() { return { data: rows[table] ?? null, error: errors[table] ?? null }; },
    }; return chain;
  } });
});
const show = async () => render(await LandUsePlanReportPage({ report }));

describe("implementation report retains verified history", () => {
  it.each(["wrong report kind", "missing plan"])("refuses %s before native reads", async kind => {
    const input = kind === "wrong report kind" ? { ...report, report_type: "land_use_plan_packet" } : { ...report, land_use_plan_id: null };
    expect(await loadImplementationReportSnapshot(await mocks.create(), input, metadata)).toBeNull();
    expect(queries).toEqual([]);
  });
  it.each(["adopted", "superseded", "repealed"])("reads the %s edition and exact saved statuses", async state => {
    version().state = state; await show();
    for (const text of ["SYNTHETIC adopted title", "SYNTHETIC adopted authority · SYNTHETIC adopted geography", "SYNTHETIC saved action", "Retained implementation detail", "SYNTHETIC retained summary", "SYNTHETIC responsible team", "2026-09-29T12:34:56+00:00", "2026-01-01 through 2026-09-30", syntheticPlanContext().place.label]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(/Status: completed/)).toHaveTextContent("due 2026-12-01");
    expect(screen.queryByText(/SYNTHETIC later/)).toBeNull();
    expect(screen.queryByText("OLD frozen action")).toBeNull();
    expect(screen.getByRole("link", { name: "Download source JSON" })).toHaveAttribute("href", `/api/reports/${reportId}/provenance`);
    expect(queries.find(q => q.table === "land_use_plan_implementation_reports")).toEqual({ table: "land_use_plan_implementation_reports", projection: "id, workspace_id, plan_id, adopted_version_id, reporting_period_start, reporting_period_end, summary, action_status_snapshot, content_hash, report_id", filters: [["report_id", reportId], ["plan_id", planId], ["workspace_id", workspaceId]] });
    expect(queries.find(q => q.table === "land_use_plan_versions")).toEqual({ table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, frozen_snapshot", filters: [["id", versionId], ["plan_id", planId], ["workspace_id", workspaceId]] });
    expect(queries.map(q => q.table)).toEqual(["land_use_plans", "report_artifacts", "land_use_plan_implementation_reports", "land_use_plan_versions"]);
  });
  it("accepts jsonb key reordering without inventing a new historical hash", async () => {
    metadata.snapshot = Object.fromEntries(Object.entries(snapshot).reverse());
    native().action_status_snapshot = [Object.fromEntries(Object.entries(action()).reverse())];
    await show(); expect(screen.getByText("SYNTHETIC saved action")).toBeVisible();
  });
  it("discloses absent legacy context without using current context", async () => {
    delete frozen.planContext; version().content_hash = hashFrozenRecord(frozen); snapshot.adoptedVersionContentHash = version().content_hash; anchor();
    await show(); expect(screen.getByRole("region", { name: "Context not retained with this version" })).toBeVisible();
    expect(screen.queryByText(syntheticPlanContext().place.label)).toBeNull();
  });
  it("uses saved reporting dates for an absent summary and distinguishes no actions", async () => {
    metadata.summary = null; native().summary = null; snapshot.actions = []; anchor(); await show();
    expect(screen.getByText("Implementation status for 2026-01-01 through 2026-09-30.")).toBeVisible();
    expect(screen.getByText("No implementation actions were present in this frozen report.")).toBeVisible();
  });
  it("labels an unspecified responsible party without supplying one", async () => {
    action().responsible_party = null; anchor(); await show(); expect(screen.getByText("Not specified")).toBeVisible();
  });
  it.each([
    ["wrong kind", () => { metadata.kind = "land_use_plan_packet"; }],
    ["wrong artifact plan", () => { metadata.landUsePlanId = otherId; }],
    ["missing snapshot", () => { delete metadata.snapshot; }],
    ["invalid content hash", () => { metadata.contentHash = "invalid"; native().content_hash = "invalid"; }],
    ["changed artifact hash", () => { metadata.contentHash = "a".repeat(64); }],
    ["wrong snapshot plan", () => { snapshot.planId = otherId; }],
    ["wrong snapshot version", () => { snapshot.adoptedVersionId = otherId; }],
    ["wrong adopted hash", () => { snapshot.adoptedVersionContentHash = "b".repeat(64); }],
    ["changed artifact action", () => { action().status = "deferred"; }],
    ["changed artifact owner", () => { action().responsible_party = "ALTERED"; }],
    ["changed artifact summary", () => { metadata.summary = "ALTERED"; }],
    ["changed reporting start", () => { snapshot.reportingPeriodStart = "2026-01-02"; }],
    ["changed reporting end", () => { snapshot.reportingPeriodEnd = "2026-10-01"; }],
    ["inverted reporting dates", () => { snapshot.reportingPeriodStart = "2026-10-01"; native().reporting_period_start = "2026-10-01"; anchor(); }],
    ["invalid status", () => { action().status = "unsupported"; anchor(); }],
    ["invalid update time", () => { action().updated_at = "unknown"; anchor(); }],
    ["missing actions", () => { delete snapshot.actions; anchor(); }],
    ["private extra field", () => { action().confidential_notes = "PRIVATE"; anchor(); }],
    ["unreadable register", () => { errors.land_use_plan_implementation_reports = { message: "unavailable" }; }],
    ["missing register", () => { rows.land_use_plan_implementation_reports = null; }],
    ["wrong registered report", () => { native().report_id = otherId; }],
    ["wrong registered plan", () => { native().plan_id = otherId; }],
    ["wrong registered workspace", () => { native().workspace_id = otherId; }],
    ["wrong native version", () => { version().id = otherId; }],
    ["wrong native plan", () => { version().plan_id = otherId; }],
    ["wrong native workspace", () => { version().workspace_id = otherId; }],
    ["unadopted version", () => { version().state = "working"; }],
    ["unreadable version", () => { errors.land_use_plan_versions = { message: "unavailable" }; }],
    ["missing version", () => { rows.land_use_plan_versions = null; }],
    ["changed native snapshot", () => { (frozen.plan as Record<string, unknown>).title = "ALTERED"; }],
    ["wrong native version number", () => { version().version_number = 3; }],
    ["invalid frozen context", () => { frozen.planContext = { ...syntheticPlanContext(), savedBy: "invalid" }; version().content_hash = hashFrozenRecord(frozen); snapshot.adoptedVersionContentHash = version().content_hash; anchor(); }],
  ] as const)("withholds %s without substituting live values", async (_name, change) => {
    change(); await show();
    expect(screen.getByRole("alert")).toHaveTextContent("does not match its implementation history and adopted plan version");
    expect(screen.getByRole("alert")).toHaveTextContent("This does not establish whether the agency completed any action.");
    for (const value of ["SYNTHETIC saved action", "SYNTHETIC adopted title", "SYNTHETIC later title", "ALTERED", "PRIVATE"]) expect(screen.queryByText(value)).toBeNull();
    expect(screen.queryByRole("link", { name: "Download source JSON" })).toBeNull();
  });
});
