import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { runGtfsQueuePass } from "../../../openplan/src/lib/gtfs/managed-worker-queue.ts";

const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, mode, archiveFile] = process.argv.slice(2);
await mkdir(directory, { recursive: true, mode: 0o700 });
const restUrl = process.env.OPENPLAN_PROOF_HTTP_URL!, storageUrl = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const bytes = await readFile(archiveFile), sha256 = createHash("sha256").update(bytes).digest("hex");
const sourceUrl = `https://example.invalid/${basename(directory)}.zip`;
let sourceRequests = 0, uploads = 0;
let staleWhileRunning = false;
const calls: string[] = [];
const transport: typeof fetch = async (input, init) => {
  const target = new URL(String(input)); assert.equal(target.origin, new URL(restUrl).origin);
  if (target.pathname.startsWith("/storage/v1/")) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
    headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
    if (init?.method === "POST") uploads++;
    return fetch(storageUrl + target.pathname.slice("/storage/v1".length) + target.search, { ...init, headers });
  }
  assert.ok(target.pathname.startsWith("/rest/v1/"));
  const name = target.pathname.split("/").at(-1)!; calls.push(name);
  target.pathname = target.pathname.slice("/rest/v1".length);
  const response = await fetch(target, init);
  if (name === "claim_gtfs_ingest" && mode === "resume-expired" && !staleWhileRunning && response.ok) {
    const claimed = await response.clone().json();
    if (claimed?.active && claimed.claim.attempt === 2) {
      const identity = JSON.parse(await readFile(join(directory, "identity.json"), "utf8"));
      const original = JSON.parse(await readFile(join(directory, "original-attempt.json"), "utf8"));
      const headers = { Authorization: "Bearer " + process.env.OPENPLAN_PROOF_HTTP_TOKEN!, "Content-Type": "application/json" };
      const renewal = await fetch(restUrl + "/rpc/renew_gtfs_ingest", { method: "POST", headers,
        body: JSON.stringify({ p_version: identity.versionId, p_token: original.token }) });
      assert.equal(renewal.status, 200); assert.equal(await renewal.json(), false, "Old token renewed a live successor");
      const write = await fetch(restUrl + "/rpc/stage_gtfs_ingest", { method: "POST", headers,
        body: JSON.stringify({ p_version: identity.versionId, p_token: original.token, p_stage: "fetching" }) });
      assert.equal((await write.json()).code, "55000", "Old token wrote during live successor ownership");
      staleWhileRunning = true;
    }
  }
  if (name === "prepare_gtfs_archive" && mode === "interrupt") {
    assert.equal(response.status, 200, "Native preparation failed before queue interruption");
    const receipt = await response.clone().json(); assert.equal(receipt.archive.sha256, sha256);
    await writeFile(join(directory, "interrupted.json"), JSON.stringify({ sourceRequests, uploads, calls }), { mode: 0o600 });
    await new Promise(() => {});
  }
  return response;
};
const service = createClient(restUrl, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
if (mode === "seed") {
  const workspaceId = process.env.OPENPLAN_PROOF_WORKSPACE!, actorId = process.env.OPENPLAN_PROOF_ACTOR!;
  const admission = await service.rpc("admit_gtfs_ingest", { p_request: randomUUID(), p_workspace: workspaceId, p_actor: actorId, p_feed: null,
    p_source: { kind: "url", provisionalName: "BART native queue fixture", sourceUrl, normalizedSourceUrl: sourceUrl } });
  assert.equal(admission.error, null, "Native queue admission failed");
  const { feedId, versionId } = admission.data;
  await writeFile(join(directory, "identity.json"), JSON.stringify({ workspaceId, actorId, feedId, versionId,
    archive: { path: `${workspaceId}/${feedId}/${versionId}.zip`, sha256, bytes: bytes.length }, installationId: randomUUID() }), { mode: 0o600 });
} else {
  const identity = JSON.parse(await readFile(join(directory, "identity.json"), "utf8"));
  const server = createServer((_request, response) => { sourceRequests++; response.end(mode === "interrupt" ? bytes : Buffer.from("Publisher changed")); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const queueDirectory = join(directory, "queue"), jobDirectory = join(queueDirectory, `version-${identity.versionId}`);
  try {
    const result = await runGtfsQueuePass({ directory: queueDirectory, installationId: identity.installationId, target: restUrl,
      serviceKey: process.env.OPENPLAN_PROOF_HTTP_TOKEN!, storageFetch: transport, service, signal: new AbortController().signal,
      onUnconfirmed: (_version, error) => console.error(JSON.stringify({ nativeProofDiagnostic: error instanceof Error ? error.message : "unknown" })),
      parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!, batchSize: 100, maxJobs: 1,
      fetchOptions: { env: {}, lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        fetchImpl: async (_url, init) => fetch(`http://127.0.0.1:${address.port}/native.zip`, init) },
      parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384, renewEveryMs: 100, renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 } });
    assert.equal(sourceRequests, 0, "Queue recovery fetched a changed publisher");
    const job = JSON.parse(await readFile(join(jobDirectory, "pending.json"), "utf8"));
    if (!job.settled) console.error(JSON.stringify({ result, calls, staleWhileRunning, uploads }));
    assert.equal(job.settled, true); assert.equal(result.pendingCount, 0);
    if (mode === "retained") {
      assert.deepEqual(result.outcomes, []); assert.equal(uploads, 0); assert.deepEqual(calls, ["list_gtfs_ingest_candidates"]);
    } else {
      assert.deepEqual(result.outcomes, [{ versionId: identity.versionId, state: "finished" }]); assert.equal(uploads, 1);
      const source = JSON.parse(await readFile(join(jobDirectory, "source/pending.json"), "utf8")); assert.equal(source.archive.sha256, sha256);
      const attempt = JSON.parse(await readFile(join(jobDirectory, `attempt-${job.attempt}/commands/pending.json`), "utf8"));
      const original = JSON.parse(await readFile(join(directory, "original-attempt.json"), "utf8"));
      assert.equal(attempt.token === original.token, mode === "resume-live", "Queue replacement identity differs");
      const historical = await readFile(join(jobDirectory, `attempt-${original.attemptDirectory}/commands/pending.json`), "utf8");
      assert.equal(JSON.parse(historical).token, original.token, "Queue lost old attempt history");
      if (mode === "resume-expired") {
        assert.equal(staleWhileRunning, true, "Live replacement fencing was not observed");
        const stale = await service.rpc("renew_gtfs_ingest", { p_version: identity.versionId, p_token: original.token });
        assert.equal(stale.error, null); assert.equal(stale.data, false, "Old queue attempt renewed after replacement");
        const write = await service.rpc("stage_gtfs_ingest", { p_version: identity.versionId, p_token: original.token, p_stage: "fetching" });
        assert.equal(write.error?.code, "55000", "Old queue attempt wrote after replacement");
      }
    }
    console.log(JSON.stringify({ mode, result, sourceRequests, uploads, calls, staleWhileRunning, attemptDirectory: job.attempt,
      retainedAttempts: (await readdir(jobDirectory)).filter(name => name.startsWith("attempt-")).length, maxRssKiB: process.resourceUsage().maxRSS }));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
