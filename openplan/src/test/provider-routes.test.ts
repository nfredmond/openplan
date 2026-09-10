import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProviderConnectionToken, PROVIDER_CONNECTION_COLUMNS, PROVIDER_TURN_COLUMNS } from "@/lib/assistant/provider-server";
import { providerProjectPacketSchema, parseProviderProjectAnswer } from "@/lib/assistant/provider-project-task";
import * as connections from "@/app/api/assistant/providers/connections/route";
import * as native from "@/app/api/assistant/providers/native/route";
import * as turns from "@/app/api/assistant/providers/turns/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), userFrom: vi.fn(), serviceFrom: vi.fn(), rpc: vi.fn(), api: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.audit, warn: mocks.audit }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.userFrom }),
  createServiceRoleClient: () => ({ from: mocks.serviceFrom, rpc: mocks.rpc }) }));
vi.mock("@/lib/assistant/provider-api-turn", () => ({ runProviderApiTurn: mocks.api }));
const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444", attempt = "55555555-5555-4555-8555-555555555555", owner = "66666666-6666-4666-8666-666666666666";
const origin = "http://localhost:3219";
let token: ReturnType<typeof newProviderConnectionToken>;
const packet = () => providerProjectPacketSchema.parse({ version: 1, workspaceId: workspace, project: { id: project, name: "SYNTHETIC project", summary: null,
  status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-09-10T00:00:00Z" }, capturedAt: "2026-09-10T01:00:00Z",
  source: { id: `project:${project}`, label: "SYNTHETIC project", href: `/projects/${project}` } });
const answer = () => ({ answer: "The cost is not supplied.", citations: [`project:${project}`], submittal: { projectId: project, title: "Draft record", submittalType: "other", notes: "" } });
const receipt = () => ({ schemaVersion: 1, provider: "codex", model: "fixture-model", authMode: "chatgpt", planType: "fixture", threadId: "synthetic-native-thread", turnId: "synthetic-native-turn" });
function turn(overrides: Record<string, unknown> = {}) {
  const canonical = JSON.stringify(packet());
  return { id, request_id: requestId, workspace_id: workspace, project_id: project, connection_id: token.connectionId,
    provider: "codex", model_id: "fixture-model", auth_mode: "chatgpt", question: "What is known?", packet_canonical: canonical,
    packet_hash: createHash("sha256").update(canonical).digest("hex"), state: "running", attempt_id: attempt,
    lease_expires_at: "2099-01-01T00:00:00Z", result: null, provider_receipt: null, failure_code: null,
    created_at: "2026-09-10T01:00:00Z", started_at: "2026-09-10T01:00:00Z", finished_at: null, ...overrides };
}
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) };
  for (const fn of [q.select, q.eq, q.order, q.limit]) fn.mockReturnValue(q);
  q.maybeSingle.mockResolvedValue({ data, error });
  return q;
}
let memberQuery: ReturnType<typeof query>, projectQuery: ReturnType<typeof query>, turnQuery: ReturnType<typeof query>, connectionQuery: ReturnType<typeof query>;
function browserRequest(path: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/assistant/providers/${path}`, { method, headers: { origin, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function nativeRequest(body: unknown, bearer = token.token) { return browserRequest("native", body, "POST", { authorization: `Bearer ${bearer}` }); }
const createBody = () => ({ workspaceId: workspace, projectId: project, requestId, question: "What is known?", model: "fixture-model", provider: "codex", connectionId: token.connectionId, authMode: "chatgpt" });

beforeEach(() => {
  vi.resetAllMocks(); token = newProviderConnectionToken();
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  memberQuery = query({ role: "member" });
  projectQuery = query({ id: project, workspace_id: workspace, name: "SYNTHETIC project", summary: null, status: "active", plan_type: "corridor", delivery_phase: "planning", updated_at: "2026-09-10T00:00:00Z" });
  turnQuery = query(turn()); connectionQuery = query([{ id: token.connectionId }]);
  mocks.userFrom.mockImplementation(table => table === "workspace_members" ? memberQuery : table === "projects" ? projectQuery : table === "assistant_provider_connections" ? connectionQuery : query([turn()]));
  mocks.serviceFrom.mockImplementation(() => turnQuery);
  let cancelled = false;
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "claim_assistant_provider_turn") return { data: { status: "connected", turn: turn() }, error: null };
    if (name === "create_assistant_provider_connection") return { data: { id: args.p_id }, error: null };
    if (name === "create_assistant_provider_turn") return { data: { created: true, turn: turn({ state: "queued", attempt_id: null }) }, error: null };
    if (name === "finish_assistant_provider_turn") return { data: turn({ state: args.p_failure_code ? "failed" : "succeeded", result: args.p_result, provider_receipt: args.p_provider_receipt, failure_code: args.p_failure_code, finished_at: "2026-09-10T01:01:00Z" }), error: null };
    if (name === "cancel_assistant_provider_turn") { cancelled = true; return { data: null, error: null }; }
    if (name === "read_assistant_provider_turn_for_user") return { data: turn(cancelled ? { state: "cancelled", finished_at: "2026-09-10T01:01:00Z" } : {}), error: null };
    return { data: { id, state: "running", attemptId: attempt }, error: null };
  });
});

describe("personal project connection routes", () => {
  it("issues Claude v2 setup bound to the exact native provider and subscription mode", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: { id: args.p_id }, error: null }));
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, provider: "claude", label: "Claude fixture", authMode: "claude_subscription" }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.setup).toMatchObject({ version: 2, provider: "claude", workspaceId: workspace, projectId: project, expectedAuthMode: "claude_subscription" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_assistant_provider_connection_v2", expect.objectContaining({ p_provider: "claude", p_auth_mode: "claude_subscription", p_user_id: owner, p_project_id: project }));
    expect(mocks.rpc.mock.calls[0][1].p_token_hash).toBe(createHash("sha256").update(saved.setup.token).digest("hex"));
  });
  it.each([{ provider: "claude", authMode: "apiKey" }, { provider: "claude", authMode: "chatgpt" }, { provider: "codex", authMode: "claude_subscription" }, { authMode: "claude_subscription" }])("refuses a connection with the wrong provider account pair %j", async changed => {
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Bad pair", ...changed }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("issues a scoped token once and stores only its hash after exact project reads", async () => {
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Local fixture", authMode: "chatgpt" }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    const saved = await response.json(); const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_token_hash).toBe(createHash("sha256").update(saved.setup.token).digest("hex"));
    expect(JSON.stringify(args)).not.toContain(saved.setup.token);
    expect(mocks.audit).toHaveBeenCalledWith("connection_issued", { connectionId: saved.setup.connectionId });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(saved.setup.token);
    expect(args).toMatchObject({ p_user_id: owner, p_workspace_id: workspace, p_project_id: project, p_auth_mode: "chatgpt" });
    expect(saved.setup).toMatchObject({ appUrl: origin, workspaceId: workspace, projectId: project, expectedAuthMode: "chatgpt" });
    expect(projectQuery.select).toHaveBeenCalledWith("id,workspace_id,name,summary,status,plan_type,delivery_phase,updated_at");
    expect(projectQuery.eq).toHaveBeenCalledWith("workspace_id", workspace); expect(projectQuery.eq).toHaveBeenCalledWith("id", project);
    expect(memberQuery.eq).toHaveBeenCalledWith("user_id", owner); expect(memberQuery.select).toHaveBeenCalledWith("role");
  });
  it("lists only owner/project metadata without token digests", async () => {
    const response = await connections.GET(browserRequest(`connections?workspaceId=${workspace}&projectId=${project}`, undefined, "GET"));
    expect(response.status).toBe(200); expect(connectionQuery.select).toHaveBeenCalledWith(PROVIDER_CONNECTION_COLUMNS);
    expect(PROVIDER_CONNECTION_COLUMNS).not.toContain("token_hash");
    expect(connectionQuery.eq).toHaveBeenCalledWith("user_id", owner); expect(connectionQuery.eq).toHaveBeenCalledWith("project_id", project);
  });
  it("uses the browser's addressed host when Next supplies an internal localhost URL", async () => {
    const body = { workspaceId: workspace, projectId: project, label: "Local fixture", authMode: "chatgpt" };
    const response = await connections.POST(browserRequest("connections", body, "POST", { host: "127.0.0.1:3219", origin: "http://127.0.0.1:3219", "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(201); expect((await response.json()).setup.appUrl).toBe("http://127.0.0.1:3219");
    expect((await connections.POST(browserRequest("connections", body, "POST", { host: "127.0.0.1:3219", origin }))).status).toBe(403);
  });
  it("supports the proxy's HTTPS scheme without trusting a different forwarded host", async () => {
    const body = { workspaceId: workspace, projectId: project, label: "Local fixture", authMode: "chatgpt" };
    const response = await connections.POST(browserRequest("connections", body, "POST", { host: "planning.example", origin: "https://planning.example", "x-forwarded-proto": "https" }));
    expect(response.status).toBe(201); expect((await response.json()).setup.appUrl).toBe("https://planning.example");
    expect((await connections.POST(browserRequest("connections", body, "POST", { host: "planning.example", origin: "https://other.example", "x-forwarded-proto": "https", "x-forwarded-host": "other.example" }))).status).toBe(403);
  });
  it.each(["https://evil.example", "null", ""])("denies a foreign or missing mutation origin %s before issuing tokens", async value => {
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Device", authMode: "chatgpt" }, "POST", { origin: value }));
    expect(response.status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies an unauthenticated caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await connections.DELETE(browserRequest("connections", { connectionId: token.connectionId }, "DELETE"));
    expect(response.status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses missing membership and mismatched project identity", async () => {
    memberQuery = query(null);
    expect((await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Device", authMode: "chatgpt" }))).status).toBe(403);
    memberQuery = query({ role: "member" }); projectQuery = query({ id: project, workspace_id: owner });
    expect((await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Device", authMode: "chatgpt" }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("revokes as the authenticated owner even after project access is lost", async () => {
    const response = await connections.DELETE(browserRequest("connections", { connectionId: token.connectionId }, "DELETE"));
    expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("revoke_assistant_provider_connection", { p_id: token.connectionId, p_user_id: owner });
    expect(mocks.userFrom).not.toHaveBeenCalled();
  });
});

describe("connector bearer routes", () => {
  it("claims Claude with its exact provider and refuses a different provider carrying that mode", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", turn: turn({ provider: "claude", auth_mode: "claude_subscription", model_id: "claude-sonnet-4-6" }) }, error: null });
    const response = await native.POST(nativeRequest({ operation: "claim", authMode: "claude_subscription", status: "connected" }));
    expect(response.status).toBe(200);
    const claimed = (await response.json()).turn;
    expect(claimed).toMatchObject({ provider: "claude", authMode: "claude_subscription", model: "claude-sonnet-4-6" });
    expect(claimed.outputSchema).toEqual(JSON.parse(readFileSync(resolve(process.cwd(), "../workers/planner_agent_connector/test/project-output-schema.json"), "utf8")));
    mocks.rpc.mockResolvedValue({ data: { status: "connected", turn: turn({ provider: "codex", auth_mode: "claude_subscription" }) }, error: null });
    expect((await native.POST(nativeRequest({ operation: "claim", authMode: "claude_subscription", status: "connected" }))).status).toBe(409);
  });
  it("retains Claude answers and rejects another provider's receipt before database completion", async () => {
    const claudeTurn = turn({ provider: "claude", auth_mode: "claude_subscription", model_id: "claude-sonnet-4-6" });
    turnQuery = query(claudeTurn);
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === "finish_assistant_provider_turn" ? { ...claudeTurn, state: "succeeded", result: args.p_result, provider_receipt: args.p_provider_receipt } : { id, attemptId: attempt, state: "running" }, error: null }));
    const body = { operation: "finish", turnId: id, attemptId: attempt, answer: JSON.stringify(answer()), receipt: { ...receipt(), provider: "claude", authMode: "claude_subscription", model: "claude-sonnet-4-6" }, failureCode: null };
    expect((await native.POST(nativeRequest(body))).status).toBe(200);
    expect(turnQuery.select).toHaveBeenCalledWith(PROVIDER_TURN_COLUMNS);
    mocks.rpc.mockClear();
    const refused = await native.POST(nativeRequest({ ...body, receipt: { ...body.receipt, provider: "codex" } }));
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: "provider_receipt_mismatch" });
    expect(mocks.rpc.mock.calls.some(call => call[0] === "finish_assistant_provider_turn")).toBe(false);
  });
  it("discloses only a checked project task with the exact native attempt", async () => {
    const response = await native.POST(nativeRequest({ operation: "claim", authMode: "chatgpt", status: "connected" }));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.turn).toMatchObject({ id, attemptId: attempt, workspaceId: workspace, projectId: project, model: "fixture-model", authMode: "chatgpt", packetHash: turn().packet_hash });
    expect(body.turn.outputSchema.properties.submittal).toBeDefined();
    expect(body.turn.outputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(body)).not.toContain(owner); expect(JSON.stringify(body)).not.toContain(token.token);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("claim_assistant_provider_turn", { p_connection_id: token.connectionId, p_token_hash: token.tokenHash, p_auth_mode: "chatgpt", p_status: "connected" });
  });
  it.each(["", "browser-cookie-session", "op_pc_bad.secret"])("never uses browser authentication in place of a bearer %s", async bearer => {
    expect((await native.POST(nativeRequest({ operation: "claim", authMode: "chatgpt", status: "connected" }, bearer))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it.each([{ connection_id: owner }, { auth_mode: "apiKey" }, { packet_hash: "a".repeat(64) }, { workspace_id: owner }])("refuses a corrupted or misbound claim %j", async change => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", turn: turn(change) }, error: null });
    const response = await native.POST(nativeRequest({ operation: "claim", authMode: "chatgpt", status: "connected" }));
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain("SYNTHETIC project");
  });
  it("returns status without project data when no request can be claimed", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "auth_mode_changed", turn: null }, error: null });
    expect(await (await native.POST(nativeRequest({ operation: "claim", authMode: "apiKey", status: "connected" }))).json()).toEqual({ status: "auth_mode_changed", turn: null });
  });
  it("checks access before reading the retained packet and parses only a draft proposal", async () => {
    const response = await native.POST(nativeRequest({ operation: "finish", turnId: id, attemptId: attempt, answer: JSON.stringify(answer()), receipt: receipt(), failureCode: null }));
    expect(response.status).toBe(200); expect(mocks.rpc.mock.calls[0][0]).toBe("read_assistant_provider_turn_status");
    expect(turnQuery.select).toHaveBeenCalledWith(PROVIDER_TURN_COLUMNS); expect(turnQuery.eq).toHaveBeenCalledWith("connection_id", token.connectionId);
    const finish = mocks.rpc.mock.calls.find(c => c[0] === "finish_assistant_provider_turn")![1];
    expect(finish.p_result).toEqual(parseProviderProjectAnswer(packet(), answer())); expect(finish.p_user_id).toBeNull();
    expect(finish.p_result.proposal.payload.recordType).toBe("submittal");
    expect(await response.json()).toEqual({ id, state: "succeeded", attemptId: attempt });
  });
  it("refuses a revoked token before any packet read", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "PRIVATE_DATABASE_CANARY" } });
    const response = await native.POST(nativeRequest({ operation: "finish", turnId: id, attemptId: attempt, answer: JSON.stringify(answer()), receipt: receipt(), failureCode: null }));
    expect(response.status).toBe(403); expect(mocks.serviceFrom).not.toHaveBeenCalled(); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_DATABASE_CANARY");
    expect(mocks.audit).toHaveBeenCalledWith("request_refused", { status: 403 });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("PRIVATE_DATABASE_CANARY");
  });
  it.each([
    { answer: JSON.stringify({ ...answer(), submittal: { ...answer().submittal, projectId: owner } }) },
    { answer: JSON.stringify({ ...answer(), citations: ["private:other"] }) },
    { receipt: { ...receipt(), model: "different-model" } }, { attemptId: owner },
    { failureCode: "native_failed" }, { receipt: { ...receipt(), cookie: "PRIVATE_COOKIE" } },
  ])("refuses an altered attempt, wider output or receipt %j", async change => {
    const response = await native.POST(nativeRequest({ operation: "finish", turnId: id, attemptId: attempt, answer: JSON.stringify(answer()), receipt: receipt(), failureCode: null, ...change }));
    expect(response.status).toBeGreaterThanOrEqual(400); expect(mocks.rpc.mock.calls.some(c => c[0] === "finish_assistant_provider_turn")).toBe(false);
  });
  it("retains a bounded failure without an answer or provider receipt", async () => {
    const response = await native.POST(nativeRequest({ operation: "finish", turnId: id, attemptId: attempt, answer: null, receipt: null, failureCode: "native_usage_limit" }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: "failed" });
  });
});

describe("saved browser provider requests", () => {
  it("queues a native turn with only server-read evidence", async () => {
    const response = await turns.POST(browserRequest("turns", createBody()));
    expect(response.status).toBe(201); const args = mocks.rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_user_id: owner, p_request_id: requestId, p_connection_id: token.connectionId, p_model_id: "fixture-model" });
    expect(JSON.parse(args.p_packet_canonical).project.summary).toBeNull(); expect(mocks.api).not.toHaveBeenCalled();
  });
  it("returns a recovered API answer without running another generation", async () => {
    const recovered = turn({ provider: "anthropic", connection_id: null, auth_mode: "workspace_api_key", state: "succeeded", result: parseProviderProjectAnswer(packet(), answer()) });
    mocks.rpc.mockResolvedValue({ data: { created: false, turn: recovered }, error: null });
    const response = await turns.POST(browserRequest("turns", { ...createBody(), provider: "anthropic", connectionId: null, authMode: "workspace_api_key", acceptApiCharges: true }));
    expect(mocks.api).not.toHaveBeenCalled(); expect(response.status).toBe(200); expect((await response.json()).turn.result).toEqual(recovered.result);
  });
  it("runs exactly a newly saved API attempt", async () => {
    const saved = turn({ provider: "anthropic", connection_id: null, auth_mode: "deployment_api_key" });
    mocks.rpc.mockResolvedValue({ data: { created: true, turn: saved }, error: null }); mocks.api.mockResolvedValue(saved);
    expect((await turns.POST(browserRequest("turns", { ...createBody(), provider: "anthropic", connectionId: null, authMode: "deployment_api_key", acceptApiCharges: true }))).status).toBe(201);
    expect(mocks.api).toHaveBeenCalledOnce(); expect(mocks.api.mock.calls[0][0].turn).toEqual(saved);
  });
  it("refuses an API request without its explicit charge acknowledgement", async () => {
    const response = await turns.POST(browserRequest("turns", { ...createBody(), provider: "anthropic", connectionId: null, authMode: "workspace_api_key" }));
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled(); expect(response.status).toBe(400);
  });
  it("also requires charge acknowledgement for a native API-key account", async () => {
    const response = await turns.POST(browserRequest("turns", { ...createBody(), authMode: "apiKey" }));
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(response.status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { created: true, turn: turn({ auth_mode: "apiKey", state: "queued", attempt_id: null }) }, error: null });
    const accepted = await turns.POST(browserRequest("turns", { ...createBody(), authMode: "apiKey", acceptApiCharges: true }));
    expect(accepted.status).toBe(201); expect(mocks.api).not.toHaveBeenCalled();
  });
  it("refuses a mismatched recovered request", async () => {
    mocks.rpc.mockResolvedValue({ data: { created: false, turn: turn({ question: "Different request" }) }, error: null });
    expect((await turns.POST(browserRequest("turns", createBody()))).status).toBe(409);
  });
  it("recovers by owner, project and request id, then rechecks access and expiry", async () => {
    const q = query([turn()]); mocks.userFrom.mockReturnValue(q);
    const response = await turns.GET(browserRequest(`turns?workspaceId=${workspace}&projectId=${project}&requestId=${requestId}`, undefined, "GET"));
    expect(response.status).toBe(200); expect(q.select).toHaveBeenCalledWith(PROVIDER_TURN_COLUMNS);
    for (const pair of [["user_id", owner], ["workspace_id", workspace], ["project_id", project], ["request_id", requestId]]) expect(q.eq).toHaveBeenCalledWith(...pair);
    expect(mocks.rpc).toHaveBeenCalledWith("read_assistant_provider_turn_for_user", { p_turn_id: id, p_user_id: owner });
  });
  it("cancels only as the current user and refuses body-selected identities", async () => {
    const response = await turns.DELETE(browserRequest("turns", { turnId: id }, "DELETE"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ cancelled: true, state: "cancelled", turnId: id });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_assistant_provider_turn", { p_turn_id: id, p_user_id: owner });
    expect((await turns.DELETE(browserRequest("turns", { turnId: id, userId: project }, "DELETE"))).status).toBe(400);
  });
  it("preserves an already completed request rather than reporting a cancellation", async () => {
    mocks.rpc.mockImplementation(async name => name === "read_assistant_provider_turn_for_user" ? { data: turn({ state: "succeeded", result: parseProviderProjectAnswer(packet(), answer()) }), error: null } : { data: null, error: null });
    const response = await turns.DELETE(browserRequest("turns", { turnId: id }, "DELETE"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ cancelled: false, state: "succeeded", turnId: id });
  });
});

it("queues Claude through its native connection without invoking the API transport", async () => {
  const body = { ...createBody(), provider: "claude", authMode: "claude_subscription", model: "claude-sonnet-4-6" };
  mocks.rpc.mockResolvedValue({ data: { created: true, turn: turn({ provider: "claude", auth_mode: "claude_subscription", model_id: body.model, state: "queued", attempt_id: null }) }, error: null });
  const response = await turns.POST(browserRequest("turns", body));
  expect(response.status).toBe(201); expect((await response.json()).turn.state).toBe("queued");
  expect(mocks.rpc).toHaveBeenCalledWith("create_assistant_provider_turn", expect.objectContaining({ p_provider: "claude", p_auth_mode: "claude_subscription", p_connection_id: token.connectionId, p_model_id: body.model }));
  expect(mocks.api).not.toHaveBeenCalled();
  mocks.rpc.mockClear();
  expect((await turns.POST(browserRequest("turns", { ...body, model: "sonnet" }))).status).toBe(400);
  expect((await turns.POST(browserRequest("turns", { ...body, authMode: "apiKey" }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled();
});

describe("OpenCode project task registration", () => {
  const openCodeTurn = (changes: Record<string, unknown> = {}) => turn({ provider: "opencode", auth_mode: "opencode_api", model_id: "gpt-6-astra", ...changes });
  const openCodeBody = () => ({ ...createBody(), provider: "opencode", authMode: "opencode_api", model: "gpt-6-astra", acceptApiCharges: true });
  it("issues OpenCode setup with the exact provider, account mode and scoped token", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: { id: args.p_id }, error: null }));
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, provider: "opencode", label: "OpenCode fixture", authMode: "opencode_api" }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.setup).toMatchObject({ version: 2, provider: "opencode", workspaceId: workspace, projectId: project, expectedAuthMode: "opencode_api" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_assistant_provider_connection_v2", expect.objectContaining({ p_provider: "opencode", p_auth_mode: "opencode_api", p_user_id: owner, p_workspace_id: workspace, p_project_id: project }));
    expect(mocks.rpc.mock.calls[0][1].p_token_hash).toBe(createHash("sha256").update(saved.setup.token).digest("hex"));
  });
  it.each([
    { provider: "opencode", authMode: "apiKey" }, { provider: "opencode", authMode: "chatgpt" }, { provider: "opencode", authMode: "claude_subscription" },
    { provider: "codex", authMode: "opencode_api" }, { provider: "claude", authMode: "opencode_api" }, { authMode: "opencode_api" },
  ])("refuses an OpenCode connection account/provider mismatch %j", async changed => {
    const response = await connections.POST(browserRequest("connections", { workspaceId: workspace, projectId: project, label: "Bad pair", ...changed }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("queues an explicitly acknowledged OpenCode API request without calling the app API transport", async () => {
    mocks.rpc.mockResolvedValue({ data: { created: true, turn: openCodeTurn({ state: "queued", attempt_id: null }) }, error: null });
    const response = await turns.POST(browserRequest("turns", openCodeBody()));
    expect(response.status).toBe(201);
    expect((await response.json()).turn).toMatchObject({ provider: "opencode", auth_mode: "opencode_api", model_id: "gpt-6-astra" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_assistant_provider_turn", expect.objectContaining({ p_provider: "opencode", p_auth_mode: "opencode_api", p_connection_id: token.connectionId, p_model_id: "gpt-6-astra" }));
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it.each([{ acceptApiCharges: undefined }, { acceptApiCharges: false }, { authMode: "apiKey" }, { authMode: "chatgpt" }, { authMode: "claude_subscription" },
    { connectionId: null }, { model: "openai/gpt-6-astra" }, { model: "gpt model" }, { model: "x".repeat(141) }, { model: "-bad" }])("refuses an unapproved or malformed OpenCode request before saving %j", async changed => {
    const response = await turns.POST(browserRequest("turns", { ...openCodeBody(), ...changed }));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled();
  });
  it("claims OpenCode with the exact native-tested structured output schema", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", turn: openCodeTurn() }, error: null });
    const response = await native.POST(nativeRequest({ operation: "claim", authMode: "opencode_api", status: "connected" }));
    expect(response.status).toBe(200);
    const claimed = (await response.json()).turn;
    expect(claimed).toMatchObject({ provider: "opencode", authMode: "opencode_api", model: "gpt-6-astra" });
    expect(claimed.outputSchema).toEqual(JSON.parse(readFileSync(resolve(process.cwd(), "../workers/planner_agent_connector/test/project-output-schema.json"), "utf8")));
    expect(mocks.rpc).toHaveBeenCalledWith("claim_assistant_provider_turn", { p_connection_id: token.connectionId, p_token_hash: token.tokenHash, p_auth_mode: "opencode_api", p_status: "connected" });
  });
  it.each([{ provider: "codex" }, { provider: "claude" }, { auth_mode: "apiKey" }, { connection_id: owner }])("rejects a misbound OpenCode claim %j", async change => {
    mocks.rpc.mockResolvedValue({ data: { status: "connected", turn: openCodeTurn(change) }, error: null });
    const response = await native.POST(nativeRequest({ operation: "claim", authMode: "opencode_api", status: "connected" }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "provider_claim_mismatch" });
  });
  const delivery = () => ({ operation: "finish", turnId: id, attemptId: attempt, answer: JSON.stringify(answer()),
    receipt: { ...receipt(), provider: "opencode", authMode: "opencode_api", model: "gpt-6-astra", planType: null }, failureCode: null });
  function finishFixture() {
    turnQuery = query(openCodeTurn());
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === "finish_assistant_provider_turn"
      ? openCodeTurn({ state: "succeeded", result: args.p_result, provider_receipt: args.p_provider_receipt }) : { id, attemptId: attempt, state: "running" }, error: null }));
  }
  it("retains OpenCode output through the common project answer validator and exact database projection", async () => {
    finishFixture();
    const response = await native.POST(nativeRequest(delivery()));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ id, attemptId: attempt, state: "succeeded" });
    expect(turnQuery.select).toHaveBeenCalledWith(PROVIDER_TURN_COLUMNS);
    expect(turnQuery.eq).toHaveBeenCalledWith("id", id); expect(turnQuery.eq).toHaveBeenCalledWith("connection_id", token.connectionId);
    expect(mocks.rpc).toHaveBeenCalledWith("finish_assistant_provider_turn", expect.objectContaining({ p_result: parseProviderProjectAnswer(packet(), answer()), p_provider_receipt: delivery().receipt }));
  });
  it.each([{ provider: "codex" }, { authMode: "apiKey" }, { model: "other-model" }])("rejects an altered OpenCode delivery receipt %j", async changed => {
    finishFixture(); const body = delivery();
    const response = await native.POST(nativeRequest({ ...body, receipt: { ...body.receipt, ...changed } }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "provider_receipt_mismatch" });
    expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_assistant_provider_turn")).toBe(false);
  });
});
