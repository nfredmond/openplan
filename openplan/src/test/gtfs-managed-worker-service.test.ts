// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimGtfsAttempt, listGtfsCandidates, readGtfsAttempt, readGtfsStatus, renewGtfsAttempt,
  verifyGtfsAttempt, verifyGtfsClaim, verifyGtfsStatus } from "@/lib/gtfs/managed-worker-service";
const id = (n: number) => `e1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { versionId: id(1), token: id(2) }, workspaceId = id(3), feedId = id(4), actorId = id(5);
const start = "2026-10-09T12:00:00.123456+00:00", until = "2026-10-09T12:02:00.123456+00:00";
const claim = () => ({ token: scope.token, version_id: scope.versionId, attempt: 1, claimed_at: start, initial_lease_until: until });
const tract = () => ({ command: id(6), version: scope.versionId, computed: true, rows: 0, computedAt: until, errorCode: null, errorDetail: null });
const snapshot = () => ({ schemaVersion: 1, versionId: scope.versionId, feedId, workspaceId, requestId: id(7), state: "running", stage: "parsing", attempts: 1, claim: claim(), active: true, prepared: true,
  source: { kind: "upload", provisionalName: " Synthetic source ", uploadSha256: "a".repeat(64), uploadBytes: 99 },
  archive: { path: `${workspaceId}/${feedId}/${scope.versionId}.zip`, sha256: "a".repeat(64), bytes: 99 }, archiveConfirmed: true,
  plan: { sha256: "b".repeat(64), bytes: 200, routeRows: 2, stopRows: 2, routeBatches: 1, stopBatches: 1 }, tract: tract(), completion: null });
const status = () => ({ schemaVersion: 1, requestId: id(7), versionId: scope.versionId, feedId, workspaceId, state: "running", stage: "parsing", attempts: 1, leaseUntil: until, archiveConfirmed: true, submittedAt: start, isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false });
function client(raw: unknown, httpStatus = 200) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(raw), { status: httpStatus, headers: { "Content-Type": "application/json" } }));
  const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return { service, fetcher };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe("managed GTFS worker boundaries", () => {
  it("validates native-shaped receipts without changing source arguments", () => {
    expect(verifyGtfsAttempt(snapshot(), scope)).toEqual(snapshot());
    expect(verifyGtfsClaim({ claim: claim(), active: true }, scope)).toEqual({ claim: claim(), active: true });
    expect(verifyGtfsStatus(status(), { workspaceId, versionId: scope.versionId })).toEqual(status());
  });
  it("keeps inactive history distinct from replacement preparation", () => {
    expect(verifyGtfsClaim(null, scope)).toBeNull(); expect(verifyGtfsClaim({ claim: claim(), active: false }, scope)?.active).toBe(false);
    const old = { ...snapshot(), attempts: 2, active: false, prepared: false };
    expect(verifyGtfsAttempt(old, scope).claim.attempt).toBe(1);
    const nextScope = { ...scope, token: id(9) };
    expect(verifyGtfsAttempt({ ...old, active: true, claim: { ...claim(), token: nextScope.token, attempt: 2 }, plan: null, tract: null }, nextScope).prepared).toBe(false);
  });
  it("distinguishes zero tracts, failed tracts and completion", () => {
    const completion = { command: id(8), version: scope.versionId, status: "ready", routeRows: 2, stopRows: 2, tractOutcome: tract() };
    expect(verifyGtfsAttempt({ ...snapshot(), state: "ready", stage: "ready", active: false, completion }, scope).tract?.rows).toBe(0);
    const failed = { ...tract(), computed: false, rows: null, computedAt: null, errorCode: "08006", errorDetail: "Synthetic outage" };
    expect(verifyGtfsAttempt({ ...snapshot(), tract: failed }, scope).tract?.rows).toBeNull();
  });
  it("accepts URL and catalog sources without inventing retained bytes", () => {
    const value = { ...snapshot(), stage: "fetching", prepared: false, plan: null, tract: null, source: { kind: "url", provisionalName: "URL", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip", uploadSha256: null, uploadBytes: null }, archive: null, archiveConfirmed: false };
    expect(verifyGtfsAttempt(value, scope).archive).toBeNull();
    expect(verifyGtfsAttempt({ ...value, source: { ...value.source, kind: "catalog", catalogSourceId: "synthetic:1" } }, scope).source.kind).toBe("catalog");
  });
  it.each([
    ["claim-token", { claim: { ...claim(), token: id(99) } }], ["claim-version", { claim: { ...claim(), version_id: id(99) } }],
    ["claim-interval", { claim: { ...claim(), initial_lease_until: start } }], ["claim-ahead", { claim: { ...claim(), attempt: 2 } }],
    ["snapshot-version", { versionId: id(99) }], ["claim-ahead-inactive", { active: false, prepared: false, claim: { ...claim(), attempt: 2 } }], ["stage-mismatch-inactive", { active: false, stage: "failed" }], ["active-old", { attempts: 2 }], ["active-queued", { state: "queued" }],
    ["stage-mismatch", { state: "ready" }], ["prepared-old", { active: false, attempts: 2 }], ["prepared-plan-missing", { plan: null }],
    ["archive-missing", { archive: null }], ["parsing-unconfirmed", { archiveConfirmed: false }],
    ["archive-path", { archive: { ...snapshot().archive, path: "other/archive.zip" } }],
    ["upload-bytes", { source: { ...snapshot().source, uploadBytes: 98 } }], ["upload-hash", { source: { ...snapshot().source, uploadSha256: "c".repeat(64) } }],
    ["upload-url", { source: { ...snapshot().source, sourceUrl: "https://example.invalid/other.zip" } }],
    ["url-scheme", { source: { kind: "url", provisionalName: "URL", sourceUrl: "file:///secret", normalizedSourceUrl: "file:///secret" } }],
    ["catalog-id", { source: { kind: "catalog", provisionalName: "Catalog", sourceUrl: "https://example.invalid/a.zip", normalizedSourceUrl: "https://example.invalid/a.zip" } }],
    ["plan-capacity", { plan: { ...snapshot().plan, routeRows: 1001, routeBatches: 1 } }], ["plan-overcount", { plan: { ...snapshot().plan, stopBatches: 3 } }],
    ["tract-scope", { tract: { ...tract(), version: id(99) } }], ["tract-failed-zero", { tract: { ...tract(), computed: false, errorCode: "08006", errorDetail: "Synthetic" } }],
    ["tract-success-null", { tract: { ...tract(), rows: null } }], ["ready-no-receipt", { state: "ready", stage: "ready", active: false, completion: null }],
    ["extra-token", { replacementToken: id(99) }],
  ])("refuses inconsistent snapshot %s", (_name, change) => { expect(() => verifyGtfsAttempt({ ...snapshot(), ...change }, scope)).toThrow(); });
  it("refuses a foreign version even when its other fields agree", () => {
    const value = snapshot();
    expect(() => verifyGtfsAttempt({ ...value, versionId: id(99), archive: { ...value.archive, path: `${workspaceId}/${feedId}/${id(99)}.zip` }, tract: { ...tract(), version: id(99) } }, scope)).toThrow("attempt scope");
  });
  it("refuses confirmed URL custody without archive identity", () => {
    expect(() => verifyGtfsAttempt({ ...snapshot(), stage: "fetching", prepared: false, plan: null, tract: null,
      source: { kind: "url", provisionalName: "URL", sourceUrl: "https://example.invalid/a.zip", normalizedSourceUrl: "https://example.invalid/a.zip" }, archive: null }, scope)).toThrow("confirmed archive missing");
  });
  it.each(["version", "counts", "tract", "state"])("refuses changed completion %s", kind => {
    const completion = { command: id(8), version: scope.versionId, status: "ready", routeRows: 2, stopRows: 2, tractOutcome: tract() };
    if (kind === "version") completion.version = id(99); if (kind === "counts") completion.routeRows = 3; if (kind === "tract") completion.tractOutcome.rows = 1;
    expect(() => verifyGtfsAttempt({ ...snapshot(), state: kind === "state" ? "running" : "ready", stage: kind === "state" ? "parsing" : "ready", active: false, completion }, scope)).toThrow();
  });
  it.each([
    ["scope", { workspaceId: id(99) }], ["version", { versionId: id(99) }], ["current", { isCurrent: true }],
    ["no-lease", { leaseUntil: null }], ["zero-attempt", { attempts: 0 }], ["inactive-lease", { state: "queued" }],
    ["failed-code", { state: "cancelled", stage: "failed", leaseUntil: null }], ["worker-secret", { token: scope.token }],
  ])("refuses inconsistent member status %s", (_name, change) => { expect(() => verifyGtfsStatus({ ...status(), ...change }, { workspaceId, versionId: scope.versionId })).toThrow(); });
  it("uses the exact native endpoints and payloads through the installed SDK", async () => {
    const q = client([{ version_id: scope.versionId }]), c = client({ claim: claim(), active: true }), r = client(snapshot()), n = client(true), m = client(status());
    expect(await listGtfsCandidates(q.service, 3, signal())).toEqual([scope.versionId]); expect((await claimGtfsAttempt(c.service, scope, signal()))?.active).toBe(true);
    expect(await readGtfsAttempt(r.service, scope, signal())).toEqual(snapshot()); expect(await renewGtfsAttempt(n.service, scope, signal())).toBe(true);
    expect(await readGtfsStatus(m.service, { workspaceId, versionId: scope.versionId, actorId }, signal())).toEqual(status());
    for (const [x, name, body] of [[q,"list_gtfs_ingest_candidates",{p_limit:3}], [c,"claim_gtfs_ingest",{p_version:scope.versionId,p_token:scope.token}], [r,"read_gtfs_ingest_attempt",{p_version:scope.versionId,p_token:scope.token}], [n,"renew_gtfs_ingest",{p_version:scope.versionId,p_token:scope.token}], [m,"read_gtfs_ingest_status",{p_workspace:workspaceId,p_version:scope.versionId,p_actor:actorId}]] as const) {
      expect(x.fetcher).toHaveBeenCalledTimes(1); expect(String(x.fetcher.mock.calls[0][0])).toBe(`http://127.0.0.1:54321/rest/v1/rpc/${name}`);
      expect(JSON.parse(String(x.fetcher.mock.calls[0][1]?.body))).toEqual(body);
    }
  });
  it.each([{rows:[{version_id:scope.versionId},{version_id:scope.versionId}]}, {rows:[{version_id:id(1)},{version_id:id(2)}]}, {rows:[{version_id:"not-a-uuid"}]}])("refuses malformed or oversized queue replies", async ({rows}) => { const m=client(rows); await expect(listGtfsCandidates(m.service,1,signal())).rejects.toThrow(); });
  it.each([0, 101, 1.5])("refuses invalid queue limits before I/O: %s", async limit => {
    const m = client([]); await expect(listGtfsCandidates(m.service, limit, signal())).rejects.toThrow(); expect(m.fetcher).not.toHaveBeenCalled();
  });
  it("refuses duplicate queue entries within the bound", async () => { const m=client([{version_id:scope.versionId},{version_id:scope.versionId}]); await expect(listGtfsCandidates(m.service,2,signal())).rejects.toThrow("duplicated"); });
  it.each([null,"true",1])("refuses ambiguous renewal %s", async raw => { const m=client(raw); await expect(renewGtfsAttempt(m.service,scope,signal())).rejects.toThrow(); });
  it("retains negative renewal", async () => { const m=client(false); expect(await renewGtfsAttempt(m.service,scope,signal())).toBe(false); });
  it("validates identity before I/O and freezes the submitted scope", async () => {
    const m=client(snapshot()); await expect(readGtfsAttempt(m.service,{...scope,versionId:"bad"},signal())).rejects.toThrow(); expect(m.fetcher).not.toHaveBeenCalled();
    const mutable={...scope},pending=readGtfsAttempt(m.service,mutable,signal()); mutable.versionId=id(99);
    expect((await pending).versionId).toBe(scope.versionId); expect(JSON.parse(String(m.fetcher.mock.calls[0][1]?.body)).p_version).toBe(scope.versionId);
  });
  it("does not send already cancelled requests", async () => { const m=client(true),abort=new AbortController(); abort.abort(); await expect(renewGtfsAttempt(m.service,scope,abort.signal)).rejects.toThrow("acknowledgement unavailable"); expect(m.fetcher).not.toHaveBeenCalled(); });
  it("cancels before the dispatch microtask without sending", async () => {
    const m = client(true), controller = new AbortController(), rpc = vi.spyOn(m.service, "rpc");
    const pending = renewGtfsAttempt(m.service, scope, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow("acknowledgement unavailable"); expect(rpc).not.toHaveBeenCalled(); expect(m.fetcher).not.toHaveBeenCalled();
  });
  it.each(["response","throw"])("redacts private transport errors without retry: %s", async kind => {
    const m=client({message:"PRIVATE_SYNTHETIC"},400); if(kind==="throw")m.fetcher.mockRejectedValue(new Error("PRIVATE_SYNTHETIC"));
    await expect(claimGtfsAttempt(m.service,scope,signal())).rejects.toThrow(/^GTFS worker acknowledgement unavailable$/); expect(m.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["timeout","cancel"])("bounds a noncompliant transport and ignores late replies: %s", async kind => {
    vi.useFakeTimers(); const m=client(true),controller=new AbortController(); let resolve!:(response:Response)=>void;
    m.fetcher.mockImplementation(()=>new Promise<Response>(r=>{resolve=r;})); const pending=renewGtfsAttempt(m.service,scope,controller.signal);
    let rejected = false; void pending.catch(() => { rejected = true; });
    const refused=expect(pending).rejects.toThrow("acknowledgement unavailable");
    try { await vi.advanceTimersByTimeAsync(0); expect(m.fetcher).toHaveBeenCalledTimes(1);
    if(kind==="timeout")await vi.advanceTimersByTimeAsync(10_000);else { controller.abort(); await vi.advanceTimersByTimeAsync(0); } expect(rejected).toBe(true); await refused;
    expect(m.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); resolve(new Response("true",{headers:{"Content-Type":"application/json"}}));
    await vi.advanceTimersByTimeAsync(0); expect(m.fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { controller.abort(); await refused; }
  });
});
