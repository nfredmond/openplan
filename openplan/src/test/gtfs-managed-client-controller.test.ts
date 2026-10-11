import { afterEach, describe, expect, it, vi } from "vitest";
import { GtfsClientController, type GtfsClientSnapshot } from "@/lib/gtfs/managed-client-controller";
import { readGtfsClientRequests, retainGtfsClientRequest } from "@/lib/gtfs/managed-client";
import { retainGtfsClientDecision } from "@/lib/gtfs/managed-client-decision";
import { fetchGtfsClientJson, readGtfsClientDecisionReceipt } from "@/lib/gtfs/managed-client-transport";

const id = (n: number) => `e4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { installationId: id(1), workspaceId: id(2), actorId: id(3) };
const intent = { source: "url" as const, workspaceId: scope.workspaceId, url: "https://example.org/feed.zip" };
const basis = { feedId: id(5), versionId: id(6), routeCount: 14, stopCount: 287, previousVersionId: null, previousRouteCount: null, previousStopCount: null };
const adoption = { operation: "adopt" as const, commandId: id(7), versionId: id(6), basis, acceptMaterialShrinkage: false };
const receipt = { managed: true, adoption: { command: id(7), version: id(6), adopted: true, alreadyCurrent: false, basis, adoptedAt: "2026-10-10T12:00:00Z", reviewAccepted: true, humanAcceptShrinkage: false } };
const cancellation = { command: id(8), workspaceId: scope.workspaceId, requestId: id(4), state: "cancelled", versionId: null, versionCancellation: null, cancelledAt: "2026-10-10T12:00:00Z" };
const cancelDecision = { operation: "cancel_request" as const, commandId: id(8), requestId: id(4), reason: "Wrong feed" };
function progress(requestId: string, state: "queued" | "ready" | "failed" | "cancelled" = "queued", isCurrent = false) {
 return { managed: true, requestId, cancellation: null, status: { schemaVersion: 1, workspaceId: scope.workspaceId, requestId, versionId: id(6), feedId: id(5), state,
  stage: state === "ready" ? "ready" : state === "failed" || state === "cancelled" ? "failed" : "pending", attempts: 0, leaseUntil: null, archiveConfirmed: true,
  submittedAt: "2026-10-10T12:00:00Z", isCurrent, failureCode: state === "failed" || state === "cancelled" ? "failed" : null, failureDetail: null, submitterAccessUnavailable: false } };
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
const controllers: GtfsClientController[] = [];
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; vi.useRealTimers(); });
function fixture(readOnly = false) {
 const values = new Map<string, string>(), store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
 let snapshot: GtfsClientSnapshot = { jobs: [], decisions: [], busy: [], error: null };
 const changed = vi.fn((next: GtfsClientSnapshot) => { snapshot = next; }), registryChanged = vi.fn();
 const fetcher = vi.fn<typeof fetch>(async (path, init) => {
  if (init?.method === "POST") return response({ managed: true }, 202);
  const requestId = String(path).split("/").at(-1)!.split("?")[0]; return response(progress(requestId));
 });
 const controller = new GtfsClientController({ scope, store, readOnly, fetcher, changed, registryChanged, deadlineMs: 20 }); controllers.push(controller);
 return { controller, store, values, fetcher, changed, registryChanged, get snapshot() { return snapshot; } };
}
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

describe("managed transit browser controller", () => {
 it("retains identity before bytes leave and reads committed queued progress after a 202", async () => {
  const f = fixture(); f.controller.start();
  f.fetcher.mockImplementation(async (path, init) => {
   const saved = readGtfsClientRequests(f.store, scope); expect(saved).toHaveLength(1);
   if (init?.method === "POST") { expect(new Headers(init.headers).get("x-openplan-gtfs-request-id")).toBe(saved[0].requestId); return response({ managed: true, adopted: true }, 202); }
   return response(progress(saved[0].requestId));
  });
  const request = await f.controller.submit(intent);
  expect(f.snapshot.jobs[0].request.requestId).toBe(request.requestId); expect(f.snapshot.jobs[0].progress?.status?.state).toBe("queued"); expect(f.snapshot.jobs[0].progress?.status?.isCurrent).toBe(false);
 });
 it("does not transmit when browser retention fails", async () => {
  const f = fixture(); f.store.setItem = () => { throw new Error("Storage full"); }; f.controller.start();
  await expect(f.controller.submit(intent)).rejects.toThrow("Storage full"); expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("does not transmit with corrupt retained history", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); const key = [...f.values.keys()][0]; f.values.set(key, "corrupt"); f.controller.start();
  await expect(f.controller.submit(intent)).rejects.toThrow("history is unavailable"); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.snapshot.error).toBeTruthy();
 });
 it("keeps unknown POST replies unconfirmed and retries the original intent and UUID", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockImplementation(async (_path, init) => init?.method === "POST" ? response({ error: "unknown" }, 503) : response({ managed: true, requestId: readGtfsClientRequests(f.store, scope)[0].requestId, status: null, cancellation: null }));
  const request = await f.controller.submit(intent); expect(f.snapshot.jobs[0].progress?.status).toBeNull(); expect(f.snapshot.jobs[0].error).toContain("unavailable");
  f.fetcher.mockClear(); await f.controller.resupply(request.requestId);
  const [path, init] = f.fetcher.mock.calls[0]; expect(path).toBe("/api/gtfs/feeds"); expect(JSON.parse(String(init?.body))).toEqual(intent); expect(new Headers(init?.headers).get("x-openplan-gtfs-request-id")).toBe(request.requestId); expect(readGtfsClientRequests(f.store, scope)).toHaveLength(1);
 });
 it("recovers retained server custody instead of resolving the URL again", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.controller.start(); await f.controller.poll(); await tick(); f.fetcher.mockClear(); await f.controller.recover(id(4));
  expect(f.fetcher.mock.calls[0][0]).toBe(`/api/gtfs/submissions/${id(4)}`); expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body))).toEqual({ workspaceId: scope.workspaceId }); expect(new Headers(f.fetcher.mock.calls[0][1]?.headers).get("x-openplan-gtfs-request-id")).toBe(id(4));
 });
 it.each(["ready", "failed", "cancelled"] as const)("does not recover terminal %s with the same version", async state => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.fetcher.mockImplementation(async () => response(progress(id(4), state))); f.controller.start(); await tick(); await f.controller.refresh(id(4)); f.fetcher.mockClear();
  await expect(f.controller.recover(id(4))).rejects.toThrow("terminal"); expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("refuses resupply for an already admitted version", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.controller.start(); await f.controller.refresh(id(4)); f.fetcher.mockClear();
  await expect(f.controller.resupply(id(4))).rejects.toThrow("existing import"); expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("requires the original ZIP resupply without storing browser bytes", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockImplementation(async (_path, init) => init?.method === "POST" ? response({}, 202) : response({ managed: true, requestId: readGtfsClientRequests(f.store, scope)[0].requestId, status: null, cancellation: null }));
  const file = new File(["zip bytes"], "feed.zip"), request = await f.controller.submit({ source: "upload", workspaceId: scope.workspaceId, filename: file.name }, file); f.fetcher.mockClear();
  await f.controller.resupply(request.requestId); expect(f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true); expect(f.snapshot.jobs[0].error).toContain("original ZIP");
  await f.controller.resupply(request.requestId, file); expect(f.fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(file); expect([...f.values.values()].join("")).not.toContain("zip bytes");
 });
 it("rejects status from another workspace and clears stale progress", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.controller.start(); await f.controller.refresh(id(4));
  const wrong = progress(id(4)); wrong.status.workspaceId = id(99); f.fetcher.mockResolvedValue(response(wrong)); await f.controller.refresh(id(4)); expect(f.snapshot.jobs[0].progress).toBeNull(); expect(f.snapshot.jobs[0].error).toContain("scope differs");
 });
 it("does not display late responses after scope disposal", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); let finish!: (value: Response) => void;
  f.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; })); f.controller.start(); f.controller.dispose(); f.changed.mockClear(); finish(response(progress(id(4)))); await tick(); expect(f.changed).not.toHaveBeenCalled(); expect(f.registryChanged).not.toHaveBeenCalled();
 });
 it("does not let an older progress read overwrite a newer completed read", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.controller.start(); await f.controller.refresh(id(4)); const pending: ((reply: Response) => void)[] = [];
  f.fetcher.mockImplementation(() => new Promise(resolve => { pending.push(resolve); })); const older = f.controller.refresh(id(4)), newer = f.controller.refresh(id(4));
  pending[1](response(progress(id(4), "ready"))); await newer; expect(f.snapshot.jobs[0].progress?.status?.state).toBe("ready"); pending[0](response(progress(id(4)))); await older; expect(f.snapshot.jobs[0].progress?.status?.state).toBe("ready");
 });
 it("serializes polling without automatically retrying writes", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); let finish!: (value: Response) => void;
  f.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; })); f.controller.start(); await f.controller.poll(); await f.controller.poll(); expect(f.fetcher).toHaveBeenCalledTimes(1); finish(response(progress(id(4)))); await tick(); expect(f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
 });
 it("reads exact parser review without adopting it", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockResolvedValue(response({ managed: true, review: { basis, materialShrinkage: false, isCurrent: false } })); const review = await f.controller.review(id(5), id(6)); expect(review.basis.routeCount).toBe(14); expect(f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
 });
 it("retains a decision before dispatch and requires its exact receipt", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockImplementation(async (_path, init) => { expect([...f.values.values()].join("")).toContain(adoption.commandId); expect(JSON.parse(String(init?.body))).toEqual({ workspaceId: scope.workspaceId, command: { operation: "adopt", commandId: id(7), basis, acceptMaterialShrinkage: false } }); return response(receipt); });
  await f.controller.decide(adoption); expect(f.snapshot.decisions[0].state).toBe("confirmed"); expect(f.registryChanged).toHaveBeenCalled();
 });
 it("keeps lost decision replies and replays the identical command", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockResolvedValue(response({}, 503)); await f.controller.decide(adoption); expect(f.snapshot.decisions[0].state).toBe("unconfirmed"); const first = f.fetcher.mock.calls[0][1]?.body;
  f.fetcher.mockResolvedValue(response(receipt)); await f.controller.decide(adoption); expect(f.fetcher.mock.calls[1][1]?.body).toBe(first); expect(f.snapshot.decisions).toHaveLength(1); expect(f.snapshot.decisions[0].state).toBe("confirmed");
 });
 it("does not confirm a mismatched command or a valid-looking receipt in an HTTP refusal", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockImplementation(async () => response({ ...receipt, adoption: { ...receipt.adoption, command: id(99) } })); await f.controller.decide(adoption); expect(f.snapshot.decisions[0].state).toBe("unconfirmed"); expect(f.snapshot.decisions[0].error).toContain("command differs");
  f.fetcher.mockImplementation(async () => response(receipt, 503)); await f.controller.decide(adoption); expect(f.snapshot.decisions[0].state).toBe("unconfirmed"); expect(f.snapshot.decisions[0].error).toContain("503");
 });
 it("does not publish valid-looking status from an HTTP refusal", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.fetcher.mockImplementation(async () => response(progress(id(4)), 503)); f.controller.start(); await f.controller.refresh(id(4)); expect(f.snapshot.jobs[0].progress).toBeNull(); expect(f.snapshot.jobs[0].error).toContain("503");
 });
 it("does not automatically replay decisions on browser reload", async () => {
  const f = fixture(); retainGtfsClientDecision(f.store, scope, adoption); f.controller.start(); await tick(); expect(f.snapshot.decisions[0].state).toBe("unchecked"); expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("does not infer current use from a historical adoption receipt", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.fetcher.mockImplementation(async (_path, init) => init?.method === "POST" ? response(receipt) : response(progress(id(4), "ready", false))); f.controller.start(); await f.controller.decide(adoption);
  expect(f.snapshot.decisions[0].state).toBe("confirmed"); expect(f.snapshot.jobs[0].progress?.status?.isCurrent).toBe(false);
 });
 it("opens workspace progress without creating another actor's retained intent", async () => {
  const f = fixture(); f.controller.start(); f.fetcher.mockImplementation(async () => response(progress(id(4)))); const result = await f.controller.inspect(id(5), id(6)); expect(result.status?.requestId).toBe(id(4)); expect(readGtfsClientRequests(f.store, scope)).toEqual([]);
  f.fetcher.mockImplementation(async () => response({ ...progress(id(4)), status: { ...progress(id(4)).status, feedId: id(99) } })); await expect(f.controller.inspect(id(5), id(6))).rejects.toThrow("inspected version differs");
 });
 it("allows viewer reads but refuses every write", async () => {
  const f = fixture(true); retainGtfsClientRequest(f.store, scope, intent, id(4)); f.controller.start(); await f.controller.refresh(id(4)); f.fetcher.mockClear();
  await expect(f.controller.submit(intent)).rejects.toThrow("Viewers"); await expect(f.controller.recover(id(4))).rejects.toThrow("Viewers"); await expect(f.controller.decide(adoption)).rejects.toThrow("Viewers"); expect(f.fetcher).not.toHaveBeenCalled();
 });
 it("forgetting browser history sends no server deletion or cancellation", async () => {
  const f = fixture(); retainGtfsClientRequest(f.store, scope, intent, id(4)); retainGtfsClientDecision(f.store, scope, adoption); f.controller.start(); await tick(); f.fetcher.mockClear(); f.controller.dismissRequest(id(4)); f.controller.dismissDecision(id(7)); expect(f.snapshot.jobs).toEqual([]); expect(f.snapshot.decisions).toEqual([]); expect(f.fetcher).not.toHaveBeenCalled();
 });
});

describe("browser transit receipts and bounded transport", () => {
 it("accepts exact adoption and early cancellation receipts", () => { expect(readGtfsClientDecisionReceipt(receipt, scope.workspaceId, adoption)).toEqual(receipt.adoption); expect(readGtfsClientDecisionReceipt({ managed: true, requestId: id(4), cancellation }, scope.workspaceId, cancelDecision)).toEqual(cancellation); });
 it.each(["command", "version", "basis", "humanAcceptShrinkage"])("rejects changed adoption %s", field => {
  const changed = { ...receipt.adoption, [field]: field === "basis" ? { ...basis, routeCount: 95 } : field === "humanAcceptShrinkage" ? true : id(99) };
  expect(() => readGtfsClientDecisionReceipt({ managed: true, adoption: changed }, scope.workspaceId, adoption)).toThrow("command differs");
 });
 it("requires adoption evidence and explicit material acceptance", () => {
  expect(() => readGtfsClientDecisionReceipt({ ...receipt, adoption: { ...receipt.adoption, reviewAccepted: undefined } }, scope.workspaceId, adoption)).toThrow("evidence differs");
  const smaller = { ...basis, previousVersionId: id(9), previousRouteCount: 20, previousStopCount: 500 };
  expect(() => readGtfsClientDecisionReceipt({ ...receipt, adoption: { ...receipt.adoption, basis: smaller } }, scope.workspaceId, { ...adoption, basis: smaller })).toThrow("shrinkage was not accepted");
 });
 it("rejects another cancellation command or workspace", () => {
  expect(() => readGtfsClientDecisionReceipt({ managed: true, requestId: id(4), cancellation: { ...cancellation, command: id(99) } }, scope.workspaceId, cancelDecision)).toThrow("command differs");
  expect(() => readGtfsClientDecisionReceipt({ managed: true, requestId: id(4), cancellation }, id(99), cancelDecision)).toThrow("scope differs");
 });
 it("sends bounded same-origin transport and drains a valid body", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ managed: true })); const result = await fetchGtfsClientJson(fetcher, "/api/gtfs/feeds", {}, new AbortController().signal);
  expect(result.body).toEqual({ managed: true }); expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" }); expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
 });
 it("bounds stalled headers and discards their late response", async () => {
  let finish!: (value: Response) => void; const cancelled = vi.fn(); const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
  const ending = new AbortController(), fallback = setTimeout(() => ending.abort(new Error("Test fallback cancellation")), 100);
  try {
   const result = fetchGtfsClientJson(fetcher, "/api/gtfs/feeds", {}, ending.signal, 10); await expect(result).rejects.toThrow("acknowledgement is unavailable");
   finish(new Response(new ReadableStream({ cancel: cancelled }))); await tick(); expect(cancelled).toHaveBeenCalled(); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally { clearTimeout(fallback); }
 });
 it("bounds a stalled JSON body and cancels its reader", async () => {
  const cancelled = vi.fn(), fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel: cancelled })));
  const ending = new AbortController(), fallback = setTimeout(() => ending.abort(new Error("Test fallback cancellation")), 100);
  try { await expect(fetchGtfsClientJson(fetcher, "/api/gtfs/feeds", {}, ending.signal, 10)).rejects.toThrow("acknowledgement is unavailable"); expect(cancelled).toHaveBeenCalled(); }
  finally { clearTimeout(fallback); }
 });
 it("refuses oversized bodies, external paths and pre-cancelled requests", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response({ padding: "x".repeat(70000) })); await expect(fetchGtfsClientJson(fetcher, "/api/gtfs/feeds", {}, new AbortController().signal)).rejects.toThrow("browser bound"); fetcher.mockClear();
  await expect(fetchGtfsClientJson(fetcher, "https://example.org", {}, new AbortController().signal)).rejects.toThrow("path differs"); await expect(fetchGtfsClientJson(fetcher, "/api/gtfs/../assistant/chat", {}, new AbortController().signal)).rejects.toThrow("path differs"); const ending = new AbortController(); ending.abort(new Error("Stopped")); await expect(fetchGtfsClientJson(fetcher, "/api/gtfs/feeds", {}, ending.signal)).rejects.toThrow("Stopped"); expect(fetcher).not.toHaveBeenCalled();
 });
});
