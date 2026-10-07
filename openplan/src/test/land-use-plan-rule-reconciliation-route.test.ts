import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getPlanKindDescriptor } from "@/lib/land-use-plans/registry";
import * as registry from "@/lib/land-use-plans/registry";
import { hashFrozenRecord, serializeFrozenRecord } from "@/lib/land-use-plans/versioning";
import { executeRuleReconciliation } from "@/lib/land-use-plans/rule-reconciliation-store";
import * as reconciliationStore from "@/lib/land-use-plans/rule-reconciliation-store";
const mocks = vi.hoisted(() => ({ access: vi.fn(), working: vi.fn(), service: vi.fn(), from: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access, loadWorkingVersion: mocks.working }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { POST } from "@/app/api/land-use-plans/[planId]/reconcile-rules/route";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const planId = id(1), workspaceId = id(2), actorId = id(3), versionId = id(4), commandId = id(5);
const descriptor = getPlanKindDescriptor("us-ca-general-plan", "area")!;
const scope = { planId, workspaceId, actorId };
const command = { operation: "reconcile", commandId, versionId, expectedDraftRevision: 7, expectedDescriptorHash: hashFrozenRecord(descriptor) };
const result = { ...scope, replayed: false, commandId, versionId, previousDraftRevision: 7, draftRevision: 9,
  descriptorHash: command.expectedDescriptorHash, addedSections: [{ id: id(6), requirementKey: "specific_land_use" }],
  applicableRequirementKeys: ["previous_rule", ...descriptor.requirements.map(rule => rule.key)], reconciledAt: "2026-10-07T00:00:00Z" };
let lookup: { data: Record<string, unknown> | null; error: unknown };
let queries: Array<{ table: string; projection: string; filters: Array<[string, unknown]> }>;
const client = { from: mocks.from, rpc: mocks.rpc };
function post(text: string | Uint8Array = JSON.stringify(command), extra: Record<string, string> = {}, selectedPlan = planId) {
  return POST(new NextRequest(`http://localhost/api/land-use-plans/${selectedPlan}/reconcile-rules`, {
    method: "POST", body: text as BodyInit, headers: { origin: "http://localhost", "content-type": "application/json",
      "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId, ...extra },
  }), { params: Promise.resolve({ planId: selectedPlan }) });
}
beforeEach(() => {
  vi.clearAllMocks(); lookup = { data: null, error: null }; queries = [];
  mocks.from.mockImplementation((table: string) => {
    const query = { table, projection: "", filters: [] as Array<[string, unknown]> }; queries.push(query);
    const chain = { select: (projection: string) => { query.projection = projection; return chain; },
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
      maybeSingle: async () => ({ ...lookup, data: lookup.data && Object.fromEntries(Object.entries(lookup.data).filter(([key]) => query.projection.split(",").map(value => value.trim()).includes(key))) }),
    }; return chain;
  });
  mocks.access.mockResolvedValue({ ok: true, access: { supabase: client, userId: actorId, canWrite: true,
    plan: { id: planId, workspace_id: workspaceId, descriptor_id: descriptor.id, plan_kind_key: "area" } } });
  mocks.working.mockResolvedValue({ id: versionId, draft_revision: 7 });
  mocks.service.mockReturnValue(client); mocks.rpc.mockResolvedValue({ data: structuredClone(result), error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("scoped rule reconciliation route", () => {
  it("retains exact request bytes and selected rules through one server-scoped transaction", async () => {
    const raw = ` \n${JSON.stringify(command)}\n`;
    const response = await post(raw); expect(response.status).toBe(201); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(planId, { write: true });
    expect(queries).toEqual([{ table: "land_use_plan_rule_reconciliation_commands", projection: "command_id",
      filters: [["plan_id", planId], ["workspace_id", workspaceId], ["command_id", commandId]] }]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reconcile_land_use_plan_rules", {
      p_plan_id: planId, p_workspace_id: workspaceId, p_actor_id: actorId, p_command_id: commandId,
      p_command_text: raw, p_descriptor_text: serializeFrozenRecord(descriptor),
    });
    expect(mocks.info).toHaveBeenCalledWith("land_use_plan_rules_reconciled", { planId, commandId, versionId, replayed: false });
  });
  it("replays original results before current rules or a newer draft are read", async () => {
    lookup.data = { command_id: commandId }; mocks.rpc.mockResolvedValue({ data: { ...result, replayed: true }, error: null });
    const selection = vi.spyOn(registry, "getPlanKindDescriptor").mockImplementation(() => { throw Error("Current rules are not recovery evidence"); });
    mocks.working.mockRejectedValue(Error("Newer draft is not recovery evidence"));
    const response = await post(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ...result, replayed: true });
    expect(mocks.working).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1].p_descriptor_text).toBeNull();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses agent header %s, including an empty value", async key => {
    expect((await post(undefined, { [key]: "" })).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://untrusted.invalid" }, { "sec-fetch-site": "cross-site" }, { "x-openplan-expected-user": id(9) },
    { "x-openplan-expected-workspace": id(9) }, { "x-openplan-expected-user": "" }, { "x-openplan-expected-workspace": "" }])("refuses untrusted or changed browser scope %j", async headers => {
    expect((await post(undefined, headers)).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500])("preserves access refusal %i without service access", async status => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unavailable" }, { status }) });
    const response = await post(); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["{", JSON.stringify({ ...command, actorId }), JSON.stringify({ ...command, operation: "freeze" }),
    JSON.stringify({ ...command, versionId: "bad" }), JSON.stringify({ ...command, expectedDraftRevision: -1 }),
    JSON.stringify({ ...command, expectedDraftRevision: 2_147_483_648 }), JSON.stringify({ ...command, expectedDescriptorHash: "bad" })])("rejects malformed commands before service access: %s", async raw => {
    expect((await post(raw)).status).toBe(400); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("bounds request bytes, rejects invalid UTF-8 and validates plan identifiers", async () => {
    expect((await post(" ".repeat(8193))).status).toBe(413);
    expect((await post(new Uint8Array([0xff, 0xfe]))).status).toBe(400);
    expect((await post(undefined, {}, "invalid")).status).toBe(400); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([null, { id: id(9), draft_revision: 7 }, { id: versionId, draft_revision: 8 }, { id: versionId }])("refuses stale or unavailable working version %j", async version => {
    mocks.working.mockResolvedValue(version); expect((await post()).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses unavailable or changed selected rules", async () => {
    const execute = vi.spyOn(reconciliationStore, "executeRuleReconciliation");
    const selection = vi.spyOn(registry, "getPlanKindDescriptor").mockReturnValue(null);
    expect((await post()).status).toBe(409);
    selection.mockReturnValue({ ...descriptor, disclosure: "Changed current rules" });
    expect((await post()).status).toBe(409); expect(execute).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks the prepared hash again before the transaction", async () => {
    await expect(executeRuleReconciliation(client as unknown as Parameters<typeof executeRuleReconciliation>[0], scope,
      JSON.stringify(command), { ...descriptor, disclosure: "Changed prepared rules" })).rejects.toMatchObject({ kind: "conflict" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ error: { message: "private read failure" }, data: null }, { error: null, data: { wrong: commandId } },
    { error: null, data: { command_id: id(9) } }])("keeps failed or incomplete receipt discovery unconfirmed %j", async value => {
    lookup = value; const response = await post(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private read failure"); expect(mocks.working).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["PT400", 400], ["42501", 403], ["PT404", 404], ["PT409", 409], ["XX000", 503]])("preserves native %s as HTTP %s without private diagnostics", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private native diagnostic" } });
    const response = await post(); expect(response.status).toBe(status); expect(await response.text()).not.toContain("private native diagnostic");
  });
  it.each(["actorId", "workspaceId", "planId", "commandId", "versionId"])("rejects substituted receipt %s", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result, [field]: id(9) }, error: null }); expect((await post()).status).toBe(503);
  });
  it.each([{ previousDraftRevision: 8 }, { descriptorHash: "b".repeat(64) }, { draftRevision: 6 }, { draftRevision: 7 },
    { reconciledAt: "not-a-date" }, { extra: true }, { applicableRequirementKeys: ["previous_rule"] },
    { addedSections: [{ id: id(6), requirementKey: "unknown" }] },
    { addedSections: [result.addedSections[0], result.addedSections[0]] },
    { addedSections: [result.addedSections[0], { id: id(7), requirementKey: "specific_land_use" }] },
    { addedSections: [result.addedSections[0], { id: id(6), requirementKey: "specific_facilities" }] }])("keeps invalid or mismatched receipts unconfirmed %j", async patch => {
    mocks.rpc.mockResolvedValue({ data: { ...result, ...patch }, error: null }); expect((await post()).status).toBe(503);
  });
  it("requires a replayed receipt when no new descriptor was prepared", async () => {
    lookup.data = { command_id: commandId }; expect((await post()).status).toBe(503);
  });
  it("accepts an exact concurrent replay after preparing the same rules", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, replayed: true }, error: null }); expect((await post()).status).toBe(200);
  });
  it("retains locally defined defaults without turning them into configured legal requirements", async () => {
    const neutral = getPlanKindDescriptor("local-unconfigured", "community")!;
    mocks.access.mockResolvedValue({ ok: true, access: { supabase: client, userId: actorId, canWrite: true,
      plan: { id: planId, workspace_id: workspaceId, descriptor_id: neutral.id, plan_kind_key: "community" } } });
    const descriptorHash = hashFrozenRecord(neutral);
    const raw = JSON.stringify({ ...command, expectedDescriptorHash: descriptorHash });
    const receipt = { ...result, descriptorHash, addedSections: [{ id: id(6), requirementKey: "locally_defined" }], applicableRequirementKeys: ["previous_rule"] };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null }); expect((await post(raw)).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: { ...receipt, applicableRequirementKeys: ["previous_rule", "locally_defined"] }, error: null });
    expect((await post(raw)).status).toBe(201);
    expect(JSON.parse(mocks.rpc.mock.calls[1][1].p_descriptor_text)).toMatchObject({ configured: false,
      requirements: [{ key: "locally_defined", applicability: "locally_defined" }] });
  });
});
