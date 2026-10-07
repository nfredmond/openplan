import { z } from "zod";
import { synthesisGenerationRequestIntentSchema } from "./synthesis-generation-request-records";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const synthesisContinuationParentSchema = z.object({ parentRequestId: id, parentActorId: id,
  parentIntentSha256: hash, sourceId: id, sourceSha256: hash, throughSequence: natural,
  segmentResultsManifestSha256: hash }).strict();
const common = { requestId: id, parent: synthesisContinuationParentSchema,
  frameByteLimit: z.number().int().min(4096).max(1_048_576),
  intentText: z.string().max(4096).refine(text => new TextEncoder().encode(text).byteLength <= 4096),
};
export const synthesisContinuationCommandSchema = z.discriminatedUnion("stage", [
  z.object({ ...common, stage: z.literal("context"), targetRecordId: target }).strict(),
  z.object({ ...common, stage: z.literal("thematic") }).strict(),
]).superRefine((value, ctx) => {
  let raw: unknown;
  try { raw = JSON.parse(value.intentText); } catch { ctx.addIssue({ code: "custom", message: "Unreadable analysis intent" }); return; }
  const intent = synthesisGenerationRequestIntentSchema.safeParse(raw);
  if (!intent.success || intent.data.sourceId !== value.parent.sourceId || intent.data.sourceSha256 !== value.parent.sourceSha256 ||
    value.requestId === value.parent.parentRequestId) ctx.addIssue({ code: "custom", message: "Analysis continuation identity differs" });
});
export type SynthesisContinuationCommand = z.infer<typeof synthesisContinuationCommandSchema>;
export type SynthesisContinuationParent = z.infer<typeof synthesisContinuationParentSchema>;
export const synthesisContinuationProposalSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("context"), parent: synthesisContinuationParentSchema,
    frameByteLimit: common.frameByteLimit, targetRecordId: target }).strict(),
  z.object({ stage: z.literal("thematic"), parent: synthesisContinuationParentSchema, frameByteLimit: common.frameByteLimit }).strict(),
]);
export type SynthesisContinuationProposal = z.infer<typeof synthesisContinuationProposalSchema>;
export const synthesisContinuationPageSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  parent: synthesisContinuationParentSchema, cancelled: z.boolean(), interpretation: z.literal("not_assessed"),
  offset: natural, pageSize: z.literal(25), total: natural.positive(), nextOffset: natural.nullable(),
  entries: z.array(z.object({ recordId: target, kind: z.enum(["item", "answer"]),
    label: z.string().min(1).max(160), excerpt: z.string().max(280), excerptTruncated: z.boolean(),
  }).strict()).max(25),
}).strict().superRefine((page, ctx) => {
  const end = page.offset + page.entries.length;
  if (page.offset > page.total || page.entries.length !== Math.min(25, page.total - page.offset) ||
    page.nextOffset !== (end < page.total ? end : null) || new Set(page.entries.map(row => row.recordId)).size !== page.entries.length ||
    page.entries.some(row => !row.recordId.startsWith(`${row.kind}:`))) {
    ctx.addIssue({ code: "custom", message: "Contribution page accounting differs" });
  }
});
