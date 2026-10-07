import { z } from "zod";
import { synthesisExecutionScopeSchema } from "./synthesis-execution-records";

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(4096).refine(value => new TextEncoder().encode(value).byteLength <= 4096,
  "Execution queue command exceeds its byte limit");

export const synthesisExecutionQueueCommandSchema = synthesisExecutionScopeSchema.extend({
  schemaVersion: z.literal(1), queueId: id, authorizationId: id, authorizationIntentSha256: hash,
}).strict();
export type SynthesisExecutionQueueCommand = z.infer<typeof synthesisExecutionQueueCommandSchema>;

export const synthesisExecutionQueueReceiptSchema = z.object({ schemaVersion: z.literal(1), queueId: id,
  commandText: text, commandSha256: hash, createdAt: z.iso.datetime({ offset: true }),
}).strict();

/** Read the original enqueue bytes without normalizing them. Native enqueue
 * must independently check current authority and unique JSON keys. This parser
 * does not grant permission or establish that any worker has started.
 */
export function parseSynthesisExecutionQueueCommand(raw: unknown) {
  const commandText = text.parse(raw);
  return { commandText, command: synthesisExecutionQueueCommandSchema.parse(JSON.parse(commandText)) };
}

/** Verify an acknowledgement against the exact locally retained command.
 * A valid receipt proves only byte custody, not current permission, dispatch,
 * completed output or acceptance of a machine interpretation.
 */
export async function verifySynthesisExecutionQueueReceipt(raw: unknown, originalText: string) {
  const { commandText, command } = parseSynthesisExecutionQueueCommand(originalText);
  const receipt = synthesisExecutionQueueReceiptSchema.parse(raw);
  if (receipt.queueId !== command.queueId || receipt.commandText !== commandText) {
    throw new Error("Execution queue receipt differs from the original command");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(receipt.commandText));
  const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== receipt.commandSha256) throw new Error("Execution queue receipt checksum differs");
  return { receipt, command };
}

const lookupSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  requestId: id, authorizationId: id, receipt: synthesisExecutionQueueReceiptSchema.nullable() }).strict();
export type SynthesisQueueLookupScope = { campaignId: string; workspaceId: string; requestId: string; authorizationId: string; actorId: string };

/** A null receipt means a valid permission has no queue entry. Malformed or
 * foreign evidence throws and must never become an empty scheduling history.
 */
export async function verifySynthesisQueueLookup(raw: unknown, scope: SynthesisQueueLookupScope) {
  const value = lookupSchema.parse(raw);
  const fields = ["campaignId", "workspaceId", "requestId", "authorizationId"] as const;
  if (fields.some(field => value[field] !== scope[field])) throw new Error("Queue lookup scope differs");
  if (value.receipt !== null) {
    const { command } = await verifySynthesisExecutionQueueReceipt(value.receipt, value.receipt.commandText);
    if (fields.some(field => command[field] !== scope[field]) || command.actorId !== scope.actorId) throw new Error("Queue lookup command differs");
  }
  return value;
}
