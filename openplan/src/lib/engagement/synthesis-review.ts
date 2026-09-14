import { z } from "zod";
import { prepareSynthesisSource } from "./synthesis-preparation";
import type { SynthesisSourceSnapshot } from "./synthesis-sources";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().refine(value => value.isWellFormed() && !value.includes("\0"), "Use valid text without NUL characters.");
const label = text.refine(value => value.trim().length > 0, "Enter a label.");
const groupId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const sourceId = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const sentiment = z.enum(["not_assessed", "positive", "mixed", "neutral", "negative"]);
const groupFields = { label, summary: text, sentiment };
export const synthesisReviewGroupSchema = z.object({ id: groupId, ...groupFields, sourceIds: z.array(sourceId) }).strict();
export const synthesisReviewContentSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal("staff_draft"),
  sourceId: uuid, sourceSha256: digest, title: label, notes: text,
  groups: z.array(synthesisReviewGroupSchema), unassignedSourceIds: z.array(sourceId),
  assignedSourceCount: z.number().int().nonnegative(), overlappingSourceCount: z.number().int().nonnegative(),
}).strict();
export type SynthesisReviewContent = z.infer<typeof synthesisReviewContentSchema>;

export const synthesisReviewChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group_update"), groupId, ...groupFields, addSourceIds: z.array(sourceId), removeSourceIds: z.array(sourceId) }).strict(),
  z.object({ kind: z.literal("group_add"), groupId, ...groupFields, sourceIds: z.array(sourceId) }).strict(),
  z.object({ kind: z.literal("group_remove"), groupId }).strict(),
  z.object({ kind: z.literal("notes"), title: label, notes: text }).strict(),
]);
export type SynthesisReviewChange = z.infer<typeof synthesisReviewChangeSchema>;
const identity = { requestId: uuid, actorId: uuid, workspaceId: uuid };
export const synthesisReviewIntentSchema = z.discriminatedUnion("operation", [
  z.object({ ...identity, operation: z.literal("create"), sourceId: uuid, sourceSha256: digest }).strict(),
  z.object({ ...identity, operation: z.literal("correct"), reviewId: uuid, expectedRevisionId: uuid,
    expectedRevisionSha256: digest, reason: label, change: synthesisReviewChangeSchema }).strict(),
]);
export type SynthesisReviewIntent = z.infer<typeof synthesisReviewIntentSchema>;

const categoryFallback = {
  retained: "Historical category", uncategorized: "Uncategorized", definition_unavailable: "Historical definition unavailable",
  question_unavailable: "Historical question unavailable", category_unavailable: "Historical category unavailable",
};

/** Every retained source stays assigned, explicitly unassigned, or explicitly overlapping. */
function coverage(groups: SynthesisReviewContent["groups"], snapshot: SynthesisSourceSnapshot) {
  const all = new Set([...snapshot.items.map(row => `item:${row.id}`), ...snapshot.answers.map(row => `answer:${row.id}`)]);
  const frequency = new Map<string, number>();
  if (new Set(groups.map(group => group.id)).size !== groups.length) throw new Error("Duplicate review group identifiers");
  for (const group of groups) {
    if (new Set(group.sourceIds).size !== group.sourceIds.length) throw new Error("Duplicate source in review group");
    for (const id of group.sourceIds) {
      if (!all.has(id)) throw new Error("Review references an unknown source");
      frequency.set(id, (frequency.get(id) ?? 0) + 1);
    }
  }
  return {
    unassignedSourceIds: [...all].filter(id => !frequency.has(id)).sort(),
    assignedSourceCount: frequency.size,
    overlappingSourceCount: [...frequency.values()].filter(count => count > 1).length,
  };
}

/** Verify a saved review's scope and complete coverage against its already verified immutable source. */
export function verifySynthesisReviewContent(raw: unknown, snapshot: SynthesisSourceSnapshot, sha256: string) {
  const content = synthesisReviewContentSchema.parse(raw);
  if (content.sourceId !== snapshot.requestId || content.sourceSha256 !== sha256) throw new Error("Review source identity differs");
  const expected = coverage(content.groups, snapshot);
  if (JSON.stringify(content.unassignedSourceIds) !== JSON.stringify(expected.unassignedSourceIds)
    || content.assignedSourceCount !== expected.assignedSourceCount || content.overlappingSourceCount !== expected.overlappingSourceCount) {
    throw new Error("Review source coverage differs");
  }
  return content;
}

/** This initial draft is derived locally; historical categories are not inferred themes. */
export function createSynthesisReviewContent(snapshot: SynthesisSourceSnapshot, sha256: string) {
  const preparation = prepareSynthesisSource(snapshot, sha256);
  const groups = preparation.categoryGroups.map((group, index) => ({
    id: `category-${index + 1}`, label: group.label?.trim() ? group.label : categoryFallback[group.context],
    summary: "", sentiment: "not_assessed" as const, sourceIds: [...group.sourceIds],
  }));
  const content = verifySynthesisReviewContent({
    schemaVersion: 1, status: "staff_draft", sourceId: snapshot.requestId, sourceSha256: sha256,
    title: snapshot.campaign.title, notes: "", groups, ...coverage(groups, snapshot),
  }, snapshot, sha256);
  return { preparation, content };
}

/** Apply a reasoned delta to a verified parent. Persistence separately fences the expected parent revision. */
export function applySynthesisReviewChange(parent: SynthesisReviewContent, raw: unknown, snapshot: SynthesisSourceSnapshot, sha256: string) {
  const content = verifySynthesisReviewContent(parent, snapshot, sha256);
  const change = synthesisReviewChangeSchema.parse(raw);
  const next = structuredClone(content);
  if (change.kind === "notes") {
    next.title = change.title; next.notes = change.notes;
  } else if (change.kind === "group_add") {
    if (next.groups.some(group => group.id === change.groupId)) throw new Error("Review group already exists");
    next.groups.push({ id: change.groupId, label: change.label, summary: change.summary, sentiment: change.sentiment, sourceIds: [...change.sourceIds].sort() });
  } else {
    const group = next.groups.find(group => group.id === change.groupId);
    if (!group) throw new Error("Review group is unavailable");
    if (change.kind === "group_remove") next.groups = next.groups.filter(row => row.id !== change.groupId);
    else {
      const add = new Set(change.addSourceIds), remove = new Set(change.removeSourceIds), current = new Set(group.sourceIds);
      if (add.size !== change.addSourceIds.length || remove.size !== change.removeSourceIds.length || [...add].some(id => remove.has(id))) throw new Error("Review membership delta repeats a source");
      if ([...add].some(id => current.has(id)) || [...remove].some(id => !current.has(id))) throw new Error("Review membership delta differs from the parent");
      group.label = change.label; group.summary = change.summary; group.sentiment = change.sentiment;
      group.sourceIds = [...group.sourceIds.filter(id => !remove.has(id)), ...add].sort();
    }
  }
  Object.assign(next, coverage(next.groups, snapshot));
  if (JSON.stringify(next) === JSON.stringify(content)) throw new Error("Review correction changes nothing");
  return verifySynthesisReviewContent(next, snapshot, sha256);
}
