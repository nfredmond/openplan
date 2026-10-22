import { readFileSync } from "node:fs";
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

// Ordinary reducer and source assertions. These never execute PostgreSQL.
describe("bounded retained event pages", () => {
 const event = (sequence: number) => ({ sequence, kind: "text_delta", body: { text: `part-${sequence}` },
  bodyHash: sequence.toString(16).padStart(64, "0"), previousHash: sequence > 1 ? (sequence - 1).toString(16).padStart(64, "0") : null });
 const page = (after: number, total: number): RetainedChatProgress => {
  const events = Array.from({ length: Math.min(100, Math.max(0, total - after)) }, (_, n) => event(after + n + 1));
  return { ...base, state: "succeeded", complete: true, texts: [{ ...base.texts![0], terminal: "stop" }],
   cursor: events.at(-1)?.sequence ?? after, events };
 };
 it.each([100, 101, 205])("drains %i events with page replay, empty tail, later append and reconnect", total => {
  let retained: RetainedChatProgress | null = null;
  for (let after = 0; after < total; after = retained.cursor) {
   const next = page(after, total);
   retained = advanceRetainedChatProgress(retained, next);
   const replay = advanceRetainedChatProgress(retained, next);
   expect(replay.events, "replayed pages do not duplicate or drop retained events").toEqual(retained.events);
   retained = replay;
  }
  expect(retained!.events).toEqual(Array.from({ length: total }, (_, n) => event(n + 1)));
  const empty = advanceRetainedChatProgress(retained, page(total, total));
  expect(empty.cursor).toBe(total); expect(empty.events).toEqual(retained!.events);
  const appended = advanceRetainedChatProgress(empty, page(total, total + 1));
  expect(appended.cursor).toBe(total + 1); expect(appended.events).toHaveLength(total + 1);
  let reconnected: RetainedChatProgress | null = null;
  for (let after = 0; after < total + 1; after = reconnected.cursor) reconnected = advanceRetainedChatProgress(reconnected, page(after, total + 1));
  expect(reconnected).toEqual(appended);
 });
 it("rejects the old full-turn cursor on a bounded page before it can skip events", () => {
  expect(() => advanceRetainedChatProgress(null, { ...page(0, 205), cursor: 205 })).toThrow("chat_progress_cursor_gap");
  const first = advanceRetainedChatProgress(null, page(0, 205));
  expect(() => advanceRetainedChatProgress(first, { ...page(100, 205), cursor: 205 })).toThrow("chat_progress_cursor_gap");
  expect(() => advanceRetainedChatProgress(first, { ...page(100, 205), events: [] })).toThrow("chat_progress_cursor_gap");
 });
 it("rejects changed replays and broken boundaries while preserving an older exact page", () => {
  const first = advanceRetainedChatProgress(null, page(0, 205));
  const second = advanceRetainedChatProgress(first, page(100, 205));
  expect(advanceRetainedChatProgress(second, page(0, 205))).toBe(second);
  const changed = page(0, 205); changed.events![99].body = { text: "changed" };
  expect(() => advanceRetainedChatProgress(second, changed)).toThrow("chat_progress_chain_invalid");
  const broken = page(200, 205); broken.events![0].previousHash = hash;
  expect(() => advanceRetainedChatProgress(second, broken)).toThrow("chat_progress_cursor_gap");
  expect(() => advanceRetainedChatProgress(null, page(100, 205))).toThrow("chat_progress_cursor_gap");
 });
 it("binds the actual SQL read cursor and events to the same limited page", () => {
  const sql = readFileSync(`${process.cwd()}/supabase/migrations/20261021215752_assistant_chat_turns.sql`, "utf8");
  const read = sql.slice(sql.indexOf(" IF p_operation='read' THEN"), sql.indexOf(" IF g.status<>'accepted'"));
  expect(read).toContain("SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY sequence),'[]'),coalesce(max(sequence),coalesce((p_payload->>'afterSequence')::bigint,0)) INTO e,n");
  expect(read).toContain("sequence>coalesce((p_payload->>'afterSequence')::bigint,0) ORDER BY sequence LIMIT 100) x;");
  expect(read, "SQL cursor must end at the last event actually returned").toContain("'cursor',n,");
  expect(read).toContain("'events',e,");
  expect(read).not.toContain("'cursor',t.cursor");
 });
});
