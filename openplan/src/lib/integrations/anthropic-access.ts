/**
 * The ONE way OpenPlan reads Anthropic credentials and constructs models.
 *
 * Resolution order at every call: the current request's workspace key (set by
 * `withWorkspaceIntegrationContext` at a route entry) first, then the
 * deployment's ANTHROPIC_API_KEY. Outside any integration context — workers,
 * unwrapped routes, tests — behavior is byte-identical to the old direct env
 * reads, so absence of the wrapper can never regress a feature.
 *
 * Presence gates call {@link hasAnthropicAccess}; construction sites call
 * {@link anthropicModel}. Both are synchronous drop-ins for the previous
 * `process.env.ANTHROPIC_API_KEY` / `anthropic(modelId)` pair.
 */

import { createAnthropic } from "@ai-sdk/anthropic";

import { workspaceIntegrationKey } from "./context";

/** The effective key for this request, or null when neither source has one. */
export function anthropicApiKey(): string | null {
  return workspaceIntegrationKey("anthropic") ?? (process.env.ANTHROPIC_API_KEY?.trim() || null);
}

/** Whether an Anthropic call can be made at all right now. */
export function hasAnthropicAccess(): boolean {
  return anthropicApiKey() !== null;
}

/**
 * Which source the effective key came from — the spend-guard refusal and the
 * wizard use this to say "your key, your spend" honestly.
 */
export function anthropicKeySource(): "workspace" | "env" | null {
  if (workspaceIntegrationKey("anthropic")) return "workspace";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "env";
  return null;
}

/**
 * Construct a model bound to the effective key. Callers must gate on
 * {@link hasAnthropicAccess} first (they all do — every site keeps its honest
 * offline fallback); reaching this without a key is a programming error.
 */
export function anthropicModel(modelId: string) {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    throw new Error("No Anthropic API key available (workspace or deployment env)");
  }
  return createAnthropic({ apiKey })(modelId);
}
