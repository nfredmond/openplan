import { z } from "zod";
import { synthesisReviewIntentSchema } from "./synthesis-review";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const positive = z.number().int().positive();
const scope = { reviewId: uuid, campaignId: uuid, workspaceId: uuid, sourceId: uuid, sourceSha256: digest };
export const synthesisReviewReceiptSchema = z.object({
  ...scope, requestId: uuid, preparationSha256: digest, revisionNo: positive,
  revisionSha256: digest, createdAt: date, replayed: z.boolean(),
}).strict();
export type SynthesisReviewReceipt = z.infer<typeof synthesisReviewReceiptSchema>;
export const synthesisReviewRecordSchema = z.object({
  ...scope, preparationText: z.string(), preparationSha256: digest,
  createdAt: date, createdBy: uuid, currentRevisionId: uuid,
  revision: z.object({
    requestId: uuid, revisionNo: positive, parentId: uuid.nullable(), parentSha256: digest.nullable(),
    actorId: uuid, reason: z.string().nullable(), intent: synthesisReviewIntentSchema,
    contentText: z.string(), contentSha256: digest, createdAt: date,
  }).strict(),
}).strict();
export type SynthesisReviewRecord = z.infer<typeof synthesisReviewRecordSchema>;

const cursor = z.object({ createdAt: date, id: uuid }).strict();
export const synthesisReviewListSchema = z.object({
  campaignId: uuid, workspaceId: uuid, sourceId: uuid, pageSize: z.literal(25),
  entries: z.array(z.object({ reviewId: uuid, createdAt: date, revisionNo: positive, revisionSha256: digest, title: z.string() }).strict()).max(25),
  nextCursor: cursor.nullable(),
}).strict().superRefine((page, ctx) => {
  const last = page.entries.at(-1);
  if (new Set(page.entries.map(row => row.reviewId)).size !== page.entries.length
    || (page.nextCursor && (page.entries.length !== 25 || page.nextCursor.id !== last?.reviewId || page.nextCursor.createdAt !== last?.createdAt))) {
    ctx.addIssue({ code: "custom", message: "Saved review history identifiers or continuation differ" });
  }
});
export const synthesisReviewRevisionListSchema = z.object({
  campaignId: uuid, workspaceId: uuid, reviewId: uuid, pageSize: z.literal(25),
  entries: z.array(z.object({ requestId: uuid, revisionNo: positive, parentId: uuid.nullable(), parentSha256: digest.nullable(),
    revisionSha256: digest, actorId: uuid, reason: z.string().nullable(), createdAt: date }).strict()).max(25),
  nextCursor: positive.nullable(),
}).strict().superRefine((page, ctx) => {
  if (new Set(page.entries.map(row => row.requestId)).size !== page.entries.length
    || new Set(page.entries.map(row => row.revisionNo)).size !== page.entries.length
    || (page.nextCursor !== null && (page.entries.length !== 25 || page.nextCursor !== page.entries.at(-1)?.revisionNo))) {
    ctx.addIssue({ code: "custom", message: "Saved revision history identifiers or continuation differ" });
  }
});
