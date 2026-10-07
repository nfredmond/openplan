import { z } from "zod";
import { inspectSynthesisThematicChoiceReceipt, synthesisThematicChoiceCommandSchema,
  type SynthesisThematicChoiceCommand } from "./synthesis-thematic-choice-command";
import { ReviewSaveError, type ReviewStorage } from "./synthesis-review-recovery";

const id = z.string().uuid();
const scopeSchema = z.object({ userId: id, workspaceId: id, campaignId: id, requestId: id,
  targetRecordId: z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/) }).strict();
const pendingSchema = scopeSchema.extend({ version: z.literal(1), commandText: z.string().max(8192) }).strict();
export type ThematicChoiceScope = z.infer<typeof scopeSchema>;
export type PendingThematicChoice = z.infer<typeof pendingSchema>;
const scopeOf = ({ userId, workspaceId, campaignId, requestId, targetRecordId }: ThematicChoiceScope): ThematicChoiceScope =>
  ({ userId, workspaceId, campaignId, requestId, targetRecordId });
const key = (scope: ThematicChoiceScope) => `openplan:synthesis-thematic-choice:${scope.userId}:${scope.workspaceId}:${scope.campaignId}:${scope.requestId}:${scope.targetRecordId}`;
const sameScope = (a: ThematicChoiceScope, b: ThematicChoiceScope) => (Object.keys(scopeSchema.shape) as Array<keyof ThematicChoiceScope>).every(field => a[field] === b[field]);

/** Recover exact submitted bytes without selecting a newer context or sending it. */
export function parsePendingThematicChoice(raw: unknown, rawScope: ThematicChoiceScope) {
  const scope = scopeSchema.parse(rawScope), pending = pendingSchema.parse(raw);
  const command = synthesisThematicChoiceCommandSchema.parse(JSON.parse(pending.commandText));
  if (!sameScope(pending, scope) || command.requestId !== scope.requestId || command.targetRecordId !== scope.targetRecordId ||
    new TextEncoder().encode(pending.commandText).byteLength > 8192) throw new Error("Choice recovery belongs to another request, contribution or account");
  return { pending, command };
}

export function readPendingThematicChoice(storage: ReviewStorage, scope: ThematicChoiceScope) {
  const raw = storage.getItem(key(scopeSchema.parse(scope)));
  return raw === null ? null : parsePendingThematicChoice(JSON.parse(raw), scope).pending;
}

/** Store and read back the inspected command before any transport. A different
 * uncertain choice cannot replace it; staff must confirm or preserve the original.
 */
export function freezeThematicChoice(storage: ReviewStorage, rawScope: ThematicChoiceScope, rawCommand: SynthesisThematicChoiceCommand) {
  const scope = scopeSchema.parse(rawScope), command = synthesisThematicChoiceCommandSchema.parse(rawCommand);
  const { pending } = parsePendingThematicChoice({ version: 1, ...scope, commandText: JSON.stringify(command) }, scope);
  const previous = readPendingThematicChoice(storage, scope);
  if (previous && previous.commandText !== pending.commandText) throw new Error("Keep the original unconfirmed context choice until it is confirmed or preserved");
  return retain(storage, previous ?? pending);
}

function retain(storage: ReviewStorage, rawPending: PendingThematicChoice) {
  const { pending } = parsePendingThematicChoice(rawPending, scopeOf(rawPending));
  const current = readPendingThematicChoice(storage, scopeOf(pending));
  if (current && current.commandText !== pending.commandText) throw new Error("Choice recovery changed in another tab. Reopen its saved copy");
  const raw = JSON.stringify(pending), name = key(pending);
  storage.setItem(name, raw);
  if (storage.getItem(name) !== raw) throw new Error("The context choice could not be retained in this browser");
  return pending;
}

/** Explicit retry sends only retained bytes. A verified reply clears only the
 * unchanged copy. Newer browser edits and unreadable originals remain retained.
 */
export async function sendThematicChoice(storage: ReviewStorage, working: PendingThematicChoice,
  options: { transport?: typeof fetch; signal?: AbortSignal; isCurrent?: () => boolean } = {}) {
  const current = () => !options.signal?.aborted && (options.isCurrent?.() ?? true);
  if (!current()) throw new Error("The selected account or context changed");
  const existing = readPendingThematicChoice(storage, scopeOf(working));
  if (!existing || existing.commandText !== working.commandText) throw new Error("Reopen the retained context choice before retrying");
  const pending = retain(storage, working), raw = JSON.stringify(pending);
  const { command } = parsePendingThematicChoice(pending, scopeOf(working));
  const response = await (options.transport ?? fetch)(`/api/engagement/campaigns/${working.campaignId}/synthesis/thematic-choices`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": working.userId,
      "x-openplan-expected-workspace": working.workspaceId }, body: pending.commandText, cache: "no-store", signal: options.signal,
  });
  if (!current()) throw new Error("The selected account or context changed");
  if (!response.ok) throw new ReviewSaveError(response.status, "The context choice is unconfirmed. Keep its original command and check current access before retrying.");
  const receipt = await inspectSynthesisThematicChoiceReceipt(await response.json(), { campaignId: working.campaignId,
    workspaceId: working.workspaceId, actorId: working.userId }, command);
  if (!current()) throw new Error("The selected account or context changed");
  let cleanupError: string | null = null;
  try {
    if (storage.getItem(key(pending)) !== raw) throw new Error("A newer copy is retained");
    storage.removeItem(key(pending));
    if (storage.getItem(key(pending)) !== null) throw new Error("Cleanup could not be confirmed");
  } catch { cleanupError = "Choice saved. Its browser copy could not be cleared; preserve or retry the original command. Newer edits remain retained."; }
  return { receipt, cleanupError };
}

/** Archive original raw bytes, even if unreadable, before releasing a slot. An
 * archive remains a recovery copy, not a fresh request or execution permission.
 */
export function preservePendingThematicChoice(storage: ReviewStorage, rawScope: ThematicChoiceScope) {
  const scope = scopeSchema.parse(rawScope), name = key(scope), raw = storage.getItem(name);
  if (raw === null) return null;
  const archive = `${name}:preserved:${crypto.randomUUID()}`;
  storage.setItem(archive, raw);
  if (storage.getItem(archive) !== raw || storage.getItem(name) !== raw) throw new Error("Choice recovery changed or could not be preserved");
  storage.removeItem(name);
  if (storage.getItem(name) !== null) throw new Error("Preserved choice recovery could not be moved aside");
  return { key: archive, raw };
}

export function listPreservedThematicChoices(storage: ReviewStorage, rawScope: ThematicChoiceScope) {
  const scope = scopeSchema.parse(rawScope), prefix = `${key(scope)}:preserved:`;
  const copies: Array<{ key: string; raw: string }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
    const raw = storage.getItem(name); if (raw !== null) copies.push({ key: name, raw });
  }
  return copies;
}
