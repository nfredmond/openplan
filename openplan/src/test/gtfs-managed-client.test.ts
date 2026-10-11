import { describe, expect, it, vi } from "vitest";
import { retainGtfsClientRequest, readGtfsClientRequests, dismissGtfsClientRequest, gtfsClientSubmission, type GtfsClientScope } from "@/lib/gtfs/managed-client";
const id = (n: number) => `e8000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { installationId: id(1), workspaceId: id(2), actorId: id(3) }, intent = { source: "url" as const, workspaceId: id(2), url: "https://example.invalid/original.zip" };
function fixture() {
 const values = new Map<string, string>(), store = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
 return { store, values, key: `openplan.gtfs.submissions:${id(1)}:${id(2)}:${id(3)}` };
}
describe("retained transit client requests", () => {
 it("retains exact intent and request identity before constructing a submission", () => {
  const f = fixture(), item = retainGtfsClientRequest(f.store, scope, intent, id(4)); expect(readGtfsClientRequests(f.store, scope)).toEqual([item]);
  expect(JSON.parse(f.values.get(f.key)!)).toEqual({ schemaVersion: 1, binding: scope, items: [{ requestId: id(4), intent }] });
  const submission = gtfsClientSubmission(item); expect(submission.path).toBe("/api/gtfs/feeds"); expect(submission.init.headers).toMatchObject({ "x-openplan-gtfs-request-id": id(4) }); expect(JSON.parse(String(submission.init.body))).toEqual(intent);
 });
 it.each(["installationId", "workspaceId", "actorId"] as const)("isolates another %s", field => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); expect(readGtfsClientRequests(f.store, { ...scope, [field]: id(90) })).toEqual([]);
 });
 it.each(["installationId", "workspaceId", "actorId"] as const)("refuses tampered saved %s binding", field => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); const raw = JSON.parse(f.values.get(f.key)!); raw.binding[field] = id(90); f.values.set(f.key, JSON.stringify(raw)); expect(() => readGtfsClientRequests(f.store, scope)).toThrow("scope differs");
 });
 it("refuses an intent in another workspace", () => { const f = fixture(); expect(() => retainGtfsClientRequest(f.store, scope, { ...intent, workspaceId: id(90) }, id(4))).toThrow("workspace differs"); expect(f.store.setItem).not.toHaveBeenCalled(); });
 it("refuses duplicate request UUIDs", () => { const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); expect(() => retainGtfsClientRequest(f.store, scope, intent, id(4))).toThrow("already exists"); });
 it("refuses unavailable browser storage before producing a request", () => { const f = fixture(); f.store.setItem.mockImplementation(() => { throw new Error("storage unavailable"); }); expect(() => retainGtfsClientRequest(f.store, scope, intent, id(4))).toThrow("storage unavailable"); });
 it("verifies browser storage actually kept the request bytes", () => { const f = fixture(); f.store.setItem.mockImplementation(() => {}); expect(() => retainGtfsClientRequest(f.store, scope, intent, id(4))).toThrow("could not be retained"); });
 it("refuses oversized retained records", () => { const f = fixture(); f.values.set(f.key, " ".repeat(65537)); expect(() => readGtfsClientRequests(f.store, scope)).toThrow("browser bound"); });
 it("refuses too many tracked requests without evicting history", () => { const f = fixture(); f.values.set(f.key, JSON.stringify({ schemaVersion: 1, binding: scope, items: Array.from({ length: 100 }, (_, n) => ({ requestId: id(n + 10), intent })) })); expect(() => retainGtfsClientRequest(f.store, scope, intent, id(4))).toThrow(); expect(JSON.parse(f.values.get(f.key)!).items).toHaveLength(100); });
 it("dismisses one browser request without a server mutation", () => { const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); retainGtfsClientRequest(f.store, scope, intent, id(5)); expect(dismissGtfsClientRequest(f.store, scope, id(4))).toEqual([{ requestId: id(5), intent }]); });
 it("keeps ZIP bytes outside browser storage while resupplying the original UUID", () => {
  const f = fixture(), file = new File(["synthetic archive"], "agency.zip", { type: "application/zip" });
  const item = retainGtfsClientRequest(f.store, scope, { source: "upload", workspaceId: id(2), filename: "agency.zip", feedId: id(6), label: "Agency" }, id(4));
  expect(f.values.get(f.key)).not.toContain("synthetic archive"); const submission = gtfsClientSubmission(item, file);
  expect(submission.path).toBe(`/api/gtfs/feeds/upload?workspaceId=${id(2)}&filename=agency.zip&feedId=${id(6)}&label=Agency`); expect(submission.init.body).toBe(file); expect(submission.init.headers).toMatchObject({ "x-openplan-gtfs-request-id": id(4), "content-type": "application/zip" });
  expect(() => gtfsClientSubmission(item)).toThrow("original ZIP");
 });
 it("derives a refresh path with no source or adoption override", () => { const item = { requestId: id(4), intent: { source: "refresh" as const, workspaceId: id(2), feedId: id(6) } }; const submission = gtfsClientSubmission(item); expect(submission.path).toBe(`/api/gtfs/feeds/${id(6)}/refresh`); expect(JSON.parse(String(submission.init.body))).toEqual({ workspaceId: id(2) }); });
 it("refuses retained arbitrary paths and action overrides", () => { expect(() => gtfsClientSubmission({ requestId: id(4), intent, path: "/api/workspaces" } as unknown as Parameters<typeof gtfsClientSubmission>[0])).toThrow(); expect(() => gtfsClientSubmission({ requestId: id(4), intent: { source: "refresh", workspaceId: id(2), feedId: id(6), adoptDespiteCollapse: true } } as unknown as Parameters<typeof gtfsClientSubmission>[0])).toThrow(); });
 it.each(["installationId", "workspaceId", "actorId"] as const)("refuses invalid current %s", field => { const f = fixture(); expect(() => readGtfsClientRequests(f.store, { ...scope, [field]: "invalid" } as GtfsClientScope)).toThrow(); expect(f.store.getItem).not.toHaveBeenCalled(); });
});
