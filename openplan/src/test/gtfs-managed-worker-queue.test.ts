// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGtfsQueuePass, runGtfsQueueService, gtfsQueueOptions, type GtfsQueueOptions } from "@/lib/gtfs/managed-worker-queue";
import type { GtfsAttemptSnapshot } from "@/lib/gtfs/managed-worker-service";
import type { GtfsOwnedWork } from "@/lib/gtfs/managed-worker-attempt";

const id = (n: number) => `ee000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-10-10T12:00:00Z", until = "2026-10-10T12:02:00Z";
const terminal = () => ({ operation: "fail" as const, input: { code: "partial_write" as const, detail: "Synthetic refusal." } });
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-gtfs-queue-")); directories.push(directory);
  const controller = new AbortController();
  const candidates = new Set<string>([id(1)]);
  const versions = new Map<string, GtfsAttemptSnapshot>();
  const claims = new Map<string, GtfsAttemptSnapshot["claim"]>();
  const receipts = new Map<string, object>();
  const events: { name: string; args: Record<string, unknown> }[] = [];
  const respond = vi.fn(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name === "scan_gtfs_ingest_candidates") {
      const ordered = [...candidates].sort(), after = args.p_after as string | null;
      return [...ordered.filter(version => after === null || version > after), ...ordered.filter(version => after !== null && version <= after)]
        .slice(0, Number(args.p_limit)).map(version_id => ({ version_id }));
    }
    const versionId = String(args.p_version), token = String(args.p_token);
    let snapshot = versions.get(versionId);
    if (name === "claim_gtfs_ingest") {
      let claim = claims.get(token);
      if (!claim) {
        if (snapshot?.active || !candidates.has(versionId)) return null;
        claim = { token, version_id: versionId, attempt: (snapshot?.attempts ?? 0) + 1, claimed_at: date, initial_lease_until: until };
        claims.set(token, claim);
        snapshot = { schemaVersion: 1, versionId, workspaceId: id(2), feedId: id(3), actorId: id(4), requestId: id(5), state: "running", stage: "pending",
          attempts: claim.attempt, claim, active: true, prepared: false,
          source: { kind: "url", provisionalName: "Synthetic source", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" },
          archive: null, archiveConfirmed: false, plan: null, tract: null, completion: null };
        versions.set(versionId, snapshot); candidates.delete(versionId);
      }
      return { claim, active: !!snapshot?.active && snapshot.claim.token === token };
    }
    if (!snapshot) throw new Error("No retained version");
    if (name === "read_gtfs_ingest_attempt") return { ...snapshot, claim: claims.get(token), active: snapshot.active && snapshot.claim.token === token };
    if (name === "renew_gtfs_ingest") return snapshot.active && snapshot.claim.token === token;
    if (name === "fail_gtfs_ingest") {
      const command = String(args.p_command);
      if (receipts.has(command)) return receipts.get(command);
      if (!snapshot.active || snapshot.claim.token !== token) throw new Error("Stale token");
      snapshot.state = "failed"; snapshot.stage = "failed"; snapshot.active = false;
      const receipt = { command, version: versionId, state: "failed", closure: { recorded: true, feedStatusChanged: false }, cleanupPending: false, closedAt: date };
      receipts.set(command, receipt); return receipt;
    }
    throw new Error("Unexpected RPC " + name);
  });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const name = String(input).split("/").at(-1)!, args = JSON.parse(String(init?.body));
    events.push({ name, args });
    return Response.json(await respond(name, args));
  });
  const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  const options: GtfsQueueOptions = { directory, installationId: id(8), target: "http://127.0.0.1:54321", service, serviceKey: "synthetic-key", signal: controller.signal,
    parserBuild: "a".repeat(40), parser: { maxOutputBytes: 65536, maxOldSpaceMb: 128, renewEveryMs: 100, renewTimeoutMs: 1000, maxRuntimeMs: 8000, terminationGraceMs: 100 }, batchSize: 100 };
  const work = vi.fn(async (_owned: GtfsOwnedWork, _paths: { source: string; artifact: string }) => terminal());
  const run = () => runGtfsQueuePass(options, work);
  const job = async (versionId = id(1)) => JSON.parse(await readFile(join(directory, `version-${versionId}/pending.json`), "utf8"));
  return { directory, controller, candidates, versions, claims, receipts, events, respond, fetcher, options, work, run, job };
}

describe("managed GTFS queue", () => {
  it("retains job and attempt identities before claims, processes serially and never adopts", async () => {
    const f = await fixture(); f.candidates.add(id(10));
    f.work.mockImplementation(async (owned, paths) => {
      const job = await f.job(owned.snapshot.versionId);
      const identity = JSON.parse(await readFile(join(f.directory, `version-${owned.snapshot.versionId}/attempt-${job.attempt}/commands/pending.json`), "utf8"));
      expect(identity.token).toBe(owned.snapshot.claim.token);
      expect(paths.source).toBe(join(f.directory, `version-${owned.snapshot.versionId}/source`));
      expect(paths.artifact).toContain(`attempt-${job.attempt}`); return terminal();
    });
    const result = await f.run(); expect(result.outcomes).toEqual([{ versionId: id(1), state: "finished" }, { versionId: id(10), state: "finished" }]);
    expect(result.pendingCount).toBe(0); expect((await f.job()).settled).toBe(true); expect(f.work).toHaveBeenCalledTimes(2);
    expect(f.events.some(event => event.name.includes("adopt"))).toBe(false);
    expect((await f.run()).outcomes).toEqual([]); expect(f.work).toHaveBeenCalledTimes(2);
  });
  it("recovers a lost terminal reply even when the version is absent from the candidate queue", async () => {
    const f = await fixture(), normal = f.respond.getMockImplementation()!; let dropped = false;
    f.respond.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (name === "fail_gtfs_ingest" && !dropped) { dropped = true; throw new Error("Lost reply"); }
      return result;
    });
    expect((await f.run()).outcomes[0].state).toBe("unconfirmed"); const before = await f.job();
    expect(f.candidates.size).toBe(0); expect((await f.run()).outcomes[0].state).toBe("recovered_terminal");
    expect((await f.job()).attempt).toBe(before.attempt); expect(f.work).toHaveBeenCalledTimes(1); expect(f.receipts.size).toBe(1);
  });
  it("replaces an expired attempt only after candidate eligibility and retains its original files", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted work"));
    expect((await f.run()).outcomes[0].state).toBe("unconfirmed"); const before = await f.job(), oldSnapshot = structuredClone(f.versions.get(id(1))!);
    f.versions.get(id(1))!.active = false; f.candidates.add(id(1));
    expect((await f.run()).outcomes[0].state).toBe("finished"); const after = await f.job();
    expect(after.attempt).not.toBe(before.attempt); expect(f.versions.get(id(1))!.attempts).toBe(2);
    expect(await readdir(join(f.directory, `version-${id(1)}`))).toContain(`attempt-${before.attempt}`);
    expect(f.versions.get(id(1))!.claim.token).not.toBe(oldSnapshot.claim.token);
    expect(f.work.mock.calls[0][1].source).toBe(f.work.mock.calls[1][1].source);
    expect(f.work.mock.calls[0][1].artifact).not.toBe(f.work.mock.calls[1][1].artifact);
  });
  it("does not replace an inactive claim absent from candidate eligibility", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted work")); await f.run(); const before = await f.job();
    f.versions.get(id(1))!.active = false;
    expect((await f.run()).outcomes[0].state).toBe("not_active"); expect((await f.job()).attempt).toBe(before.attempt); expect(f.work).toHaveBeenCalledTimes(1);
  });
  it("a competing live claim still refuses replacement after a stale queue hint", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted work")); await f.run();
    const snapshot = f.versions.get(id(1))!; snapshot.claim = { ...snapshot.claim, token: id(99), attempt: 2 }; snapshot.attempts = 2;
    f.claims.set(id(99), snapshot.claim); f.candidates.add(id(1));
    expect((await f.run()).outcomes[0].state).toBe("unavailable"); expect(f.work).toHaveBeenCalledTimes(1); expect(snapshot.claim.token).toBe(id(99));
  });
  it("observes a later terminal attempt without replaying stale terminal input", async () => {
    const f = await fixture(), normal = f.respond.getMockImplementation()!;
    f.respond.mockImplementation(async (name, args) => {
      const result = await normal(name, args);
      if (name === "fail_gtfs_ingest") throw new Error("Lost old terminal reply");
      return result;
    });
    await f.run(); f.respond.mockImplementation(normal); f.events.length = 0;
    const snapshot = f.versions.get(id(1))!; snapshot.claim = { ...snapshot.claim, token: id(99), attempt: 2 }; snapshot.attempts = 2;
    snapshot.state = "failed"; snapshot.stage = "failed"; snapshot.active = false; f.claims.set(id(99), snapshot.claim);
    expect((await f.run()).outcomes[0].state).toBe("observed_terminal"); expect((await f.job()).settled).toBe(true); expect(f.work).toHaveBeenCalledTimes(1);
    expect(f.events.some(event => event.name === "fail_gtfs_ingest")).toBe(false);
  });
  it("a bounded pass rotates retained errors and new queue work", async () => {
    const f = await fixture(); f.options.maxJobs = 1; f.work.mockRejectedValue(new Error("Retained interruption"));
    await f.run(); f.candidates.add(id(10));
    const next = await f.run(); expect(next.outcomes[0].versionId).toBe(id(10)); expect(next.pendingCount).toBe(2);
    f.candidates.clear(); const third = await f.run(); expect(third.outcomes[0].versionId).toBe(id(1));
    expect(third.outcomes).toHaveLength(1);
  });
  it("discovers later candidates when the first eligible page persistently fails", async () => {
    const f = await fixture(); f.options.maxJobs = 1; f.candidates.add(id(10)); f.candidates.add(id(11));
    const normal = f.respond.getMockImplementation()!;
    f.respond.mockImplementation(async (name, args) => {
      if (name === "claim_gtfs_ingest" && args.p_version !== id(11)) throw new Error("Persistent admission transport failure");
      return normal(name, args);
    });
    for (let pass = 0; pass < 4; pass++) await f.run();
    expect((await f.job(id(11))).settled).toBe(true);
    expect(f.events.filter(event => event.name === "scan_gtfs_ingest_candidates").map(event => event.args.p_after))
      .toEqual([null, id(1), id(10), id(10)]);
    expect(f.work).toHaveBeenCalledTimes(1);
  });
  it("upgrades a retained queue journal without discarding its existing attempt", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted")); await f.run();
    const path = join(f.directory, "pending.json"), root = JSON.parse(await readFile(path, "utf8")); delete root.discovery;
    await writeFile(path, JSON.stringify(root));
    expect((await f.run()).outcomes[0].state).toBe("finished"); expect((await f.job()).settled).toBe(true);
  });
  it.each(["installationId", "target"])("refuses changed %s queue binding before any service access", async field => {
    const f = await fixture(); await f.run(); const before = f.events.length;
    if (field === "installationId") f.options.installationId = id(99); else f.options.target = "http://other.invalid";
    await expect(f.run()).rejects.toThrow("queue binding differs"); expect(f.events).toHaveLength(before);
  });
  it("refuses a journal rebound to another version without claiming or doing work", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted work")); await f.run(); const job = await f.job();
    const path = join(f.directory, `version-${id(1)}/attempt-${job.attempt}/commands/pending.json`);
    const identity = JSON.parse(await readFile(path, "utf8")); identity.versionId = id(99); await writeFile(path, JSON.stringify(identity));
    f.events.length = 0; expect((await f.run()).outcomes[0].state).toBe("unconfirmed");
    expect(f.events.map(event => event.name)).toEqual(["scan_gtfs_ingest_candidates"]); expect(f.work).toHaveBeenCalledTimes(1);
  });
  it("refuses mismatched job identity", async () => {
    const f = await fixture(); f.work.mockRejectedValueOnce(new Error("Interrupted work")); await f.run(); const job = await f.job(); job.versionId = id(99);
    await writeFile(join(f.directory, `version-${id(1)}/pending.json`), JSON.stringify(job));
    await expect(f.run()).rejects.toThrow("job scope differs"); expect(f.work).toHaveBeenCalledTimes(1);
  });
  it.each(["public", "symlink"])("refuses %s job directories", async kind => {
    const f = await fixture(); await f.run();
    if (kind === "public") await chmod(join(f.directory, `version-${id(1)}`), 0o755);
    else await symlink(join(f.directory, `version-${id(1)}`), join(f.directory, `version-${id(99)}`));
    await expect(f.run()).rejects.toThrow(kind === "public" ? "not private" : "directory is invalid");
  });
  it("refuses an inventory beyond its installation cap", async () => {
    const f = await fixture(); f.options.maxJobs = 1; f.options.maxRecords = 1;
    for (let n = 10; n < 12; n++) await mkdir(join(f.directory, `version-${id(n)}`), { mode: 0o700 });
    await expect(f.run()).rejects.toThrow("inventory exceeds configured bound"); expect(f.work).not.toHaveBeenCalled();
  });
  it("refuses relative queue directories before service I/O", async () => {
    const f = await fixture(); f.options.directory = relative(process.cwd(), join(f.directory, "relative"));
    await expect(f.run()).rejects.toThrow("directory must be absolute"); expect(f.events).toEqual([]);
  });
  it("shutdown cancels active work without creating a feed failure", async () => {
    const f = await fixture(); let observed = false;
    f.work.mockImplementation(async owned => { f.controller.abort(); observed = owned.signal.aborted; return terminal(); });
    await expect(f.run()).rejects.toThrow(); expect(observed).toBe(true); expect(f.receipts.size).toBe(0);
    expect(f.events.some(event => event.name === "fail_gtfs_ingest")).toBe(false);
  });
  it("a second process cannot concurrently use the installation queue", async () => {
    const f = await fixture(); let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; }), complete = new Promise<void>(resolve => { release = resolve; });
    f.work.mockImplementation(async () => { reached(); await complete; return terminal(); });
    const first = f.run(); await entered;
    try { await expect(f.run()).rejects.toThrow("connector_already_running"); }
    finally { release(); await first; }
  });
  it("a successful --once pass reports a bounded pass, not a drain", async () => {
    const f = await fixture(); f.candidates.clear(); const report = vi.fn(), reportError = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError })).toBe("pass_complete");
    expect(report).toHaveBeenCalledWith({ outcomes: [], pendingCount: 0, candidateCount: 0 }); expect(reportError).not.toHaveBeenCalled();
  });
  it("recovers submissions before queue discovery and preserves unconfirmed handoffs in once status", async () => {
    const f = await fixture(); f.candidates.clear(); const report = vi.fn(), recoverSubmissions = vi.fn(async () => {
      expect(f.events).toEqual([]); return { pendingCount: 2 };
    });
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError: vi.fn(), recoverSubmissions })).toBe("unconfirmed");
    expect(recoverSubmissions).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith({ outcomes: [], pendingCount: 2, candidateCount: 0 });
  });
  it("keeps unavailable submission inventory distinct from a known zero pending count", async () => {
    const f = await fixture(); f.candidates.clear(); const report = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError: vi.fn(), recoverSubmissions: async () => ({ pendingCount: 0, unavailable: true }) })).toBe("unconfirmed");
    expect(report).toHaveBeenCalledWith({ outcomes: [], pendingCount: 0, candidateCount: 0, submissionRecoveryUnavailable: true });
  });
  it("refuses invalid submission pending counts before queue discovery", async () => {
    const f = await fixture(), report = vi.fn(), reportError = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError, recoverSubmissions: async () => ({ pendingCount: -1 }) })).toBe("error");
    expect(f.events).toEqual([]); expect(reportError).toHaveBeenCalledTimes(1); expect(report).not.toHaveBeenCalled();
  });
  it("stops after interrupted submission recovery before queue discovery", async () => {
    const f = await fixture(), report = vi.fn(), reportError = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError, recoverSubmissions: async () => { f.controller.abort(); return { pendingCount: 0 }; } })).toBe("stopped");
    expect(f.events).toEqual([]); expect(report).not.toHaveBeenCalled(); expect(reportError).not.toHaveBeenCalled();
  });
  it("polling exits on a stop requested after its report", async () => {
    const f = await fixture(); f.candidates.clear(); const report = vi.fn(() => f.controller.abort());
    expect(await runGtfsQueueService({ ...f.options, once: false, report, reportError: vi.fn() })).toBe("stopped"); expect(report).toHaveBeenCalledTimes(1);
  });
  it("polling exits during an interrupted queue read", async () => {
    const f = await fixture(); f.respond.mockImplementation(async () => { f.controller.abort(); return []; });
    const report = vi.fn(), reportError = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: false, report, reportError })).toBe("stopped");
    expect(report).not.toHaveBeenCalled(); expect(reportError).not.toHaveBeenCalled(); expect(f.work).not.toHaveBeenCalled();
  });
  it("reports queue transport errors without exposing the exception or dispatching work", async () => {
    const f = await fixture(); f.respond.mockRejectedValue(new Error("Private error")); const report = vi.fn(), reportError = vi.fn();
    expect(await runGtfsQueueService({ ...f.options, once: true, report, reportError })).toBe("error"); expect(reportError).toHaveBeenCalledTimes(1); expect(report).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  });
  it("keeps optional error diagnostics outside planner-facing outcomes", async () => {
    const f = await fixture(), error = new Error("Private diagnostic"), diagnostic = vi.fn();
    f.work.mockRejectedValue(error); f.options.onUnconfirmed = diagnostic;
    const result = await f.run(); expect(result.outcomes).toEqual([{ versionId: id(1), state: "unconfirmed" }]);
    expect(diagnostic).toHaveBeenCalledWith(id(1), error); expect(JSON.stringify(result)).not.toContain("Private diagnostic");
  });
});

describe("GTFS worker configuration", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", OPENPLAN_GTFS_INSTALLATION_ID: id(8), OPENPLAN_GTFS_PARSER_BUILD: "a".repeat(40), OPENPLAN_GTFS_WORK_DIR: "/private/work" };
  it("offers help without loading credentials and binds the durable directory to its target", () => {
    expect(gtfsQueueOptions(["--help"], {})).toEqual({ help: true });
    expect(gtfsQueueOptions(["--once"], env)).toMatchObject({ help: false, once: true, installationId: id(8), target: env.NEXT_PUBLIC_SUPABASE_URL, parserBuild: env.OPENPLAN_GTFS_PARSER_BUILD });
    expect(gtfsQueueOptions([], env)).toMatchObject({ once: false });
    expect(gtfsQueueOptions([], env).directory).not.toBe(gtfsQueueOptions([], { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54322" }).directory);
  });
  it("the installed worker CLI prints help without a configured database or credentials", () => {
    const result = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/workers/gtfs-ingestion.ts", "--help"],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
        OPENPLAN_GTFS_INSTALLATION_ID: "", OPENPLAN_GTFS_PARSER_BUILD: "" }, timeout: 10000 });
    expect(result).toContain("one bounded pass"); expect(result).toContain("Completion does not adopt");
  });
  it.each(["arguments", "relative", "credentials", "installation", "build"])("refuses invalid %s configuration", kind => {
    const config = { ...env }; const argv = kind === "arguments" ? ["--unknown"] : [];
    if (kind === "relative") config.OPENPLAN_GTFS_WORK_DIR = "relative";
    if (kind === "credentials") config.NEXT_PUBLIC_SUPABASE_URL = "http://user:password@127.0.0.1:54321";
    if (kind === "installation") config.OPENPLAN_GTFS_INSTALLATION_ID = "";
    if (kind === "build") config.OPENPLAN_GTFS_PARSER_BUILD = "unknown";
    expect(() => gtfsQueueOptions(argv, config)).toThrow();
  });
});
