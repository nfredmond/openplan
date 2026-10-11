import { z } from "zod";
import type { GtfsClientScope } from "./managed-client";

const id = z.string().uuid().transform(value => value.toLowerCase());
const count = z.number().int().nonnegative().max(2147483647);
const scopeSchema = z.object({ installationId: id, workspaceId: id, actorId: id }).strict();
const basis = z.object({ feedId: id, versionId: id, routeCount: count.positive(), stopCount: count.positive(),
 previousVersionId: id.nullable(), previousRouteCount: count.nullable(), previousStopCount: count.nullable() }).strict();
const decisionSchema = z.discriminatedUnion("operation", [
 z.object({ operation: z.literal("cancel_request"), requestId: id, commandId: id, reason: z.string().trim().min(1).max(2000) }).strict(),
 z.object({ operation: z.literal("adopt"), versionId: id, commandId: id, basis, acceptMaterialShrinkage: z.boolean() }).strict(),
]);
const recordSchema = z.object({ schemaVersion: z.literal(1), binding: scopeSchema, decisions: z.array(decisionSchema).max(100) }).strict();
export type GtfsClientDecision = z.infer<typeof decisionSchema>;
type Store = Pick<Storage, "getItem" | "setItem">;
const key = (scope: GtfsClientScope) => `openplan.gtfs.decisions:${scope.installationId}:${scope.workspaceId}:${scope.actorId}`;
function checkedDecision(raw: GtfsClientDecision) {
 const decision = decisionSchema.parse(raw);
 if (decision.operation === "adopt" && (decision.basis.versionId !== decision.versionId || (decision.basis.previousVersionId === null
  ? decision.basis.previousRouteCount !== null || decision.basis.previousStopCount !== null
  : decision.basis.previousRouteCount === null || decision.basis.previousStopCount === null))) throw new Error("Retained transit review basis differs");
 return decision;
}
function read(store: Store, rawScope: GtfsClientScope) {
 const scope = scopeSchema.parse(rawScope), raw = store.getItem(key(scope));
 if (raw === null) return { schemaVersion: 1 as const, binding: scope, decisions: [] as GtfsClientDecision[] };
 if (raw.length > 65536) throw new Error("Retained transit decisions exceed the browser bound");
 const record = recordSchema.parse(JSON.parse(raw));
 if (record.binding.installationId !== scope.installationId || record.binding.workspaceId !== scope.workspaceId || record.binding.actorId !== scope.actorId
  || new Set(record.decisions.map(item => item.commandId)).size !== record.decisions.length) throw new Error("Retained transit decision scope differs");
 record.decisions.forEach(checkedDecision); return record;
}
function save(store: Store, record: z.infer<typeof recordSchema>) {
 const text = JSON.stringify(recordSchema.parse(record));
 if (text.length > 65536) throw new Error("Retained transit decisions exceed the browser bound");
 const storageKey = key(record.binding); store.setItem(storageKey, text);
 if (store.getItem(storageKey) !== text) throw new Error("Transit decision identity could not be retained");
}
/** Keep exact human intent and command identity before sending a decision.
 * Changed review bases require a new explicit command. Earlier commands remain
 * in history, including commands whose replies have not been confirmed.
 */
export function retainGtfsClientDecision(store: Store, scope: GtfsClientScope, rawDecision: GtfsClientDecision) {
 const record = read(store, scope), decision = checkedDecision(rawDecision), saved = record.decisions.find(item => item.commandId === decision.commandId);
 if (saved) {
  if (JSON.stringify(saved) !== JSON.stringify(decision)) throw new Error("Transit command UUID already binds a different decision");
  return saved;
 }
 record.decisions.push(decision); save(store, record); return decision;
}
export function readGtfsClientDecisions(store: Store, scope: GtfsClientScope) { return read(store, scope).decisions; }
/** Forgetting browser history never retracts a committed decision or cancels
 * processing. The planner may remove this record only as a browser action.
 */
export function dismissGtfsClientDecision(store: Store, scope: GtfsClientScope, commandId: string) {
 const record = read(store, scope), command = id.parse(commandId); record.decisions = record.decisions.filter(item => item.commandId !== command); save(store, record); return record.decisions;
}
export function gtfsClientDecisionRequest(rawScope: GtfsClientScope, rawDecision: GtfsClientDecision) {
 const scope = scopeSchema.parse(rawScope), decision = checkedDecision(rawDecision);
 const path = decision.operation === "cancel_request" ? `/api/gtfs/submissions/${decision.requestId}/cancel` : `/api/gtfs/versions/${decision.versionId}/adopt`;
 const payload = decision.operation === "cancel_request" ? { workspaceId: scope.workspaceId, commandId: decision.commandId, reason: decision.reason }
  : { workspaceId: scope.workspaceId, command: { operation: "adopt", commandId: decision.commandId, basis: decision.basis, acceptMaterialShrinkage: decision.acceptMaterialShrinkage } };
 return { path, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } satisfies RequestInit };
}
