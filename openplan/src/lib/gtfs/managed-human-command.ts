import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { assessFeedVersionCollapse } from "./persist";
import type { GtfsWorkerService } from "./managed-worker-service";

const id = z.string().uuid().transform(value => value.toLowerCase());
const count = z.number().int().nonnegative().max(2147483647);
const date = z.iso.datetime({ offset: true });
const basisSchema = z.object({ feedId: id, versionId: id, routeCount: count.positive(), stopCount: count.positive(), previousVersionId: id.nullable(), previousRouteCount: count.nullable(), previousStopCount: count.nullable() }).strict();
const reviewSchema = z.object({ basis: basisSchema, materialShrinkage: z.boolean(), isCurrent: z.boolean() }).strict();
const scopeSchema = z.object({ workspaceId: id, versionId: id, actorId: id }).strict();
export const gtfsHumanCommandSchema = z.discriminatedUnion("operation", [
 z.object({ operation: z.literal("cancel"), commandId: id, reason: z.string().trim().min(1).max(2000) }).strict(),
 z.object({ operation: z.literal("adopt"), commandId: id, basis: basisSchema, acceptMaterialShrinkage: z.boolean() }).strict(),
]);
const bindingSchema = z.object({ schemaVersion: z.literal(1), installationId: id, target: z.string(), scope: scopeSchema, command: gtfsHumanCommandSchema }).strict();
const recordSchema = z.object({ binding: bindingSchema, receipt: z.json().nullable() }).strict();
export type GtfsAdoptionReview = z.infer<typeof reviewSchema>;
export type GtfsHumanCommand = z.infer<typeof gtfsHumanCommandSchema>;

function requireMatch(value: boolean, message: string): asserts value { if (!value) throw new Error(message); }
function collapse(basis: z.infer<typeof basisSchema>) {
 requireMatch(basis.previousVersionId === null ? basis.previousRouteCount === null && basis.previousStopCount === null
   : basis.previousRouteCount !== null && basis.previousStopCount !== null, "GTFS review predecessor differs");
 return assessFeedVersionCollapse(basis.previousVersionId === null ? null : { routeCount: basis.previousRouteCount!, stopCount: basis.previousStopCount! }, { routeCount: basis.routeCount, stopCount: basis.stopCount }).collapsed;
}
async function rpc(service: GtfsWorkerService, name: string, args: Record<string, unknown>, signal: AbortSignal, deadlineMs: number) {
 signal.throwIfAborted();
 const ending = new AbortController(), bounded = AbortSignal.any([signal, ending.signal]);
 const timer = setTimeout(() => ending.abort(new Error("GTFS human command acknowledgement is unavailable")), deadlineMs);
 let abort = () => {};
 try {
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(bounded.reason); bounded.addEventListener("abort", abort, { once: true }); if (bounded.aborted) abort(); });
  const result = await Promise.race([service.rpc(name, structuredClone(args)).abortSignal(bounded), cancelled]); bounded.throwIfAborted();
  requireMatch(!result.error, "GTFS human command acknowledgement is unavailable"); return result.data as unknown;
 } finally { clearTimeout(timer); bounded.removeEventListener("abort", abort); ending.abort(); }
}

/** Read the completed version and its exact predecessor without adopting it. */
export async function readGtfsAdoptionReview(service: GtfsWorkerService, rawScope: z.infer<typeof scopeSchema>, signal: AbortSignal): Promise<GtfsAdoptionReview> {
 const scope = scopeSchema.parse(rawScope), raw = await rpc(service, "read_gtfs_adoption_review", { p_workspace: scope.workspaceId, p_version: scope.versionId, p_actor: scope.actorId }, signal, 10000);
 const review = reviewSchema.parse(raw);
 requireMatch(review.basis.versionId === scope.versionId && collapse(review.basis) === review.materialShrinkage, "GTFS reviewed version or shrinkage differs");
 requireMatch(!review.isCurrent || review.basis.previousVersionId === scope.versionId, "GTFS reviewed current version differs");
 return review;
}
function verifyReceipt(raw: unknown, scope: z.infer<typeof scopeSchema>, command: GtfsHumanCommand) {
 if (command.operation === "cancel") {
  const value = z.object({ command: id, version: id, state: z.literal("cancelled"), closure: z.object({ recorded: z.literal(true), feedStatusChanged: z.boolean() }).strict(), cleanupPending: z.boolean(), closedAt: date }).strict().parse(raw);
  requireMatch(value.command === command.commandId && value.version === scope.versionId, "GTFS cancellation receipt differs"); return value;
 }
 const value = z.object({ command: id, version: id, adopted: z.literal(true), alreadyCurrent: z.boolean(), basis: basisSchema, adoptedAt: date.nullable(), reviewAccepted: z.literal(true).optional(), humanAcceptShrinkage: z.boolean() }).strict().parse(raw);
 requireMatch(value.command === command.commandId && value.version === scope.versionId && isDeepStrictEqual(value.basis, command.basis)
   && value.humanAcceptShrinkage === command.acceptMaterialShrinkage, "GTFS reviewed adoption receipt differs");
 requireMatch(!collapse(value.basis) || command.acceptMaterialShrinkage, "GTFS material shrinkage was not accepted");
 requireMatch(value.alreadyCurrent ? value.basis.previousVersionId === scope.versionId : value.reviewAccepted === true && value.adoptedAt !== null, "GTFS adoption evidence differs");
 return value;
}

/** Retain the exact human command before dispatch. Replays preserve actor,
 * installation, reviewed counts, reason and SQL command identity. A lost reply
 * remains unconfirmed. Route-local authorization and agent refusal precede this
 * helper; SQL rechecks the session actor on every replay.
 */
export async function executeGtfsHumanCommand(options: { directory: string; installationId: string; target: string; scope: z.infer<typeof scopeSchema>;
 command: GtfsHumanCommand; service: GtfsWorkerService; signal: AbortSignal; deadlineMs?: number }) {
 requireMatch(isAbsolute(options.directory), "GTFS human command directory must be absolute");
 const target = new URL(options.target); requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.hash && !target.search, "GTFS human command target is invalid");
 const binding = bindingSchema.parse({ schemaVersion: 1, target: target.href.replace(/\/$/, ""), installationId: options.installationId, scope: options.scope, command: options.command });
 if (binding.command.operation === "adopt") requireMatch(binding.command.basis.versionId === binding.scope.versionId && (!collapse(binding.command.basis) || binding.command.acceptMaterialShrinkage), "GTFS adoption review does not match or accept shrinkage");
 const deadlineMs = z.number().int().min(1).max(10000).parse(options.deadlineMs ?? 10000);
 options.signal.throwIfAborted();
 const lock = await acquireConnectorLock(options.directory), ending = new AbortController(), signal = AbortSignal.any([options.signal, lock.signal, ending.signal]);
 try {
  let record: z.infer<typeof recordSchema>;
  try { record = recordSchema.parse(await readPrivateJson(join(options.directory, "pending.json"), 65536)); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; record = { binding, receipt: null }; }
  requireMatch(isDeepStrictEqual(record.binding, binding), "GTFS human command binding differs");
  signal.throwIfAborted(); await writeConnectorJournal(options.directory, record); signal.throwIfAborted();
  const { scope, command } = binding;
  if (record.receipt !== null) verifyReceipt(record.receipt, scope, command);
  const args = { p_workspace: scope.workspaceId, p_version: scope.versionId, p_actor: scope.actorId, p_command: command.commandId };
  const raw = command.operation === "cancel" ? await rpc(options.service, "cancel_gtfs_ingest", { ...args, p_reason: command.reason }, signal, deadlineMs)
    : await rpc(options.service, "adopt_reviewed_gtfs_ingest", { ...args, p_basis: command.basis, p_accept_shrinkage: command.acceptMaterialShrinkage }, signal, deadlineMs);
  const receipt = verifyReceipt(raw, scope, command);
  requireMatch(record.receipt === null || isDeepStrictEqual(receipt, record.receipt), "GTFS retained human command receipt changed");
  signal.throwIfAborted(); await writeConnectorJournal(options.directory, { binding, receipt }); return receipt;
 } finally { ending.abort(); await lock.release(); }
}
