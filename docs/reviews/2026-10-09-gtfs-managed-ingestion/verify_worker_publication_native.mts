import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runGtfsOwnedAttempt } from "../../../openplan/src/lib/gtfs/managed-worker-attempt.ts";
import { processGtfsRetainedArchive } from "../../../openplan/src/lib/gtfs/managed-worker-publication.ts";
import type { GtfsAttemptSnapshot, GtfsOutputPlan, GtfsTractOutcome } from "../../../openplan/src/lib/gtfs/managed-worker-service.ts";
const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const [directory, mode] = process.argv.slice(2);
await mkdir(directory, { recursive: true, mode: 0o700 });
const url = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const identity = JSON.parse(process.env.OPENPLAN_PROOF_ARCHIVE_IDENTITY!);
const { workspaceId, feedId, versionId } = identity;
const id = "ee000000-0000-4000-8000-000000000001";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Backend = { token: string | null; plan: GtfsOutputPlan | null; tract: GtfsTractOutcome | null;
  completion: GtfsAttemptSnapshot["completion"]; completeHash: string | null; routes: number; stops: number;
  batches: Record<string, { hash: string; command: string; rows: number }>; metadata: Record<string, unknown> | null };
let state: Backend;
try { state = JSON.parse(await readFile(join(directory, "backend.json"), "utf8")); }
catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  state = { token: null, plan: null, tract: null, completion: null, completeHash: null, routes: 0, stops: 0, batches: {}, metadata: null };
}
const save = () => writeFile(join(directory, "backend.json"), JSON.stringify(state), { mode: 0o600 });
const claim = () => ({ token: state.token!, version_id: versionId, attempt: 1,
  claimed_at: "2026-10-09T12:00:00Z", initial_lease_until: "2026-10-09T12:02:00Z" });
const snapshot = (): GtfsAttemptSnapshot => ({ schemaVersion: 1, versionId, workspaceId, feedId, actorId: id, requestId: id,
  state: state.completion ? "ready" : "running", stage: state.completion ? "ready" : state.plan ? "parsing" : "pending",
  attempts: 1, active: !state.completion, prepared: !!state.plan, claim: claim(),
  source: { kind: "url", provisionalName: "Retained public feed", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" },
  archive: { path: identity.storagePath, sha256: identity.checksumSha256, bytes: identity.byteSize }, archiveConfirmed: true,
  plan: state.plan, tract: state.tract, completion: state.completion });
const calls: string[] = [];
let downloads = 0, workCalls = 0;
const service = createClient(url, process.env.OPENPLAN_PROOF_STORAGE_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(input)); assert.equal(target.origin, new URL(url).origin);
    if (target.pathname.startsWith("/storage/v1/")) {
      downloads++; target.pathname = target.pathname.slice("/storage/v1".length); return fetch(target, init);
    }
    const name = target.pathname.split("/").at(-1)!; calls.push(name);
    const args = JSON.parse(String(init?.body)); assert.equal(args.p_version, versionId);
    state.token ??= args.p_token; assert.equal(args.p_token, state.token);
    let result: unknown;
    switch (name) {
      case "claim_gtfs_ingest": result = { claim: claim(), active: !state.completion }; break;
      case "read_gtfs_ingest_attempt": result = snapshot(); break;
      case "renew_gtfs_ingest": result = !state.completion; break;
      case "confirm_gtfs_archive": result = { versionId, archive: args.p_archive, confirmedAt: "2026-10-09T12:00:00Z" }; break;
      case "stage_gtfs_ingest": result = { versionId, stage: args.p_stage }; break;
      case "prepare_gtfs_derived":
        state.plan = args.p_plan;
        result = { version: versionId, token: state.token, plan: state.plan, removedRoutes: 0, removedStops: 0, removedTracts: 0 }; break;
      case "write_gtfs_ingest_batch": {
        const key = `${args.p_kind}-${args.p_ordinal}`;
        assert.equal(state.batches[key], undefined, "Duplicate publication reached controlled backend");
        assert.ok(args.p_rows.every((row: Record<string, unknown>) => row.workspace_id === workspaceId && row.feed_version_id === versionId));
        const receipt = { command: args.p_command, rows: args.p_rows.length, hash: digest(args.p_rows) };
        state.batches[key] = receipt;
        if (args.p_kind === "route") state.routes += receipt.rows; else state.stops += receipt.rows;
        result = receipt; break;
      }
      case "compute_managed_gtfs_tracts":
        assert.equal(state.routes, state.plan!.routeRows); assert.equal(state.stops, state.plan!.stopRows);
        state.tract = { command: args.p_command, version: versionId, computed: false, rows: null, computedAt: null,
          errorCode: "synthetic_unavailable", errorDetail: "Controlled proof has no native tract computation" };
        result = state.tract; break;
      case "complete_gtfs_ingest":
        if (state.completion) assert.equal(digest(args), state.completeHash, "Retried completion payload differs");
        else {
          state.completeHash = digest(args); state.metadata = args.p_metadata;
          assert.equal(args.p_metadata.route_count, 14); assert.equal(args.p_metadata.stop_count, 287);
          state.completion = { command: args.p_command, version: versionId, status: "ready", routeRows: state.routes,
            stopRows: state.stops, tractOutcome: state.tract! };
          await save();
          throw new Error("Synthetic completion reply lost after acceptance");
        }
        result = state.completion; break;
      default: throw new Error("Unexpected controlled RPC");
    }
    await save();
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } },
});
let outcome: unknown;
try {
  outcome = await runGtfsOwnedAttempt({ directory: join(directory, "commands"), installationId: id, target: url,
    versionId, maxCommandBytes: 4 * 1024 * 1024, signal: new AbortController().signal, service,
    work: async owned => {
      workCalls++;
      const result = await processGtfsRetainedArchive({ directory: join(directory, "artifact"), installationId: id, target: url,
        parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!, service, owned, batchSize: 100, env: {},
        parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384, renewEveryMs: 100,
          renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 } });
      assert.equal(result.summary?.routeCount, 14); assert.equal(result.summary?.stopCount, 287);
      return result.terminal;
    },
  });
  assert.notEqual(mode, "interrupt", "Missing simulated unknown completion outcome");
} catch (error) {
  if (mode !== "interrupt") throw error;
  assert.ok((error as Error).message.includes("acknowledgement unavailable"));
  assert.ok(state.completion); outcome = { state: "unknown_completion" };
}
const command = JSON.parse(await readFile(join(directory, "commands/command-terminal/pending.json"), "utf8"));
const artifact = JSON.parse(await readFile(join(directory, "artifact/pending.json"), "utf8"));
const parsedFiles = (await readdir(join(directory, "artifact"))).filter(name => name.startsWith("parsed-")).length;
console.log(JSON.stringify({ mode, outcome, downloads, workCalls, calls, parsedFiles,
  terminalCommand: command.commandId, terminalResolved: command.resolved, outputSha256: artifact.output.receipt.sha256,
  routeRows: state.routes, stopRows: state.stops, parserRoutes: state.metadata?.route_count, parserStops: state.metadata?.stop_count,
  maxRssKiB: process.resourceUsage().maxRSS }));
