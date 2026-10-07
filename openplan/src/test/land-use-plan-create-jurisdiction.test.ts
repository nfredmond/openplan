import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { creationCommandFixture, creationReceiptFixture, creationScope, creationId } from "./fixtures/land-use-plans/creation";
import { getPlanKindDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), membership: vi.fn(), userFrom: vi.fn(), service: vi.fn(), from: vi.fn(), rpc: vi.fn(), resolve: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.userFrom }), createServiceRoleClient: mocks.service }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: mocks.membership }));
vi.mock("@/lib/geographies/place-resolver", () => ({ resolvePlaceBoundary: mocks.resolve }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: mocks.warn }) }));
import { POST } from "@/app/api/land-use-plans/route";
import { POST as STOP } from "@/app/api/land-use-plans/creation-requests/[commandId]/stop/route";

const client = { from: mocks.from, rpc: mocks.rpc };
let lookup: { data: null | { command_id: string }; error: unknown };
let queries: { table: string; projection: string; filters: [string, unknown][] }[];
function request(body: string | Uint8Array = JSON.stringify(creationCommandFixture()), headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/land-use-plans", { method: "POST", body: body as BodyInit,
    headers: { origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": creationScope.actorId,
      "x-openplan-expected-workspace": creationScope.workspaceId, ...headers } });
}
beforeEach(() => {
  vi.clearAllMocks(); queries = []; lookup = { data: null, error: null };
  mocks.auth.mockResolvedValue({ data: { user: { id: creationScope.actorId } }, error: null });
  mocks.membership.mockResolvedValue({ membership: { workspace_id: creationScope.workspaceId, role: "member" },
    workspace: { home_country_code: "US", home_subdivision_code: "PR" } });
  mocks.userFrom.mockImplementation(() => { throw new Error("Creation must not read workspace home or write separate rows"); });
  mocks.service.mockReturnValue(client); mocks.rpc.mockResolvedValue({ data: creationReceiptFixture(), error: null });
  mocks.resolve.mockRejectedValue(new Error("Unexpected boundary lookup"));
  mocks.from.mockImplementation((table: string) => {
    const query = { table, projection: "", filters: [] as [string, unknown][] }; queries.push(query);
    const chain = { select: (projection: string) => { query.projection = projection; return chain; }, eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; }, maybeSingle: async () => lookup };
    return chain;
  });
});

describe("authenticated creation stop route", () => {
  const context = { params: Promise.resolve({ commandId: creationId(3) }) };
  const receipt = (text: string) => ({ outcome: "cancelled", replayed: false, ...creationScope, commandId: creationId(3), commandText: text, cancelledAt: "2026-10-07T14:00:00Z" });
  it("stops original bytes without rerunning installed rules or a place lookup", async () => {
    const command = { ...creationCommandFixture(), descriptorId: "uninstalled-old-rules" }, raw = ` \n${JSON.stringify(command)}\n`;
    mocks.rpc.mockResolvedValue({ data: receipt(raw), error: null });
    const response = await STOP(request(raw), context); expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt(raw));
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.userFrom).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_land_use_plan_creation", { p_actor_id: creationScope.actorId, p_workspace_id: creationScope.workspaceId, p_command_id: creationId(3), p_command_text: raw });
  });
  it("returns the retained created plan without claiming cancellation", async () => {
    const result = { outcome: "created", result: { ...creationReceiptFixture(), replayed: true } }; mocks.rpc.mockResolvedValue({ data: result, error: null });
    const response = await STOP(request(), context); expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    mocks.rpc.mockResolvedValue({ data: { outcome: "created", result: creationReceiptFixture() }, error: null }); expect((await STOP(request(), context)).status).toBe(503);
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id", "x-openplan-expected-user", "x-openplan-expected-workspace"])("refuses unapproved stop scope %s", async key => {
    expect((await STOP(request(undefined, { [key]: creationId(9) }), context)).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("requires origin, authentication and current write membership", async () => {
    expect((await STOP(request(undefined, { origin: "http://elsewhere.test" }), context)).status).toBe(403);
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null }); expect((await STOP(request(), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ data: { user: null }, error: { message: "private" } }); expect((await STOP(request(), context)).status).toBe(503);
    mocks.auth.mockResolvedValue({ data: { user: { id: creationScope.actorId } }, error: null }); mocks.membership.mockResolvedValue({ membership: { workspace_id: creationScope.workspaceId, role: "viewer" } });
    expect((await STOP(request(), context)).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("refuses invalid IDs, bodies, scope fields and normalization before privileged access", async () => {
    expect((await STOP(request(), { params: Promise.resolve({ commandId: "invalid" }) })).status).toBe(400);
    expect((await STOP(request(), { params: Promise.resolve({ commandId: creationId(9) }) })).status).toBe(400);
    for (const raw of ["{", JSON.stringify({ ...creationCommandFixture(), title: " padded " }), JSON.stringify({ ...creationCommandFixture(), actorId: creationId(9) })]) expect((await STOP(request(raw), context)).status).toBe(400);
    expect((await STOP(request(" ".repeat(2_000_001)), context)).status).toBe(413); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([["PT400", 400], ["PT409", 409], ["42501", 403], ["XX000", 503]])("preserves stop RPC %s as %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private SQL detail" } }); const response = await STOP(request(), context);
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain("private SQL detail");
  });
  it("does not confirm a stop receipt for different bytes", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(JSON.stringify(creationCommandFixture()) + " "), error: null }); expect((await STOP(request(), context)).status).toBe(503);
  });
});

describe("plan-owned creation route", () => {
  it("uses exact bytes and authenticated scope for one atomic command without workspace-home reads", async () => {
    const raw = ` \n${JSON.stringify(creationCommandFixture())}\n`;
    const response = await POST(request(raw));
    expect(response.status).toBe(201); expect(await response.json()).toEqual(creationReceiptFixture());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.userFrom).not.toHaveBeenCalled();
    expect(queries).toEqual([{ table: "land_use_plan_creation_commands", projection: "command_id", filters: [["workspace_id", creationScope.workspaceId], ["command_id", creationId(3)]] }]);
    expect(mocks.rpc).toHaveBeenCalledWith("create_land_use_plan_with_context", expect.objectContaining({ p_actor_id: creationScope.actorId, p_workspace_id: creationScope.workspaceId, p_command_text: raw }));
  });
  it("allows assessed California plan authority with a Puerto Rico office and refuses an incompatible plan assessment", async () => {
    const descriptor = getPlanKindDescriptor("us-ca-general-plan", "comprehensive")!;
    const command = { ...creationCommandFixture(), descriptorId: descriptor.id, planKindKey: "comprehensive", expectedDescriptorHash: hashFrozenRecord(descriptor),
      assessment: { authorities: [{ id: creationId(4), label: "SYNTHETIC California agency", role: "Adopting", kind: "county", jurisdiction: { country: "US", subdivision: "CA" }, sourceUrls: ["https://example.test/authority"] }],
        applicability: { status: "staff_assessed" as const, explanation: "SYNTHETIC scope test only", sourceUrls: ["https://example.test/rules"], authorityIds: [creationId(4)] } } };
    const receipt = { ...creationReceiptFixture(), descriptorId: command.descriptorId, descriptorHash: command.expectedDescriptorHash, planKindKey: command.planKindKey,
      context: { ...creationReceiptFixture().context, assessment: command.assessment } };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect((await POST(request(JSON.stringify(command)))).status).toBe(201);
    command.assessment.authorities[0].jurisdiction.subdivision = "PR";
    expect((await POST(request(JSON.stringify(command)))).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.userFrom).not.toHaveBeenCalled();
  });
  it("replays the original receipt without boundary lookup or reinstalling old rules", async () => {
    lookup.data = { command_id: creationId(3) };
    mocks.rpc.mockResolvedValue({ data: { ...creationReceiptFixture(), replayed: true }, error: null });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_prepared_context).toBeNull(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unsupported agent writes marked by %s", async key => {
    expect((await POST(request(undefined, { [key]: "" }))).status).toBe(403); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "http://elsewhere.test" }, { "sec-fetch-site": "cross-site" }])("refuses another origin %j", async headers => {
    expect((await POST(request(undefined, headers))).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-expected-user", "x-openplan-expected-workspace"])("refuses changed scope %s", async key => {
    expect((await POST(request(undefined, { [key]: creationId(9) }))).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("distinguishes missing authentication, failed authentication and unavailable membership", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null }); expect((await POST(request())).status).toBe(401);
    mocks.auth.mockResolvedValue({ data: { user: null }, error: { message: "private auth" } }); expect((await POST(request())).status).toBe(503);
    mocks.auth.mockResolvedValue({ data: { user: { id: creationScope.actorId } }, error: null }); mocks.membership.mockRejectedValue(new Error("private membership"));
    expect((await POST(request())).status).toBe(503); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([null, { workspace_id: creationScope.workspaceId, role: "viewer" }])("refuses absent or read-only membership %j", async membership => {
    mocks.membership.mockResolvedValue({ membership }); expect((await POST(request())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("rejects malformed, unnormalized, client-attributed and old creation payloads before service access", async () => {
    for (const raw of ["{", JSON.stringify({ ...creationCommandFixture(), title: " padded " }), JSON.stringify({ ...creationCommandFixture(), actorId: creationId(9) }), JSON.stringify({ title: "Old payload", geographyGeojson: {} })]) {
      expect((await POST(request(raw))).status).toBe(400);
    }
    expect((await POST(request(new Uint8Array([0xc3, 0x28])))).status).toBe(400);
    expect((await POST(request(" ".repeat(2_000_001)))).status).toBe(413); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([["PT400", 400], ["PT409", 409], ["42501", 403], ["XX000", 503]])("preserves native %s as %s without exposing diagnostics", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private native details" } });
    const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain("private native details");
  });
  it("does not acknowledge a substituted receipt or unreadable journal", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...creationReceiptFixture(), actorId: creationId(9) }, error: null }); expect((await POST(request())).status).toBe(503);
    lookup.error = { message: "private lookup" }; expect((await POST(request())).status).toBe(503); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
