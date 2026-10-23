import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as chatGet, POST as chatPost } from "@/app/api/assistant/providers/chat/route";
import { GET as intentGet, POST as intentPost } from "@/app/api/assistant/providers/chat/intents/route";
import { ProviderRequestError } from "@/lib/assistant/provider-server";
import { chatFixture, chatIds as id } from "./fixtures/provider-chat-fixture";

const f = vi.hoisted(() => ({ client: vi.fn(), options: vi.fn(), session: vi.fn(), snapshot: vi.fn(), view: vi.fn(), prepare: vi.fn(), drive: vi.fn(), intent: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: f.client, createServiceRoleClient: vi.fn(() => { throw new Error("No service authority in route tests"); }) }));
vi.mock("@/lib/assistant/provider-chat-server", async original => ({ ...await original<object>(),
  loadChatOptions: f.options, chatSessionRpc: f.session, readChatSnapshot: f.snapshot, chatOwnerView: f.view, prepareChatGrant: f.prepare, driveChatTurn: f.drive }));
vi.mock("@/lib/assistant/provider-chat-intents", () => ({ chatIntentRpc: f.intent, readChatIntentReview: f.review }));
const canary = "PRIVATE question canonical payload credential secret";
const privateResult = { canonical: canary, question: canary, credential: canary };
const session = { auth: { getUser: async () => ({ data: { user: { id: id.user } }, error: null }) } };
let lines: Array<Record<string, unknown>>;
function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.fixture.invalid/api/assistant/providers/chat${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { origin: "https://app.fixture.invalid", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function outcome(route: string, level: string, event: string, context: Record<string, unknown>) {
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ subsystem: "openplan/api", route, level, event, context });
  expect(lines[0].context).toEqual(context);
  expect(JSON.stringify(lines)).not.toContain(canary);
}
beforeEach(() => {
  vi.clearAllMocks(); lines = [];
  vi.spyOn(console, "info").mockImplementation(line => lines.push(JSON.parse(String(line))));
  vi.spyOn(console, "warn").mockImplementation(line => lines.push(JSON.parse(String(line))));
  f.client.mockResolvedValue(session); f.options.mockResolvedValue([]); f.session.mockResolvedValue({ ...privateResult, recoveryHref: "/assistant-activity" });
  f.snapshot.mockResolvedValue({ snapshot: privateResult, grant: privateResult }); f.view.mockReturnValue(privateResult);
  for (const mock of [f.prepare, f.drive, f.intent, f.review]) mock.mockResolvedValue(privateResult);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("saved-chat route outcomes use the actual audit logger without body content", () => {
  it.each([["options", "options_read"], ["history", "history_read"]])("audits %s reads", async (operation, event) => {
    expect((await chatGet(request(`?operation=${operation}&workspaceId=${id.workspace}`))).status).toBe(200);
    outcome("assistant.providers.chat.get", "info", event, { status: 200 });
  });
  it("audits a released progress read without logging its canonical body", async () => {
    const response = await chatGet(request(`?turnId=${id.turn}&afterSequence=3`));
    expect(await response.json()).toEqual({ released: true, ...privateResult });
    expect(f.snapshot).toHaveBeenCalledWith(session, id.turn, 3);
    outcome("assistant.providers.chat.get", "info", "progress_read", { status: 200, released: true });
  });
  it("withholds progress after access failure and audits only the release outcome", async () => {
    f.snapshot.mockRejectedValue(new Error(canary)); f.session.mockResolvedValue({ turnId: id.turn, state: "access_lost", recoveryHref: "/assistant-activity" });
    expect(await (await chatGet(request(`?turnId=${id.turn}`))).json()).toEqual({ released: false, turnId: id.turn, state: "access_lost", recoveryHref: "/assistant-activity" });
    expect(f.view).not.toHaveBeenCalled();
    outcome("assistant.providers.chat.get", "warn", "progress_withheld", { status: 200, released: false });
  });
  const grant = chatFixture();
  const prepare = { operation: "prepare", input: { capabilityRecordId: id.capability, question: canary, scope: {
    target: grant.scope.target, selectedProjectIds: grant.scope.selectedProjectIds, includeWorkspaceIndex: false },
    prepareRequestId: id.request, acceptanceRequestId: id.accept, turnRequestId: id.turn } };
  const accept = { operation: "accept", turnId: id.turn, digest: "a".repeat(64), acceptanceRequestId: id.accept };
  it.each([prepare, accept, { operation: "drive", turnId: id.turn }, { operation: "cancel", turnId: id.turn }])("audits chat $operation only after the command resolves", async body => {
    const response = await chatPost(request("", body));
    const status = body.operation === "prepare" ? 201 : 200;
    expect(response.status).toBe(status); expect(await response.json()).toEqual(["accept", "cancel"].includes(body.operation) ? { ...privateResult, recoveryHref: "/assistant-activity" } : privateResult);
    outcome("assistant.providers.chat.post", "info", "command_completed", { operation: body.operation, status });
    if (body.operation === "prepare") expect(f.prepare).toHaveBeenCalledWith(session, id.user, "https://app.fixture.invalid", prepare.input);
    if (body.operation === "accept") expect(f.session).toHaveBeenCalledWith(session, "accept", id.turn, { digest: accept.digest, acceptanceRequestId: id.accept });
    if (body.operation === "cancel") expect(f.session).toHaveBeenCalledWith(session, "cancel", id.turn);
    if (body.operation === "drive") expect(f.drive).toHaveBeenCalledWith(session, id.user, id.turn, expect.any(AbortSignal));
  });
  it.each([false, true])("audits intent review=%s without logging status or draft bodies", async review => {
    expect((await intentGet(request(`/intents?intentId=${id.call}${review ? "&review=true" : ""}`))).status).toBe(200);
    expect(f.intent).toHaveBeenCalledWith(session, "status", id.call);
    expect(f.review).toHaveBeenCalledTimes(review ? 1 : 0);
    outcome("assistant.providers.chat.intents.get", "info", review ? "intent_review_read" : "intent_status_read", { status: 200 });
  });
  const claim = { operation: "claim_execution", intentId: id.call, originalApprovalId: id.accept, expectedExecutableHash: "a".repeat(64) };
  it.each([claim, { operation: "reconcile", intentId: id.call }, { operation: "repeat", intentId: id.call, repeatRequestId: id.request, acknowledgePossibleDuplicate: true }])("audits intent $operation without logging bindings", async body => {
    const response = await intentPost(request("/intents", body));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(privateResult);
    const { operation, intentId, ...payload } = body;
    expect(f.intent).toHaveBeenCalledWith(session, operation, intentId, payload);
    outcome("assistant.providers.chat.intents.post", "info", "intent_command_completed", { operation, status: 200 });
  });
  const routes = [
    { name: "chat.get", handler: chatGet, path: `?turnId=${id.turn}`, body: undefined },
    { name: "chat.post", handler: chatPost, path: "", body: accept },
    { name: "chat.intents.get", handler: intentGet, path: `/intents?intentId=${id.call}`, body: undefined },
    { name: "chat.intents.post", handler: intentPost, path: "/intents", body: claim },
  ];
  it.each(routes)("$name rejects bearer credentials before any session or command", async ({ name, handler, path, body }) => {
    expect((await handler(request(path, body, { authorization: `Bearer ${canary}` }))).status).toBe(401);
    expect(f.client).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled(); expect(f.intent).not.toHaveBeenCalled();
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 401 });
  });
  it.each(routes)("$name rejects an unauthenticated cookie session", async ({ name, handler, path, body }) => {
    f.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    expect((await handler(request(path, body))).status).toBe(401);
    expect(f.session).not.toHaveBeenCalled(); expect(f.intent).not.toHaveBeenCalled(); expect(f.drive).not.toHaveBeenCalled();
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 401 });
  });
  it.each(routes.filter(route => route.body !== undefined))("$name rejects cross-origin writes", async ({ name, handler, path, body }) => {
    expect((await handler(request(path, body, { origin: "https://other.fixture.invalid" }))).status).toBe(403);
    expect(f.client).not.toHaveBeenCalled();
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 403 });
  });
  it.each(routes.filter(route => route.body !== undefined))("$name rejects extra payload fields without dispatch", async ({ name, handler, path, body }) => {
    expect((await handler(request(path, { ...body, secret: canary }))).status).toBe(400);
    expect(f.session).not.toHaveBeenCalled(); expect(f.intent).not.toHaveBeenCalled();
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 400 });
  });
  it.each(routes)("$name audits access refusal without backend error text", async ({ name, handler, path, body }) => {
    for (const mock of [f.session, f.intent]) mock.mockRejectedValue(new ProviderRequestError(canary, 403));
    expect((await handler(request(path, body))).status).toBe(403);
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 403 });
  });
  it.each(routes)("$name sanitizes unknown backend failures", async ({ name, handler, path, body }) => {
    for (const mock of [f.session, f.intent]) mock.mockRejectedValue(new Error(canary));
    const response = await handler(request(path, body));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "provider_request_unavailable" });
    outcome(`assistant.providers.${name}`, "warn", "request_refused", { status: 503 });
  });
});
