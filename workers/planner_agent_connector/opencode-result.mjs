import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export class OpenCodeResultError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const nativeId = (value, prefix) => typeof value === "string" && new RegExp(`^${prefix}_[a-zA-Z0-9]{26}$`).test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = value => Number.isFinite(value) && value > 0;

// Match the pinned runtime's timestamp prefix; random suffixes keep simultaneous
// connector requests distinct. The exact supplied ID must return as parentID.
export function openCodeMessageId() {
  const time = ((BigInt(Date.now()) * 4096n + 1n) & 0xffffffffffffn).toString(16).padStart(12, "0");
  return `msg_${time}${randomBytes(7).toString("hex")}`;
}

// Verify a single completed StructuredOutput call, including the exact native
// message readback. Narrative parts cannot substitute for the structured answer.
// The app still validates the project output schema and any proposed action.
export function openCodeTurnResult(turn, readback, { sessionId, parentId, model }) {
  if (!nativeId(sessionId, "ses") || !nativeId(parentId, "msg") || typeof model !== "string" || !model) {
    throw new OpenCodeResultError("native_request_invalid");
  }
  const info = turn?.info, parts = turn?.parts;
  if (!object(turn) || !object(info) || !Array.isArray(parts) || !nativeId(info.id, "msg") ||
    info.id === parentId || info.sessionID !== sessionId || info.parentID !== parentId || info.role !== "assistant") {
    throw new OpenCodeResultError("native_protocol_invalid");
  }
  if (info.providerID !== "openai" || info.modelID !== model) throw new OpenCodeResultError("native_model_changed");
  if (info.agent !== "openplan" || info.mode !== "openplan" || info.path?.cwd !== "/work/task") {
    throw new OpenCodeResultError("native_capability_changed");
  }
  if (info.error != null || !timestamp(info.time?.created) || !timestamp(info.time?.completed) || info.finish !== "tool-calls") {
    throw new OpenCodeResultError("native_turn_failed");
  }
  if (!object(info.structured)) throw new OpenCodeResultError("native_answer_missing");
  let answer;
  try { answer = JSON.stringify(info.structured); }
  catch { throw new OpenCodeResultError("native_protocol_invalid"); }
  if (Buffer.byteLength(answer) > 64_000) throw new OpenCodeResultError("native_answer_too_large");
  const ids = new Set();
  for (const part of parts) {
    if (!object(part) || !nativeId(part.id, "prt") || ids.has(part.id) ||
      part.sessionID !== sessionId || part.messageID !== info.id ||
      !["step-start", "step-finish", "tool", "text", "reasoning"].includes(part.type)) {
      throw new OpenCodeResultError("native_protocol_invalid");
    }
    ids.add(part.id);
  }
  const starts = parts.filter(part => part.type === "step-start");
  const finishes = parts.filter(part => part.type === "step-finish");
  const tools = parts.filter(part => part.type === "tool");
  if (starts.length !== 1 || tools.length !== 1 ||
    starts[0] !== parts[0] || finishes[0] !== parts.at(-1) || finishes[0].reason !== "tool-calls") {
    throw new OpenCodeResultError("native_protocol_invalid");
  }
  const tool = tools[0], state = tool.state;
  if (tool.tool !== "StructuredOutput" || typeof tool.callID !== "string" || !tool.callID ||
    state?.status !== "completed" || state.metadata?.valid !== true ||
    !timestamp(state.time?.start) || !timestamp(state.time?.end) || state.time.start < info.time.created ||
    state.time.end < state.time.start || state.time.end > info.time.completed) {
    throw new OpenCodeResultError("native_turn_failed");
  }
  try {
    if (!isDeepStrictEqual(state.input, info.structured) || !isDeepStrictEqual(turn, readback)) {
      throw new OpenCodeResultError("native_result_mismatch");
    }
  } catch (error) {
    throw error instanceof OpenCodeResultError ? error : new OpenCodeResultError("native_protocol_invalid");
  }
  return { threadId: sessionId, turnId: info.id, answer };
}
