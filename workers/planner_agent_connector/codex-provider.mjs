import { codexLaunch, codexThreadParams, codexTurnParams } from "./codex-launch.mjs";
import { startCodexSession, NativeProviderError } from "./codex-session.mjs";

async function initialize(session) {
  await session.request("initialize", { clientInfo: { name: "openplan_project_connector", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  session.notify("initialized");
}

// Only the native runtime reads or refreshes credentials. Return the mode and
// plan, never account identifiers, email addresses, tokens or provider key data.
async function accountSummary(session) {
  const result = await session.request("account/read", { refreshToken: false });
  if (!result || typeof result !== "object") throw new NativeProviderError("native_account_unreadable");
  if (!result.account) return { status: "needs_login", authMode: null, planType: null };
  const type = result.account.type;
  if (!["chatgpt", "apiKey"].includes(type)) return { status: "unsupported_auth_mode", authMode: null, planType: null };
  return { status: "connected", authMode: type, planType: type === "chatgpt" && typeof result.account.planType === "string" ? result.account.planType : null };
}

export async function inspectCodexConnection(options) {
  const launch = await codexLaunch(options);
  const session = startCodexSession(launch, { timeoutMs: 15_000, signal: options.signal });
  try {
    await initialize(session);
    const account = await accountSummary(session);
    if (!options.includeModels || account.status !== "connected") return account;
    const result = await session.request("model/list", { includeHidden: false, limit: 100 });
    if (!Array.isArray(result?.data)) throw new NativeProviderError("native_models_unreadable");
    const models = result.data.filter((item) => !item.hidden && typeof item.model === "string" && typeof item.displayName === "string")
      .map((item) => ({ id: item.model, label: item.displayName, isDefault: item.isDefault === true }));
    return { ...account, models, modelsTruncated: Boolean(result.nextCursor) };
  }
  finally { await session.close(); }
}

// A new isolated turn receives a frozen project packet. No general browser or
// service credentials are in this process. The caller validates returned drafts
// before storing them; only the existing browser approval route may execute one.
export async function runCodexProjectTurn(options) {
  const { model, expectedAuthMode, instructions, prompt, outputSchema, signal } = options;
  if (typeof model !== "string" || !model.trim() || model.length > 160 || !["chatgpt", "apiKey"].includes(expectedAuthMode)) {
    throw new NativeProviderError("native_request_invalid");
  }
  if (typeof prompt !== "string" || Buffer.byteLength(prompt) > 100_000 || typeof instructions !== "string" || Buffer.byteLength(instructions) > 20_000) {
    throw new NativeProviderError("native_input_too_large");
  }
  const launch = await codexLaunch(options);
  const session = startCodexSession(launch, { timeoutMs: 180_000, signal });
  try {
    await initialize(session);
    const account = await accountSummary(session);
    if (account.status !== "connected") throw new NativeProviderError(`native_${account.status}`);
    if (account.authMode !== expectedAuthMode) throw new NativeProviderError("native_auth_mode_changed");
    const started = await session.request("thread/start", codexThreadParams({ model, instructions }));
    if (started?.model !== model || typeof started?.thread?.id !== "string") throw new NativeProviderError("native_model_changed");
    const threadId = started.thread.id;
    const startedTurn = await session.request("turn/start", codexTurnParams({ threadId, prompt, outputSchema }));
    if (typeof startedTurn?.turn?.id !== "string") throw new NativeProviderError("native_protocol_invalid");
    const turnId = startedTurn.turn.id;
    const final = await session.waitFor("turn/completed", (event) => event.threadId === threadId && event.turn?.id === turnId);
    if (final.turn.status !== "completed" || final.turn.error) {
      const info = final.turn.error?.codexErrorInfo;
      const code = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : "";
      throw new NativeProviderError(code === "usageLimitExceeded" ? "native_usage_limit" : "native_turn_failed");
    }
    if (!Array.isArray(final.turn.items)) throw new NativeProviderError("native_protocol_invalid");
    const messages = final.turn.items.filter((item) => item.type === "agentMessage" && typeof item.text === "string" && item.phase !== "commentary");
    const answer = messages.at(-1)?.text;
    if (!answer?.trim()) throw new NativeProviderError("native_answer_missing");
    if (Buffer.byteLength(answer) > 64_000) throw new NativeProviderError("native_answer_too_large");
    return { provider: "codex", model, authMode: account.authMode, planType: account.planType, threadId, turnId, answer };
  } finally { await session.close(); }
}
