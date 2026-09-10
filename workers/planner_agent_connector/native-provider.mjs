import { checkedConnectorSetup } from "./connector-client.mjs";
import { inspectCodexConnection, runCodexProjectTurn } from "./codex-provider.mjs";
import { inspectClaudeConnection, runClaudeProjectTurn } from "./claude-provider.mjs";

// Legacy setup files name Codex implicitly. New files bind the native provider
// and account mode explicitly; neither an error nor a retry changes that choice.
export function connectorProviderAdapter(setup) {
  const provider = checkedConnectorSetup(setup).provider ?? "codex";
  return provider === "claude"
    ? { provider, inspect: inspectClaudeConnection, generate: runClaudeProjectTurn }
    : { provider, inspect: inspectCodexConnection, generate: runCodexProjectTurn };
}
