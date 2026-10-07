import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { hashFrozenRecord, serializeFrozenPlanContent, serializeFrozenRecord, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
const mocks = vi.hoisted(() => ({ access: vi.fn(), working: vi.fn(), snapshot: vi.fn(), service: vi.fn(), from: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access, loadWorkingVersion: mocks.working, buildFrozenSnapshot: mocks.snapshot }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { POST } from "@/app/api/land-use-plans/[planId]/freeze/route";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const planId = id(1), versionId = id(2), actorId = id(3), workspaceId = id(4), commandId = id(5);
const descriptor = getJurisdictionPlanDescriptor("local-unconfigured")!;
const command = { state: "public_review", commandId, versionId, expectedDraftRevision: 7, expectedDescriptorHash: hashFrozenRecord(descriptor) };
const snapshot: FrozenPlanContent = { descriptorSnapshot: descriptor, planContext: null,
  plan: { id: planId, descriptorId: descriptor.id, planKindKey: "community", title: "SYNTHETIC plan", authorityLabel: "SYNTHETIC authority", geographyLabel: "SYNTHETIC place" },
  version: { id: versionId, versionNumber: 1, versionKind: "original", basedOnVersionId: null, applicableRequirementKeys: [], draftRevision: 7 },
  nodes: [], relationships: [], designations: [], implementationActions: [] };
const result = { replayed: false, commandId, versionId, draftRevision: 7, contentHash: hashFrozenRecord(snapshot), frozenAt: "2026-10-07T00:00:00+00:00", reviewEventId: id(6) };
const client = { from: mocks.from, rpc: mocks.rpc };
let tables: Record<string, { data: unknown; error: unknown }>;
let queries: { table: string; projection: string; filters: [string, unknown][] }[];
function post(text = JSON.stringify(command), extra: Record<string, string> = {}) {
  return POST(new NextRequest(`http://localhost/api/land-use-plans/${planId}/freeze`, { method: "POST", body: text,
    headers: { origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": actorId,
      "x-openplan-expected-workspace": workspaceId, ...extra } }), { params: Promise.resolve({ planId }) });
}
beforeEach(() => {
  vi.clearAllMocks(); queries = [];
  tables = { land_use_plan_freeze_commands: { data: null, error: null }, land_use_plan_content_nodes: { data: [], error: null },
    land_use_plan_designations: { data: [{ id: id(7) }], error: null }, land_use_plan_implementation_actions: { data: [{ id: id(8) }], error: null },
    land_use_plan_process_records: { data: [], error: null }, land_use_plan_consultation_records: { data: null, error: null } };
  mocks.from.mockImplementation((table: string) => {
    const query = { table, projection: "", filters: [] as [string, unknown][] }; queries.push(query);
    function reply() {
      const value = tables[table]; if (!value) throw new Error(`Unexpected table ${table}`);
      const project = (row: object) => Object.fromEntries(Object.entries(row).filter(([key]) => query.projection.split(",").map(part => part.trim()).includes(key)));
      return { ...value, data: Array.isArray(value.data) ? value.data.map(project) : value.data && typeof value.data === "object" ? project(value.data) : value.data };
    }
    const chain = { select: (projection: string) => { query.projection = projection; return chain; },
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; }, limit: () => chain,
      maybeSingle: async () => reply(), then: (resolve: (value: ReturnType<typeof reply>) => unknown) => Promise.resolve(reply()).then(resolve) };
    return chain;
  });
  mocks.access.mockResolvedValue({ ok: true, access: { supabase: client, userId: actorId, canWrite: true,
    plan: { id: planId, workspace_id: workspaceId, descriptor_id: descriptor.id } } });
  mocks.working.mockResolvedValue({ id: versionId, draft_revision: 7, applicable_requirement_keys: [] });
  mocks.snapshot.mockResolvedValue({ snapshot, hash: hashFrozenRecord(snapshot) });
  mocks.service.mockReturnValue(client); mocks.rpc.mockResolvedValue({ data: result, error: null });
});

describe("atomic plan freeze route", () => {
  it("sends the original request and canonical content through one scoped transaction", async () => {
    const text = ` \n${JSON.stringify(command)}\n`;
    const response = await post(text);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(planId, { write: true });
    expect(queries[0]).toEqual({ table: "land_use_plan_freeze_commands", projection: "command_id", filters: [["plan_id", planId], ["workspace_id", workspaceId], ["command_id", commandId]] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("freeze_land_use_plan_version", { p_plan_id: planId, p_version_id: versionId,
      p_actor_id: actorId, p_command_id: commandId, p_expected_draft_revision: 7, p_command_text: text,
      p_snapshot_text: serializeFrozenPlanContent(snapshot), p_descriptor_text: serializeFrozenRecord(descriptor) });
  });
  it("recovers without loading a newer working draft or installed checklist", async () => {
    tables.land_use_plan_freeze_commands.data = { command_id: commandId };
    mocks.rpc.mockResolvedValue({ data: { ...result, replayed: true }, error: null });
    mocks.working.mockRejectedValue(new Error("Must not load a newer draft"));
    const response = await post(JSON.stringify({ ...command, expectedDescriptorHash: "c".repeat(64) }));
    expect(response.status).toBe(200); expect(mocks.working).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_snapshot_text: null, p_descriptor_text: null });
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses agent header %s even when empty", async key => {
    expect((await post(undefined, { [key]: "" })).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "http://elsewhere.test" }, { "sec-fetch-site": "cross-site" },
    { "x-openplan-expected-user": id(9) }, { "x-openplan-expected-workspace": id(9) }, { "x-openplan-expected-user": "" }])("refuses untrusted or changed scope %j", async headers => {
    expect((await post(undefined, headers)).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("preserves access refusal before creating a service client", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const response = await post(); expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["{", JSON.stringify({ ...command, actorId }), JSON.stringify({ ...command, expectedDraftRevision: -1 }), JSON.stringify({ ...command, versionId: "invalid" })])("rejects malformed commands before service access", async text => {
    expect((await post(text)).status).toBe(400); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("bounds request bytes", async () => {
    expect((await post(" ".repeat(8193))).status).toBe(413); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([null, { id: id(9), draft_revision: 7 }, { id: versionId, draft_revision: 8 }, { id: versionId }])("refuses a changed or unknown working version %j", async value => {
    mocks.working.mockResolvedValue(value); expect((await post()).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses descriptor drift before building or freezing", async () => {
    expect((await post(JSON.stringify({ ...command, expectedDescriptorHash: "c".repeat(64) }))).status).toBe(409);
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.snapshot.mockResolvedValue({ snapshot: { ...snapshot, descriptorSnapshot: { ...descriptor, label: "changed" } } });
    expect((await post()).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires readiness fields and refuses blank required content", async () => {
    mocks.working.mockResolvedValue({ id: versionId, draft_revision: 7, applicable_requirement_keys: ["local"] });
    tables.land_use_plan_content_nodes.data = [{ requirement_key: "local", body: "SYNTHETIC saved section" }];
    expect((await post()).status).toBe(201);
    expect(queries.find(query => query.table === "land_use_plan_content_nodes")).toEqual({ table: "land_use_plan_content_nodes", projection: "requirement_key, body", filters: [["version_id", versionId], ["node_kind", "section"]] });
    mocks.rpc.mockClear(); tables.land_use_plan_content_nodes.data = [{ requirement_key: "local", body: " \n " }];
    expect((await post()).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports required rules absent from an older saved checklist before preparing a snapshot", async () => {
    const current = getJurisdictionPlanDescriptor("us-ca-general-plan")!;
    const required = current.requirements.filter(rule => rule.applicability === "required").map(rule => rule.key);
    mocks.access.mockResolvedValue({ ok: true, access: { supabase: client, userId: actorId, canWrite: true,
      plan: { id: planId, workspace_id: workspaceId, descriptor_id: current.id, plan_kind_key: "general" } } });
    mocks.working.mockResolvedValue({ id: versionId, draft_revision: 7, applicable_requirement_keys: ["prior_rule"] });
    tables.land_use_plan_content_nodes.data = [{ requirement_key: "prior_rule", body: "SYNTHETIC retained text" }];
    tables.land_use_plan_process_records.data = current.processSteps.map(step => ({ process_key: step.key, status: "complete" }));
    tables.land_use_plan_consultation_records.data = { status: "complete" };
    const requestText = JSON.stringify({ ...command, expectedDescriptorHash: hashFrozenRecord(current) });
    const response = await post(requestText);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ blockers: [`Complete applicable sections: ${required.join(", ")}`] });
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(queries.find(query => query.table === "land_use_plan_content_nodes")).toEqual({ table: "land_use_plan_content_nodes", projection: "requirement_key, body", filters: [["version_id", versionId], ["node_kind", "section"]] });

    tables.land_use_plan_content_nodes.data = ["prior_rule", ...required].map(key => ({ requirement_key: key, body: "SYNTHETIC reviewed text" }));
    const currentSnapshot = { ...snapshot, descriptorSnapshot: current,
      plan: { ...snapshot.plan, descriptorId: current.id, planKindKey: "general" } };
    mocks.snapshot.mockResolvedValue({ snapshot: currentSnapshot, hash: hashFrozenRecord(currentSnapshot) });
    mocks.rpc.mockResolvedValue({ data: { ...result, contentHash: hashFrozenRecord(currentSnapshot) }, error: null });
    expect((await post(requestText)).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["land_use_plan_designations", "land_use_plan_implementation_actions"])("refuses missing %s", async table => {
    tables[table].data = []; expect((await post()).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["land_use_plan_freeze_commands", "land_use_plan_content_nodes", "land_use_plan_designations", "land_use_plan_implementation_actions", "land_use_plan_process_records", "land_use_plan_consultation_records"])("keeps %s read failures unconfirmed", async table => {
    tables[table].error = { message: "private database diagnostic" };
    const response = await post(); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database diagnostic"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses an incomplete or mismatched command-discovery projection", async () => {
    for (const data of [{ other: commandId }, { command_id: id(9) }]) {
      tables.land_use_plan_freeze_commands.data = data; expect((await post()).status).toBe(503);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["PT400", 400], ["42501", 403], ["PT404", 404], ["PT409", 409], ["unknown", 503]])("maps SQL %s to HTTP %s without diagnostics", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private diagnostic" } });
    const response = await post(); expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("private diagnostic");
  });
  it.each([{ commandId: id(9) }, { versionId: id(9) }, { draftRevision: 8 }, { contentHash: "c".repeat(64) }, { frozenAt: "invalid" }, { reviewEventId: "invalid" }, { extra: true }])("keeps mismatched receipts unconfirmed %j", async patch => {
    mocks.rpc.mockResolvedValue({ data: { ...result, ...patch }, error: null }); expect((await post()).status).toBe(503);
  });
  it("requires a replayed receipt when no fresh snapshot was prepared", async () => {
    tables.land_use_plan_freeze_commands.data = { command_id: commandId }; expect((await post()).status).toBe(503);
  });
  it("accepts a concurrent exact replay after fresh preparation", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, replayed: true }, error: null }); expect((await post()).status).toBe(200);
  });
  it("keeps failed snapshot preparation unconfirmed", async () => {
    mocks.snapshot.mockResolvedValue(null); expect((await post()).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
