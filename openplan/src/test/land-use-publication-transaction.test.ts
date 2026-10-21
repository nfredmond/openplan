import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashFrozenRecord, serializeFrozenRecord } from "@/lib/land-use-plans/versioning";

const state = vi.hoisted(() => ({ rpc: vi.fn(), load: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: state.load }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { publishAdoptedPlan, PlanPublicationError } from "@/lib/land-use-plans/publication";
import { POST } from "@/app/api/land-use-plans/[planId]/decisions/route";
import { createServiceRoleClient } from "@/lib/supabase/server";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const planId = "20000000-0000-4000-8000-000000000002";
const actorId = "30000000-0000-4000-8000-000000000003";
const versionId = "40000000-0000-4000-8000-000000000004";
const reportId = "50000000-0000-4000-8000-000000000005";
const artifactId = "60000000-0000-4000-8000-000000000006";
const otherId = "70000000-0000-4000-8000-000000000007";
const snapshot = {
  plan: { id: planId, title: "Retained plan", descriptorId: "reference", planKindKey: "comprehensive_plan",
    authorityLabel: "Recorded authority", geographyLabel: "Recorded study place" },
  version: { id: versionId, versionNumber: 1 }, nodes: [], relationships: [], designations: [], implementationActions: [],
};
const contentHash = hashFrozenRecord(snapshot);
const scope = { workspaceId, planId, actorId, versionId, versionNumber: 1, contentHash, title: "Adopted packet" };
const result = { workspaceId, planId, versionId, contentHash, reportId, artifactId, title: scope.title, alreadyPublished: false };

beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: state.select, eq: state.eq, maybeSingle: state.maybeSingle };
  state.from.mockReturnValue(query); state.select.mockReturnValue(query); state.eq.mockReturnValue(query);
  state.maybeSingle.mockResolvedValue({ data: { id: versionId, version_number: 1, state: "adopted", content_hash: contentHash,
    frozen_snapshot: snapshot, published_report_id: null }, error: null });
  state.load.mockResolvedValue({ ok: true, access: { plan: { id: planId, workspace_id: workspaceId }, userId: actorId,
    supabase: { from: state.from } } });
  state.rpc.mockResolvedValue({ data: result, error: null });
});

async function publicationFailure(input: typeof scope, value: unknown = snapshot) {
  try { await publishAdoptedPlan(createServiceRoleClient(), input, value); return null; }
  catch (error) {
    if (!(error instanceof PlanPublicationError)) throw error;
    return error;
  }
}

function request() {
  return new NextRequest(`http://localhost/api/land-use-plans/${planId}/decisions`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "publish", versionId, versionContentHash: contentHash, title: scope.title }) });
}

describe("atomic adopted plan publication boundary", () => {
  it("sends exact scope and established frozen bytes to one RPC", async () => {
    expect(await publishAdoptedPlan(createServiceRoleClient(), scope, snapshot)).toEqual(result);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("publish_land_use_plan_version", {
      p_workspace_id: workspaceId, p_plan_id: planId, p_actor_id: actorId, p_version_id: versionId,
      p_version_content_hash: contentHash, p_title: scope.title, p_snapshot_text: serializeFrozenRecord(snapshot),
    });
  });
  it("retains the first publisher title when the canonical packet already exists", async () => {
    state.rpc.mockResolvedValue({ data: { ...result, title: "Original publisher title", alreadyPublished: true }, error: null });
    expect(await publishAdoptedPlan(createServiceRoleClient(), scope, snapshot)).toMatchObject({ reportId, alreadyPublished: true, title: "Original publisher title" });
  });
  it("refuses changed frozen bytes before any RPC", async () => {
    expect(await publicationFailure(scope, { ...snapshot, nodes: [{ text: "changed" }] })).toMatchObject({ kind: "conflict" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["workspaceId", "planId", "versionId"] as const)("rejects a returned %s from another scope", async (key) => {
    state.rpc.mockResolvedValue({ data: { ...result, [key]: otherId }, error: null });
    expect(await publicationFailure(scope)).toMatchObject({ kind: "unavailable" });
  });
  it("rejects a returned content hash from another version", async () => {
    state.rpc.mockResolvedValue({ data: { ...result, contentHash: "f".repeat(64) }, error: null });
    expect(await publicationFailure(scope)).toMatchObject({ kind: "unavailable" });
  });
  it("rejects an unexpected title for a newly created packet", async () => {
    state.rpc.mockResolvedValue({ data: { ...result, title: "Unexpected replacement" }, error: null });
    expect(await publicationFailure(scope)).toMatchObject({ kind: "unavailable" });
  });
  it.each([["PT400", "invalid", 400], ["42501", "forbidden", 403], ["PT404", "missing", 404],
    ["PT409", "conflict", 409], ["XX000", "unavailable", 503]] as const)("retains refusal semantics for %s", async (code, kind, status) => {
    state.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await publicationFailure(scope)).toMatchObject({ kind, status });
  });
  it("returns the RPC packet and exact latest public URL without direct report writes", async () => {
    const response = await POST(request(), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reportId, alreadyPublished: false, publicUrl: `/published-plans/${planId}` });
    expect(state.from.mock.calls).toEqual([["land_use_plan_versions"]]);
    expect(state.select).toHaveBeenCalledExactlyOnceWith("id, version_number, state, content_hash, frozen_snapshot, published_report_id");
    expect(state.eq.mock.calls).toEqual([["id", versionId], ["plan_id", planId]]);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("checks an existing pointer through the locked RPC instead of trusting the first read", async () => {
    state.maybeSingle.mockResolvedValue({ data: { id: versionId, version_number: 1, state: "adopted", content_hash: contentHash,
      frozen_snapshot: snapshot, published_report_id: otherId }, error: null });
    state.rpc.mockResolvedValue({ data: { ...result, alreadyPublished: true }, error: null });
    const response = await POST(request(), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reportId, alreadyPublished: true });
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not fabricate a packet after an unconfirmed RPC response", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const response = await POST(request(), { params: Promise.resolve({ planId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("reportId");
    expect(state.from.mock.calls).toEqual([["land_use_plan_versions"]]);
  });
  it("returns a lock conflict without creating a second packet", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    expect((await POST(request(), { params: Promise.resolve({ planId }) })).status).toBe(409);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps the access refusal ahead of any version or RPC read", async () => {
    state.load.mockResolvedValue({ ok: false, response: new Response("denied", { status: 403 }) });
    expect((await POST(request(), { params: Promise.resolve({ planId }) })).status).toBe(403);
    expect(state.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("publication SQL intent, without database execution", () => {
  const path = process.env.OPENPLAN_PUBLICATION_SQL_FIXTURE ?? join(process.cwd(), "supabase/migrations/20261017030608_land_use_plan_publication_transaction.sql");
  const sql = readFileSync(path, "utf8");
  it("locks the scoped plan and adopted version before inserting either record", () => {
    expect(sql).toContain("WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT");
    expect(sql).toContain("WHERE id=p_version_id AND plan_id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT");
    expect(sql).toContain("plan_row.current_adopted_version_id IS DISTINCT FROM adopted.id");
    expect(sql.indexOf("FOR UPDATE NOWAIT")).toBeLessThan(sql.indexOf("INSERT INTO public.reports"));
  });
  it("checks current write permission and exact retained source bytes", () => {
    expect(sql).toContain("role IN ('owner','admin','member') FOR SHARE NOWAIT");
    expect(sql).toContain("adopted.frozen_snapshot IS DISTINCT FROM supplied_snapshot");
    expect(sql).toContain("extensions.digest(p_snapshot_text,'sha256')");
    expect(sql).toContain("decision.adoption_manifest_hash");
  });
  it("verifies the canonical packet before returning an existing pointer", () => {
    expect(sql).toContain("report_row.workspace_id IS DISTINCT FROM p_workspace_id");
    expect(sql).toContain("artifact_count<>1");
    expect(sql).toContain("artifact.metadata_json->'frozenSnapshot' IS DISTINCT FROM adopted.frozen_snapshot");
    expect(sql).toContain("artifact.metadata_json->>'adoptionManifestHash' IS DISTINCT FROM decision.adoption_manifest_hash");
  });
  it("inserts both records before the null-guarded pointer and rolls back unmatched publication", () => {
    const report = sql.indexOf("INSERT INTO public.reports");
    const artifact = sql.indexOf("INSERT INTO public.report_artifacts");
    const pointer = sql.indexOf("UPDATE public.land_use_plan_versions SET published_report_id=new_report_id");
    expect(report).toBeGreaterThan(0); expect(artifact).toBeGreaterThan(report); expect(pointer).toBeGreaterThan(artifact);
    expect(sql).toContain("AND published_report_id IS NULL");
    expect(sql).toContain("IF changed<>1 THEN RAISE EXCEPTION");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available THEN");
    expect(sql).not.toContain("EXCEPTION WHEN OTHERS");
  });
  it("exposes only the service-role invoker function and preserves source history", () => {
    expect(sql).toContain("LANGUAGE plpgsql SECURITY INVOKER");
    expect(sql).toContain("SET search_path=pg_catalog,public,pg_temp");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated,service_role");
    expect(sql).toContain("TO service_role;");
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO (?:PUBLIC|anon|authenticated)/);
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.land_use_plan_decisions/);
  });
});

describe("additive publication decision boundary SQL source", () => {
  const sql = readFileSync(process.env.OPENPLAN_PUBLICATION_BOUNDARY_SQL_FIXTURE ??
    join(process.cwd(), "supabase/migrations/20261020235917_land_use_publication_decision_boundary.sql"), "utf8");
  const [publisher, reader] = sql.split("CREATE FUNCTION public.land_use_plan_publication_source_v1");
  it("excludes every concurrent decision write before choosing a native singleton", () => {
    const lock = publisher.indexOf("LOCK TABLE public.land_use_plan_decisions IN SHARE MODE NOWAIT;");
    const count = publisher.indexOf("IF (SELECT count(*) FROM public.land_use_plan_decisions WHERE version_id=adopted.id)<>1 THEN");
    expect(lock).toBeGreaterThan(0);
    expect(publisher).toContain("IF current_setting('transaction_isolation')<>'read committed' THEN");
    expect(count).toBeGreaterThan(lock);
    expect(count).toBeLessThan(publisher.indexOf("SELECT * INTO decision"));
    expect(count).toBeLessThan(publisher.indexOf("already_published:="));
    expect(publisher).toContain("SELECT * INTO decision FROM public.land_use_plan_decisions WHERE version_id=adopted.id;");
    expect(publisher).not.toContain("ORDER BY decided_on");
    for (const guard of ["decision.workspace_id IS DISTINCT FROM p_workspace_id", "decision.plan_id IS DISTINCT FROM p_plan_id",
      "decision.version_content_hash IS DISTINCT FROM p_version_content_hash", "decision.decision_kind NOT IN ('adoption','amendment')"]) expect(publisher).toContain(guard);
  });
  it("preserves actor, hash, artifact, manifest and exact replay refusals", () => {
    for (const guard of ["role IN ('owner','admin','member') FOR SHARE NOWAIT", "extensions.digest(p_snapshot_text,'sha256')",
      "artifact_count<>1", "artifact.metadata_json->>'kind'='land_use_plan_implementation_report'",
      "AND adoption_manifest_hash=decision.adoption_manifest_hash)<>1", "jsonb_typeof(manifest_decision) IS DISTINCT FROM 'object'",
      "The retained adoption decision is unreadable or inconsistent", "artifact.metadata_json->'adoptionManifest' IS DISTINCT FROM decision.adoption_manifest",
      "AND published_report_id IS NULL", "IF changed<>1 THEN RAISE EXCEPTION", "EXCEPTION WHEN lock_not_available THEN"])
      expect(publisher).toContain(guard);
    expect(publisher).toContain("CREATE OR REPLACE FUNCTION public.publish_land_use_plan_version");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.land_use_plan_decisions/);
  });
  it("reads current identity and all decision kinds with retained evidence in one stable statement", () => {
    expect(reader).toContain("RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER");
    expect(reader).toContain("WHERE p.id=p_plan_id AND v.state='adopted' AND v.published_report_id IS NOT NULL");
    expect(reader).toContain("JOIN public.land_use_plan_versions v ON v.id=p.current_adopted_version_id");
    expect(reader).toContain("LEFT JOIN public.reports r ON r.id=v.published_report_id");
    expect(reader).toContain("FROM public.land_use_plan_decisions WHERE version_id=v.id LIMIT 2");
    expect(reader).toContain("FROM public.report_artifacts WHERE report_id=r.id LIMIT 2");
    expect(reader).toContain("SELECT id,workspace_id,plan_id,version_id,version_content_hash,decision_kind,decision_body,");
    expect(reader).toContain("instrument_type,instrument_identifier,vote,decided_on,effective_on,review_release_id,");
    expect(reader).toContain("adoption_manifest,adoption_manifest_hash,");
    expect(reader).toContain("SELECT id,report_id,artifact_kind,metadata_json");
    expect(reader).toContain("encode(extensions.digest(convert_to(adoption_manifest::text,'UTF8'),'sha256'),'hex')=adoption_manifest_hash AS manifest_hash_verified");
    expect(reader).not.toMatch(/ORDER BY|decision_kind IN|decision_kind=/);
    expect(reader).toContain("REVOKE ALL ON FUNCTION public.land_use_plan_publication_source_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;");
    expect(reader).toContain("GRANT EXECUTE ON FUNCTION public.land_use_plan_publication_source_v1(uuid) TO service_role;");
  });
});

describe("publication peer migration probe wrapper source", () => {
  const wrapper = readFileSync(join(process.cwd(), "src/test/land-use-implementation-report-transaction-rls.test.ts"), "utf8");
  const peerStart = wrapper.indexOf('it.skipIf(!LIVE_RLS)("serializes report edits and publication decisions in both native session orders"');
  const single = wrapper.slice(0, peerStart);
  const peer = wrapper.slice(peerStart);
  it("refuses the unsupported peer probe before resolving a stack or preparing seed fixtures", () => {
    expect(peerStart).toBeGreaterThan(0);
    const refusal = 'if (process.env.OPENPLAN_PUBLICATION_BOUNDARY_MIGRATION_PROBE === "1") {\n' +
      '    throw new Error("Publication peer fixtures require the candidate committed on the isolated stack in both sessions; use the rollback migration probe only with the single-session fixture.");\n  }';
    const guard = peer.indexOf(refusal);
    expect(guard).toBeGreaterThan(0);
    for (const preparation of ["resolveLocalDbContainer()", "requireContractVerificationStack(container)", "randomUUID()",
      "readFileSync(", "const run =", "result = run(", "cleanup = run("]) {
      expect(peer.indexOf(preparation), preparation).toBeGreaterThan(guard);
    }
    expect(peer).not.toContain("${publicationMigration}");
    expect(peer).not.toContain("const publicationMigration");
  });
  it("retains the rollback-only candidate migration in the single-session fixture", () => {
    expect(single).toContain('const publicationMigration = process.env.OPENPLAN_PUBLICATION_BOUNDARY_MIGRATION_PROBE === "1"');
    expect(single).toContain('readFileSync("supabase/migrations/20261020235917_land_use_publication_decision_boundary.sql", "utf8")');
    expect(single).toContain("${publicationMigration}");
    expect(single).toContain("ROLLBACK;");
  });
});
