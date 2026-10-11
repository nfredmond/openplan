/**
 * Default models for agentic work inside OpenPlan, set by Nathaniel on
 * 2026-10-10. One table, three roles, two provider families. Every hardcoded
 * Claude default in the app reads from here; the env overrides each feature
 * already documents (`OPENPLAN_ASSISTANT_MODEL`, `OPENPLAN_ENGAGEMENT_*_MODEL`,
 * and the rest) still win.
 *
 * - `orchestrator`: the main thinker. Assistant chat, narrative drafting,
 *   document extraction.
 * - `quick`: quick decisions, summaries and straightforward tasks.
 *   Moderation, synthesis, translation, short interpretations. Haiku 5.5 is
 *   much better than GPT-6 Luna at this work; offer Luna only to someone
 *   whose subscription is OpenAI.
 * - `mapping`: map and GIS tasks. Fable 5.1 is much better at mapping than
 *   GPT-6 Astra; offer Astra only to someone whose subscription is OpenAI.
 *   No in-app call site uses this role yet.
 *
 * The family follows the planner's preference or existing subscription:
 * `anthropic` for an Anthropic API key or Claude subscription, `openai` for a
 * ChatGPT account, an OpenAI API key or OpenCode.
 *
 * `quick.openai` is GPT-6 Luna, confirmed by Nathaniel on 2026-10-10. Move it
 * to GPT-6.1 Luna here when that model ships.
 */

export type AgentModelRole = "orchestrator" | "quick" | "mapping";
export type AgentModelFamily = "anthropic" | "openai";
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type AgentModelChoice = { modelId: string; effort: AgentEffort };

export const AGENT_MODEL_POLICY: Record<AgentModelRole, Record<AgentModelFamily, AgentModelChoice>> = {
  orchestrator: {
    anthropic: { modelId: "claude-opus-5-5", effort: "high" },
    openai: { modelId: "gpt-6.1-sol", effort: "high" },
  },
  quick: {
    anthropic: { modelId: "claude-haiku-5-5", effort: "high" },
    openai: { modelId: "gpt-6-luna", effort: "high" },
  },
  mapping: {
    anthropic: { modelId: "claude-fable-5-1", effort: "high" },
    openai: { modelId: "gpt-6-astra", effort: "high" },
  },
};

/** The Claude model a role uses when no env override is set. */
export function defaultClaudeModelId(role: AgentModelRole): string {
  return AGENT_MODEL_POLICY[role].anthropic.modelId;
}

/**
 * The model ID a Planner Agent project task starts with for a provider. A
 * project task is orchestrator work. Codex and OpenCode run OpenAI models;
 * the Claude subscription and the Anthropic API run Claude. A saved API
 * connection lists its own model IDs, so it starts empty.
 */
export function plannerAgentDefaultModelId(provider: string): string {
  if (provider === "codex" || provider === "opencode") return AGENT_MODEL_POLICY.orchestrator.openai.modelId;
  if (provider === "claude" || provider === "anthropic") return AGENT_MODEL_POLICY.orchestrator.anthropic.modelId;
  return "";
}

/**
 * The effort to send with a Claude model, or null to send none. Only models
 * named in the policy get one: an env override may point at an older model
 * (Haiku 4.5 rejects the effort parameter), so an unknown ID is left alone.
 */
export function claudeEffortFor(modelId: string): AgentEffort | null {
  for (const role of Object.values(AGENT_MODEL_POLICY)) {
    if (role.anthropic.modelId === modelId) return role.anthropic.effort;
  }
  return null;
}

type ClaudePrice = {
  input: number;
  output: number;
  /** Higher rates that apply to the whole call once the prompt exceeds `aboveInputTokens`. */
  longPrompt?: { aboveInputTokens: number; input: number; output: number };
};

/**
 * Anthropic first-party list prices, USD per million tokens, from the Claude
 * API model table cached 2026-10-06. Older IDs stay so env overrides still
 * estimate.
 */
const CLAUDE_LIST_PRICES: Record<string, ClaudePrice> = {
  "claude-fable-5-1": { input: 10.0, output: 50.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longPrompt: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 } },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
};

/**
 * Estimate one call's list-price cost from token usage. Returns null for an
 * unlisted model ID or when no usage is available.
 */
export function estimateClaudeListPriceUsd(
  modelId: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const price = CLAUDE_LIST_PRICES[modelId];
  if (!price) return null;
  if (inputTokens === null && outputTokens === null) return null;
  const rates =
    price.longPrompt && (inputTokens ?? 0) > price.longPrompt.aboveInputTokens ? price.longPrompt : price;
  const raw = ((inputTokens ?? 0) / 1_000_000) * rates.input + ((outputTokens ?? 0) / 1_000_000) * rates.output;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
