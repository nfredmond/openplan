import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/workspaces/provider-api-connections/route";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), userFrom: vi.fn(), serviceFrom: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom }), createServiceRoleClient: () => ({ from: mocks.serviceFrom, rpc: mocks.rpc }) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.audit, warn: mocks.audit }) }));
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222",
  connectionId = "33333333-3333-4333-8333-333333333333", revisionId = "44444444-4444-4444-8444-444444444444",
  otherId = "55555555-5555-4555-8555-555555555555";
const origin = "http://localhost:3219";
const configuration = { label: "Synthetic API", protocol: "openai_chat_completions", endpoint: "https://model.fixture.invalid/v1/",
  modelIds: ["synthetic-model"], structuredOutput: true, authMode: "api_key", timeoutSeconds: 120 };
const input = () => ({ workspaceId, connectionId, revisionId, expectedRevisionId: null, configuration, apiKey: "SYNTHETIC-KEY" });
const connection = () => ({ id: connectionId, workspace_id: workspaceId, current_revision_id: revisionId, created_by: userId, created_at: "2026-09-12T00:00:00Z", revoked_at: null as string | null });
let retained: Record<string, unknown> | null;
let ciphertext: string | null;
let memberQuery: ReturnType<typeof query>;
let listQuery: ReturnType<typeof query>;
const reads: Array<{ table: string; query: ReturnType<typeof query> }> = [];
function query(data: unknown, error: unknown = null, count = 1) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.order.mockReturnValue(q); q.range.mockResolvedValue({ data, error, count });
  return q;
}
function request(method: string, body?: unknown, addressedOrigin = origin) {
  return new NextRequest(`${origin}/api/workspaces/provider-api-connections${method === "GET" ? `?workspaceId=${workspaceId}` : ""}`, {
    method, headers: { origin: addressedOrigin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function retainedRow(canonical: string) {
  return { id: revisionId, connection_id: connectionId, workspace_id: workspaceId, previous_revision_id: null,
    configuration: JSON.parse(canonical), configuration_canonical: canonical, configuration_hash: createHash("sha256").update(canonical).digest("hex"), configured_by: userId, created_at: "2026-09-12T00:00:00Z" };
}
beforeEach(() => {
  vi.resetAllMocks(); reads.length = 0; retained = null; ciphertext = null;
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-OPERATOR-SECRET-ONLY-FOR-TESTS");
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  memberQuery = query({ workspace_id: workspaceId, role: "owner" });
  listQuery = query([{ ...connection(), current_revision: { configuration } }]);
  mocks.userFrom.mockImplementation(table => table === "workspace_members" ? memberQuery : listQuery);
  mocks.serviceFrom.mockImplementation(table => {
    const q = query(table === "workspace_provider_api_revisions" ? retained : { revision_id: revisionId, connection_id: connectionId, workspace_id: workspaceId, credential_ciphertext: ciphertext });
    reads.push({ table, query: q }); return q;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "revoke_workspace_provider_api_connection") return { data: { ...connection(), revoked_at: "2026-09-12T01:00:00Z" }, error: null };
    const created = retained === null;
    retained = retainedRow(String(args.p_configuration_canonical)); ciphertext = args.p_credential_ciphertext as string | null;
    return { data: { created, connection: connection(), revision: retained }, error: null };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("workspace API connection routes", () => {
  it("stores encrypted credentials with exact identity and returns metadata only", async () => {
    const response = await route.PUT(request("PUT", input()));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ created: true, revision: { id: revisionId, configuration } });
    expect(ciphertext).toMatch(/^v2:/);
    expect(JSON.stringify(body)).not.toContain(ciphertext!);
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC-KEY");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("SYNTHETIC-KEY");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(ciphertext!);
    expect(mocks.rpc).toHaveBeenCalledWith("save_workspace_provider_api_revision", expect.objectContaining({ p_user_id: userId, p_workspace_id: workspaceId, p_connection_id: connectionId, p_revision_id: revisionId, p_expected_revision_id: null }));
    expect(memberQuery.select).toHaveBeenCalledWith("workspace_id, role");
    expect(memberQuery.eq).toHaveBeenCalledWith("user_id", userId);
  });

  for (const role of ["member", "viewer", null]) for (const method of ["PUT", "DELETE"] as const) {
    it(`refuses ${role ?? "non-member"} ${method} before any private read`, async () => {
      memberQuery.maybeSingle.mockResolvedValue({ data: role ? { workspace_id: workspaceId, role } : null, error: null });
      expect((await route[method](request(method, method === "PUT" ? input() : { workspaceId, connectionId, expectedRevisionId: revisionId }))).status).toBe(role ? 403 : 404);
      expect(mocks.serviceFrom).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }
  for (const method of ["PUT", "DELETE"] as const) {
    it(`refuses cross-origin ${method}`, async () => {
      const body = method === "PUT" ? input() : { workspaceId, connectionId, expectedRevisionId: revisionId };
      expect((await route[method](request(method, body, "https://unrelated.fixture.invalid"))).status).toBe(403);
      expect(mocks.serviceFrom).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }
  it("refuses a signed-out manager", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await route.PUT(request("PUT", input()))).status).toBe(401);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it("recovers the same plaintext key despite randomized encryption on retry", async () => {
    await route.PUT(request("PUT", input())); const originalCiphertext = ciphertext;
    const again = await route.PUT(request("PUT", input()));
    expect(again.status).toBe(200); expect((await again.json()).created).toBe(false);
    expect(ciphertext).toBe(originalCiphertext);
    const revisionRead = reads.find(row => row.query.eq.mock.calls.some(([key]) => key === "id"))!;
    expect(revisionRead.query.select).toHaveBeenCalledWith("id,connection_id,workspace_id,previous_revision_id,configuration,configuration_canonical,configuration_hash,configured_by,created_at");
    const keyRead = reads.find(row => row.table === "workspace_provider_api_credentials")!;
    expect(keyRead.query.select).toHaveBeenCalledWith("revision_id,connection_id,workspace_id,credential_ciphertext");
    for (const read of reads) {
      expect(read.query.eq).toHaveBeenCalledWith("workspace_id", workspaceId);
      expect(read.query.eq).toHaveBeenCalledWith("connection_id", connectionId);
    }
  });

  for (const field of ["apiKey", "configuration", "expectedRevisionId"]) {
    it(`refuses changed retry ${field}`, async () => {
      await route.PUT(request("PUT", input())); mocks.rpc.mockClear();
      const changed = { ...input(), [field]: field === "apiKey" ? "DIFFERENT-SYNTHETIC-KEY" : field === "configuration" ? { ...configuration, modelIds: ["changed-model"] } : otherId };
      expect((await route.PUT(request("PUT", changed))).status).toBe(409);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }

  it("recovers a concurrent identical save by reading the winning ciphertext", async () => {
    const prepared = prepareProviderApiRevision(input());
    mocks.rpc.mockImplementationOnce(async () => {
      retained = retainedRow(JSON.stringify(prepared.configuration)); ciphertext = prepared.credentialCiphertext;
      return { data: null, error: { code: "PT409" } };
    });
    const response = await route.PUT(request("PUT", input()));
    expect(response.status).toBe(200); expect((await response.json()).created).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(ciphertext).toBe(prepared.credentialCiphertext);
  });

  it("refuses a save response naming a different revision", async () => {
    const row = retainedRow(JSON.stringify(configuration));
    mocks.rpc.mockResolvedValueOnce({ data: { created: true, connection: connection(), revision: { ...row, id: otherId } }, error: null });
    expect((await route.PUT(request("PUT", input()))).status).toBe(409);
  });

  it("returns metadata with an explicit page count and narrow query projection", async () => {
    const response = await route.GET(request("GET"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 1, offset: 0, nextOffset: null });
    expect(memberQuery.select).toHaveBeenCalledWith("workspace_id,role");
    expect(listQuery.select).toHaveBeenCalledWith("id,workspace_id,current_revision_id,created_by,created_at,revoked_at,current_revision:workspace_provider_api_revisions!workspace_provider_api_current_revision(id,connection_id,workspace_id,previous_revision_id,configuration,configuration_canonical,configuration_hash,configured_by,created_at)", { count: "exact" });
    expect(listQuery.eq).toHaveBeenCalledWith("workspace_id", workspaceId); expect(listQuery.range).toHaveBeenCalledWith(0,49);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });
  it("refuses a metadata request from a non-member", async () => {
    memberQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await route.GET(request("GET"))).status).toBe(404);
    expect(listQuery.select).not.toHaveBeenCalled();
  });
  it("does not turn a failed membership lookup into empty success", async () => {
    memberQuery.maybeSingle.mockResolvedValue({ data: null, error: { code: "08006", message: "DO-NOT-EXPOSE" } });
    const response = await route.GET(request("GET"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("DO-NOT-EXPOSE");
    expect(listQuery.select).not.toHaveBeenCalled();
  });
  it("checks exact revocation identity before reporting success", async () => {
    const response = await route.DELETE(request("DELETE", { workspaceId, connectionId, expectedRevisionId: revisionId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_workspace_provider_api_connection", { p_user_id: userId, p_workspace_id: workspaceId, p_connection_id: connectionId, p_expected_revision_id: revisionId });
    mocks.rpc.mockResolvedValueOnce({ data: { ...connection(), id: otherId, revoked_at: "2026-09-12T01:00:00Z" }, error: null });
    expect((await route.DELETE(request("DELETE", { workspaceId, connectionId, expectedRevisionId: revisionId }))).status).toBe(409);
  });
  it("reads revision history with explicit workspace and connection projections", async () => {
    const historyQuery = query([retainedRow(JSON.stringify(configuration))], null, 51);
    const connectionQuery = query({ id: connectionId });
    mocks.userFrom.mockImplementation(table => table === "workspace_members" ? memberQuery : table === "workspace_provider_api_connections" ? connectionQuery : historyQuery);
    const response = await route.GET(new NextRequest(`${origin}/api/workspaces/provider-api-connections?workspaceId=${workspaceId}&connectionId=${connectionId}`));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 51, nextOffset: 50, revisions: [{ id: revisionId }] });
    expect(connectionQuery.select).toHaveBeenCalledWith("id");
    expect(connectionQuery.eq).toHaveBeenCalledWith("workspace_id", workspaceId); expect(connectionQuery.eq).toHaveBeenCalledWith("id", connectionId);
    expect(historyQuery.select).toHaveBeenCalledWith("id,connection_id,workspace_id,previous_revision_id,configuration,configuration_canonical,configuration_hash,configured_by,created_at", { count: "exact" });
    expect(historyQuery.eq).toHaveBeenCalledWith("workspace_id", workspaceId); expect(historyQuery.eq).toHaveBeenCalledWith("connection_id", connectionId);
    expect(historyQuery.range).toHaveBeenCalledWith(0, 49); expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });
  it("does not present a missing or inaccessible connection as empty history", async () => {
    const connectionQuery = query(null);
    mocks.userFrom.mockImplementation(table => table === "workspace_members" ? memberQuery : connectionQuery);
    expect((await route.GET(new NextRequest(`${origin}/api/workspaces/provider-api-connections?workspaceId=${workspaceId}&connectionId=${connectionId}`))).status).toBe(404);
    expect(mocks.userFrom).not.toHaveBeenCalledWith("workspace_provider_api_revisions");
  });

});
