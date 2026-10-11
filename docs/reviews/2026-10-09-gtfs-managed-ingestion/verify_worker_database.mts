import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runGtfsOwnedAttempt } from "../../../openplan/src/lib/gtfs/managed-worker-attempt.ts";
import { processGtfsRetainedArchive } from "../../../openplan/src/lib/gtfs/managed-worker-publication.ts";
const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, mode, archiveFile] = process.argv.slice(2);
await mkdir(directory, { recursive: true, mode: 0o700 });
const restUrl = process.env.OPENPLAN_PROOF_HTTP_URL!;
const storageUrl = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const calls: string[] = [];
let downloads = 0, workCalls = 0;
const service = createClient(restUrl, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(input)); assert.equal(target.origin, new URL(restUrl).origin);
    if (target.pathname.startsWith("/storage/v1/")) {
      if ((init?.method ?? "GET") === "GET") downloads++;
      const headers = new Headers(init?.headers);
      headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
      headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
      return fetch(storageUrl + target.pathname.slice("/storage/v1".length) + target.search, { ...init, headers });
    }
    assert.ok(target.pathname.startsWith("/rest/v1/"));
    const name = target.pathname.split("/").at(-1)!; calls.push(name);
    target.pathname = target.pathname.slice("/rest/v1".length);
    const response = await fetch(target, init);
    if ((name === "complete_gtfs_ingest" && mode === "interrupt")
      || (name === "write_gtfs_ingest_batch" && mode === "interrupt-batch")) {
      assert.equal(response.status, 200, "Native completion failed before interruption");
      const receipt = await response.clone().json();
      await writeFile(join(directory, "completion-request.json"), String(init?.body), { mode: 0o600 });
      if (mode === "interrupt") assert.equal(receipt.status, "ready");
      else assert.equal(receipt.rows, 95);
      await writeFile(join(directory, "committed-before-kill.json"), JSON.stringify({
        command: receipt.command, requestSha256: createHash("sha256").update(String(init?.body)).digest("hex"),
        receipt, downloads, workCalls, calls,
      }), { mode: 0o600 });
      // The parent kills only this owned process group before the SDK receives the reply.
      await new Promise(() => {});
    }
    if (!response.ok) {
      const body = await response.clone().json();
      console.error(JSON.stringify({ rpc: name, status: response.status, code: body.code, message: body.message }));
    }
    return response;
  } },
});
if (mode === "seed") {
  const bytes = await readFile(archiveFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const workspaceId = process.env.OPENPLAN_PROOF_WORKSPACE!;
  const actorId = process.env.OPENPLAN_PROOF_ACTOR!;
  const admission = await service.rpc("admit_gtfs_ingest", { p_request: randomUUID(), p_workspace: workspaceId,
    p_actor: actorId, p_feed: null, p_source: { kind: "upload", provisionalName: "Public BART recovery fixture",
      uploadSha256: sha256, uploadBytes: bytes.length } });
  assert.equal(admission.error, null, "Native admission failed");
  const { feedId, versionId } = admission.data;
  const archive = { path: `${workspaceId}/${feedId}/${versionId}.zip`, sha256, bytes: bytes.length };
  const uploaded = await service.storage.from("gtfs-uploads").upload(archive.path, bytes, { contentType: "application/zip", upsert: false });
  assert.equal(uploaded.error, null, "Native Storage upload failed");
  const confirmed = await service.rpc("confirm_gtfs_archive", { p_version: versionId, p_token: null, p_archive: archive });
  assert.equal(confirmed.error, null, "Native upload confirmation failed");
  await writeFile(join(directory, "identity.json"), JSON.stringify({ workspaceId, actorId, feedId, versionId, archive,
    installationId: randomUUID() }), { mode: 0o600 });
  console.log(JSON.stringify({ seeded: true, versionId, feedId }));
} else {
  const identity = JSON.parse(await readFile(join(directory, "identity.json"), "utf8"));
  if (mode === "cleanup") {
    const removed = await service.storage.from("gtfs-uploads").remove([identity.archive.path]);
    assert.equal(removed.error, null, "Native fixture cleanup failed");
  } else {
    const outcome = await runGtfsOwnedAttempt({ directory: join(directory, "commands"),
      installationId: identity.installationId, target: restUrl, versionId: identity.versionId,
      maxCommandBytes: 4 * 1024 * 1024, signal: new AbortController().signal, service,
      work: async owned => {
        workCalls++;
        assert.ok(["interrupt", "interrupt-batch", "resume-batch"].includes(mode), "Recovered terminal attempt reentered processing");
        const result = await processGtfsRetainedArchive({ directory: join(directory, "artifact"),
          installationId: identity.installationId, target: restUrl, parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!,
          service, owned, batchSize: 100, env: {},
          parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384, renewEveryMs: 100,
            renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 } });
        assert.equal(result.summary?.routeCount, 14); assert.equal(result.summary?.stopCount, 287);
        return result.terminal;
      },
    });
    assert.ok(outcome.state === "recovered_terminal" || outcome.state === "finished");
    assert.equal(outcome.state, mode === "resume-batch" ? "finished" : "recovered_terminal");
    assert.equal(workCalls, mode === "resume-batch" ? 1 : 0); assert.equal(downloads, 0);
    assert.equal(outcome.result.retained, mode.startsWith("retained"));
    if (mode !== "resume-batch") {
      const expected = ["claim_gtfs_ingest", "read_gtfs_ingest_attempt"];
      if (mode === "recover") expected.push("complete_gtfs_ingest");
      assert.deepEqual(calls, expected);
    } else {
      assert.equal(calls.filter(name => name === "write_gtfs_ingest_batch").length, 9);
      assert.equal(calls.includes("prepare_gtfs_derived"), false, "Recovery cleared saved rows again");
    }
    const pending = JSON.parse(await readFile(join(directory, "commands/command-terminal/pending.json"), "utf8"));
    const committed = JSON.parse(await readFile(join(directory, "committed-before-kill.json"), "utf8"));
    assert.equal(pending.resolved, true);
    if (mode === "resume-batch" || mode === "retained-batch") {
      const batch = JSON.parse(await readFile(join(directory, "commands/command-route-0/pending.json"), "utf8"));
      assert.equal(batch.commandId, committed.command);
      assert.equal(batch.resolved, true); assert.deepEqual(batch.receipt, committed.receipt);
    } else {
      assert.equal(pending.commandId, committed.command);
      assert.deepEqual(outcome.result.receipt, committed.receipt);
    }
    const artifact = JSON.parse(await readFile(join(directory, "artifact/pending.json"), "utf8"));
    assert.equal((await readdir(join(directory, "artifact"))).filter(name => name.startsWith("parsed-")).length, 1);
    console.log(JSON.stringify({ mode, outcome, calls, downloads, workCalls, terminalCommand: pending.commandId,
      outputSha256: artifact.output.receipt.sha256, maxRssKiB: process.resourceUsage().maxRSS }));
  }
}
