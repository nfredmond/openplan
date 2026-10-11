import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runGtfsOwnedAttempt } from "../../../openplan/src/lib/gtfs/managed-worker-attempt.ts";
import type { GtfsDurableMutation } from "../../../openplan/src/lib/gtfs/managed-worker-dispatch.ts";

const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, operation] = process.argv.slice(2);
assert.ok(operation === "fail" || operation === "complete");
await mkdir(directory, { recursive: true, mode: 0o700 });
const url = process.env.OPENPLAN_PROOF_HTTP_URL!;
const key = process.env.OPENPLAN_PROOF_HTTP_TOKEN!;
const workspaceId = process.env.OPENPLAN_PROOF_WORKSPACE!, actorId = process.env.OPENPLAN_PROOF_ACTOR!;
let interrupted = false, workCalls = 0, terminalRequests = 0;
const calls: string[] = [];
let cancellation: { state: string } | undefined;
const transport: typeof fetch = async (input, init) => {
  const target = new URL(String(input)); assert.equal(target.origin, new URL(url).origin);
  assert.ok(target.pathname.startsWith("/rest/v1/"));
  const name = target.pathname.split("/").at(-1)!; calls.push(name);
  target.pathname = target.pathname.slice("/rest/v1".length);
  if (name === `${operation}_gtfs_ingest`) {
    terminalRequests++;
    if (!interrupted) {
      interrupted = true;
      const payload = JSON.parse(String(init?.body)) as { p_version: string };
      const response = await fetch(new URL("/rpc/cancel_gtfs_ingest", url), {
        method: "POST", headers: init?.headers, body: JSON.stringify({ p_workspace: workspaceId,
          p_version: payload.p_version, p_command: randomUUID(), p_actor: actorId,
          p_reason: "Synthetic cancellation before terminal delivery" }),
      });
      assert.equal(response.status, 200); cancellation = await response.json() as { state: string };
      assert.equal(cancellation.state, "cancelled");
      throw new Error("Synthetic unavailable terminal acknowledgement after native cancellation");
    }
  }
  return fetch(target, init);
};
const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
const sourceUrl = `https://example.invalid/${randomUUID()}.zip`;
const admission = await service.rpc("admit_gtfs_ingest", { p_request: randomUUID(), p_workspace: workspaceId,
  p_actor: actorId, p_feed: null, p_source: { kind: "url", provisionalName: "Synthetic cancelled terminal",
    sourceUrl, normalizedSourceUrl: sourceUrl } });
assert.equal(admission.error, null);
const { versionId, feedId } = admission.data as { versionId: string; feedId: string };
const terminal: Extract<GtfsDurableMutation, { operation: "complete" | "fail" }> = operation === "fail"
  ? { operation, input: { code: "partial_write", detail: "Synthetic terminal refusal" } }
  : { operation, input: {
    archive: { path: `${workspaceId}/${feedId}/${versionId}.zip`, sha256: "a".repeat(64), bytes: 100 },
    plan: { sha256: "b".repeat(64), bytes: 100, routeRows: 1, stopRows: 1, routeBatches: 1, stopBatches: 1 },
    manifest: [{ kind: "route", ordinal: 0, rows: 1, hash: "c".repeat(64) }, { kind: "stop", ordinal: 0, rows: 1, hash: "d".repeat(64) }],
    metadata: { agency_count: 1, route_count: 1, stop_count: 1, trip_count: 1, stop_time_row_count: 1,
      calendar_service_count: 1, frequency_trip_count: 0, scheduled_trip_count: 1, parse_warnings: [] },
    tract: { command: randomUUID(), version: versionId, computed: true, rows: 0,
      computedAt: new Date().toISOString(), errorCode: null, errorDetail: null },
  } };
const run = () => runGtfsOwnedAttempt({ directory, installationId: randomInstallation, target: url,
  versionId, maxCommandBytes: 65536, signal: new AbortController().signal, service,
  work: async () => { workCalls++; return terminal; },
});
const randomInstallation = randomUUID();
await assert.rejects(run(), /GTFS worker acknowledgement unavailable/);
const commandPath = join(directory, "command-terminal/pending.json");
const retained = await readFile(commandPath);
assert.equal(JSON.parse(retained.toString()).resolved, false);
const offset = calls.length;
for (let count = 0; count < 2; count++) {
  const recovered = await run();
  assert.equal(recovered.state, "observed_terminal");
  assert.ok("snapshot" in recovered); assert.equal(recovered.snapshot.state, "cancelled");
  assert.deepEqual(await readFile(commandPath), retained);
}
assert.equal(terminalRequests, 1); assert.equal(workCalls, 1);
assert.ok(calls.slice(offset).every(name => ["claim_gtfs_ingest", "read_gtfs_ingest_attempt"].includes(name)));
console.log(JSON.stringify({ operation, versionId, workCalls, terminalRequests, recoveredPasses: 2,
  originalCommandRetainedExactly: true, cancellation, calls }));
