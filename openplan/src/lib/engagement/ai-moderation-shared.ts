/**
 * The client-safe half of AI moderation: categories, severities, actions,
 * result types, the caveat — and the READ-BACK of what the scan persisted.
 * Split from `ai-moderation.ts` because the engine there reaches the Anthropic
 * access layer (node:crypto / node:async_hooks via the workspace-integration
 * context), which must never enter a browser bundle — and the moderation panel
 * only needs these.
 *
 * The read-back lives here, next to the vocabulary the writer uses, because it
 * is the same contract seen from the other end. `moderation-scan/route.ts`
 * writes an assessment into `engagement_items.metadata_json.ai_moderation`;
 * that column is free-form jsonb, so nothing in the database enforces the shape
 * on the way back out. Keeping reader and writer in one file is what stops them
 * drifting — the campaign page used to carry its own private `StoredModeration`
 * shape and cast the strings straight into the typed union, which meant a value
 * this build does not recognize rendered as one it does.
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

/** How much of a comment the flagged list quotes back to the moderator. */
const MODERATION_SNIPPET_CHARS = 120;

/** A flagged comment as the moderator panel renders it. */
export type ModeratedItem = { id: string; snippet: string; moderation: ItemModeration };

/**
 * The moderation queue as the campaign page hands it to the panel.
 *
 * `queueItemCount` counts what a human still has to decide (status pending or
 * flagged) and is deliberately independent of whether a scan ever ran — the
 * queue is a fact about statuses, the assessments are a fact about a scan.
 */
export type ModerationQueueView = {
  queueItemCount: number;
  flagged: ModeratedItem[];
  lastSource: ModerationResult["source"] | null;
  /**
   * Stored assessments this build could not interpret. Surfaced rather than
   * dropped: an assessment we cannot read is an unknown, and a panel that
   * quietly omitted it would tell a moderator "nothing else was flagged" on the
   * strength of data it failed to parse.
   */
  unreadableAssessmentCount: number;
};

type StoredModerationRecord = Record<string, unknown>;

function asRecord(value: unknown): StoredModerationRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StoredModerationRecord) : null;
}

function storedAssessment(metadata: unknown): StoredModerationRecord | null {
  return asRecord(asRecord(metadata)?.ai_moderation);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Read one persisted assessment, or null when it cannot be trusted to mean what
 * it appears to mean.
 *
 * Every field is checked against the enum this build actually knows instead of
 * being cast. That matters in one direction more than the other: a severity
 * string we do not recognize, coerced to `"none"`, would paint a high-severity
 * flag in the neutral tone and read as reassurance. So an unrecognized severity
 * or action voids the whole assessment rather than being defaulted, and the
 * caller reports the count.
 *
 * Unrecognized FLAG names are dropped individually rather than voiding the
 * assessment, because each flag stands alone — a scan that named one category
 * we know and one we do not still tells the moderator something true. But an
 * assessment left with no recognized flag at all is not a flag, and is voided.
 */
export function parseStoredItemModeration(itemId: string, metadata: unknown): ItemModeration | null {
  const stored = storedAssessment(metadata);
  if (!stored) {
    return null;
  }

  const rawFlags = Array.isArray(stored.flags) ? stored.flags : [];
  const flags = rawFlags
    .map((flag) => oneOf(flag, MODERATION_CATEGORIES))
    .filter((flag): flag is ModerationCategory => flag !== null);
  if (flags.length === 0) {
    return null;
  }

  const severity = oneOf(stored.severity, MODERATION_SEVERITIES);
  const suggestedAction = oneOf(stored.suggested_action, MODERATION_ACTIONS);
  if (!severity || !suggestedAction) {
    return null;
  }

  return {
    item_id: itemId,
    flags,
    severity,
    rationale: typeof stored.rationale === "string" ? stored.rationale : "",
    suggested_action: suggestedAction,
  };
}

/** Collapse a comment body to the quoted snippet the panel shows. */
function snippet(body: string): string {
  return body.trim().replace(/\s+/g, " ").slice(0, MODERATION_SNIPPET_CHARS);
}

function assessmentTime(metadata: unknown): number {
  const at = storedAssessment(metadata)?.at;
  const parsed = typeof at === "string" ? Date.parse(at) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Assemble the moderation panel's input from the campaign's items.
 *
 * `lastSource` is the source of the most RECENTLY stamped assessment, not of
 * whichever queued item happened to sort first. The panel uses it to say
 * whether the last scan ran on Claude or fell back to the offline heuristics,
 * and answering that from an arbitrary row would let a stale AI assessment
 * hide a fallback that ran after it. An assessment with no readable `at` cannot
 * win the comparison, so it never overrides one that carries a timestamp.
 */
export function buildModerationQueueView(
  items: Array<{ id: string; body: string; status: string | null; metadata_json?: unknown }>
): ModerationQueueView {
  const queued = items.filter((item) => item.status === "pending" || item.status === "flagged");

  const flagged: ModeratedItem[] = [];
  let unreadableAssessmentCount = 0;
  for (const item of queued) {
    const stored = storedAssessment(item.metadata_json);
    if (!stored) {
      continue;
    }
    const moderation = parseStoredItemModeration(item.id, item.metadata_json);
    if (moderation) {
      flagged.push({ id: item.id, snippet: snippet(item.body), moderation });
      continue;
    }
    // An assessment that named no category at all is a clean "nothing found
    // here", which is exactly what the scan writes for an unflagged comment —
    // not something the panel needs to disclose.
    const namedNothing = Array.isArray(stored.flags) && stored.flags.length === 0;
    if (!namedNothing) {
      unreadableAssessmentCount += 1;
    }
  }

  let lastSource: ModerationResult["source"] | null = null;
  let lastSourceAt = Number.NEGATIVE_INFINITY;
  for (const item of queued) {
    const source = oneOf(storedAssessment(item.metadata_json)?.source, ["ai", "deterministic-fallback"] as const);
    if (!source) {
      continue;
    }
    const at = assessmentTime(item.metadata_json);
    if (lastSource === null || at > lastSourceAt) {
      lastSource = source;
      lastSourceAt = at;
    }
  }

  return { queueItemCount: queued.length, flagged, lastSource, unreadableAssessmentCount };
}
