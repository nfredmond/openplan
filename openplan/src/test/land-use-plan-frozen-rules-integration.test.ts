import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashFrozenRecord, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  queries: [] as Array<{ table: string; projection: string; filters: unknown[][] }>,
  rpc: vi.fn(), access: {} as Record<string, unknown>,
  frozenReadError: false,
  frozenOverride: undefined as Record<string, unknown> | null | undefined,
}));

function from(table: string) {
  const query = { table, projection: "", filters: [] as unknown[][] }; state.queries.push(query);
  const project = (row: Record<string, unknown>, projection: string): Record<string, unknown> => Object.fromEntries(
    projection.split(/,(?![^()]*\))/).map(part => {
      const key = part.trim(), nested = /^(\w+)\((.*)\)$/.exec(key);
      if (!nested) return [key, row[key]];
      const children = row[nested[1]];
      return [nested[1], Array.isArray(children) ? children.map(child => project(child, nested[2])) : children];
    }));
  const data = () => (state.rows[table] ?? []).map(row => project(row, query.projection));
  const chain = {
    select(projection: string) { query.projection = projection; return chain; },
    eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
    order() { return chain; }, limit() { return chain; }, in() { return chain; }, is() { return chain; },
    async maybeSingle() {
      if (table === "land_use_plan_versions" && state.frozenReadError) return { data: null, error: { message: "Synthetic read failure" } };
      if (table === "land_use_plan_versions" && state.frozenOverride !== undefined) return { data: state.frozenOverride ? project(state.frozenOverride, query.projection) : null, error: null };
      return { data: data()[0] ?? null, error: null };
    },
    then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) { return Promise.resolve(resolve({ data: data(), error: null })); },
  };
  return chain;
}
vi.mock("@/lib/land-use-plans/api", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/land-use-plans/api")>();
  return { ...original, loadLandUsePlanAccess: async () => ({ ok: true, access: state.access }) };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: state.rpc }), createClient: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { buildFrozenSnapshot, loadWorkingVersion, type LandUsePlanAccess } from "@/lib/land-use-plans/api";
import { POST } from "@/app/api/land-use-plans/[planId]/decisions/route";
import { GET as detail } from "@/app/api/land-use-plans/[planId]/route";
const planId = "20000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000002";
const documentId = "20000000-0000-4000-8000-000000000003";
const releaseId = "20000000-0000-4000-8000-000000000004";
const workspaceId = "20000000-0000-4000-8000-000000000005";
let snapshot: FrozenPlanContent;

function rehash() {
  const hash = hashFrozenRecord(snapshot);
  state.rows.land_use_plan_versions[0].content_hash = hash;
  state.rows.land_use_plan_review_releases[0].version_content_hash = hash;
  return hash;
}

beforeEach(() => {
  state.frozenReadError = false; state.frozenOverride = undefined;
  state.queries.length = 0; state.rpc.mockReset().mockResolvedValue({ data: "synthetic-decision", error: null });
  snapshot = {
    descriptorSnapshot: structuredClone(getJurisdictionPlanDescriptor("local-unconfigured")!),
    plan: { id: planId, descriptorId: "local-unconfigured", planKindKey: "community", title: "Synthetic plan", authorityLabel: "Synthetic authority", geographyLabel: "Synthetic area" },
    version: { id: versionId, versionNumber: 1, versionKind: "original", basedOnVersionId: null, applicableRequirementKeys: ["locally_defined"] },
    nodes: [], relationships: [], designations: [], implementationActions: [],
  };
  state.access = { userId: documentId, canWrite: true, supabase: { from }, plan: { id: planId, workspace_id: workspaceId,
    descriptor_id: "local-unconfigured", plan_kind_key: "community", title: snapshot.plan.title,
    authority_label: snapshot.plan.authorityLabel, geography_label: snapshot.plan.geographyLabel } };
  state.rows = {
    land_use_plans: [{ plan_context: null, plan_context_hash: null, descriptor_id: "local-unconfigured", plan_kind_key: "community", current_working_version_id: versionId }],
    land_use_plan_versions: [{ id: versionId, plan_id: planId, workspace_id: workspaceId, version_number: 1, state: "public_review", frozen_snapshot: snapshot, published_report_id: null }],
    kb_documents: [{ id: documentId, title: "Synthetic supporting document" }],
    land_use_plan_process_records: [{ process_key: "local_process", status: "complete", due_on: null, completed_on: "2026-10-07", evidence_document_id: documentId }],
    land_use_plan_review_releases: [{ id: releaseId, version_id: versionId, round_number: 1, outcome_snapshot: {}, outcome_hash: "b".repeat(64), closed_at: "2026-10-07T00:00:00Z" }],
  };
  rehash();
});

describe("frozen workbench rules and context", () => {
  const read = () => detail(new NextRequest("http://localhost"), { params: Promise.resolve({ planId }) });

  it("opens a selected historical version read-only while retaining an editable current draft", async () => {
    Object.assign(state.access.plan as object, { current_working_version_id: documentId });
    state.rows.land_use_plan_versions.push({ id: documentId, version_number: 2, state: "working" });
    for (const selected of [undefined, documentId, versionId]) {
      state.queries.length = 0;
      const response = await detail(new NextRequest(`http://localhost${selected ? `?versionId=${selected}` : ""}`), { params: Promise.resolve({ planId }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ activeVersion: { id: selected ?? documentId },
        canWrite: selected !== versionId, isHistoricalVersion: selected === versionId });
      expect(state.queries[0].filters).toEqual([["plan_id", planId]]);
      expect(state.queries.find(query => query.table === "land_use_plan_content_nodes")?.filters).toEqual([["version_id", selected ?? documentId]]);
    }
  });

  it("does not grant write access when the current version is selected by a reader", async () => {
    state.access.canWrite = false;
    const response = await detail(new NextRequest(`http://localhost?versionId=${versionId}`), { params: Promise.resolve({ planId }) });
    expect(await response.json()).toMatchObject({ canWrite: false, isHistoricalVersion: false });
  });

  it("refuses an unavailable version without falling back to the current plan", async () => {
    const response = await detail(new NextRequest(`http://localhost?versionId=${documentId}`), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "The requested version is not available for this plan" });
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].filters).toEqual([["plan_id", planId]]);
  });

  it.each(["", "invalid", `${versionId}&versionId=${versionId}`])("refuses an invalid or repeated version query %s before reading records", async query => {
    const response = await detail(new NextRequest(`http://localhost?versionId=${query}`), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose one valid plan version" });
    expect(state.queries).toHaveLength(0);
  });

  it.each(["public_review", "adopted", "superseded", "repealed"])("reads the saved %s edition independently of current plan identity and installed rules", async stateName => {
    snapshot.descriptorSnapshot!.terminology.plan = "SYNTHETIC reviewed wording";
    snapshot.descriptorSnapshot!.id = "retired-reviewed-edition";
    snapshot.plan.descriptorId = snapshot.descriptorSnapshot!.id;
    snapshot.planContext = syntheticPlanContext(); rehash();
    state.rows.land_use_plan_versions[0].state = stateName;
    Object.assign(state.access.plan as object, { descriptor_id: "removed-current-edition", title: "Later draft title", geography_label: "Later area" });
    const response = await read(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ descriptor: snapshot.descriptorSnapshot, descriptorHash: hashFrozenRecord(snapshot.descriptorSnapshot),
      frozenVersion: { plan: snapshot.plan, descriptorCustody: "frozen", context: { status: "retained", context: snapshot.planContext } },
      plan: { descriptor_id: "removed-current-edition", title: "Later draft title" } });
    const queries = state.queries.filter(query => query.table === "land_use_plan_versions");
    expect(queries[0].projection).not.toContain("frozen_snapshot");
    expect(queries[1].projection.split(", ")).toEqual(["id", "plan_id", "workspace_id", "version_number", "state", "content_hash", "frozen_snapshot"]);
    expect(queries[1].filters).toEqual([["id", versionId], ["plan_id", planId], ["workspace_id", workspaceId]]);
    expect(body.versions[0]).not.toHaveProperty("frozen_snapshot");
  });

  it("labels an unretained historical checklist and context without backfilling them", async () => {
    delete snapshot.descriptorSnapshot; rehash();
    const response = await read(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ descriptor: getJurisdictionPlanDescriptor(snapshot.plan.descriptorId),
      frozenVersion: { descriptorCustody: "not_retained", context: { status: "legacy" } } });
    expect(snapshot).not.toHaveProperty("descriptorSnapshot"); expect(snapshot).not.toHaveProperty("planContext");
  });
  it("keeps reviewed wording and dates when the same family remains installed", async () => {
    snapshot.descriptorSnapshot!.disclosure = "SYNTHETIC reviewed scope";
    snapshot.descriptorSnapshot!.verifiedAt = "2025-01-01"; rehash();
    const response = await read(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ descriptor: snapshot.descriptorSnapshot, descriptorHash: hashFrozenRecord(snapshot.descriptorSnapshot) });
  });

  it("discloses a missing legacy reference without substituting the current plan's descriptor", async () => {
    delete snapshot.descriptorSnapshot; snapshot.plan.descriptorId = "missing-legacy-reference"; rehash();
    const response = await read(); expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This version did not retain a checklist, and its descriptor reference is not installed" });
  });

  it.each(["plan", "version", "number", "rules", "kind", "context", "unhashed-content"])("refuses %s corruption before loading workbench records", async fault => {
    if (fault === "plan") snapshot.plan.id = documentId;
    if (fault === "version") snapshot.version.id = documentId;
    if (fault === "number") snapshot.version.versionNumber = 99;
    if (fault === "rules") snapshot.descriptorSnapshot!.id = "another-family";
    if (fault === "kind") snapshot.plan.planKindKey = "unsupported-kind";
    if (fault === "context") snapshot.planContext = { ...syntheticPlanContext(), savedBy: "invalid" };
    if (fault === "unhashed-content") snapshot.nodes.push({ body: "Changed since review" });
    else rehash();
    expect((await read()).status).toBe(409);
    expect(state.queries.every(query => query.table === "land_use_plan_versions")).toBe(true);
  });

  it.each([null, { id: documentId }, { plan_id: documentId }, { workspace_id: documentId },
    { version_number: 99 }, { state: "working" }, { content_hash: null }, { content_hash: "c".repeat(64) }, { frozen_snapshot: null }])("refuses a missing or changed selected row %j", async patch => {
    state.frozenOverride = patch ? { ...state.rows.land_use_plan_versions[0], ...patch } : null;
    expect((await read()).status).toBe(409);
  });

  it("distinguishes a frozen read failure from a missing record", async () => {
    state.frozenReadError = true;
    const response = await read(); expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load the frozen plan version" });
  });
  it.each(["id", "number", "state"])("binds a self-consistent fresh %s to the version selected by the workbench", async field => {
    if (field === "id") snapshot.version.id = documentId;
    if (field === "number") snapshot.version.versionNumber = 99;
    rehash();
    state.frozenOverride = { ...state.rows.land_use_plan_versions[0],
      id: snapshot.version.id, version_number: snapshot.version.versionNumber, state: field === "state" ? "adopted" : "public_review" };
    expect((await read()).status).toBe(409);
  });
  it("refuses a different valid snapshot returned after selecting the version hash", async () => {
    const changed = structuredClone(snapshot); changed.plan.title = "SYNTHETIC different frozen text";
    state.frozenOverride = { ...state.rows.land_use_plan_versions[0], frozen_snapshot: changed, content_hash: hashFrozenRecord(changed) };
    expect((await read()).status).toBe(409);
  });
  it("refuses an unrecognized version state", async () => {
    state.rows.land_use_plan_versions[0].state = "unrecognized";
    expect((await read()).status).toBe(409);
  });
});

describe("freezing a descriptor with authored content", () => {
  const working = { draft_revision: 7, id: versionId, version_number: 1, version_kind: "original", based_on_version_id: null, applicable_requirement_keys: ["locally_defined"] };
  it("includes the exact descriptor in the returned snapshot and content hash", async () => {
    const result = await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working);
    expect(result?.snapshot.descriptorSnapshot).toEqual(getJurisdictionPlanDescriptor("local-unconfigured"));
    expect(result?.snapshot.version.draftRevision).toBe(7);
    expect(hashFrozenRecord({ ...result?.snapshot, version: { ...result?.snapshot.version, draftRevision: 8 } })).not.toBe(result?.hash);
    expect(result?.hash).toBe(hashFrozenRecord(result?.snapshot));
    const withoutRules = { ...result?.snapshot }; delete withoutRules.descriptorSnapshot;
    expect(hashFrozenRecord(withoutRules)).not.toBe(result?.hash);
  });
  it("loads the edit counter through both working and detail projections", async () => {
    Object.assign(state.access.plan as object, { current_working_version_id: versionId });
    Object.assign(state.rows.land_use_plan_versions[0], working, { state: "working" });
    expect((await loadWorkingVersion(state.access as unknown as LandUsePlanAccess))?.draft_revision).toBe(7);
    expect(state.queries[0].projection.split(", ")).toContain("draft_revision");
    expect(state.queries[0].filters).toEqual([["id", versionId], ["plan_id", planId], ["state", "working"]]);
    const response = await detail(new NextRequest("http://localhost"), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actorId: documentId, frozenVersion: null, plan: { workspace_id: workspaceId },
      descriptorHash: hashFrozenRecord(getJurisdictionPlanDescriptor("local-unconfigured")), activeVersion: { draft_revision: 7 } });
  });
  it("sorts public policy links without mutating rows and retains only projected fields", async () => {
    state.rows.land_use_plan_designations = [{ id: documentId, layer_version_id: releaseId,
      land_use_plan_designation_policy_links: [{ policy_node_id: workspaceId, confidential: "PRIVATE" }, { policy_node_id: versionId, confidential: "PRIVATE" }] }];
    state.rows.workspace_gis_layer_versions = [{ id: releaseId, feature_hash: "a".repeat(64), feature_hash_computed_at: "2026-10-07T00:00:00Z",
      feature_count: 2, bbox: [0, 0, 1, 1], geometry_kinds: ["Polygon"], private_path: "PRIVATE" }];
    const result = await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working);
    expect(result?.snapshot.designations[0]).toMatchObject({ land_use_plan_designation_policy_links: [{ policy_node_id: versionId }, { policy_node_id: workspaceId }],
      layer_version_evidence: { id: releaseId, feature_hash: "a".repeat(64), feature_count: 2 } });
    expect(JSON.stringify(result?.snapshot)).not.toContain("PRIVATE");
    expect(state.rows.land_use_plan_designations[0].land_use_plan_designation_policy_links).toEqual([{ policy_node_id: workspaceId, confidential: "PRIVATE" }, { policy_node_id: versionId, confidential: "PRIVATE" }]);
    expect(state.queries.find(query => query.table === "land_use_plan_designations")?.projection).toContain("land_use_plan_designation_policy_links(policy_node_id)");
  });
  it("does not freeze a plan kind absent from its descriptor", async () => {
    (state.access.plan as Record<string, unknown>).plan_kind_key = "absent";
    expect(await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working)).toBeNull();
    expect(state.queries).toHaveLength(0);
  });
  it("retains exact context and scopes the fresh context read before hashing", async () => {
    const context = syntheticPlanContext();
    Object.assign(state.rows.land_use_plans[0], { plan_context: context, plan_context_hash: "c".repeat(64) });
    const result = await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working);
    expect(result).not.toBeNull();
    expect(result?.snapshot.planContext).toEqual(context);
    expect(result?.hash).toBe(hashFrozenRecord(result?.snapshot));
    expect(hashFrozenRecord({ ...result?.snapshot, planContext: null })).not.toBe(result?.hash);
    const query = state.queries.find(q => q.table === "land_use_plans")!;
    expect(query.projection.split(",")).toEqual(expect.arrayContaining(["plan_context", "plan_context_hash", "descriptor_id", "plan_kind_key", "current_working_version_id"]));
    expect(query.filters).toContainEqual(["id", planId]);
    expect(query.filters).toContainEqual(["workspace_id", workspaceId]);
    context.place.label = "Later draft label";
    expect(result?.snapshot.planContext?.place.label).toBe("SYNTHETIC study area");
  });
  it("retains explicit historical absence without inventing context", async () => {
    const result = await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working);
    expect(result?.snapshot).toHaveProperty("planContext", null);
  });
  it.each(["missing", "malformed", "normalized", "hash", "version", "descriptor", "kind"])("refuses a %s context read before freeze", async fault => {
    const row = state.rows.land_use_plans[0];
    if (fault === "missing") delete row.plan_context;
    if (fault === "malformed") row.plan_context = {};
    if (fault === "normalized") { const context = syntheticPlanContext(); context.place.label = "  Changed by trimming  "; row.plan_context = context; row.plan_context_hash = "c".repeat(64); }
    if (fault === "hash") row.plan_context_hash = "c".repeat(64);
    if (fault === "version") row.current_working_version_id = documentId;
    if (fault === "descriptor") row.descriptor_id = "us-ca-general-plan";
    if (fault === "kind") row.plan_kind_key = "comprehensive";
    expect(await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working)).toBeNull();
  });
});

describe("adoption of the reviewed descriptor", () => {
  async function adopt() {
    const request = new NextRequest("http://localhost/api/land-use-plans/" + planId + "/decisions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "adopt", versionId,
        versionContentHash: state.rows.land_use_plan_versions[0].content_hash, decisionKind: "adoption", decisionBody: "Synthetic body",
        instrumentType: "Synthetic instrument", instrumentIdentifier: "TEST", decidedOn: "2026-10-07", supportingDocumentId: documentId }),
    });
    return POST(request, { params: Promise.resolve({ planId }) });
  }

  it("retains the reviewed rules and their hash in the exact adoption manifest", async () => {
    // A mutable plan descriptor must not override the reviewed version.
    (state.access.plan as Record<string, unknown>).descriptor_id = "us-ca-general-plan";
    const response = await adopt();
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledOnce();
    const payload = state.rpc.mock.calls[0][1];
    expect(payload.p_adoption_manifest.descriptorSnapshot).toEqual(snapshot.descriptorSnapshot);
    expect(payload.p_adoption_manifest.descriptorSha256).toBe(hashFrozenRecord(snapshot.descriptorSnapshot));
    expect(payload.p_adoption_manifest.descriptorCustody).toBe("frozen");
    const query = state.queries.find(q => q.table === "land_use_plan_versions")!;
    expect(query.projection).toContain("version_number"); expect(query.projection).toContain("frozen_snapshot");
    expect(query.filters).toContainEqual(["plan_id", planId]);
  });

  it("retains the exact reviewed context in the adoption manifest", async () => {
    snapshot.planContext = syntheticPlanContext(); rehash();
    const response = await adopt();
    expect(response.status).toBe(200);
    expect(state.rpc.mock.calls[0][1].p_adoption_manifest).toMatchObject({ planContext: snapshot.planContext, planContextCustody: "frozen" });
  });

  it.each(["malformed", "normalized"])("refuses %s context before recording adoption", async fault => {
    const context = syntheticPlanContext();
    if (fault === "malformed") context.savedBy = "unverified";
    else context.place.label = "  Trimmed label  ";
    snapshot.planContext = context; rehash();
    expect((await adopt()).status).toBe(409);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("keeps required recorded process evidence as an adoption gate", async () => {
    state.rows.land_use_plan_process_records = [];
    const response = await adopt();
    expect(response.status).toBe(409);
    expect((await response.json()).missing).toContain("local_process");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("records legacy adoption with an explicitly current, unretained descriptor reference", async () => {
    delete snapshot.descriptorSnapshot; rehash();
    const response = await adopt();
    expect(response.status).toBe(200);
    const manifest = state.rpc.mock.calls[0][1].p_adoption_manifest;
    expect(manifest.descriptorCustody).toBe("current_reference_not_retained_at_review");
    expect(manifest.descriptorSnapshot).toEqual(getJurisdictionPlanDescriptor("local-unconfigured"));
    expect(manifest.planContext).toBeNull();
    expect(manifest.planContextCustody).toBe("not_retained");
    expect(snapshot).not.toHaveProperty("descriptorSnapshot");
  });

  it("requires reassessment when the installed descriptor differs from the saved one", async () => {
    snapshot.descriptorSnapshot!.processSteps[0].label = "Original source edition"; rehash();
    const response = await adopt();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("installed descriptor differs");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed saved checklist instead of reconstructing it for adoption", async () => {
    snapshot.descriptorSnapshot!.id = "another-descriptor"; rehash();
    const response = await adopt();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("saved checklist is malformed");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(["plan", "version", "number", "bytes"])("refuses substituted frozen %s before adoption", async fault => {
    if (fault === "plan") snapshot.plan.id = documentId;
    if (fault === "version") snapshot.version.id = documentId;
    if (fault === "number") snapshot.version.versionNumber = 2;
    if (fault === "bytes") snapshot.plan.title = "Changed retained content";
    else rehash();
    const response = await adopt();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("content or identity could not be verified");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
