import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { runGtfsOwnedAttempt } from "../../../openplan/src/lib/gtfs/managed-worker-attempt.ts";
import { processGtfsSourceArchive } from "../../../openplan/src/lib/gtfs/managed-worker-intake.ts";

const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, mode, archiveFile] = process.argv.slice(2);
await mkdir(directory, { recursive: true, mode: 0o700 });
const restUrl = process.env.OPENPLAN_PROOF_HTTP_URL!, storageUrl = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const sourceUrl = `https://example.invalid/${basename(directory)}.zip`;
const bytes = await readFile(archiveFile), sha256 = createHash("sha256").update(bytes).digest("hex");
let sourceRequests = 0, uploads = 0, workCalls = 0;
const calls: string[] = [];
const marker = async (boundary: string) => {
  await writeFile(join(directory, "interrupted.json"), JSON.stringify({ boundary, sourceRequests, uploads, workCalls, calls }), { mode: 0o600 });
  await new Promise(() => {});
};
const transport: typeof fetch = async (input, init) => {
  const target = new URL(String(input)); assert.equal(target.origin, new URL(restUrl).origin);
  if (target.pathname.startsWith("/storage/v1/")) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
    headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
    const response = await fetch(storageUrl + target.pathname.slice("/storage/v1".length) + target.search, { ...init, headers });
    if (init?.method === "POST") {
      uploads++; assert.equal(new Headers(init.headers).get("x-upsert"), "false"); assert.ok(init.signal);
      assert.equal(response.status, 200, "Native immutable upload failed");
      assert.equal(createHash("sha256").update(await readFile(join(directory, "source/archive.zip"))).digest("hex"), sha256);
      if (mode === "interrupt-upload") await marker("upload-committed");
    }
    return response;
  }
  assert.ok(target.pathname.startsWith("/rest/v1/"));
  const name = target.pathname.split("/").at(-1)!; calls.push(name);
  target.pathname = target.pathname.slice("/rest/v1".length);
  const response = await fetch(target, init);
  if ((name === "prepare_gtfs_archive" && mode === "interrupt-prepare")
    || (name === "confirm_gtfs_archive" && mode === "interrupt-confirm")) {
    assert.equal(response.status, 200, "Native archive RPC failed before interruption");
    const receipt = await response.clone().json(); assert.equal(receipt.archive.sha256, sha256);
    await marker(name + "-committed");
  }
  return response;
};
const service = createClient(restUrl, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
if (mode === "seed") {
  const workspaceId = process.env.OPENPLAN_PROOF_WORKSPACE!, actorId = process.env.OPENPLAN_PROOF_ACTOR!;
  const admission = await service.rpc("admit_gtfs_ingest", { p_request: randomUUID(), p_workspace: workspaceId,
    p_actor: actorId, p_feed: null, p_source: { kind: "url", provisionalName: "BART native intake fixture", sourceUrl, normalizedSourceUrl: sourceUrl } });
  assert.equal(admission.error, null, "Native URL admission failed");
  const { feedId, versionId } = admission.data;
  await writeFile(join(directory, "identity.json"), JSON.stringify({ workspaceId, actorId, feedId, versionId,
    archive: { path: `${workspaceId}/${feedId}/${versionId}.zip`, sha256, bytes: bytes.length }, installationId: randomUUID() }), { mode: 0o600 });
  console.log(JSON.stringify({ mode, versionId }));
} else {
  const identity = JSON.parse(await readFile(join(directory, "identity.json"), "utf8"));
  const server = createServer((_request, response) => {
    sourceRequests++;
    // Recovery must not contact this changed publisher under the saved version.
    response.end(mode.startsWith("interrupt") ? bytes : Buffer.from("Publisher changed"));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  try {
    const outcome = await runGtfsOwnedAttempt({ directory: join(directory, "commands"),
      installationId: identity.installationId, target: restUrl, versionId: identity.versionId,
      maxCommandBytes: 4 * 1024 * 1024, signal: new AbortController().signal, service,
      work: async owned => {
        workCalls++;
        const deliver: typeof owned.deliver = async (slot, command) => {
          if (mode === "interrupt-local" && command.operation === "prepare_archive") await marker("local-saved-before-prepare");
          return owned.deliver(slot, command);
        };
        const result = await processGtfsSourceArchive({ directory: join(directory, "source"),
          installationId: identity.installationId, target: restUrl, serviceKey: process.env.OPENPLAN_PROOF_HTTP_TOKEN!, storageFetch: transport,
          service, owned: { ...owned, deliver }, batchSize: 100,
          fetchOptions: { env: {}, lookup: async () => [{ address: "8.8.8.8", family: 4 }],
            fetchImpl: async (_url, init) => fetch(`http://127.0.0.1:${address.port}/native.zip`, init) },
          artifact: { directory: join(directory, "artifact"), parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!,
            parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384, renewEveryMs: 100,
              renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 } } });
        assert.equal(result.summary?.routeCount, 14); assert.equal(result.summary?.stopCount, 287);
        return result.terminal;
      },
    });
    assert.equal(sourceRequests, 0, "Recovery fetched a changed source");
    assert.equal(outcome.state, mode === "retained" ? "recovered_terminal" : "finished");
    assert.equal(workCalls, mode === "retained" ? 0 : 1);
    assert.equal(uploads, mode === "resume-before-upload" ? 1 : 0, "Recovery repeated committed Storage upload");
    const source = JSON.parse(await readFile(join(directory, "source/pending.json"), "utf8"));
    assert.equal(source.archive.sha256, sha256); assert.equal(source.archive.bytes, bytes.length);
    assert.equal(source.provenance.finalUrl, sourceUrl);
    const artifact = JSON.parse(await readFile(join(directory, "artifact/pending.json"), "utf8"));
    console.log(JSON.stringify({ mode, state: outcome.state, sourceRequests, uploads, workCalls, calls,
      archiveSha256: source.archive.sha256, outputSha256: artifact.output.receipt.sha256, maxRssKiB: process.resourceUsage().maxRSS }));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
