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
const snapshot = () => ({ schemaVersion: 1, versionId: scope.versionId, feedId, workspaceId, requestId: id(7), actorId, state: "running", stage: "parsing", attempts: 1, claim: claim(), active: true, prepared: true,
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

import { adoptGtfsAttempt, completeGtfsAttempt, computeGtfsTracts, confirmGtfsArchive, failGtfsAttempt,
  prepareGtfsArchive, prepareGtfsOutput, stageGtfsAttempt, verifyGtfsManifest, writeGtfsBatch } from "@/lib/gtfs/managed-worker-service";
const fullScope = { ...scope, workspaceId, feedId, actorId };
const manifest = () => [{ kind: "route" as const, ordinal: 0, rows: 2, hash: "c".repeat(64) },
  { kind: "stop" as const, ordinal: 0, rows: 2, hash: "d".repeat(64) }];
const metadata = () => ({ agency_count: 1, route_count: 2, stop_count: 2, trip_count: 2, stop_time_row_count: 2,
  calendar_service_count: 1, frequency_trip_count: 0, scheduled_trip_count: 2, parse_warnings: [] });
const batchRows = () => [1, 2].map(n => ({ workspace_id: workspaceId, feed_version_id: scope.versionId, route_id: `R${n}` }));
const basis = () => ({ feedId, versionId: scope.versionId, routeCount: 2, stopCount: 2,
  previousVersionId: null as string | null, previousRouteCount: null as number | null, previousStopCount: null as number | null });
const commandId = id(20);
const commands = () => {
  const archive = snapshot().archive, plan = snapshot().plan;
  return [
    { name: "stage", rpc: "stage_gtfs_ingest", reply: { versionId: scope.versionId, stage: "parsing" }, args: { p_version: scope.versionId, p_token: scope.token, p_stage: "parsing" },
      run: (m: ReturnType<typeof client>) => stageGtfsAttempt(m.service, scope, "parsing", signal()) },
    { name: "archive-prepare", rpc: "prepare_gtfs_archive", reply: { versionId: scope.versionId, archive, preparedAt: start }, args: { p_version: scope.versionId, p_token: scope.token, p_archive: archive },
      run: (m: ReturnType<typeof client>) => prepareGtfsArchive(m.service, fullScope, archive, signal()) },
    { name: "archive-confirm", rpc: "confirm_gtfs_archive", reply: { versionId: scope.versionId, archive, confirmedAt: start }, args: { p_version: scope.versionId, p_token: scope.token, p_archive: archive },
      run: (m: ReturnType<typeof client>) => confirmGtfsArchive(m.service, fullScope, archive, signal()) },
    { name: "prepare", rpc: "prepare_gtfs_derived", reply: { version: scope.versionId, token: scope.token, removedRoutes: 0, removedStops: 0, removedTracts: 0, plan }, args: { p_version: scope.versionId, p_token: scope.token, p_plan: plan },
      run: (m: ReturnType<typeof client>) => prepareGtfsOutput(m.service, scope, plan, signal()) },
    { name: "batch", rpc: "write_gtfs_ingest_batch", reply: { command: commandId, rows: 2, hash: "c".repeat(64) }, args: { p_version: scope.versionId, p_token: scope.token, p_command: commandId, p_kind: "route", p_ordinal: 0, p_rows: batchRows() },
      run: (m: ReturnType<typeof client>) => writeGtfsBatch(m.service, fullScope, { id: commandId, kind: "route", ordinal: 0, rows: batchRows() }, signal()) },
    { name: "tract", rpc: "compute_managed_gtfs_tracts", reply: { ...tract(), command: commandId }, args: { p_version: scope.versionId, p_token: scope.token, p_command: commandId, p_plan: plan, p_manifest: manifest() },
      run: (m: ReturnType<typeof client>) => computeGtfsTracts(m.service, scope, { id: commandId, plan, manifest: manifest() }, signal()) },
    { name: "complete", rpc: "complete_gtfs_ingest", reply: { command: commandId, version: scope.versionId, status: "ready", routeRows: 2, stopRows: 2, tractOutcome: tract() }, args: { p_version: scope.versionId, p_token: scope.token, p_command: commandId, p_archive: archive, p_plan: plan, p_manifest: manifest(), p_metadata: metadata(), p_tract_command: tract().command },
      run: (m: ReturnType<typeof client>) => completeGtfsAttempt(m.service, fullScope, { id: commandId, archive, plan, manifest: manifest(), metadata: metadata(), tract: tract() }, signal()) },
    { name: "fail", rpc: "fail_gtfs_ingest", reply: { command: commandId, version: scope.versionId, state: "failed", closure: { recorded: true, feedStatusChanged: false }, cleanupPending: true, closedAt: start }, args: { p_version: scope.versionId, p_token: scope.token, p_command: commandId, p_code: "partial_write", p_detail: "Synthetic failure" },
      run: (m: ReturnType<typeof client>) => failGtfsAttempt(m.service, scope, { id: commandId, code: "partial_write", detail: "Synthetic failure" }, signal()) },
    { name: "adopt", rpc: "adopt_gtfs_ingest", reply: { command: commandId, version: scope.versionId, adopted: true, alreadyCurrent: false, basis: basis(), reviewAccepted: false, adoptedAt: start }, args: { p_workspace: workspaceId, p_version: scope.versionId, p_actor: actorId, p_command: commandId, p_review: null },
      run: (m: ReturnType<typeof client>) => adoptGtfsAttempt(m.service, fullScope, { id: commandId, routeCount: 2, stopCount: 2 }, signal()) },
  ];
};

describe("managed GTFS mutation receipts", () => {
  it.each(commands())("binds $name to its exact native payload", async command => {
    const m = client(command.reply); expect(await command.run(m)).toEqual(command.reply);
    expect(m.fetcher).toHaveBeenCalledTimes(1);
    expect(String(m.fetcher.mock.calls[0][0])).toBe(`http://127.0.0.1:54321/rest/v1/rpc/${command.rpc}`);
    expect(m.fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(m.fetcher.mock.calls[0][1]?.body))).toEqual(command.args);
  });
  it.each(commands())("refuses a foreign $name receipt", async command => {
    const changed = { ...command.reply } as Record<string, unknown>;
    if ("command" in changed) changed.command = id(99);
    else if ("versionId" in changed) changed.versionId = id(99);
    else changed.version = id(99);
    const m = client(changed); await expect(command.run(m)).rejects.toThrow();
  });
  it.each(["order", "ordinal", "totals"])("refuses malformed manifest %s", kind => {
    const value = manifest(); if (kind === "order") value.reverse(); if (kind === "ordinal") value[0].ordinal = 1; if (kind === "totals") value[0].rows = 1;
    expect(() => verifyGtfsManifest(value, snapshot().plan)).toThrow();
  });
  it("refuses a foreign batch before sending", async () => {
    const m = client({ command: commandId, rows: 2, hash: "c".repeat(64) });
    await expect(writeGtfsBatch(m.service, fullScope, { id: commandId, kind: "route", ordinal: 0, rows: batchRows().map(row => ({ ...row, workspace_id: id(99) })) }, signal())).rejects.toThrow("row scope");
    expect(m.fetcher).not.toHaveBeenCalled();
  });
  it("refuses truncated batch receipts", async () => {
    const c = commands().find(c => c.name === "batch")!; const m = client({ ...c.reply, rows: 1 }); await expect(c.run(m)).rejects.toThrow("batch receipt");
  });
  it("freezes batch payload before transport", async () => {
    const m = client({ command: commandId, rows: 2, hash: "c".repeat(64) }), rows = batchRows();
    const pending = writeGtfsBatch(m.service, fullScope, { id: commandId, kind: "route", ordinal: 0, rows }, signal()); rows[0].route_id = "changed";
    await pending; expect(JSON.parse(String(m.fetcher.mock.calls[0][1]?.body)).p_rows[0].route_id).toBe("R1");
  });
  it.each(["archive-prepare", "archive-confirm"])("refuses changed archive metadata: %s", async name => {
    const c = commands().find(c => c.name === name)!; const m = client({ ...c.reply, archive: { ...snapshot().archive, bytes: 98 } }); await expect(c.run(m)).rejects.toThrow();
  });
  it("refuses changed preparation identity", async () => {
    const c = commands().find(c => c.name === "prepare")!; const m = client({ ...c.reply, plan: { ...snapshot().plan, bytes: 201 } }); await expect(c.run(m)).rejects.toThrow("preparation receipt");
  });
  it("refuses changed finalization evidence", async () => {
    const c = commands().find(c => c.name === "complete")!; const m = client({ ...c.reply, tractOutcome: { ...tract(), rows: 1 } }); await expect(c.run(m)).rejects.toThrow("finalization receipt");
  });
  it("keeps a failed tract outcome nonnumeric", async () => {
    const c = commands().find(c => c.name === "tract")!, reply = { ...tract(), command: commandId, computed: false, rows: null, computedAt: null, errorCode: "08006", errorDetail: "Synthetic outage" };
    expect(await c.run(client(reply))).toEqual(reply);
  });
  it("preserves withheld adoption and does not send review acceptance", async () => {
    const m = client({ command: commandId, version: scope.versionId, adopted: false, withheld: true,
      basis: { ...basis(), previousVersionId: id(99), previousRouteCount: 10, previousStopCount: 10 } });
    const command = { id: commandId, routeCount: 2, stopCount: 2, review: { acceptMaterialShrinkage: true } };
    expect((await adoptGtfsAttempt(m.service, fullScope, command, signal())).adopted).toBe(false);
    expect(JSON.parse(String(m.fetcher.mock.calls[0][1]?.body)).p_review).toBeNull();
  });
  it("allows the exact existing twenty-percent boundary", async () => {
    const reply = { command: commandId, version: scope.versionId, adopted: true, alreadyCurrent: false, reviewAccepted: false, adoptedAt: start,
      basis: { ...basis(), routeCount: 8, stopCount: 8, previousVersionId: id(99), previousRouteCount: 10, previousStopCount: 10 } };
    expect((await adoptGtfsAttempt(client(reply).service, fullScope, { id: commandId, routeCount: 8, stopCount: 8 }, signal())).adopted).toBe(true);
  });
  it.each(["scope", "predecessor", "outcome", "current", "review"])("refuses inconsistent adoption %s", async kind => {
    const c = commands().find(c => c.name === "adopt")!, reply = { ...c.reply, basis: basis() } as Record<string, unknown>;
    if (kind === "scope") reply.basis = { ...basis(), feedId: id(99) };
    if (kind === "predecessor") reply.basis = { ...basis(), previousRouteCount: 3 };
    if (kind === "outcome") reply.basis = { ...basis(), previousVersionId: id(99), previousRouteCount: 10, previousStopCount: 10 };
    if (kind === "current") { reply.alreadyCurrent = true; delete reply.reviewAccepted; }
    if (kind === "review") reply.reviewAccepted = true;
    await expect(c.run(client(reply))).rejects.toThrow();
  });
});
