import type { ClientRequest, Agent } from "node:http";
import { z } from "zod";
import { pinnedProviderExchange, type ProviderApiNetworkPolicy } from "./provider-api-transport";
import { CHAT_LIMITS, canonicalChat, chatHash, parseChatJson, chatToolInputs, type ChatToolName } from "./provider-chat-task";

const token = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const toolId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const toolName = z.enum(["list_projects", "get_surface_context", "propose_create_project_record"]);
export const chatWireMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }).strict(),
  z.object({ role: z.literal("user"), content: z.string() }).strict(),
  z.object({ role: z.literal("assistant"), content: z.string().nullable(), tool_calls: z.array(z.object({ id: toolId, type: z.literal("function"),
    function: z.object({ name: toolName, arguments: z.string().max(16000) }).strict() }).strict()).max(12).optional() }).strict(),
  z.object({ role: z.literal("tool"), tool_call_id: toolId, content: z.string() }).strict(),
]);
export type ChatWireMessage = z.infer<typeof chatWireMessageSchema>;
const usageSchema = z.object({ prompt_tokens: token, completion_tokens: token.max(2000), total_tokens: token }).strict();
const deltaSchema = z.object({ role: z.literal("assistant").optional(), content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ index: z.number().int().min(0).max(11), id: toolId.optional(), type: z.literal("function").optional(),
    function: z.object({ name: toolName.optional(), arguments: z.string().optional() }).strict() }).strict()).max(12).optional() }).strict();
const frameSchema = z.object({ id: toolId, object: z.literal("chat.completion.chunk"), created: token, model: z.string(),
  choices: z.array(z.object({ index: z.literal(0), delta: deltaSchema, finish_reason: z.enum(["stop", "tool_calls"]).nullable() }).strict()).max(1),
  usage: usageSchema.nullable().optional() }).strict();
export type CheckedChatTerminal = { version: 1; responseId: string; model: string; reason: "stop" | "tool_calls"; bodyHash: string; rawBody: string; responseBytes: number;
  inputTokens: number | null; outputTokens: number | null; text: string;
  calls: Array<{ toolCallId: string; name: ChatToolName; input: unknown; argumentsCanonical: string }>; frameCount: number };

export function checkChatRequest(raw: string, model: string, expectedMessages: ChatWireMessage[], expectedTools: unknown) {
  if (Buffer.byteLength(raw) > CHAT_LIMITS.requestBytesPerStep) throw new Error("chat_request_limit");
  const parsed = z.object({ model: z.literal(model), messages: z.array(chatWireMessageSchema), stream: z.literal(true), max_tokens: z.literal(2000),
    tools: z.unknown().optional(), tool_choice: z.literal("auto").optional(), stream_options: z.object({ include_usage: z.literal(true) }).strict() }).strict().parse(parseChatJson(raw));
  // Tool argument objects are compared after strict parsing; their JSON string
  // serialization order may differ in the installed adapter.
  const normalize = (messages: ChatWireMessage[]) => messages.map(m => m.role === "assistant" && m.tool_calls ? { ...m,
    tool_calls: m.tool_calls.map(c => ({ ...c, function: { ...c.function, arguments: canonicalChat(parseChatJson(c.function.arguments)) } })) } : m);
  const noTools = Array.isArray(expectedTools) && expectedTools.length === 0;
  if (canonicalChat(normalize(parsed.messages)) !== canonicalChat(normalize(expectedMessages)) ||
    (noTools ? parsed.tools !== undefined || parsed.tool_choice !== undefined : parsed.tool_choice !== "auto" || canonicalChat(parsed.tools) !== canonicalChat(expectedTools))) throw new Error("chat_request_binding_mismatch");
  return raw;
}

// Validate the raw protocol before the SDK sees it. Missing usage is retained
// as unknown. A checked terminal plus [DONE] and a complete UTF-8 body are required.
export function checkChatStream(body: string, model: string, allowedTools: readonly string[]): CheckedChatTerminal {
  if (Buffer.byteLength(body) > CHAT_LIMITS.responseBytesPerStep || !body.endsWith("\n\n") || body.includes("\r")) throw new Error("chat_stream_incomplete");
  const frames = body.split("\n\n"); frames.pop();
  if (!frames.length || frames.length > 4096) throw new Error("chat_frame_limit");
  let responseId: string | null = null, terminal: "stop" | "tool_calls" | null = null, done = false, text = "";
  let usage: z.infer<typeof usageSchema> | null = null;
  const calls = new Map<number, { id: string; name: ChatToolName; arguments: string }>();
  const ids = new Set<string>();
  for (const frame of frames) {
    if (Buffer.byteLength(frame) > 64000 || done || !frame.startsWith("data: ") || frame.includes("\n")) throw new Error("chat_frame_invalid");
    const data = frame.slice(6);
    if (data === "[DONE]") { if (!terminal) throw new Error("chat_terminal_missing"); done = true; continue; }
    const parsed = frameSchema.parse(parseChatJson(data));
    if (parsed.model !== model || (responseId !== null && responseId !== parsed.id)) throw new Error("chat_response_identity_mismatch");
    responseId = parsed.id;
    if (parsed.usage != null) {
      if (usage || parsed.usage.total_tokens !== parsed.usage.prompt_tokens + parsed.usage.completion_tokens) throw new Error("chat_usage_invalid");
      usage = parsed.usage;
    }
    if (!parsed.choices.length) { if (!terminal || !parsed.usage) throw new Error("chat_usage_frame_invalid"); continue; }
    if (terminal) throw new Error("chat_after_terminal");
    const choice = parsed.choices[0];
    if (choice.delta.content) text += choice.delta.content;
    for (const c of choice.delta.tool_calls ?? []) {
      let call = calls.get(c.index);
      if (!call) {
        if (c.index !== calls.size || !c.id || !c.function.name || c.type !== "function" || ids.has(c.id) || !allowedTools.includes(c.function.name)) throw new Error("chat_tool_identity_invalid");
        call = { id: c.id, name: c.function.name, arguments: "" }; calls.set(c.index, call); ids.add(c.id);
      } else if (c.id !== undefined || c.function.name !== undefined || c.type !== undefined) throw new Error("chat_tool_identity_repeated");
      call.arguments += c.function.arguments ?? "";
      if (Buffer.byteLength(call.arguments) > 16000) throw new Error("chat_tool_argument_limit");
    }
    if (choice.finish_reason) terminal = choice.finish_reason;
  }
  if (!done || !terminal || !responseId || (terminal === "stop" ? calls.size !== 0 : calls.size === 0)) throw new Error("chat_terminal_invalid");
  return { version: 1, responseId, model, reason: terminal, bodyHash: chatHash(body), rawBody: body, responseBytes: Buffer.byteLength(body),
    inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null, text,
    calls: [...calls.values()].map(call => { const input = chatToolInputs[call.name].parse(parseChatJson(call.arguments));
      return { toolCallId: call.id, name: call.name, input, argumentsCanonical: canonicalChat(input) }; }), frameCount: frames.length };
}

function captureChatStream(request: ClientRequest, agent: Agent, signal: AbortSignal, model: string,
  onProgress: (frameSequence: number, text: string) => Promise<void>) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const stop = (code: string) => { if (settled) return; settled = true; request.destroy(); agent.destroy(); reject(new Error(code)); };
    request.on("error", () => stop(signal.aborted ? "chat_interrupted" : "chat_network_uncertain"));
    request.on("response", async response => {
      if (response.statusCode !== 200 || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers["content-type"] ?? "") ||
        ![undefined, "identity"].includes(response.headers["content-encoding"])) { stop("chat_response_profile_refused"); return; }
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      let body = "", pending = "", bytes = 0, frameSequence = 0, responseId: string | null = null, done = false;
      try {
        for await (const chunk of response) {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length; if (bytes > CHAT_LIMITS.responseBytesPerStep) throw new Error("chat_response_limit");
          const decoded = decoder.decode(buffer, { stream: true }); body += decoded; pending += decoded;
          let boundary: number;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2); frameSequence++;
            if (done || frameSequence > 4096 || Buffer.byteLength(frame) > 64000 || !frame.startsWith("data: ") || /[\r\n]/.test(frame)) throw new Error("chat_frame_invalid");
            if (frame === "data: [DONE]") { done = true; continue; }
            const parsed = frameSchema.parse(parseChatJson(frame.slice(6)));
            if (parsed.model !== model || responseId !== null && parsed.id !== responseId) throw new Error("chat_response_identity_mismatch");
            responseId = parsed.id;
            const text = parsed.choices[0]?.delta.content;
            // This is explicitly partial progress, never a terminal or proposal.
            // Awaiting the broker provides backpressure and fresh session checks.
            if (text) await onProgress(frameSequence, text);
          }
          if (Buffer.byteLength(pending) > 64000) throw new Error("chat_frame_limit");
        }
        body += decoder.decode();
        if (signal.aborted || !response.complete || pending.length || !done) throw new Error("chat_response_incomplete");
        if (!settled) { settled = true; agent.destroy(); resolve(body); }
      } catch { stop(signal.aborted ? "chat_interrupted" : "chat_stream_uncertain"); }
    });
  });
}

export function createChatStepFetch(args: { endpoint: string; model: string; signal: AbortSignal; timeoutMs: number;
  messages: ChatWireMessage[]; wireTools: unknown; allowedTools: string[]; policy?: ProviderApiNetworkPolicy;
  authorize: (requestCanonical: string) => Promise<void>; openCredential: () => Promise<string | null>;
  onProgress?: (frameSequence: number, text: string) => Promise<void> }) {
  let consumed = false, terminal: CheckedChatTerminal | null = null;
  let stage: "validating" | "authorizing" | "credential" | "network" | "checked" = "validating";
  let failure: { code: string; state: "unavailable" | "failed" | "uncertain" } | null = null;
  const fetchStep: typeof fetch = async (input, init) => {
    try {
    if (consumed) throw new Error("chat_step_exchange_repeated"); consumed = true;
    if (String(input) !== new URL("chat/completions", args.endpoint).href || init?.method !== "POST" || typeof init.body !== "string") throw new Error("chat_step_destination_changed");
    const headers = new Headers(init.headers);
    for (const key of headers.keys()) if (!["content-type", "user-agent"].includes(key)) throw new Error("chat_sdk_headers_invalid");
    if (headers.get("content-type") !== "application/json") throw new Error("chat_sdk_headers_invalid");
    const body = checkChatRequest(init.body, args.model, args.messages, args.wireTools);
    args.signal.throwIfAborted();
    stage = "authorizing";
    await args.authorize(body); // Durable consumption precedes credential opening and network.
    args.signal.throwIfAborted();
    stage = "credential";
    let apiKey = await args.openCredential();
    try {
      stage = "network";
      const raw = await pinnedProviderExchange({ endpoint: args.endpoint, model: args.model, apiKey, signal: args.signal,
        timeoutMs: args.timeoutMs, policy: args.policy }, body, (request, agent, signal) => captureChatStream(request, agent, signal, args.model, args.onProgress ?? (async () => {})));
      stage = "checked"; terminal = checkChatStream(raw, args.model, args.allowedTools);
      return new Response(raw, { status: 200, headers: { "content-type": "text/event-stream" } });
    } finally { apiKey = null; }
    } catch (error) {
      const code = error instanceof Error && /^chat_[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "chat_step_unavailable";
      failure = { code, state: stage === "checked" || code === "chat_response_profile_refused" ? "failed" : stage === "network" ? "uncertain" : "unavailable" };
      throw error;
    }
  };
  return { fetch: fetchStep, failure: () => failure, receipt: () => { if (!consumed || !terminal) throw new Error("chat_terminal_missing"); return terminal; } };
}
