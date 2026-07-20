/**
 * E9 (part 2) — AI moderation ASSIST for the engagement queue. Claude classifies
 * each pending/flagged comment for toxicity / personal-info (PII) / off-topic /
 * spam with an EXPLAINABLE rationale, to help a human moderator triage faster. It
 * never auto-rejects — a person still decides. AI-offline safe: with no API key
 * (or any model/parse error) it falls back to deterministic PII + spam heuristics,
 * so this never throws for AI reasons (mirrors ai-synthesis.ts).
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const MODERATION_MODEL_ID =
  process.env.OPENPLAN_ENGAGEMENT_MODERATION_MODEL?.trim() || "claude-haiku-4-5-20251001";

/** Cap items per scan so a huge campaign can't blow the token budget. */
export const MODERATION_MAX_ITEMS = 100;
const BODY_PROMPT_CAP = 1200;

const SEVERITY_RANK: Record<ModerationSeverity, number> = { none: 0, low: 1, medium: 2, high: 3 };

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

// ── deterministic (AI-offline) heuristics: PII + spam only ──────────────────
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const URL_RE = /\bhttps?:\/\/|www\./gi;

export function deterministicItemModeration(item: ModerationInputItem): ItemModeration {
  const text = `${item.title ?? ""} ${item.body}`;
  const flags: ModerationCategory[] = [];
  const reasons: string[] = [];

  if (EMAIL_RE.test(text) || PHONE_RE.test(text) || SSN_RE.test(text)) {
    flags.push("pii");
    reasons.push("contains what looks like an email, phone number, or SSN");
  }
  const urlCount = (text.match(URL_RE) ?? []).length;
  if (urlCount >= 3) {
    flags.push("spam");
    reasons.push(`${urlCount} links (possible spam)`);
  }

  const severity: ModerationSeverity = flags.includes("pii") ? "high" : flags.includes("spam") ? "medium" : "none";
  return {
    item_id: item.id,
    flags,
    severity,
    rationale: reasons.length
      ? `Heuristic check flagged: ${reasons.join("; ")}.`
      : "No PII or spam patterns found (heuristic; toxicity and off-topic need the AI pass).",
    suggested_action: flags.length > 0 ? "review" : "approve",
  };
}

function parseModelJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function coerceAiItem(raw: unknown, item: ModerationInputItem): ItemModeration | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const flags = Array.isArray(r.flags)
    ? (r.flags.map((f) => String(f)).filter((f): f is ModerationCategory =>
        (MODERATION_CATEGORIES as readonly string[]).includes(f)
      ))
    : [];
  const severityRaw = String(r.severity ?? "none").toLowerCase();
  const severity: ModerationSeverity = (MODERATION_SEVERITIES as readonly string[]).includes(severityRaw)
    ? (severityRaw as ModerationSeverity)
    : "none";
  const action: ModerationAction = flags.length > 0 ? "review" : "approve";
  const rationale = String(r.rationale ?? "").trim().slice(0, 400) || "No specific concern identified.";
  return { item_id: item.id, flags: [...new Set(flags)], severity: flags.length === 0 ? "none" : severity, rationale, suggested_action: action };
}

/**
 * OR the deterministic full-body PII/spam flags into the AI assessment. The AI
 * prompt is length-capped, so PII/spam past the cap would be invisible to the
 * model; the regex floor runs over the WHOLE body and can only ADD flags. This
 * guarantees the tool's core PII screen never silently misses long comments.
 */
function mergeModeration(ai: ItemModeration, deterministic: ItemModeration): ItemModeration {
  const flags = [...new Set([...ai.flags, ...deterministic.flags])];
  const severity = SEVERITY_RANK[ai.severity] >= SEVERITY_RANK[deterministic.severity] ? ai.severity : deterministic.severity;
  const missedByAi = deterministic.flags.filter((flag) => !ai.flags.includes(flag));
  const rationale = missedByAi.length
    ? `${ai.rationale} (Full-text check also flagged: ${missedByAi.join(", ")}.)`.slice(0, 480)
    : ai.rationale;
  return {
    item_id: ai.item_id,
    flags,
    severity: flags.length === 0 ? "none" : severity,
    rationale,
    suggested_action: flags.length > 0 ? "review" : "approve",
  };
}

function buildResult(
  items: ItemModeration[],
  source: ModerationResult["source"],
  model: string | null,
  fallback_reason: ModerationFallbackReason | null
): ModerationResult {
  return {
    source,
    model,
    fallback_reason,
    item_count: items.length,
    flagged_count: items.filter((i) => i.flags.length > 0).length,
    items,
    caveat: MODERATION_CAVEAT,
  };
}

/** Classify each item. Falls back to deterministic heuristics with no API key or
 * on any model/parse error; never throws for AI reasons. */
export async function moderateEngagementItems(items: ModerationInputItem[]): Promise<ModerationResult> {
  const capped = items.slice(0, MODERATION_MAX_ITEMS);

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return buildResult(capped.map(deterministicItemModeration), "deterministic-fallback", null, "missing_api_key");
  }
  if (capped.length === 0) {
    return buildResult([], "deterministic-fallback", null, null);
  }

  const lines = capped.map((item) => {
    const body = (item.body ?? "").trim().slice(0, BODY_PROMPT_CAP);
    return `- id=${item.id} :: ${item.title ? `[${item.title}] ` : ""}${body || "(no text)"}`;
  });

  try {
    const { text } = await generateText({
      model: anthropic(MODERATION_MODEL_ID),
      temperature: 0.1,
      maxOutputTokens: 1800,
      system:
        "You are a content-moderation assistant for a public agency's community engagement portal. You help a human moderator by flagging comments that may need review. You are conservative and explainable; you never make a final accept/reject decision.",
      prompt: [
        "Classify each community comment below for these concern categories:",
        "- toxicity: harassment, hate, threats, or abusive language",
        "- pii: personal information (email, phone, home address, SSN) about a person",
        "- off_topic: unrelated to a transportation / land-use / civic planning topic",
        "- spam: advertising, link farming, or bot-like repetition",
        "",
        "Return ONLY a JSON object of this exact shape:",
        '{ "items": [ { "item_id": string, "flags": ["toxicity"|"pii"|"off_topic"|"spam", ...], "severity": "none"|"low"|"medium"|"high", "rationale": string } ] }',
        "",
        "Rules:",
        "- Include EVERY comment's id. An empty `flags` array means no concern.",
        "- `rationale` is one short sentence explaining the flags (or why it is clean). Do NOT quote PII back verbatim.",
        "- Be conservative: only flag clear concerns. You never reject — a human decides.",
        "",
        "COMMENTS:",
        ...lines,
      ].join("\n"),
    });

    const cleaned = text.trim();
    if (!cleaned) return buildResult(capped.map(deterministicItemModeration), "deterministic-fallback", null, "empty_output");

    const payload = parseModelJson(cleaned) as { items?: unknown } | null;
    if (!payload || !Array.isArray(payload.items)) {
      return buildResult(capped.map(deterministicItemModeration), "deterministic-fallback", null, "invalid_output");
    }

    const byId = new Map<string, unknown>();
    for (const entry of payload.items) {
      if (entry && typeof entry === "object" && "item_id" in entry) {
        byId.set(String((entry as { item_id: unknown }).item_id), entry);
      }
    }
    const results = capped.map((item) => {
      const deterministic = deterministicItemModeration(item); // full-body PII/spam floor
      const aiItem = coerceAiItem(byId.get(item.id), item);
      return aiItem ? mergeModeration(aiItem, deterministic) : deterministic;
    });
    return buildResult(results, "ai", MODERATION_MODEL_ID, null);
  } catch {
    return buildResult(capped.map(deterministicItemModeration), "deterministic-fallback", null, "generation_error");
  }
}
