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

const receiptSchema = z.object({ schemaVersion: z.literal(1), queueId: id,
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
  const receipt = receiptSchema.parse(raw);
  if (receipt.queueId !== command.queueId || receipt.commandText !== commandText) {
    throw new Error("Execution queue receipt differs from the original command");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(receipt.commandText));
  const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== receipt.commandSha256) throw new Error("Execution queue receipt checksum differs");
  return { receipt, command };
}
