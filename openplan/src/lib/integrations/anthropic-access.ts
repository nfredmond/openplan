/**
 * Ambient Anthropic credential resolution for synchronous request paths.
 * Durable translation attempts use a sealed request credential instead; see
 * translation-credentials.ts and engagement/translation-generation.ts.
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
import { wrapLanguageModel } from "ai";

import { claudeEffortFor } from "@/lib/ai/model-policy";
import { workspaceIntegrationKey } from "./context";

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];

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
 * Output tokens added to each call's cap for thinking. Opus 5.5 and Haiku 5.5
 * always think, and thinking counts against the cap; every cap in the app was
 * sized for visible text when the defaults were Opus 4.8 and Haiku 4.5 with
 * thinking off. Kept modest so a non-streaming call stays well under the
 * five-minute response-header timeout.
 */
export const CLAUDE_THINKING_ALLOWANCE_TOKENS = 8000;

/**
 * Apply the policy to a Claude model: its effort, and room for thinking on
 * top of the caller's visible-output cap. A model ID outside the policy is
 * returned unchanged.
 */
export function withAgentModelPolicy(model: WrappableModel, modelId: string): WrappableModel {
  const effort = claudeEffortFor(modelId);
  if (!effort) return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        maxOutputTokens:
          params.maxOutputTokens === undefined ? undefined : params.maxOutputTokens + CLAUDE_THINKING_ALLOWANCE_TOKENS,
        providerOptions: {
          ...params.providerOptions,
          anthropic: { ...params.providerOptions?.anthropic, effort },
        },
      }),
    },
  });
}

/**
 * Construct a model bound to the effective key. Callers must gate on
 * {@link hasAnthropicAccess} first (they all do — every site keeps its honest
 * offline fallback); reaching this without a key is a programming error.
 *
 * A model named in the agent model policy carries the policy's effort and
 * thinking allowance on every call; see {@link withAgentModelPolicy}.
 */
export function anthropicModel(modelId: string) {
  const apiKey = anthropicApiKey();
  if (!apiKey) {
    throw new Error("No Anthropic API key available (workspace or deployment env)");
  }
  return withAgentModelPolicy(createAnthropic({ apiKey })(modelId), modelId);
}
