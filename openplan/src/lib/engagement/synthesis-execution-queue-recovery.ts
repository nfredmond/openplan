import type { ReviewStorage } from "./synthesis-review-recovery";
import { type SynthesisExecutionScope } from "./synthesis-execution-records";
import { parseSynthesisExecutionQueueCommand, synthesisExecutionQueueCommandSchema,
  verifySynthesisExecutionQueueReceipt } from "./synthesis-execution-queue-records";

type Scope = SynthesisExecutionScope & { authorizationId: string; authorizationIntentSha256: string };
function checkedScope(scope: Scope) {
  return synthesisExecutionQueueCommandSchema.omit({ schemaVersion: true, queueId: true }).parse(scope);
}
function key(raw: Scope) {
  const scope = checkedScope(raw);
  return `openplan:synthesis-queue:${scope.actorId}:${scope.workspaceId}:${scope.campaignId}:${scope.requestId}:${scope.stage}:${scope.authorizationId}`;
}
function checked(raw: string, scope: Scope) {
  const { command, commandText } = parseSynthesisExecutionQueueCommand(raw), expected = checkedScope(scope);
  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    if (command[field] !== expected[field]) throw new Error("Execution queue recovery belongs to another scope");
  }
  return { command, commandText };
}

/** One immutable browser command per allowance. Reading or acknowledging it
 * never clears the slot or generates a new queue identity after a lost reply.
 */
export function readPendingSynthesisQueue(storage: ReviewStorage, scope: Scope) {
  const raw = storage.getItem(key(scope));
  return raw === null ? null : checked(raw, scope);
}
export function retainPendingSynthesisQueue(storage: ReviewStorage, scope: Scope, commandText: string) {
  const value = checked(commandText, scope), name = key(scope), old = storage.getItem(name);
  if (old !== null && old !== commandText) throw new Error("Another original queue command is retained for this allowance");
  storage.setItem(name, commandText);
  if (storage.getItem(name) !== commandText) throw new Error("Execution queue command could not be retained");
  return value;
}

/** Retry exact bytes after uncertainty, even after permission expiry. The native
 * command distinguishes historical receipt recovery from fresh scheduling.
 */
export async function sendPendingSynthesisQueue(storage: ReviewStorage, scope: Scope, commandText: string,
  transport: typeof fetch = fetch, signal?: AbortSignal) {
  const value = checked(commandText, scope);
  if (readPendingSynthesisQueue(storage, scope)?.commandText !== commandText) throw new Error("Original queue command is not retained");
  retainPendingSynthesisQueue(storage, scope, value.commandText);
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  bounded.throwIfAborted();
  const { campaignId, actorId, workspaceId } = checkedScope(scope);
  const response = await transport(`/api/engagement/campaigns/${campaignId}/synthesis/execution/queue`, {
    method: "POST", cache: "no-store", signal: bounded, body: commandText,
    headers: { "Content-Type": "application/json", "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId },
  });
  bounded.throwIfAborted();
  if (!response.ok) throw new SynthesisQueueSaveError(response.status);
  const verified = await verifySynthesisExecutionQueueReceipt(await response.json(), commandText);
  bounded.throwIfAborted();
  if (readPendingSynthesisQueue(storage, scope)?.commandText !== commandText) throw new Error("Execution queue recovery changed during acknowledgement");
  return verified;
}
export class SynthesisQueueSaveError extends Error {
  constructor(public readonly status: number) {
    super("Execution scheduling is unconfirmed. Keep the original queue command and retry it to recover the receipt.");
  }
}
