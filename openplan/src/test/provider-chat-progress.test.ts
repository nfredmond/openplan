import { describe, expect, it } from "vitest";
import { advanceRetainedChatProgress, type RetainedChatProgress } from "@/lib/assistant/chat-stream";
const hash = "a".repeat(64);
const base: RetainedChatProgress = { turnId: "synthetic-turn", released: true, state: "running", cursor: 1, complete: false,
 texts: [{ stepId: "synthetic-step", text: "Progress only", terminal: "tool_calls", receiptHash: hash }],
 events: [{ sequence: 1, kind: "model_terminal", body: {}, bodyHash: hash, previousHash: null }] };
describe("retained progress is not stream EOF success", () => {
 it("retains progress without declaring completion", () => expect(advanceRetainedChatProgress(null, base).complete).toBe(false));
 it("requires state and retained stop receipt for completion", () => {
  expect(() => advanceRetainedChatProgress(null, { ...base, complete: true })).toThrow("chat_progress_terminal_missing");
  expect(advanceRetainedChatProgress(null, { ...base, state: "succeeded", complete: true, texts: [{ ...base.texts![0], terminal: "stop" }] }).complete).toBe(true);
 });
 it("withholds the whole retained body on one lost contributor", () => {
  const result = advanceRetainedChatProgress(base, { ...base, released: false, state: "access_lost" });
  expect(result).not.toHaveProperty("texts"); expect(result).not.toHaveProperty("intents"); expect(result).not.toHaveProperty("events");
 });
 it("appends only contiguous retained sequences and rejects mismatched hashes", () => {
  const next = { ...base, cursor: 2, events: [{ sequence: 2, kind: "completed", body: {}, bodyHash: "b".repeat(64), previousHash: hash }] };
  expect(advanceRetainedChatProgress(base, next).events).toHaveLength(2);
  expect(() => advanceRetainedChatProgress(base, { ...next, events: [{ ...next.events[0], previousHash: "c".repeat(64) }] })).toThrow("chat_progress_cursor_gap");
 });
});
