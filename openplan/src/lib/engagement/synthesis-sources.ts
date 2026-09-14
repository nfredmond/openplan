import { z } from "zod";

const uuid = z.string().uuid();
const date = z.string().datetime({ offset: true });
export const synthesisSourceSelectionSchema = z.object({
  statuses: z.array(z.enum(["pending", "approved", "rejected", "flagged"])).min(1).max(4),
  includeItems: z.boolean(),
  includeSurveys: z.boolean(),
  categoryIds: z.array(uuid),
  from: date.nullable(),
  to: date.nullable(),
}).strict().superRefine((selection, context) => {
  if (!selection.includeItems && !selection.includeSurveys) context.addIssue({ code: "custom", message: "Select comments or survey responses." });
  if (new Set(selection.statuses).size !== selection.statuses.length || new Set(selection.categoryIds.map(id => id.toLowerCase())).size !== selection.categoryIds.length) {
    context.addIssue({ code: "custom", message: "Selection values must be unique." });
  }
  if (selection.from && selection.to && Date.parse(selection.to) <= Date.parse(selection.from)) context.addIssue({ code: "custom", message: "End must follow start." });
});
export type SynthesisSourceSelection = z.infer<typeof synthesisSourceSelectionSchema>;
export const synthesisSourceIntentSchema = z.object({ requestId: uuid, selection: synthesisSourceSelectionSchema }).strict();
export type SynthesisSourceIntent = z.infer<typeof synthesisSourceIntentSchema>;

export const synthesisSourceCountsSchema = z.object({
  items: z.number().int().nonnegative(), sessions: z.number().int().nonnegative(), answers: z.number().int().nonnegative(),
  campaignItems: z.number().int().nonnegative(), campaignSessions: z.number().int().nonnegative(), campaignAnswers: z.number().int().nonnegative(),
}).strict();
export const synthesisSourceReceiptSchema = z.object({
  requestId: uuid, campaignId: uuid, workspaceId: uuid, snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: date, counts: synthesisSourceCountsSchema, replayed: z.boolean(),
}).strict();

const status = z.enum(["pending", "approved", "rejected", "flagged"]);
const item = z.object({
  id: uuid, campaign_id: uuid, body: z.string(), title: z.string().nullable(), category_id: uuid.nullable(),
  configuration_version_id: uuid.nullable(), status, created_at: date, updated_at: date,
  parent_item_id: uuid.nullable(),
}).passthrough();
const session = z.object({
  id: uuid, campaign_id: uuid, configuration_version_id: uuid.nullable(), status, created_at: date, updated_at: date,
}).passthrough();
const answer = z.object({
  id: uuid, campaign_id: uuid, session_id: uuid, question_id: uuid.nullable(), question_type: z.string(),
  question_prompt_snapshot: z.string().nullable(), answer_text: z.string().nullable(), answer_json: z.record(z.string(), z.unknown()),
}).passthrough();
export const synthesisSourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal("internal"), capturedAt: date,
  requestId: uuid, campaignId: uuid, workspaceId: uuid, selection: synthesisSourceSelectionSchema,
  campaign: z.object({ id: uuid, title: z.string(), summary: z.string().nullable(), projectId: uuid.nullable(), configurationVersionId: uuid.nullable() }).strict(),
  counts: synthesisSourceCountsSchema,
  items: z.array(item), sessions: z.array(session), answers: z.array(answer),
  definitions: z.array(z.object({ id: uuid, campaignId: uuid, sha256: z.string().regex(/^[a-f0-9]{64}$/), definitionText: z.string() }).strict()),
}).strict();
export type SynthesisSourceSnapshot = z.infer<typeof synthesisSourceSnapshotSchema>;
