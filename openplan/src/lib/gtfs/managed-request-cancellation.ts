import { isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import type { GtfsWorkerService } from "./managed-worker-service";

const id = z.string().uuid().transform(value => value.toLowerCase());
const date = z.iso.datetime({ offset: true });
const scopeSchema = z.object({ workspaceId: id, requestId: id, actorId: id }).strict();
const terminalSchema = z.object({ command: id, version: id, state: z.literal("cancelled"),
 closure: z.object({ recorded: z.literal(true), feedStatusChanged: z.boolean() }).strict(), cleanupPending: z.boolean(), closedAt: date }).strict();
const receiptSchema = z.object({ command: id, requestId: id, workspaceId: id, state: z.literal("cancelled"), versionId: id.nullable(), cancelledAt: date,
 versionCancellation: terminalSchema.nullable() }).strict();
const commandSchema = z.object({ commandId: id, reason: z.string().trim().min(1).max(2000) }).strict();
const bindingSchema = z.object({ schemaVersion: z.literal(1), installationId: id, target: z.string(), scope: scopeSchema, command: commandSchema }).strict();
const recordSchema = z.object({ binding: bindingSchema, receipt: receiptSchema.nullable() }).strict();
export type GtfsRequestCancellation = z.infer<typeof receiptSchema>;
export type GtfsRequestScope = z.infer<typeof scopeSchema>;
function requireMatch(value: boolean, message: string): asserts value { if (!value) throw new Error(message); }

/** Validate a durable request reservation separately from processing status. */
export function verifyGtfsRequestCancellation(raw: unknown, scope: Pick<GtfsRequestScope, "workspaceId" | "requestId">, commandId?: string) {
 const receipt = receiptSchema.parse(raw);
 requireMatch(receipt.workspaceId === scope.workspaceId && receipt.requestId === scope.requestId && (commandId === undefined || receipt.command === commandId), "GTFS request cancellation receipt scope differs");
 requireMatch(receipt.versionCancellation === null || (receipt.versionId !== null && receipt.versionCancellation.version === receipt.versionId
  && receipt.versionCancellation.command === receipt.command), "GTFS request cancellation terminal receipt differs");
 return receipt;
}
async function rpc(service: GtfsWorkerService, name: string, args: Record<string, unknown>, signal: AbortSignal, deadlineMs = 10000) {
 signal.throwIfAborted();
 const ending = new AbortController(), bounded = AbortSignal.any([signal, ending.signal]);
 const timer = setTimeout(() => ending.abort(new Error("GTFS request cancellation acknowledgement is unavailable")), deadlineMs);
 let abort = () => {};
 try {
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(bounded.reason); bounded.addEventListener("abort", abort, { once: true }); if (bounded.aborted) abort(); });
  const result = await Promise.race([service.rpc(name, structuredClone(args)).abortSignal(bounded), cancelled]); bounded.throwIfAborted();
  requireMatch(!result.error, "GTFS request cancellation acknowledgement is unavailable"); return result.data as unknown;
 } finally { clearTimeout(timer); bounded.removeEventListener("abort", abort); ending.abort(); }
}
/** Current members may read a cancellation. Null remains distinct from an
 * unavailable lookup, and does not establish that admission never committed.
 */
export async function readGtfsRequestCancellation(service: GtfsWorkerService, rawScope: GtfsRequestScope, signal: AbortSignal): Promise<GtfsRequestCancellation | null> {
 const scope = scopeSchema.parse(rawScope), raw = await rpc(service, "read_gtfs_submission_cancellation", { p_workspace: scope.workspaceId, p_request: scope.requestId, p_actor: scope.actorId }, signal);
 return raw === null ? null : verifyGtfsRequestCancellation(raw, scope);
}

/** Save the human command before SQL reserves cancellation against late
 * admission. A lost reply retries the same command under current permission.
 */
export async function cancelGtfsRequest(options: { directory: string; installationId: string; target: string; scope: GtfsRequestScope;
 command: z.infer<typeof commandSchema>; service: GtfsWorkerService; signal: AbortSignal; deadlineMs?: number }) {
 requireMatch(isAbsolute(options.directory), "GTFS request command directory must be absolute");
 const target = new URL(options.target); requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.hash && !target.search, "GTFS request command target is invalid");
 const binding = bindingSchema.parse({ schemaVersion: 1, target: target.href.replace(/\/$/, ""), installationId: options.installationId, scope: options.scope, command: options.command });
 const deadlineMs = z.number().int().min(1).max(10000).parse(options.deadlineMs ?? 10000);
 options.signal.throwIfAborted();
 const lock = await acquireConnectorLock(options.directory), ending = new AbortController(), signal = AbortSignal.any([options.signal, lock.signal, ending.signal]);
 try {
  let record: z.infer<typeof recordSchema>;
  try { record = recordSchema.parse(await readPrivateJson(join(options.directory, "pending.json"), 65536)); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; record = { binding, receipt: null }; }
  requireMatch(isDeepStrictEqual(record.binding, binding), "GTFS request command binding differs");
  signal.throwIfAborted(); await writeConnectorJournal(options.directory, record); signal.throwIfAborted();
  if (record.receipt !== null) verifyGtfsRequestCancellation(record.receipt, binding.scope, binding.command.commandId);
  const raw = await rpc(options.service, "cancel_gtfs_submission", { p_workspace: binding.scope.workspaceId, p_request: binding.scope.requestId,
   p_actor: binding.scope.actorId, p_command: binding.command.commandId, p_reason: binding.command.reason }, signal, deadlineMs);
  const receipt = verifyGtfsRequestCancellation(raw, binding.scope, binding.command.commandId);
  requireMatch(record.receipt === null || isDeepStrictEqual(receipt, record.receipt), "GTFS retained request cancellation changed");
  signal.throwIfAborted(); await writeConnectorJournal(options.directory, { binding, receipt }); return receipt;
 } finally { ending.abort(); await lock.release(); }
}
