import { spawn } from "node:child_process";

export class ClaudeProviderError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Wait for child exit as well as output. A result followed by a failed exit is
// not success. Cancellation and bounds terminate only this owned child.
export function runClaudeCommand(launch, { input = "", signal, timeoutMs = 180_000, statusQuery = false } = {}) {
  if (signal?.aborted) return Promise.reject(new ClaudeProviderError("native_cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, launch.options);
    let failure, bytes = 0, errorBytes = 0, killTimer;
    const chunks = [];
    const fail = code => {
      if (failure) return;
      failure = new ClaudeProviderError(code);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    };
    const abort = () => fail("native_cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => fail("native_timeout"), timeoutMs);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 1_000_000) fail("native_output_too_large");
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on("data", chunk => {
      errorBytes += chunk.length;
      if (errorBytes > 256_000) fail("native_stderr_too_large");
    });
    child.stdin.on("error", () => { /* Exit status decides a closed input pipe. */ });
    child.on("error", () => { failure ??= new ClaudeProviderError("native_process_unavailable"); });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", abort);
      const stdout = Buffer.concat(chunks).toString("utf8");
      let signedOut = false;
      if (statusQuery && code === 1 && !exitSignal) {
        try { signedOut = JSON.parse(stdout)?.loggedIn === false; } catch { /* Refuse malformed native status. */ }
      }
      if (failure) reject(failure);
      else if ((code !== 0 && !signedOut) || exitSignal) reject(new ClaudeProviderError("native_process_failed"));
      else resolve(stdout);
    });
    child.stdin.end(input);
    if (signal?.aborted) abort();
  });
}

// Native status can include email and organization identifiers. Only these
// nonidentifying account fields cross the adapter boundary.
export function claudeAccountSummary(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.loggedIn !== "boolean") throw new ClaudeProviderError("native_account_unreadable");
  if (!raw.loggedIn) return { status: "needs_login", authMode: null, planType: null };
  if (raw.authMethod !== "claude.ai" || raw.apiProvider !== "firstParty" || !["pro", "max", "team", "enterprise"].includes(raw.subscriptionType)) {
    return { status: "unsupported_auth_mode", authMode: null, planType: null };
  }
  return { status: "connected", authMode: "claude_subscription", planType: raw.subscriptionType };
}

// Only the matching native session's final structured result can be delivered.
// Text fragments, permission requests and successful starts are not receipts.
export function claudeTurnResult(stdout, model) {
  let events;
  try { events = stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line)); }
  catch { throw new ClaudeProviderError("native_protocol_invalid"); }
  if (events.some(event => !event || typeof event !== "object" || Array.isArray(event))) throw new ClaudeProviderError("native_protocol_invalid");
  const initialized = events.filter(event => event.type === "system" && event.subtype === "init");
  if (initialized.length !== 1 || typeof initialized[0].session_id !== "string" || !initialized[0].session_id) throw new ClaudeProviderError("native_protocol_invalid");
  const start = initialized[0];
  if (start.apiKeySource !== "none") throw new ClaudeProviderError("native_auth_mode_changed");
  if (start.model !== model) throw new ClaudeProviderError("native_model_changed");
  if (!Array.isArray(start.tools) || start.tools.some(name => name !== "StructuredOutput") || !Array.isArray(start.mcp_servers) || start.mcp_servers.length) {
    throw new ClaudeProviderError("native_capability_changed");
  }
  const results = events.filter(event => event.type === "result");
  if (results.length !== 1 || results[0] !== events.at(-1) || results[0].session_id !== start.session_id) throw new ClaudeProviderError("native_stream_interrupted");
  const final = results[0];
  if (final.subtype !== "success" || final.is_error !== false) throw new ClaudeProviderError("native_turn_failed");
  if (typeof final.uuid !== "string" || !final.uuid) throw new ClaudeProviderError("native_protocol_invalid");
  if (!final.modelUsage || Object.keys(final.modelUsage).length !== 1 || Object.keys(final.modelUsage)[0] !== model) throw new ClaudeProviderError("native_model_changed");
  if (!final.structured_output || typeof final.structured_output !== "object" || Array.isArray(final.structured_output)) throw new ClaudeProviderError("native_answer_missing");
  const answer = JSON.stringify(final.structured_output);
  if (Buffer.byteLength(answer) > 64_000) throw new ClaudeProviderError("native_answer_too_large");
  return { threadId: start.session_id, turnId: final.uuid, answer };
}
