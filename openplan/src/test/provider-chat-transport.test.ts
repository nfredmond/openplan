import { describe, expect, it } from "vitest";
import { checkChatRequest, checkChatStream } from "@/lib/assistant/provider-chat-transport";
import { chatStreamFrame as frame, chatIds } from "./fixtures/provider-chat-fixture";
const done = "data: [DONE]\n\n";
describe("closed streaming tools profile", () => {
 it("requires a checked terminal and retains missing usage as unknown", () => {
  const body = frame({ role: "assistant", content: "Frozen answer" }) + frame({}, "stop") + done;
  expect(checkChatStream(body, "synthetic-model", [])).toMatchObject({ text: "Frozen answer", reason: "stop", inputTokens: null, outputTokens: null, rawBody: body });
  expect(() => checkChatStream(frame({ content: "Not success" }), "synthetic-model", [])).toThrow("chat_terminal_invalid");
  expect(() => checkChatStream(body.slice(0, -1), "synthetic-model", [])).toThrow("chat_stream_incomplete");
 });
 it("assembles strict allowed calls and rejects duplicate identity, unknown tools and truncated arguments", () => {
  const first = frame({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_surface_context", arguments: '{"kind":"project",' } }] });
  const last = frame({ tool_calls: [{ index: 0, function: { arguments: `"id":"${chatIds.project}"}` } }] }, "tool_calls") + done;
  expect(checkChatStream(first + last, "synthetic-model", ["get_surface_context"]).calls).toMatchObject([{ toolCallId: "call_1", name: "get_surface_context", input: { kind: "project", id: chatIds.project } }]);
  expect(() => checkChatStream(first + first + last, "synthetic-model", ["get_surface_context"])).toThrow("chat_tool_identity_repeated");
  expect(() => checkChatStream(first + last, "synthetic-model", [])).toThrow("chat_tool_identity_invalid");
  expect(() => checkChatStream(first + frame({}, "tool_calls") + done, "synthetic-model", ["get_surface_context"])).toThrow();
 });
 it("checks model, strict fields, stop/tool reason, usage, frame and total bytes", () => {
  const body = frame({ content: "Answer" }, "stop") + done;
  expect(() => checkChatStream(body, "other-model", [])).toThrow("chat_response_identity_mismatch");
  expect(() => checkChatStream(frame({ function_call: {} }, "stop") + done, "synthetic-model", [])).toThrow();
  expect(() => checkChatStream(frame({}, "tool_calls") + done, "synthetic-model", [])).toThrow("chat_terminal_invalid");
  expect(() => checkChatStream(frame({}, "stop", { usage: { prompt_tokens: 1, completion_tokens: 2001, total_tokens: 2002 } }) + done, "synthetic-model", [])).toThrow();
  expect(() => checkChatStream(frame({}, "stop", { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 } }) + done, "synthetic-model", [])).toThrow("chat_usage_invalid");
  expect(() => checkChatStream(frame({ content: "x".repeat(64001) }, "stop") + done, "synthetic-model", [])).toThrow("chat_frame_invalid");
 });
 it("binds the actual serialized request without accepting old one-shot or hidden options", () => {
  const messages = [{ role: "user" as const, content: "Frozen input" }], tools: unknown[] = [{ type: "function", function: { name: "list_projects", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } }];
  const request = { model: "synthetic-model", messages, stream: true, max_tokens: 2000, tools, tool_choice: "auto", stream_options: { include_usage: true } };
  expect(checkChatRequest(JSON.stringify(request), "synthetic-model", messages, tools)).toBe(JSON.stringify(request));
  for (const change of [{ stream: false }, { model: "other-model" }, { max_tokens: 2001 }, { functions: [] }, { messages: [{ role: "user", content: "Changed" }] }]) expect(() => checkChatRequest(JSON.stringify({ ...request, ...change }), "synthetic-model", messages, tools)).toThrow();
  const { tools: _tools, tool_choice: _choice, ...withoutTools } = request;
  expect(checkChatRequest(JSON.stringify(withoutTools), "synthetic-model", messages, [])).toBe(JSON.stringify(withoutTools));
  expect(() => checkChatRequest(JSON.stringify(request), "synthetic-model", messages, [])).toThrow("chat_request_binding_mismatch");
 });
});
