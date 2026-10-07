import { z } from "zod";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
// PostgreSQL timestamps retain six fractional digits; Date alone would lose cursor ordering.
const date = z.iso.datetime({ offset: true }).refine(value => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6);
export const synthesisRequestHistoryCursorSchema = z.object({ createdAt: date, id }).strict();
const scopeSchema = z.object({ campaignId: id, workspaceId: id, sourceId: id, sourceSha256: hash }).strict();
const entrySchema = z.object({ requestId: id, actorId: id, intentSha256: hash, createdAt: date,
  stage: z.enum(["segment", "context", "thematic"]), parentRequestId: id.nullable(), cancelled: z.boolean(),
}).strict();
const pageSchema = scopeSchema.extend({ schemaVersion: z.literal(1), pageSize: z.literal(25),
  entries: z.array(entrySchema).max(25), nextCursor: synthesisRequestHistoryCursorSchema.nullable(),
}).strict();
export const synthesisRequestHistoryPageSchema = pageSchema;
export type SynthesisRequestHistoryScope = z.infer<typeof scopeSchema>;
export type SynthesisRequestHistoryCursor = z.infer<typeof synthesisRequestHistoryCursorSchema>;
export type SynthesisRequestHistoryPage = z.infer<typeof pageSchema>;
const micros = (date: string) => BigInt(Date.parse(date)) * BigInt(1000) + BigInt((date.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3));
const older = (a: SynthesisRequestHistoryCursor, b: SynthesisRequestHistoryCursor) => {
  const at = micros(a.createdAt), bt = micros(b.createdAt);
  return at < bt || (at === bt && a.id < b.id);
};

/** Verify source identity, stages and keyset continuity before displaying a native page.
 * A listing cannot prove execution, preparation completeness or semantic quality.
 */
export function verifySynthesisRequestHistory(raw: unknown, rawScope: SynthesisRequestHistoryScope,
  rawBefore: SynthesisRequestHistoryCursor | null = null) {
  const scope = scopeSchema.parse(rawScope), page = pageSchema.parse(raw);
  const before = rawBefore === null ? null : synthesisRequestHistoryCursorSchema.parse(rawBefore);
  if (Object.keys(scope).some(key => page[key as keyof SynthesisRequestHistoryScope] !== scope[key as keyof SynthesisRequestHistoryScope])) {
    throw new Error("Generation history source differs");
  }
  const seen = new Set<string>();
  let previous = before;
  for (const entry of page.entries) {
    const current = { createdAt: entry.createdAt, id: entry.requestId };
    if (seen.has(entry.requestId) || (previous && !older(current, previous))) throw new Error("Generation history order differs");
    if ((entry.stage === "segment") !== (entry.parentRequestId === null) || entry.parentRequestId === entry.requestId) {
      throw new Error("Generation history stage differs");
    }
    seen.add(entry.requestId); previous = current;
  }
  if (page.nextCursor && (page.entries.length !== 25 || page.nextCursor.id !== previous?.id || page.nextCursor.createdAt !== previous.createdAt)) {
    throw new Error("Generation history cursor differs");
  }
  return page;
}
