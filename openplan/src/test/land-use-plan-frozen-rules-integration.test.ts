import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashFrozenRecord, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  queries: [] as Array<{ table: string; projection: string; filters: unknown[][] }>,
  rpc: vi.fn(), access: {} as Record<string, unknown>,
}));

function from(table: string) {
  const query = { table, projection: "", filters: [] as unknown[][] }; state.queries.push(query);
  const data = () => (state.rows[table] ?? []).map(row => Object.fromEntries(query.projection.split(",").map(key => key.trim()).map(key => [key, row[key]])));
  const chain = {
    select(projection: string) { query.projection = projection; return chain; },
    eq(key: string, value: unknown) { query.filters.push([key, value]); return chain; },
    order() { return chain; }, limit() { return chain; },
    async maybeSingle() { return { data: data()[0] ?? null, error: null }; },
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

import { buildFrozenSnapshot, type LandUsePlanAccess } from "@/lib/land-use-plans/api";
import { POST } from "@/app/api/land-use-plans/[planId]/decisions/route";
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
    land_use_plan_versions: [{ id: versionId, version_number: 1, state: "public_review", frozen_snapshot: snapshot, published_report_id: null }],
    kb_documents: [{ id: documentId, title: "Synthetic supporting document" }],
    land_use_plan_process_records: [{ process_key: "local_process", status: "complete", due_on: null, completed_on: "2026-10-07", evidence_document_id: documentId }],
    land_use_plan_review_releases: [{ id: releaseId, version_id: versionId, round_number: 1, outcome_snapshot: {}, outcome_hash: "b".repeat(64), closed_at: "2026-10-07T00:00:00Z" }],
  };
  rehash();
});

describe("freezing a descriptor with authored content", () => {
  const working = { id: versionId, version_number: 1, version_kind: "original", based_on_version_id: null, applicable_requirement_keys: ["locally_defined"] };
  it("includes the exact descriptor in the returned snapshot and content hash", async () => {
    const result = await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working);
    expect(result?.snapshot.descriptorSnapshot).toEqual(getJurisdictionPlanDescriptor("local-unconfigured"));
    expect(result?.hash).toBe(hashFrozenRecord(result?.snapshot));
    const withoutRules = { ...result?.snapshot }; delete withoutRules.descriptorSnapshot;
    expect(hashFrozenRecord(withoutRules)).not.toBe(result?.hash);
  });
  it("does not freeze a plan kind absent from its descriptor", async () => {
    (state.access.plan as Record<string, unknown>).plan_kind_key = "absent";
    expect(await buildFrozenSnapshot(state.access as unknown as LandUsePlanAccess, working)).toBeNull();
    expect(state.queries).toHaveLength(0);
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
