import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/providers/turns/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), serviceFrom: vi.fn(), inline: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
  createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.serviceFrom }) }));
vi.mock("@/lib/assistant/provider-api-turn", () => ({ runProviderApiTurn: mocks.inline }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.audit, warn: mocks.audit }) }));
const id = "11111111-1111-4111-8111-111111111111", owner = "22222222-2222-4222-8222-222222222222",
  workspace = "33333333-3333-4333-8333-333333333333", project = "44444444-4444-4444-8444-444444444444",
  connection = "55555555-5555-4555-8555-555555555555", revision = "66666666-6666-4666-8666-666666666666",
  requestId = "77777777-7777-4777-8777-777777777777", other = "88888888-8888-4888-8888-888888888888";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const configuration = (authMode = "api_key") => ({ label: "SYNTHETIC API", protocol: "openai_chat_completions", endpoint: "https://synthetic.example.test/v1/",
  modelIds: ["synthetic-model", "synthetic-other-model"], structuredOutput: true, authMode, timeoutSeconds: 30 });
const body = (authMode = "connection_api_key") => ({ workspaceId: workspace, projectId: project, requestId, provider: "api_connection", connectionId: connection,
  revisionId: revision, configurationHash: hash(JSON.stringify(configuration(authMode === "connection_no_key" ? "none" : "api_key"))),
  model: "synthetic-model", authMode, acceptApiCharges: true, question: "SYNTHETIC question" });
function request(value: unknown, origin = "http://localhost:3219") {
  return new NextRequest("http://localhost:3219/api/assistant/providers/turns", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
}
function query(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); return q;
}
let member: ReturnType<typeof query>, selectedProject: ReturnType<typeof query>;
type Args = Record<string, string | boolean>;
function retained(args: Args, changes: Record<string, unknown> = {}) {
  const canonical = String(args.p_packet_canonical);
  return { id, request_id: args.p_request_id, user_id: args.p_user_id, workspace_id: args.p_workspace_id, project_id: args.p_project_id,
    connection_id: null, provider: "api_connection", model_id: args.p_model_id, auth_mode: args.p_auth_mode, question: args.p_question,
    packet_canonical: canonical, packet_hash: hash(canonical), state: "queued", attempt_id: null, lease_expires_at: null, result: null,
    provider_receipt: null, failure_code: null, created_at: "2026-09-12T00:00:00Z", started_at: null, finished_at: null,
    api_connection_id: args.p_connection_id, api_revision_id: args.p_revision_id, api_configuration_hash: args.p_configuration_hash,
    api_configuration_canonical: JSON.stringify(configuration(args.p_auth_mode === "connection_no_key" ? "none" : "api_key")), api_charge_ack: args.p_charge_ack, ...changes };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  member = query({ role: "member" });
  selectedProject = query({ id: project, workspace_id: workspace, name: "SYNTHETIC project", summary: "SYNTHETIC original",
    status: "active", plan_type: "other", delivery_phase: "planning", updated_at: "2026-09-12T00:00:00Z" });
  mocks.from.mockImplementation(table => { if (table === "workspace_members") return member; if (table === "projects") return selectedProject; throw new Error("Unrelated private read"); });
  mocks.serviceFrom.mockImplementation(() => { throw new Error("Queue route must not read credentials or execute actions"); });
  mocks.rpc.mockImplementation(async (_name, args: Args) => ({ data: { created: true, turn: retained(args) }, error: null }));
});

describe("saved API project request route", () => {
  it.each(["connection_api_key", "connection_no_key"])("queues the exact saved revision with %s without inline generation", async authMode => {
    const input = body(authMode); const response = await POST(request(input));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    const saved = await response.json(); expect(saved.turn).toMatchObject({ state: "queued", api_connection_id: connection, api_revision_id: revision });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_assistant_api_turn", {
      p_request_id: requestId, p_user_id: owner, p_workspace_id: workspace, p_project_id: project, p_connection_id: connection,
      p_revision_id: revision, p_configuration_hash: input.configurationHash, p_model_id: input.model, p_auth_mode: input.authMode,
      p_charge_ack: true, p_question: input.question, p_packet_canonical: saved.turn.packet_canonical,
    });
    expect(selectedProject.select).toHaveBeenCalledWith("id,workspace_id,name,summary,status,plan_type,delivery_phase,updated_at");
    expect(selectedProject.eq).toHaveBeenCalledWith("workspace_id", workspace); expect(selectedProject.eq).toHaveBeenCalledWith("id", project);
    expect(member.select).toHaveBeenCalledWith("role"); expect(member.eq).toHaveBeenCalledWith("user_id", owner);
    expect(mocks.serviceFrom).not.toHaveBeenCalled(); expect(mocks.inline).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(input.question);
  });
  it.each([
    { acceptApiCharges: false }, { acceptApiCharges: undefined }, { acceptApiCharges: "true" }, { revisionId: undefined },
    { revisionId: "bad" }, { connectionId: null }, { configurationHash: "bad" }, { configurationHash: undefined },
    { authMode: "workspace_api_key" }, { apiKey: "SYNTHETIC unsolicited key" }, { userId: other },
  ])("refuses invalid or unacknowledged API selection %j before storage", async change => {
    const response = await POST(request({ ...body(), ...change }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.inline).not.toHaveBeenCalled();
  });
  it("denies a foreign browser origin before authenticating or storing", async () => {
    expect((await POST(request(body(), "https://foreign.example.test"))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies missing current membership before reading project data", async () => {
    member.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await POST(request(body()))).status).toBe(403);
    expect(selectedProject.select).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ user_id: other }, { api_connection_id: other }, { api_revision_id: other }, { model_id: "synthetic-other-model" },
    { question: "SYNTHETIC wrong question" }, { request_id: other }])("refuses a valid stored row bound to a different request %j", async change => {
    mocks.rpc.mockImplementation(async (_name, args: Args) => ({ data: { created: true, turn: retained(args, change) }, error: null }));
    const response = await POST(request(body())); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "provider_retry_conflict" });
    expect(mocks.inline).not.toHaveBeenCalled();
  });
  it("refuses a different valid frozen configuration hash", async () => {
    const canonical = JSON.stringify({ ...configuration(), label: "SYNTHETIC other revision" });
    mocks.rpc.mockImplementation(async (_name, args: Args) => ({ data: { created: true, turn: retained(args, { api_configuration_canonical: canonical, api_configuration_hash: hash(canonical) }) }, error: null }));
    const response = await POST(request(body())); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "provider_retry_conflict" });
  });
  it.each([true, false])("requires the new packet only when created is %s, preserving the old retry baseline", async created => {
    let oldCanonical = "";
    mocks.rpc.mockImplementation(async (_name, args: Args) => {
      const old = JSON.parse(String(args.p_packet_canonical)); old.project.summary = "SYNTHETIC previously retained baseline"; old.capturedAt = "2026-09-10T00:00:00Z";
      oldCanonical = JSON.stringify(old);
      return { data: { created, turn: retained(args, { packet_canonical: oldCanonical, packet_hash: hash(oldCanonical) }) }, error: null };
    });
    const response = await POST(request(body())); expect(response.status).toBe(created ? 409 : 200);
    if (!created) expect((await response.json()).turn.packet_canonical).toBe(oldCanonical);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.inline).not.toHaveBeenCalled();
  });
  it("returns the retained request on response-loss retry without a second dispatch", async () => {
    let first: ReturnType<typeof retained>;
    mocks.rpc.mockImplementationOnce(async (_name, args: Args) => { first = retained(args); return { data: { created: true, turn: first }, error: null }; });
    const saved = await (await POST(request(body()))).json();
    mocks.rpc.mockResolvedValue({ data: { created: false, turn: saved.turn }, error: null });
    const retry = await POST(request(body())); expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ created: false, turn: saved.turn });
    expect(mocks.inline).not.toHaveBeenCalled(); expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });
  it("preserves a current-revision or retry conflict from the database", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "SYNTHETIC private storage detail" } });
    const response = await POST(request(body())); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "provider_retry_conflict" });
    expect(mocks.inline).not.toHaveBeenCalled();
  });
});
