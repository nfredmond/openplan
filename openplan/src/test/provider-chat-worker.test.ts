import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatModelStep, CHAT_CREDENTIAL_COLUMNS } from "@/lib/assistant/provider-chat-worker";
import { invokeReservedChatTool, retainChatToolReservation } from "@/lib/assistant/chat-tools";
import type { ChatSession } from "@/lib/assistant/provider-chat-projection";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { checkChatRequest, type ChatWireMessage } from "@/lib/assistant/provider-chat-transport";
import { canonicalChat, chatDefinitions, chatGrantDigest, chatHash } from "@/lib/assistant/provider-chat-task";
import { chatFixture, chatIds as id, chatStreamFrame as frame } from "./fixtures/provider-chat-fixture";
const harness = vi.hoisted(() => ({ network: vi.fn(), service: vi.fn(), order: [] as string[], disagree: false }));
vi.mock("@/lib/assistant/provider-api-transport", async importOriginal => ({ ...await importOriginal<object>(), pinnedProviderExchange: harness.network }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: harness.service }));
vi.mock("ai", async importOriginal => {
 const actual = await importOriginal<typeof import("ai")>();
 return { ...actual, streamText: (...args: Parameters<typeof actual.streamText>) => {
  const original = actual.streamText(...args);
  if (!harness.disagree) return original;
  return new Proxy(original, { get(target, key) {
   if (key === "fullStream") return (async function* () {
    for await (const part of target.fullStream) yield part.type === "tool-call" ? { ...part, input: { projectId: id.project, title: "SDK disagreement", submittalType: "other", notes: "" } } : part;
   })();
   return Reflect.get(target, key, target);
  } });
 } };
});
beforeEach(() => {
 vi.clearAllMocks(); harness.order.length = 0; harness.disagree = false;
 vi.stubEnv("OPENPLAN_INSTALLATION_ID", id.installation); vi.stubEnv("OPENPLAN_CHAT_POOL_ID", id.pool); vi.stubEnv("OPENPLAN_CHAT_POOL_REVISION", id.poolRevision);
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
 const grant = chatFixture(), query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
 query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
 query.maybeSingle.mockImplementation(async () => { harness.order.push("credential"); return { data: { revision_id: id.revision, connection_id: id.connection, workspace_id: id.workspace, credential_ciphertext: null }, error: null }; });
 harness.service.mockReturnValue({ from: vi.fn((table: string) => { expect(table).toBe("workspace_provider_api_credentials"); return query; }) });
 harness.network.mockImplementation(async (args, body) => { harness.order.push("network"); expect(args.apiKey).toBeNull(); expect(JSON.parse(body)).toMatchObject({ stream: true, max_tokens: 2000 }); return frame({ role: "assistant", content: "Synthetic checked answer" }, "stop") + "data: [DONE]\n\n"; });
 const authorize = vi.fn(async () => { harness.order.push("authorize"); });
 const run = () => runChatModelStep({ grant, expectedGrantDigest: chatGrantDigest(grant), messages: [{ role: "user", content: "Synthetic frozen packet" }],
  leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal, authorize });
 return { grant, query, authorize, run };
}
describe("one retained SDK model invocation", () => {
 it("authorizes actual serialized bytes before credentials and exactly one exchange", async () => {
  const f = setup(); const result = await f.run();
  expect(result.receipt).toMatchObject({ reason: "stop", text: "Synthetic checked answer", inputTokens: null, outputTokens: null });
  expect(harness.order).toEqual(["authorize", "credential", "network"]); expect(f.authorize).toHaveBeenCalledOnce(); expect(harness.network).toHaveBeenCalledOnce();
  expect(f.query.select).toHaveBeenCalledWith(CHAT_CREDENTIAL_COLUMNS);
  expect(f.query.eq.mock.calls).toEqual([["workspace_id", id.workspace], ["connection_id", id.connection], ["revision_id", id.revision]]);
 });
 it.each(["", "  ", "\t\n", "\u00a0\ufeff", "\u2003\u2028"])("normalizes SDK and checked receipt arguments with padding %j", async padding => {
  const f = setup(), input = { projectId: id.project, title: `${padding}Draft${padding}`, submittalType: "other", notes: `${padding}Notes${padding}` };
  const raw = frame({ role: "assistant", tool_calls: [{ index: 0, id: "draft_call", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n";
  harness.network.mockResolvedValue(raw);
  const result = await f.run();
  expect(result.receipt.calls).toEqual([{ toolCallId: "draft_call", name: "propose_create_project_record", input: { ...input, title: "Draft", notes: "Notes" }, argumentsCanonical: canonicalChat({ ...input, title: "Draft", notes: "Notes" }) }]);
  expect(result.receipt.rawBody).toBe(raw); expect(result.receipt.bodyHash).toBe(chatHash(raw));
  expect(result.receiptHash).toBe(chatHash(canonicalChat(result.receipt)));
  expect(harness.network).toHaveBeenCalledOnce(); expect(f.authorize).toHaveBeenCalledOnce();
 });
 it.each(["Simple notes", "Line 1\nLine 2\tend\b\f\rinside"])("continues the actual second SDK request with exact broker output %j", async notes => {
  const f = setup(), input = { projectId: id.project, title: "Draft", submittalType: "progress_report", notes };
  harness.network.mockResolvedValueOnce(frame({ role: "assistant", tool_calls: [{ index: 0, id: "draft_call", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n");
  const first = await f.run(), call = first.receipt.calls[0];
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: id.project, workspace_id: id.workspace }, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const broker = await invokeReservedChatTool({ session: { from: vi.fn().mockReturnValue(query) } as unknown as ChatSession, userId: id.user, grant: f.grant,
   reservation: retainChatToolReservation({ released: true, cached: false, handle: id.handle, callId: id.call, stepId: id.step, toolCallId: call.toolCallId, name: call.name, input: call.input, usedCalls: 1 }) });
  if (!("executableCanonical" in broker) || !broker.executableCanonical) throw new Error("Draft broker output missing");
  const expected = { kind: "create_project_record", recordType: "submittal", projectId: id.project, title: "Draft", submittalType: "progress_report", notes };
  expect(broker.executableCanonical).toBe(canonicalizeActionPayload(expected));
  expect(broker.result).toMatchObject({ executableHash: hashAssistantActionPayload(expected), status: "proposed" });
  const messages: ChatWireMessage[] = [{ role: "user", content: "Synthetic frozen packet" }, { role: "assistant", content: null,
   tool_calls: [{ id: call.toolCallId, type: "function", function: { name: call.name, arguments: call.argumentsCanonical } }] },
   { role: "tool", tool_call_id: call.toolCallId, content: canonicalChat(broker.result) }];
  const authorize = vi.fn(async (_body: string) => {});
  await runChatModelStep({ grant: f.grant, expectedGrantDigest: chatGrantDigest(f.grant), messages,
   leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal, authorize });
  const request = authorize.mock.calls[0][0], actual = JSON.parse(request);
  expect(actual.messages[1].tool_calls[0].function.arguments).toBe(JSON.stringify(JSON.parse(call.argumentsCanonical)));
  expect(JSON.parse(actual.messages[1].tool_calls[0].function.arguments)).toEqual(input);
  expect(actual.messages[2]).toEqual(messages[2]);
  const tools = chatDefinitions(f.grant.scope).tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  expect(checkChatRequest(request, "synthetic-model", messages, tools)).toBe(request);
  expect(chatHash(request)).toBe(chatHash(harness.network.mock.calls[1][1]));
  for (const changed of [JSON.stringify({ ...input, notes: "Changed nested value" }), '{"notes":"a","notes":"b"}']) {
   const wrong = structuredClone(actual); wrong.messages[1].tool_calls[0].function.arguments = changed;
   expect(() => checkChatRequest(JSON.stringify(wrong), "synthetic-model", messages, tools)).toThrow();
  }
  const wrongId = structuredClone(actual); wrongId.messages[1].tool_calls[0].id = "changed_id";
  expect(() => checkChatRequest(JSON.stringify(wrongId), "synthetic-model", messages, tools)).toThrow("chat_request_binding_mismatch");
  expect(harness.network).toHaveBeenCalledTimes(2); expect(authorize).toHaveBeenCalledOnce();
 });
 it("still rejects invalid SDK/receipt tool input without repair", async () => {
  const f = setup(); harness.network.mockResolvedValue(frame({ role: "assistant", tool_calls: [{ index: 0, id: "bad_draft", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify({ projectId: id.project, title: "\t\n", submittalType: "other", notes: "" }) } }] }, "tool_calls") + "data: [DONE]\n\n");
  await expect(f.run()).rejects.toThrow(); expect(harness.network).toHaveBeenCalledOnce();
 });
 it("rejects SDK tool input that disagrees with the checked raw-provider receipt", async () => {
  const f = setup(), input = { projectId: id.project, title: "Draft", submittalType: "other", notes: "" };
  harness.network.mockResolvedValue(frame({ role: "assistant", tool_calls: [{ index: 0, id: "draft_call", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n");
  harness.disagree = true;
  await expect(f.run()).rejects.toThrow("chat_sdk_terminal_invalid"); expect(harness.network).toHaveBeenCalledOnce();
 });
 it("refuses before credentials when the session dispatch gate fails", async () => {
  const f = setup(); f.authorize.mockRejectedValue(new Error("synthetic_source_revoked"));
  await expect(f.run()).rejects.toThrow(); expect(harness.service).not.toHaveBeenCalled(); expect(harness.network).not.toHaveBeenCalled();
 });
 it("does not repair or retry a text-bearing incomplete response", async () => {
  const f = setup(); harness.network.mockResolvedValue(frame({ role: "assistant", content: "Unconfirmed text" }));
  await expect(f.run()).rejects.toThrow(); expect(harness.network).toHaveBeenCalledOnce(); expect(f.authorize).toHaveBeenCalledOnce();
 });
 it("refuses a changed executing pool before the SDK or credential lookup", async () => {
  const f = setup(); vi.stubEnv("OPENPLAN_CHAT_POOL_REVISION", id.request);
  await expect(f.run()).rejects.toThrow("chat_actual_pool_mismatch"); expect(harness.service).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
 });
});
