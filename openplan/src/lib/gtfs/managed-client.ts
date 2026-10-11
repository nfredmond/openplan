import { z } from "zod";

const id = z.string().uuid().transform(value => value.toLowerCase());
const scopeSchema = z.object({ installationId: id, workspaceId: id, actorId: id }).strict();
const intentSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("url"), workspaceId: id, url: z.string().url().max(2048), label: z.string().min(1).max(120).optional() }).strict(),
  z.object({ source: z.literal("catalog"), workspaceId: id, catalogId: z.string().min(1).max(120), area: z.object({ minLon: z.number().min(-180).max(180), minLat: z.number().min(-90).max(90), maxLon: z.number().min(-180).max(180), maxLat: z.number().min(-90).max(90) }).strict().optional() }).strict(),
  z.object({ source: z.literal("upload"), workspaceId: id, feedId: id.optional(), filename: z.string().min(1).max(255), label: z.string().min(1).max(120).optional() }).strict(),
  z.object({ source: z.literal("refresh"), workspaceId: id, feedId: id }).strict(),
]);
const itemSchema = z.object({ requestId: id, intent: intentSchema }).strict();
const recordsSchema = z.object({ schemaVersion: z.literal(1), binding: scopeSchema, items: z.array(itemSchema).max(100) }).strict();
export type GtfsClientScope = z.infer<typeof scopeSchema>;
export type GtfsClientIntent = z.infer<typeof intentSchema>;
export type GtfsClientRequest = z.infer<typeof itemSchema>;
type Store = Pick<Storage, "getItem" | "setItem">;

function storageKey(scope: GtfsClientScope) {
 return `openplan.gtfs.submissions:${scope.installationId}:${scope.workspaceId}:${scope.actorId}`;
}
function checkedRecords(store: Store, rawScope: GtfsClientScope) {
 const scope = scopeSchema.parse(rawScope), raw = store.getItem(storageKey(scope));
 if (raw === null) return { schemaVersion: 1 as const, binding: scope, items: [] as GtfsClientRequest[] };
 if (raw.length > 65536) throw new Error("Retained transit requests exceed the browser bound");
 const records = recordsSchema.parse(JSON.parse(raw));
 if (records.binding.installationId !== scope.installationId || records.binding.workspaceId !== scope.workspaceId || records.binding.actorId !== scope.actorId
   || records.items.some(item => item.intent.workspaceId !== scope.workspaceId) || new Set(records.items.map(item => item.requestId)).size !== records.items.length) throw new Error("Retained transit request scope differs");
 return records;
}
function save(store: Store, records: z.infer<typeof recordsSchema>) {
 const validated = recordsSchema.parse(records), text = JSON.stringify(validated);
 if (text.length > 65536) throw new Error("Retained transit requests exceed the browser bound");
 const key = storageKey(validated.binding); store.setItem(key, text);
 if (store.getItem(key) !== text) throw new Error("Transit request identity could not be retained");
}

/** Retain the request UUID and exact intent before network transmission. ZIP
 * bytes remain with the planner and the private server archive, not browser
 * storage. A storage refusal prevents an untracked managed submission.
 */
export function retainGtfsClientRequest(store: Store, scope: GtfsClientScope, rawIntent: GtfsClientIntent, requestId = crypto.randomUUID()) {
 const records = checkedRecords(store, scope), item = itemSchema.parse({ requestId, intent: rawIntent });
 if (item.intent.workspaceId !== records.binding.workspaceId) throw new Error("Transit request workspace differs");
 if (records.items.some(saved => saved.requestId === item.requestId)) throw new Error("Transit request UUID already exists");
 records.items.push(item); save(store, records); return item;
}
export function readGtfsClientRequests(store: Store, scope: GtfsClientScope) { return checkedRecords(store, scope).items; }
/** Forgetting browser progress does not cancel or remove server-side custody. */
export function dismissGtfsClientRequest(store: Store, scope: GtfsClientScope, requestId: string) {
 const records = checkedRecords(store, scope), request = id.parse(requestId); records.items = records.items.filter(item => item.requestId !== request); save(store, records); return records.items;
}

/** Derive a retry transport from validated intent. A retained arbitrary path
 * cannot redirect a session-authenticated import to a different API route.
 */
export function gtfsClientSubmission(request: GtfsClientRequest, file?: File): { path: string; init: RequestInit } {
 const item = itemSchema.parse(request), intent = item.intent;
 const headers = { "x-openplan-gtfs-request-id": item.requestId };
 if (intent.source === "upload") {
  if (!file) throw new Error("Select the original ZIP to resupply this request");
  const params = new URLSearchParams({ workspaceId: intent.workspaceId, filename: intent.filename });
  if (intent.feedId) params.set("feedId", intent.feedId); if (intent.label) params.set("label", intent.label);
  return { path: `/api/gtfs/feeds/upload?${params}`, init: { method: "POST", headers: { ...headers, "content-type": file.type || "application/zip" }, body: file } };
 }
 if (intent.source === "refresh") return { path: `/api/gtfs/feeds/${intent.feedId}/refresh`, init: { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: intent.workspaceId }) } };
 return { path: "/api/gtfs/feeds", init: { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(intent) } };
}
