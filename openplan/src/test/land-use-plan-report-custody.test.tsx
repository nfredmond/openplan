import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandUsePlanReportPage } from "@/components/reports/land-use-plan-report-page";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
const planId = "22000000-0000-4000-8000-000000000001";
const versionId = "22000000-0000-4000-8000-000000000002";
const reportId = "22000000-0000-4000-8000-000000000003";
const otherId = "22000000-0000-4000-8000-000000000004";
const report = { id: reportId, workspace_id: otherId, land_use_plan_id: planId, title: "SYNTHETIC report title", report_type: "land_use_plan_packet", summary: "Long hash " + "a".repeat(64), generated_at: "2026-10-07" };
let frozen: Record<string, unknown>;
let metadata: Record<string, unknown>;
let rows: Record<string, Record<string, unknown> | null>;
let errors: Record<string, { message: string } | null>;
let queries: Array<{ table: string; projection?: string; filters: Array<[string, unknown]> }>;

beforeEach(() => {
  vi.clearAllMocks();
  frozen = { plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community", title: "SYNTHETIC frozen title", authorityLabel: "SYNTHETIC frozen authority", geographyLabel: "SYNTHETIC frozen geography" },
    version: { id: versionId, versionNumber: 2 }, planContext: syntheticPlanContext(),
    nodes: [{ id: "node", node_kind: "policy", title: "SYNTHETIC retained policy", body: "Retained policy text" }],
    relationships: [], designations: [], implementationActions: [] };
  metadata = { landUsePlanId: planId, versionId, contentHash: hashFrozenRecord(frozen), frozenSnapshot: frozen };
  rows = {
    land_use_plans: { id: planId, title: "SYNTHETIC later title", authority_label: "SYNTHETIC later authority", geography_label: "SYNTHETIC later geography" },
    report_artifacts: { id: "artifact", generated_at: "2026-10-07", metadata_json: metadata },
    land_use_plan_versions: { id: versionId, workspace_id: otherId, plan_id: planId, version_number: 2, state: "adopted", content_hash: hashFrozenRecord(frozen), published_report_id: reportId },
  };
  errors = {}; queries = [];
  mocks.create.mockResolvedValue({ from(table: string) {
    const query: (typeof queries)[number] = { table, filters: [] }; queries.push(query);
    const chain = {
      select(value: string) { query.projection = value; return chain; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
      order() { return chain; }, limit() { return chain; },
      async maybeSingle() { return { data: rows[table] ?? null, error: errors[table] ?? null }; },
    };
    return chain;
  } });
});
const show = async () => render(await LandUsePlanReportPage({ report }));
function rehashArtifact() { metadata.contentHash = hashFrozenRecord(frozen); }
function anchorArtifact() { rehashArtifact(); rows.land_use_plan_versions!.content_hash = metadata.contentHash; }

describe("adopted plan report custody", () => {
  it.each(["adopted", "superseded", "repealed"])("shows the %s recorded identity and context, independent of later labels", async state => {
    rows.land_use_plan_versions!.state = state;
    await show();
    for (const text of ["SYNTHETIC frozen title", "SYNTHETIC frozen authority · SYNTHETIC frozen geography", "Retained policy text", syntheticPlanContext().place.label]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText(/SYNTHETIC later/)).toBeNull();
    expect(screen.getByRole("region", { name: "Context retained with this version" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Download source JSON" })).toHaveAttribute("download", `openplan-report-${reportId}-provenance.json`);
    expect(screen.getByRole("link", { name: "Download source JSON" })).toHaveAttribute("href", `/api/reports/${reportId}/provenance`);
    expect(screen.getByRole("heading", { name: "SYNTHETIC report title" }).closest("header")?.parentElement).toHaveClass("[overflow-wrap:anywhere]");
    expect(queries.find(q => q.table === "land_use_plan_versions")).toEqual({ table: "land_use_plan_versions", projection: "id, workspace_id, plan_id, version_number, state, content_hash, published_report_id", filters: [["id", versionId], ["plan_id", planId], ["workspace_id", otherId]] });
    expect(queries.find(q => q.table === "report_artifacts")?.projection).toBe("id, generated_at, metadata_json");
  });
  it("discloses legacy context absence without substituting current context", async () => {
    delete frozen.planContext; anchorArtifact(); await show();
    expect(screen.getByRole("region", { name: "Context not retained with this version" })).toBeVisible();
    expect(screen.queryByText(syntheticPlanContext().place.label)).toBeNull();
  });
  it.each([
    ["changed artifact", () => { (frozen.plan as Record<string, unknown>).title = "ALTERED frozen title"; }],
    ["self-rehashed artifact", () => { (frozen.plan as Record<string, unknown>).title = "ALTERED frozen title"; rehashArtifact(); }],
    ["wrong artifact plan", () => { metadata.landUsePlanId = otherId; }],
    ["wrong queried plan", () => { rows.land_use_plan_versions!.plan_id = otherId; }],
    ["wrong queried version", () => { rows.land_use_plan_versions!.id = otherId; }],
    ["wrong version number", () => { rows.land_use_plan_versions!.version_number = 3; }],
    ["wrong report pointer", () => { rows.land_use_plan_versions!.published_report_id = otherId; }],
    ["unadopted version", () => { rows.land_use_plan_versions!.state = "public_review"; }],
    ["kind substitution", () => { metadata.kind = "land_use_plan_implementation_report"; }],
    ["invalid retained context", () => { frozen.planContext = { ...syntheticPlanContext(), savedBy: "invalid" }; anchorArtifact(); }],
    ["unreadable native version", () => { errors.land_use_plan_versions = { message: "read failed" }; }],
    ["missing native version", () => { rows.land_use_plan_versions = null; }],
    ["missing version reference", () => { delete metadata.versionId; }],
  ] as const)("withholds %s without rendering retained content", async (_name, mutate) => {
    mutate(); await show();
    expect(screen.getByRole("alert")).toHaveTextContent("does not match its recorded plan version");
    expect(screen.queryByText("Retained policy text")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download source JSON" })).toBeNull();
  });
});
