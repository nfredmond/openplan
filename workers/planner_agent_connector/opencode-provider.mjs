import { randomBytes } from "node:crypto";
import { openCodeLaunch, OPENCODE_PROTOCOL_VERSION } from "./opencode-launch.mjs";
import { inspectOpenCodeModels } from "./opencode-models.mjs";
import { openCodeRelay } from "./opencode-relay.mjs";
import { startOpenCodeServer } from "./opencode-process.mjs";
import { openCodeMessageId, openCodeTurnResult, OpenCodeResultError } from "./opencode-result.mjs";

// Inspection cannot generate: model listing runs without network access, and
// this unused loopback URL has no listener. No native provider data is returned.
export async function inspectOpenCodeConnection(options) {
  if (options.signal?.aborted) throw new OpenCodeResultError("native_cancelled");
  const launch = await openCodeLaunch({ ...options,
    relayUrl: `http://127.0.0.1:1/${randomBytes(32).toString("hex")}`, serverPassword: randomBytes(32).toString("hex") });
  const account = { ...launch.account, nativeVersion: OPENCODE_PROTOCOL_VERSION };
  if (!options.includeModels || account.status !== "connected") return account;
  return { ...account, models: await inspectOpenCodeModels(launch, { signal: options.signal }), modelsTruncated: false };
}

// The second argument is an internal deterministic transport seam. Connector
// setup files cannot supply functions, endpoints, native tools or billing fallbacks.
export async function runOpenCodeProjectTurn(options, { relayFetchImpl } = {}) {
  const { model, expectedAuthMode, instructions, prompt, outputSchema, signal } = options;
  if (signal?.aborted) throw new OpenCodeResultError("native_cancelled");
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,139}$/.test(model) || expectedAuthMode !== "opencode_api") {
    throw new OpenCodeResultError("native_request_invalid");
  }
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 100_000 ||
    typeof instructions !== "string" || !instructions.trim() || Buffer.byteLength(instructions) > 20_000) {
    throw new OpenCodeResultError("native_input_too_large");
  }
  let serializedSchema;
  try { serializedSchema = JSON.stringify(outputSchema); } catch { /* Refuse unrepresentable schemas below. */ }
  if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema) ||
    !serializedSchema || Buffer.byteLength(serializedSchema) > 32_000) throw new OpenCodeResultError("native_output_schema_invalid");
  const interrupted = new AbortController();
  const nativeSignal = AbortSignal.any([interrupted.signal, ...(signal ? [signal] : [])]);
  const relay = await openCodeRelay({ model, signal: nativeSignal, fetchImpl: relayFetchImpl,
    onFailure: () => interrupted.abort() });
  let server, result;
  try {
    const launch = await openCodeLaunch({ ...options, relayUrl: relay.baseUrl, serverPassword: randomBytes(32).toString("hex") });
    if (launch.account.status !== "connected") throw new OpenCodeResultError(`native_${launch.account.status}`);
    if (launch.account.authMode !== expectedAuthMode) throw new OpenCodeResultError("native_auth_mode_changed");
    const models = await inspectOpenCodeModels(launch, { signal: nativeSignal });
    if (!models.some(item => item.id === model)) throw new OpenCodeResultError("native_model_unavailable");
    server = await startOpenCodeServer(launch, { signal: nativeSignal });
    const session = await server.request("/session", { method: "POST", body: {
      title: "OpenPlan retained project request", permission: [
        { permission: "*", pattern: "*", action: "deny" }, { permission: "StructuredOutput", pattern: "*", action: "allow" },
      ],
    } });
    if (typeof session?.id !== "string" || !/^ses_[a-zA-Z0-9]{26}$/.test(session.id)) throw new OpenCodeResultError("native_protocol_invalid");
    const parentId = openCodeMessageId();
    const turn = await server.request(`/session/${session.id}/message`, { method: "POST", body: {
      messageID: parentId, model: { providerID: "openai", modelID: model }, agent: "openplan", system: instructions,
      format: { type: "json_schema", schema: outputSchema, retryCount: 0 }, parts: [{ type: "text", text: prompt }],
    } });
    if (typeof turn?.info?.id !== "string" || !/^msg_[a-zA-Z0-9]{26}$/.test(turn.info.id)) throw new OpenCodeResultError("native_protocol_invalid");
    const readback = await server.request(`/session/${session.id}/message/${turn.info.id}`);
    result = openCodeTurnResult(turn, readback, { sessionId: session.id, parentId, model });
  } catch (error) {
    if (signal?.aborted) throw new OpenCodeResultError("native_cancelled");
    throw relay.failure ? new OpenCodeResultError(relay.failure) : error;
  } finally {
    try { await server?.close(); }
    finally { await relay.close(); }
  }
  if (signal?.aborted) throw new OpenCodeResultError("native_cancelled");
  if (relay.forwardedRequests !== 1 || relay.failure) throw new OpenCodeResultError(relay.failure ?? "native_request_budget_mismatch");
  if (server.failure) throw new OpenCodeResultError(server.failure);
  return { provider: "opencode", model, authMode: "opencode_api", planType: null, ...result };
}
