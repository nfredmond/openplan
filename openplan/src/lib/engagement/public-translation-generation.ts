import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { prepareWorkspaceTranslationSelection } from "@/lib/integrations/workspace-keys";
import { TranslationCredentialError } from "@/lib/integrations/translation-credentials";
import { TRANSLATION_LANGUAGES, supportsMachineTranslation } from "./translation-languages";
import { translationGenerationPacketCanonical } from "./translation-generation";

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({ shareToken: z.string().min(8).max(64), itemId: id }).strict();
const sourceSchema = z.object({ workspaceId: id, campaignId: id, itemId: id, title: z.string().nullable(), body: z.string() }).strict();
export const publicTranslationIntentSchema = z.object({
  language: z.enum(TRANSLATION_LANGUAGES).refine(supportsMachineTranslation),
  sourceHash: hash,
  retryOf: id.optional(),
}).strict();
export type PublicTranslationIntent = z.infer<typeof publicTranslationIntentSchema>;
export type PublicTranslationScope = z.infer<typeof scopeSchema>;
const retryable = new Set(["failed", "interrupted", "incomplete", "cancelled"]);
export const publicTranslationViewSchema = z.object({
  requestId: id, language: z.enum(TRANSLATION_LANGUAGES).refine(supportsMachineTranslation),
  state: z.enum(["queued", "reserved", "running", "completed", "incomplete", "failed", "interrupted", "cancelled"]),
  translated: z.string().nullable(),
}).strict().refine(value => value.state === "completed"
  ? value.translated !== null && value.translated.trim().length > 0 && value.translated.isWellFormed() && !value.translated.includes("\0") && [...value.translated].length <= 8000
  : value.translated === null);
export type PublicTranslationView = z.infer<typeof publicTranslationViewSchema>;
type Source = z.infer<typeof sourceSchema>;
type Service = ReturnType<typeof createServiceRoleClient>;
type Failure = "invalid" | "forbidden" | "conflict" | "unavailable" | "credential_unavailable" | "rate_limited";
export class PublicTranslationQueueError extends Error {
  constructor(public readonly kind: Failure, public readonly status: number) { super(kind); }
}
function unavailable(): never { throw new PublicTranslationQueueError("unavailable", 503); }
function checkError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new PublicTranslationQueueError("forbidden", 404);
  if (["PT409", "23505"].includes(error.code ?? "")) throw new PublicTranslationQueueError("conflict", 409);
  if (error.code === "PT429") throw new PublicTranslationQueueError("rate_limited", 429);
  if (["22023", "22P02"].includes(error.code ?? "")) throw new PublicTranslationQueueError("invalid", 400);
  unavailable();
}

// Hash the exact original displayed by the public reader, including a null or
// empty title. It is separate from the database's private deduplication hash.
export function publicTranslationSourceHash(source: { title: string | null; body: string }) {
  return createHash("sha256").update(JSON.stringify([source.title, source.body])).digest("hex");
}
function parseInput(rawScope: PublicTranslationScope, raw: PublicTranslationIntent) {
  const scope = scopeSchema.safeParse(rawScope), intent = publicTranslationIntentSchema.safeParse(raw);
  if (!scope.success || !intent.success) throw new PublicTranslationQueueError("invalid", 400);
  return { scope: scope.data, intent: intent.data };
}
function view(raw: unknown, language: PublicTranslationIntent["language"], requestId?: string): PublicTranslationView {
  const parsed = publicTranslationViewSchema.safeParse(raw);
  if (!parsed.success || parsed.data.language !== language || (requestId !== undefined && parsed.data.requestId !== requestId)) unavailable();
  return parsed.data;
}
function operationSignal(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
}
async function source(service: Service, scope: PublicTranslationScope, intent: PublicTranslationIntent, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await service.rpc("read_public_translation_source", { p_share_token: scope.shareToken, p_item: scope.itemId }).abortSignal(signal);
  signal.throwIfAborted(); checkError(result.error);
  const parsed = sourceSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.itemId !== scope.itemId) unavailable();
  if (publicTranslationSourceHash(parsed.data) !== intent.sourceHash) throw new PublicTranslationQueueError("conflict", 409);
  return parsed.data;
}
async function read(service: Service, scope: PublicTranslationScope, intent: PublicTranslationIntent, requestId: string, snapshot: Source, signal: AbortSignal) {
  const result = await service.rpc("read_public_translation_request", { p_request: requestId, p_share_token: scope.shareToken, p_item: scope.itemId, p_snapshot: snapshot }).abortSignal(signal);
  signal.throwIfAborted(); checkError(result.error);
  return view(result.data, intent.language, requestId);
}
async function find(service: Service, scope: PublicTranslationScope, intent: PublicTranslationIntent, snapshot: Source, signal: AbortSignal) {
  const result = await service.rpc("find_public_translation_request", { p_share_token: scope.shareToken, p_item: scope.itemId,
    p_locale: intent.language, p_previous: intent.retryOf ?? null, p_snapshot: snapshot }).abortSignal(signal);
  signal.throwIfAborted(); checkError(result.error);
  return result.data === null ? null : view(result.data, intent.language);
}

// Both discovery and exact receipt recovery recheck the current public original.
// They do not prepare credentials, create jobs or ask a provider to repeat work.
export async function readPublicTranslationGeneration(service: Service, rawScope: PublicTranslationScope,
  raw: PublicTranslationIntent, requestId?: string, parentSignal?: AbortSignal) {
  const { scope, intent } = parseInput(rawScope, raw);
  if (requestId !== undefined && !id.safeParse(requestId).success) throw new PublicTranslationQueueError("invalid", 400);
  const signal = operationSignal(parentSignal);
  const snapshot = await source(service, scope, intent, signal);
  return requestId === undefined ? find(service, scope, intent, snapshot, signal) : read(service, scope, intent, requestId, snapshot, signal);
}

// New intent is distinct from recovery: only an explicit named terminal retry
// can create a successor. SQL repeats these checks under its source/budget locks.
export async function queuePublicTranslationGeneration(service: Service, rawScope: PublicTranslationScope,
  raw: PublicTranslationIntent, parentSignal?: AbortSignal): Promise<PublicTranslationView & { created: boolean }> {
  const { scope, intent } = parseInput(rawScope, raw);
  const signal = operationSignal(parentSignal);
  const snapshot = await source(service, scope, intent, signal);
  const existing = await find(service, scope, intent, snapshot, signal);
  if (existing !== null) return { ...existing, created: false };
  if (intent.retryOf !== undefined) {
    const previous = await read(service, scope, intent, intent.retryOf, snapshot, signal);
    if (!retryable.has(previous.state)) throw new PublicTranslationQueueError("conflict", 409);
  }
  const requestId = randomUUID(), fieldId = randomUUID();
  let packetCanonical: string;
  try {
    packetCanonical = translationGenerationPacketCanonical({ schemaVersion: 1, workspaceId: snapshot.workspaceId,
      campaignId: snapshot.campaignId, fieldId, sourceText: snapshot.title ? `${snapshot.title}\n\n${snapshot.body}` : snapshot.body,
      targetLanguage: intent.language });
  } catch { throw new PublicTranslationQueueError("invalid", 400); }
  let selection: Awaited<ReturnType<typeof prepareWorkspaceTranslationSelection>>;
  try {
    selection = await prepareWorkspaceTranslationSelection({ workspaceId: snapshot.workspaceId, requestId, credentialId: randomUUID(),
      modelId: process.env.OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL?.trim() || "claude-haiku-4-5-20251001", client: service, signal });
  } catch (error) {
    if (error instanceof TranslationCredentialError) throw new PublicTranslationQueueError("credential_unavailable", 503);
    throw error;
  }
  signal.throwIfAborted();
  const args = { p_request: requestId, p_field: fieldId, p_share_token: scope.shareToken, p_item: scope.itemId, p_locale: intent.language,
    p_snapshot: snapshot, p_packet_canonical: packetCanonical, p_credential: selection.credential, p_selected_hash: selection.selectedKeyCiphertextHash };
  const result = await (intent.retryOf === undefined ? service.rpc("create_public_translation_request", args)
    : service.rpc("retry_public_translation_request", { ...args, p_previous: intent.retryOf })).abortSignal(signal);
  signal.throwIfAborted(); checkError(result.error);
  const ack = z.object({ requestId: id, created: z.boolean() }).strict().safeParse(result.data);
  if (!ack.success || (ack.data.created && ack.data.requestId !== requestId)) unavailable();
  const current = await read(service, scope, intent, ack.data.requestId, snapshot, signal);
  return { ...current, created: ack.data.created };
}
