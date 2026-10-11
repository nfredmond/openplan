import { z } from "zod";
import type { GtfsClientDecision } from "./managed-client-decision";
import { readGtfsClientProgress } from "./managed-progress";

const id = z.string().uuid().transform(value => value.toLowerCase());
const count = z.number().int().nonnegative().max(2147483647);
const basis = z.object({ feedId: id, versionId: id, routeCount: count.positive(), stopCount: count.positive(),
 previousVersionId: id.nullable(), previousRouteCount: count.nullable(), previousStopCount: count.nullable() }).strict();

/** A receipt confirms the exact command. It does not prove that an historical
 * adoption remains current. The controller reads current progress separately.
 */
export function readGtfsClientDecisionReceipt(raw: unknown, workspaceId: string, decision: GtfsClientDecision) {
 if (decision.operation === "cancel_request") {
  const body = z.object({ managed: z.literal(true), requestId: id, cancellation: z.unknown(), detail: z.string().optional() }).strict().parse(raw);
  const progress = readGtfsClientProgress({ ...body, status: null }, { workspaceId, requestId: decision.requestId });
  if (!progress.cancellation || progress.cancellation.command !== decision.commandId) throw new Error("Transit cancellation command differs");
  return progress.cancellation;
 }
 const body = z.object({ managed: z.literal(true), adoption: z.object({ command: id, version: id, adopted: z.literal(true),
  alreadyCurrent: z.boolean(), basis, adoptedAt: z.iso.datetime({ offset: true }).nullable(), reviewAccepted: z.literal(true).optional(),
  humanAcceptShrinkage: z.boolean() }).strict(), detail: z.string().optional() }).strict().parse(raw);
 const receipt = body.adoption;
 if (receipt.command !== decision.commandId || receipt.version !== decision.versionId || JSON.stringify(receipt.basis) !== JSON.stringify(basis.parse(decision.basis))
  || receipt.humanAcceptShrinkage !== decision.acceptMaterialShrinkage) throw new Error("Transit adoption command differs");
 const material = receipt.basis.previousVersionId !== null && ((receipt.basis.previousRouteCount! > 0 && receipt.basis.routeCount < receipt.basis.previousRouteCount! * 0.8)
  || (receipt.basis.previousStopCount! > 0 && receipt.basis.stopCount < receipt.basis.previousStopCount! * 0.8));
 if (material && !decision.acceptMaterialShrinkage) throw new Error("Transit material shrinkage was not accepted");
 if (receipt.alreadyCurrent ? receipt.basis.previousVersionId !== decision.versionId : receipt.reviewAccepted !== true || receipt.adoptedAt === null) throw new Error("Transit adoption evidence differs");
 return receipt;
}

/** Bound both the HTTP acknowledgement and its JSON body. Cancellation ends
 * browser transport and discards a late reply; it never cancels server custody.
 */
export async function fetchGtfsClientJson(fetcher: typeof fetch, path: string, init: RequestInit, signal: AbortSignal, deadlineMs = 15000) {
 const target = new URL(path, "http://openplan.invalid");
 if (!path.startsWith("/api/gtfs/") || target.origin !== "http://openplan.invalid" || !target.pathname.startsWith("/api/gtfs/")) throw new Error("Transit transport path differs");
 if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000) throw new Error("Transit transport deadline differs");
 signal.throwIfAborted();
 const ending = new AbortController(), bounded = AbortSignal.any([signal, ending.signal]);
 const timer = setTimeout(() => ending.abort(new Error("Transit acknowledgement is unavailable. Retain the same request or command.")), deadlineMs);
 let abort = () => {}, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, finished = false;
 const cancelled = new Promise<never>((_, reject) => { abort = () => reject(bounded.reason); bounded.addEventListener("abort", abort, { once: true }); if (bounded.aborted) abort(); });
 try {
  const pending = fetcher(path, { ...init, credentials: "same-origin", cache: "no-store", signal: bounded });
  void pending.then(response => { if (bounded.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
  const response = await Promise.race([pending, cancelled]); bounded.throwIfAborted();
  reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  if (reader) while (true) {
   const next = await Promise.race([reader.read(), cancelled]); bounded.throwIfAborted();
   if (next.done) { finished = true; break; }
   length += next.value.byteLength; if (length > 65536) throw new Error("Transit response exceeds the browser bound"); chunks.push(next.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); bounded.throwIfAborted();
  return { ok: response.ok, status: response.status, body };
 } finally {
  clearTimeout(timer); bounded.removeEventListener("abort", abort); ending.abort();
  if (reader && !finished) void reader.cancel().catch(() => {});
 }
}
