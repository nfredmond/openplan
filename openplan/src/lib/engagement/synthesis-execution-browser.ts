import { parseSynthesisExecutionReceipt, synthesisExecutionHistorySchema, synthesisExecutionPreviewSchema,
  type SynthesisExecutionScope } from "./synthesis-execution-records";

const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
const fields = ["campaignId", "workspaceId", "requestId", "actorId", "sourceId", "sourceSha256", "requestIntentSha256"] as const;

/** Verify returned scope before showing private execution metadata. This does
 * not independently validate a model or promise a worker will start.
 */
export function verifySynthesisExecutionPreview(raw: unknown, scope: SynthesisExecutionScope) {
  const preview = synthesisExecutionPreviewSchema.parse(raw);
  if (fields.some(field => preview[field] !== scope[field]) || preview.stage !== scope.stage) throw new Error("Prepared execution scope differs");
  return preview;
}

export async function verifySynthesisExecutionHistory(raw: unknown, scope: SynthesisExecutionScope) {
  const page = synthesisExecutionHistorySchema.parse(raw);
  if (fields.some(field => page[field] !== scope[field])) throw new Error("Saved execution permissions belong to another source or request");
  const seen = new Set<string>();
  for (const entry of page.entries) {
    parseSynthesisExecutionReceipt({ schemaVersion: entry.schemaVersion, id: entry.id, requestId: entry.requestId,
      intentText: entry.intentText, intentSha256: entry.intentSha256 }, { authorizationId: entry.id, intentText: entry.intentText }, scope.requestId);
    if (seen.has(entry.id) || await digest(entry.intentText) !== entry.intentSha256) throw new Error("Saved execution permission differs");
    seen.add(entry.id);
  }
  const last = page.entries.at(-1);
  if (page.nextCursor && (!last || page.nextCursor.id !== last.id || page.nextCursor.createdAt !== last.createdAt)) throw new Error("Saved execution permission cursor differs");
  return page;
}
