import { render, screen, within } from "@testing-library/react";
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
let manifest: Record<string, unknown>;
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
  manifest = { planId, versionId, versionContentHash: metadata.contentHash, reviewReleaseId: otherId,
    decision: { kind: "amendment", body: "SYNTHETIC recorded decision body", instrumentType: "SYNTHETIC resolution", instrumentIdentifier: "TEST-2", vote: "SYNTHETIC no actual vote", decidedOn: "2026-10-07", effectiveOn: "2026-10-08" },
    supportingDocuments: [{ id: "doc", title: "Retained synthetic document" }],
  };
  metadata.adoptionManifest = manifest; metadata.adoptionManifestHash = "a".repeat(64); metadata.reviewReleaseId = otherId;
  rows.land_use_plan_decisions = { plan_id: planId, version_id: versionId, version_content_hash: metadata.contentHash, review_release_id: otherId, adoption_manifest: structuredClone(manifest), adoption_manifest_hash: metadata.adoptionManifestHash };
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

const native = () => rows.land_use_plan_decisions!;
const decision = () => manifest.decision as Record<string, unknown>;
const anchorDecision = () => { native().adoption_manifest = structuredClone(manifest); };

describe("adopted report retained decision and relationships", () => {
  it.each(["adopted", "superseded", "repealed"])("renders the retained decision for %s editions", async state => {
    rows.land_use_plan_versions!.state = state;
    await show();
    const section = within(screen.getByRole("region", { name: "Recorded adoption decision" }));
    for (const value of ["SYNTHETIC recorded decision body", "amendment", "SYNTHETIC resolution TEST-2", "2026-10-07", "2026-10-08", "SYNTHETIC no actual vote"]) expect(section.getByText(value)).toBeVisible();
    expect(section.queryByRole("alert")).toBeNull();
    expect(queries.find(q => q.table === "land_use_plan_decisions")).toEqual({ table: "land_use_plan_decisions", projection: "plan_id, version_id, version_content_hash, review_release_id, adoption_manifest, adoption_manifest_hash", filters: [["plan_id", planId], ["version_id", versionId], ["adoption_manifest_hash", "a".repeat(64)]] });
  });
  it("accepts reordered native keys without replacing the retained record", async () => {
    native().adoption_manifest = Object.fromEntries(Object.entries(manifest).reverse());
    await show(); expect(screen.getByText("SYNTHETIC recorded decision body")).toBeVisible();
  });
  it("labels missing vote and effective date without inventing them", async () => {
    decision().vote = null; decision().effectiveOn = null; anchorDecision();
    await show();
    expect(within(screen.getByRole("region", { name: "Recorded adoption decision" })).getAllByText("Not recorded")).toHaveLength(2);
  });
  it("discloses a legacy record that was not retained without querying a later decision", async () => {
    delete metadata.adoptionManifest; delete metadata.adoptionManifestHash;
    await show();
    expect(screen.getByText(/This report did not retain an adoption record/)).toBeVisible();
    expect(queries.some(q => q.table === "land_use_plan_decisions")).toBe(false);
    expect(screen.getByText("Retained policy text")).toBeVisible();
  });
  it.each([
    ["changed artifact decision", () => { decision().body = "ALTERED decision"; }],
    ["changed ancillary evidence", () => { manifest.supportingDocuments = []; }],
    ["wrong native plan", () => { native().plan_id = otherId; }],
    ["wrong native version", () => { native().version_id = otherId; }],
    ["wrong native content hash", () => { native().version_content_hash = "b".repeat(64); }],
    ["wrong native manifest hash", () => { native().adoption_manifest_hash = "b".repeat(64); }],
    ["wrong native review release", () => { native().review_release_id = planId; }],
    ["wrong manifest plan", () => { manifest.planId = otherId; anchorDecision(); }],
    ["wrong manifest version", () => { manifest.versionId = otherId; anchorDecision(); }],
    ["wrong manifest content hash", () => { manifest.versionContentHash = "b".repeat(64); anchorDecision(); }],
    ["wrong artifact review release", () => { metadata.reviewReleaseId = planId; }],
    ["invalid decision shape", () => { decision().decidedOn = "not-a-date"; anchorDecision(); }],
    ["invalid manifest hash", () => { metadata.adoptionManifestHash = "not-a-hash"; native().adoption_manifest_hash = "not-a-hash"; }],
    ["manifest without hash", () => { delete metadata.adoptionManifestHash; }],
    ["hash without manifest", () => { delete metadata.adoptionManifest; }],
    ["missing native decision", () => { rows.land_use_plan_decisions = null; }],
    ["unreadable native decision", () => { errors.land_use_plan_decisions = { message: "read failed" }; }],
  ] as const)("withholds %s and preserves separately verified plan content", async (_name, mutate) => {
    mutate(); await show();
    expect(screen.getByRole("alert")).toHaveTextContent("adoption record could not be verified");
    expect(screen.queryByText("SYNTHETIC recorded decision body")).toBeNull();
    expect(screen.queryByText("ALTERED decision")).toBeNull();
    expect(screen.getByText("Retained policy text")).toBeVisible();
  });
  it("renders related plan labels, relation and notes from the verified snapshot", async () => {
    frozen.relationships = [{ id: "relationship", related_plan_label: "SYNTHETIC predecessor", relationship_kind: "supersedes", notes: "SYNTHETIC related plan note" }];
    anchorArtifact(); manifest.versionContentHash = metadata.contentHash; native().version_content_hash = metadata.contentHash; anchorDecision();
    await show();
    const section = within(screen.getByRole("region", { name: "Related plans retained with this version" }));
    expect(section.getByRole("heading", { name: "SYNTHETIC predecessor" })).toBeVisible();
    expect(section.getByText("Relationship recorded as: supersedes")).toBeVisible();
    expect(section.getByText("SYNTHETIC related plan note")).toBeVisible();
    expect(section.queryByRole("link")).toBeNull();
  });
  it("distinguishes an empty retained relationship list from missing information", async () => {
    await show();
    expect(screen.getByText("No related-plan references were retained with this version.")).toBeVisible();
  });
  it("does not infer labels or kinds for incomplete retained relationships", async () => {
    frozen.relationships = [{ id: "incomplete" }]; anchorArtifact(); manifest.versionContentHash = metadata.contentHash; native().version_content_hash = metadata.contentHash; anchorDecision();
    await show();
    expect(screen.getByText("Related plan label not recorded")).toBeVisible();
    expect(screen.getByText("Relationship recorded as: not recorded")).toBeVisible();
  });
});
