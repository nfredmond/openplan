import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { serializePlanContextSave } from "@/lib/land-use-plans/plan-context-command";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";

const mocks = vi.hoisted(() => ({ access: vi.fn(), service: vi.fn(), rpc: vi.fn(), from: vi.fn(), resolve: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/geographies/place-resolver", () => ({ resolvePlaceBoundary: mocks.resolve }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { GET, POST } from "@/app/api/land-use-plans/[planId]/context/route";

const planId = "10000000-0000-4000-8000-000000000001", versionId = "10000000-0000-4000-8000-000000000002";
const actorId = "10000000-0000-4000-8000-000000000003", workspaceId = "10000000-0000-4000-8000-000000000004";
const commandId = "10000000-0000-4000-8000-000000000005", otherId = "10000000-0000-4000-8000-000000000006";
const context = { params: Promise.resolve({ planId }) };
const geometry: { type: "Polygon"; coordinates: [number, number][][] } = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const command = {
  commandId, versionId, expectedContextHash: null, descriptorId: "local-unconfigured", planKindKey: "community",
  place: { mode: "uploaded" as const, geometry, label: "SYNTHETIC study" },
  assessment: { authorities: [{ id: otherId, label: "SYNTHETIC body", kind: "unassessed", role: "adopting", jurisdiction: null, sourceUrls: [] }],
    applicability: { status: "unresolved" as const, explanation: "Synthetic unresolved assessment" } },
};
const retained = { schemaVersion: 1, place: placeOfRecordFromCapturedArea(command.place), assessment: command.assessment,
  savedBy: actorId, savedAt: "2026-10-07T10:30:00.123456Z" };
const outcome = { replayed: false, context: retained, contextHash: "a".repeat(64), commandId, versionId };
const client = { from: mocks.from, rpc: mocks.rpc };
let tables: Record<string, { data: unknown; error: unknown }>;
let queries: { table: string; projection: string; filters: [string, unknown][] }[];
function request(text = serializePlanContextSave(command), extra: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/land-use-plans/${planId}/context`, { method: "POST", body: text,
    headers: { origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": actorId,
      "x-openplan-expected-workspace": workspaceId, ...extra } });
}
async function post(text?: string, headers?: Record<string, string>) { return POST(request(text, headers), context); }
function planRow() { return { plan_context: retained, plan_context_hash: outcome.contextHash, descriptor_id: command.descriptorId,
  plan_kind_key: command.planKindKey, current_working_version_id: versionId }; }

beforeEach(() => {
  vi.clearAllMocks(); queries = [];
  tables = { land_use_plan_context_commands: { data: null, error: null }, land_use_plans: { data: planRow(), error: null } };
  mocks.from.mockImplementation((table: string) => {
    const query = { table, projection: "", filters: [] as [string, unknown][] }; queries.push(query);
    const chain = { select: (projection: string) => { query.projection = projection; return chain; },
      eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain; },
      maybeSingle: async () => {
        const result = tables[table];
        if (!result) throw new Error(`Unexpected table ${table}`);
        // Return only requested fields so missing projections cannot pass by accident.
        if (result.data && typeof result.data === "object") return { ...result,
          data: Object.fromEntries(Object.entries(result.data).filter(([key]) => query.projection.split(",").map(value => value.trim()).includes(key))) };
        return result;
      } };
    return chain;
  });
  mocks.access.mockResolvedValue({ ok: true, access: { supabase: client, userId: actorId,
    plan: { id: planId, workspace_id: workspaceId }, canWrite: true } });
  mocks.service.mockReturnValue(client);
  mocks.rpc.mockResolvedValue({ data: outcome, error: null });
  mocks.resolve.mockRejectedValue(new Error("Boundary lookup should not run for uploaded/replayed input"));
});

describe("plan context route", () => {
  it("saves exact normalized command bytes under server-authenticated scope", async () => {
    const text = ` \n${serializePlanContextSave(command)}\n `;
    const response = await post(text);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(outcome);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(planId, { write: true });
    expect(queries).toEqual([{ table: "land_use_plan_context_commands", projection: "command_id",
      filters: [["plan_id", planId], ["workspace_id", workspaceId], ["command_id", commandId]] }]);
    expect(mocks.rpc).toHaveBeenCalledWith("save_land_use_plan_context", { p_plan_id: planId, p_version_id: versionId,
      p_actor_id: actorId, p_command_id: commandId, p_expected_context_hash: null, p_command_text: text,
      p_prepared_context: expect.objectContaining({ savedBy: actorId, assessment: command.assessment,
        place: expect.objectContaining({ source: "uploaded_file", countryCode: null }) }),
      p_expected_descriptor_id: command.descriptorId, p_expected_plan_kind_key: command.planKindKey });
  });
  it("retains exact saved geography during an authority-only edit without resolving it again", async () => {
    const text = serializePlanContextSave({ ...command, place: { mode: "retained" }, expectedContextHash: outcome.contextHash });
    const response = await post(text); expect(response.status).toBe(201);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1].p_prepared_context.place).toEqual(retained.place);
    expect(queries[1]).toEqual({ table: "land_use_plans", projection: "plan_context,plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id",
      filters: [["id", planId], ["workspace_id", workspaceId]] });
  });
  it.each(["absent", "hash", "version", "descriptor", "kind"])("refuses retained geography when its %s precondition changed", async fault => {
    if (fault === "absent") tables.land_use_plans.data = { ...planRow(), plan_context: null, plan_context_hash: null };
    if (fault === "hash") tables.land_use_plans.data = { ...planRow(), plan_context_hash: "b".repeat(64) };
    if (fault === "version") tables.land_use_plans.data = { ...planRow(), current_working_version_id: otherId };
    if (fault === "descriptor") tables.land_use_plans.data = { ...planRow(), descriptor_id: "us-ca-general-plan" };
    if (fault === "kind") tables.land_use_plans.data = { ...planRow(), plan_kind_key: "another-kind" };
    expect((await post(serializePlanContextSave({ ...command, place: { mode: "retained" }, expectedContextHash: outcome.contextHash }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("requires an applicability assessment even when retaining an existing configured study area", async () => {
    tables.land_use_plans.data = { ...planRow(), descriptor_id: "us-ca-general-plan", plan_kind_key: "comprehensive" };
    expect((await post(serializePlanContextSave({ ...command, descriptorId: "us-ca-general-plan", planKindKey: "comprehensive", place: { mode: "retained" }, expectedContextHash: outcome.contextHash }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("replays a retained-area request before consulting today's mutable context", async () => {
    tables.land_use_plan_context_commands.data = { command_id: commandId };
    tables.land_use_plans = { data: null, error: new Error("Current context unavailable") };
    mocks.rpc.mockResolvedValue({ data: { ...outcome, replayed: true }, error: null });
    expect((await post(serializePlanContextSave({ ...command, place: { mode: "retained" }, expectedContextHash: outcome.contextHash }))).status).toBe(200);
    expect(queries).toHaveLength(1); expect(mocks.rpc.mock.calls[0][1].p_prepared_context).toBeNull();
  });
  it("normalizes form fields before retaining transport bytes", () => {
    const text = serializePlanContextSave({ ...command, place: { ...command.place, label: "  SYNTHETIC study  " } });
    expect(JSON.parse(text).place.label).toBe("SYNTHETIC study");
  });
  it("replays retained results without reinstalling old rules or fetching geography", async () => {
    tables.land_use_plan_context_commands.data = { command_id: commandId };
    mocks.rpc.mockResolvedValue({ data: { ...outcome, replayed: true }, error: null });
    const response = await post(JSON.stringify({ ...command, descriptorId: "uninstalled-old-edition", place: { mode: "place", kind: "county", geoid: "06001", label: "SYNTHETIC old lookup" } }));
    expect(response.status).toBe(200); expect((await response.json()).replayed).toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1].p_prepared_context).toBeNull();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses an agent write carrying %s", async key => {
    expect((await post(undefined, { [key]: "" })).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "http://elsewhere.test" }, { "sec-fetch-site": "cross-site" }])("refuses cross-origin writes %j", async headers => {
    expect((await post(undefined, headers)).status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-expected-user", "x-openplan-expected-workspace"])("refuses account/workspace changes in %s", async key => {
    expect((await post(undefined, { [key]: otherId })).status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("preserves authentication and permission refusals without service access", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const response = await post(); expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["savedBy", "savedAt", "workspaceId", "actorId"])("refuses client attribution or extra scope %s", async field => {
    expect((await post(JSON.stringify({ ...command, [field]: actorId }))).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("refuses unnormalized fields before any write", async () => {
    expect((await post(JSON.stringify({ ...command, assessment: { ...command.assessment,
      applicability: { ...command.assessment.applicability, explanation: "  unnormalized  " } } }))).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("bounds the body and refuses malformed JSON", async () => {
    expect((await post("{" )).status).toBe(400);
    expect((await post(" ".repeat(2_000_001))).status).toBe(413);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("refuses unsupported new checklist and plan-kind selections", async () => {
    for (const patch of [{ descriptorId: "missing" }, { planKindKey: "missing" }]) expect((await post(JSON.stringify({ ...command, ...patch }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves unavailability when retained-command discovery fails", async () => {
    tables.land_use_plan_context_commands = { data: null, error: { message: "private diagnostic" } };
    const response = await post(); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private diagnostic"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["PT409", 409], ["42501", 403], ["PT404", 404], ["PT400", 400], ["other", 503]])("preserves RPC %s as %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private SQL diagnostic" } });
    const response = await post(); expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL diagnostic");
  });
  it.each([
    { commandId: otherId }, { versionId: otherId }, { context: { ...retained, savedBy: otherId } },
    { contextHash: "invalid" }, { context: { ...retained, place: { ...retained.place, label: "  changed  " } } },
  ])("does not acknowledge a mismatched or altered result %j", async patch => {
    mocks.rpc.mockResolvedValue({ data: { ...outcome, ...patch }, error: null }); expect((await post()).status).toBe(503);
  });
  it("reads the exact retained context and required projections through the user client", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/land-use-plans/${planId}/context`), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ planId, actorId, workspaceId,
      contextState: { status: "retained", context: retained }, contextHash: outcome.contextHash,
      descriptorId: command.descriptorId, planKindKey: command.planKindKey, versionId, canWrite: true });
    expect(queries).toEqual([{ table: "land_use_plans",
      projection: "plan_context,plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id",
      filters: [["id", planId], ["workspace_id", workspaceId]] }]);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("keeps legacy null distinct from missing, invalid or unreadable context", async () => {
    for (const [patch, status] of [
      [{ plan_context: null, plan_context_hash: null }, 200], [{ plan_context: undefined }, 503], [{ plan_context: undefined, plan_context_hash: null }, 503],
      [{ plan_context: {} }, 503], [{ plan_context: { ...retained, place: { ...retained.place, label: "  changed  " } } }, 503], [{ plan_context: null }, 503], [{ plan_context_hash: undefined }, 503],
      [{ descriptor_id: undefined }, 503], [{ current_working_version_id: undefined }, 503],
    ] as const) {
      tables.land_use_plans = { data: { ...planRow(), ...patch }, error: null };
      const response = await GET(new NextRequest("http://localhost"), context); expect(response.status).toBe(status);
      if (status === 200) expect((await response.json()).contextState).toEqual({ status: "legacy" });
    }
    tables.land_use_plans = { data: null, error: { message: "failure" } };
    expect((await GET(new NextRequest("http://localhost"), context)).status).toBe(503);
  });
});
