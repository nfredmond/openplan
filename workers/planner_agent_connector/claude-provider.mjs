import { claudeLaunch, claudeTurnArgs, CLAUDE_PROTOCOL_VERSION } from "./claude-launch.mjs";
import { runClaudeCommand, claudeAccountSummary, claudeTurnResult, ClaudeProviderError } from "./claude-process.mjs";

async function readAccount(launch, signal) {
  const stdout = await runClaudeCommand({ ...launch, args: [...launch.args, "auth", "status", "--json"] },
    { statusQuery: true, timeoutMs: 15_000, signal });
  let raw;
  try { raw = JSON.parse(stdout); } catch { throw new ClaudeProviderError("native_account_unreadable"); }
  return claudeAccountSummary(raw);
}

// The native CLI exposes account status without a model call. It has no tested
// non-generating model catalog here; absence is explicit, never an invented list.
export async function inspectClaudeConnection(options) {
  const launch = await claudeLaunch(options);
  const account = await readAccount(launch, options.signal);
  return { ...account, nativeVersion: CLAUDE_PROTOCOL_VERSION,
    ...(options.includeModels ? { models: [], modelsUnavailable: true } : {}) };
}

// Each request gets a fresh native conversation with only the frozen packet.
// The surrounding connector journals the attempt and validates the app's answer
// schema before delivery. There is no native resume or automatic regeneration.
export async function runClaudeProjectTurn(options) {
  const { model, expectedAuthMode, instructions, prompt, outputSchema, signal } = options;
  if (typeof model !== "string" || !/^claude-[a-z0-9-]{1,140}$/.test(model) || expectedAuthMode !== "claude_subscription") {
    throw new ClaudeProviderError("native_request_invalid");
  }
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 100_000 ||
    typeof instructions !== "string" || !instructions.trim() || Buffer.byteLength(instructions) > 20_000) {
    throw new ClaudeProviderError("native_input_too_large");
  }
  if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema) || Buffer.byteLength(JSON.stringify(outputSchema)) > 32_000) {
    throw new ClaudeProviderError("native_output_schema_invalid");
  }
  const launch = await claudeLaunch(options);
  const account = await readAccount(launch, signal);
  if (account.status !== "connected") throw new ClaudeProviderError(`native_${account.status}`);
  if (account.authMode !== expectedAuthMode) throw new ClaudeProviderError("native_auth_mode_changed");
  const stdout = await runClaudeCommand({ ...launch, args: [...launch.args, ...claudeTurnArgs({ model, instructions, outputSchema })] },
    { input: prompt, signal });
  const result = claudeTurnResult(stdout, model);
  return { provider: "claude", model, authMode: account.authMode, planType: account.planType, ...result };
}
