import { test } from "node:test";
import assert from "node:assert/strict";
import { openCodeMessageId, openCodeTurnResult } from "../opencode-result.mjs";

const binding = { sessionId: `ses_${"A".repeat(26)}`, parentId: `msg_${"B".repeat(26)}`, model: "gpt-6-astra" };
function fixture() {
  const id = `msg_${"C".repeat(26)}`;
  const structured = { answer: "SYNTHETIC retained answer", citations: [], submittal: null };
  const part = (type, letter, extra = {}) => ({ type, id: `prt_${letter.repeat(26)}`, sessionID: binding.sessionId, messageID: id, ...extra });
  return { info: { id, sessionID: binding.sessionId, parentID: binding.parentId, role: "assistant", agent: "openplan", mode: "openplan",
    path: { cwd: "/work/task" }, providerID: "openai", modelID: binding.model, time: { created: 100, completed: 200 }, finish: "tool-calls", structured },
    parts: [part("step-start", "D"), part("tool", "E", { tool: "StructuredOutput", callID: "call_synthetic",
      state: { status: "completed", metadata: { valid: true }, time: { start: 120, end: 180 }, input: structured } }),
    part("step-finish", "F", { reason: "tool-calls" })] };
}

test("returns only a bound structured answer after exact native readback", () => {
  const turn = fixture();
  assert.deepEqual(openCodeTurnResult(turn, structuredClone(turn), binding), {
    threadId: binding.sessionId, turnId: turn.info.id, answer: JSON.stringify(turn.info.structured),
  });
});

test("allows narrative parts without promoting their text to the saved answer", () => {
  const turn = fixture();
  for (const [type, letter] of [["text", "G"], ["reasoning", "H"]]) turn.parts.splice(1, 0, {
    type, id: `prt_${letter.repeat(26)}`, sessionID: binding.sessionId, messageID: turn.info.id, text: "PRIVATE_NARRATIVE",
  });
  assert.ok(!openCodeTurnResult(turn, structuredClone(turn), binding).answer.includes("PRIVATE_NARRATIVE"));
});

test("generates compatible distinct parent message IDs", t => {
  t.mock.method(Date, "now", () => 1700000000000);
  const ids = Array.from({ length: 50 }, () => openCodeMessageId());
  assert.ok(ids.every(id => /^msg_[a-f0-9]{26}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

for (const [name, change, code] of [
  ["assistant ID", t => { t.info.id = "bad"; t.parts.forEach(p => { p.messageID = "bad"; }); }, "native_protocol_invalid"],
  ["reused parent ID", t => { t.info.id = binding.parentId; t.parts.forEach(p => { p.messageID = binding.parentId; }); }, "native_protocol_invalid"],
  ["session", t => { t.info.sessionID = `ses_${"Z".repeat(26)}`; }, "native_protocol_invalid"],
  ["parent", t => { t.info.parentID = `msg_${"Z".repeat(26)}`; }, "native_protocol_invalid"],
  ["role", t => { t.info.role = "user"; }, "native_protocol_invalid"],
  ["provider", t => { t.info.providerID = "anthropic"; }, "native_model_changed"],
  ["model", t => { t.info.modelID = "unselected"; }, "native_model_changed"],
  ["agent", t => { t.info.agent = "build"; }, "native_capability_changed"],
  ["mode", t => { t.info.mode = "build"; }, "native_capability_changed"],
  ["working directory", t => { t.info.path.cwd = "/private"; }, "native_capability_changed"],
  ["native error", t => { t.info.error = { message: "PRIVATE_ERROR" }; }, "native_turn_failed"],
  ["missing completion", t => { delete t.info.time.completed; }, "native_turn_failed"],
  ["invalid creation", t => { t.info.time.created = 0; }, "native_turn_failed"],
  ["reversed completion", t => { t.info.time.completed = 99; }, "native_turn_failed"],
  ["finish reason", t => { t.info.finish = "length"; }, "native_turn_failed"],
  ["missing answer", t => { delete t.info.structured; }, "native_answer_missing"],
  ["array answer", t => { t.info.structured = []; t.parts[1].state.input = []; }, "native_answer_missing"],
  ["oversized answer", t => { t.info.structured.answer = "x".repeat(64001); }, "native_answer_too_large"],
  ["part ID", t => { t.parts[0].id = "bad"; }, "native_protocol_invalid"],
  ["null part", t => { t.parts.push(null); }, "native_protocol_invalid"],
  ["non-array parts", t => { t.parts = {}; }, "native_protocol_invalid"],
  ["duplicate part", t => { t.parts[1].id = t.parts[0].id; }, "native_protocol_invalid"],
  ["part session", t => { t.parts[1].sessionID = `ses_${"Z".repeat(26)}`; }, "native_protocol_invalid"],
  ["part message", t => { t.parts[1].messageID = binding.parentId; }, "native_protocol_invalid"],
  ["unknown part", t => { t.parts.splice(1, 0, { ...t.parts[0], id: `prt_${"Z".repeat(26)}`, type: "file" }); }, "native_protocol_invalid"],
  ["missing start", t => { t.parts.shift(); }, "native_protocol_invalid"],
  ["extra start", t => { t.parts.splice(1, 0, { ...t.parts[0], id: `prt_${"Z".repeat(26)}` }); }, "native_protocol_invalid"],
  ["missing finish", t => { t.parts.pop(); }, "native_protocol_invalid"],
  ["missing tool", t => { t.parts.splice(1, 1); }, "native_protocol_invalid"],
  ["extra tool", t => { t.parts.splice(2, 0, { ...structuredClone(t.parts[1]), id: `prt_${"Z".repeat(26)}` }); }, "native_protocol_invalid"],
  ["start ordering", t => { t.parts.unshift(t.parts.splice(1, 1)[0]); }, "native_protocol_invalid"],
  ["finish ordering", t => { t.parts.splice(1, 0, t.parts.pop()); }, "native_protocol_invalid"],
  ["step reason", t => { t.parts[2].reason = "error"; }, "native_protocol_invalid"],
  ["wrong tool", t => { t.parts[1].tool = "bash"; }, "native_turn_failed"],
  ["missing call ID", t => { delete t.parts[1].callID; }, "native_turn_failed"],
  ["numeric call ID", t => { t.parts[1].callID = 42; }, "native_turn_failed"],
  ["empty call ID", t => { t.parts[1].callID = ""; }, "native_turn_failed"],
  ["failed tool", t => { t.parts[1].state.status = "error"; }, "native_turn_failed"],
  ["invalid tool", t => { t.parts[1].state.metadata.valid = false; }, "native_turn_failed"],
  ["missing tool start", t => { delete t.parts[1].state.time.start; }, "native_turn_failed"],
  ["missing tool end", t => { delete t.parts[1].state.time.end; }, "native_turn_failed"],
  ["early tool", t => { t.parts[1].state.time.start = 90; }, "native_turn_failed"],
  ["reversed tool time", t => { t.parts[1].state.time.end = 110; }, "native_turn_failed"],
  ["late tool", t => { t.parts[1].state.time.end = 210; }, "native_turn_failed"],
  ["tool input", t => { t.parts[1].state.input = { answer: "CHANGED" }; }, "native_result_mismatch"],
]) test(`refuses native result with ${name}`, () => {
  const turn = fixture(); change(turn);
  assert.throws(() => openCodeTurnResult(turn, structuredClone(turn), binding), { message: code });
});

test("readback must match the whole native message", () => {
  const turn = fixture(), readback = structuredClone(turn); readback.info.modelID = "changed";
  assert.throws(() => openCodeTurnResult(turn, readback, binding), { message: "native_result_mismatch" });
});

for (const raw of [null, [], {}, { info: null }, { info: [], parts: [] }]) test(`rejects malformed native response ${JSON.stringify(raw)}`, () => {
  assert.throws(() => openCodeTurnResult(raw, raw, binding), { message: "native_protocol_invalid" });
});

for (const key of ["sessionId", "parentId", "model"]) test(`rejects missing requested ${key}`, () => {
  const turn = fixture();
  assert.throws(() => openCodeTurnResult(turn, turn, { ...binding, [key]: null }), { message: "native_request_invalid" });
});
