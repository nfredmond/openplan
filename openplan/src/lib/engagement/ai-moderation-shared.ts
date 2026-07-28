/**
 * The client-safe half of AI moderation: categories, severities, actions,
 * result types, and the caveat. Split from `ai-moderation.ts` because the
 * engine there reaches the Anthropic access layer (node:crypto /
 * node:async_hooks via the workspace-integration context), which must never
 * enter a browser bundle — and the moderation panel only needs these.
 */

export const MODERATION_CATEGORIES = ["toxicity", "pii", "off_topic", "spam"] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export const MODERATION_SEVERITIES = ["none", "low", "medium", "high"] as const;
export type ModerationSeverity = (typeof MODERATION_SEVERITIES)[number];

export const MODERATION_ACTIONS = ["approve", "review"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export type ModerationInputItem = { id: string; title?: string | null; body: string };

export type ItemModeration = {
  item_id: string;
  flags: ModerationCategory[];
  severity: ModerationSeverity;
  rationale: string;
  suggested_action: ModerationAction;
};

export type ModerationFallbackReason = "missing_api_key" | "generation_error" | "empty_output" | "invalid_output";

export type ModerationResult = {
  source: "ai" | "deterministic-fallback";
  model: string | null;
  fallback_reason: ModerationFallbackReason | null;
  item_count: number;
  flagged_count: number;
  items: ItemModeration[];
  caveat: string;
};

export const MODERATION_CAVEAT =
  "AI moderation is a screening ASSIST: it flags possible toxicity, personal information, off-topic, or spam with a rationale to help a human moderator triage. It NEVER auto-rejects — a person decides — and is not a definitive content judgment.";
