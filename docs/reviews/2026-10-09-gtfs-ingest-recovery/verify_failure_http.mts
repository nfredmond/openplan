import assert from "node:assert/strict";
import { createRequire } from "node:module";
const app = process.cwd();
const require = createRequire(app + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("../../../openplan/node_modules/@supabase/supabase-js");
const { reapAbandonedGtfsIngests, markGtfsFeedVersionStage, failGtfsFeedVersion } = await import(app + "/src/lib/gtfs/persist.ts");
const url = process.env.OPENPLAN_PROOF_HTTP_URL!;
const token = process.env.OPENPLAN_PROOF_HTTP_TOKEN!;
const schema = process.env.OPENPLAN_PROOF_HTTP_SCHEMA!;
let closureAttempts = 0;
let storageAttempts = 0;
let nativeStageRefusals = 0;
let acknowledgmentAttempts = 0;
const fault = process.env.OPENPLAN_PROOF_FAILURE ?? "storage";
assert.ok(["storage", "acknowledgment"].includes(fault));
const client = createClient(url, token, {
  db: { schema }, auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const target = new URL(String(input));
    if (target.pathname.startsWith("/storage/")) {
      if ((init?.method ?? "GET") === "DELETE") {
        storageAttempts++;
        if (fault === "storage" && storageAttempts === 1) return new Response(JSON.stringify({ statusCode: "503", error: "unavailable", message: "injected Storage interruption" }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      if (process.env.OPENPLAN_PROOF_STORAGE_URL) {
        const native = new URL(process.env.OPENPLAN_PROOF_STORAGE_URL);
        native.pathname = target.pathname.replace(/^\/storage\/v1/, "");
        native.search = target.search;
        const headers = new Headers(init?.headers);
        headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN);
        headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
        return fetch(native, { ...init, headers });
      }
      return new Response("[]", { status: 200 });
    }
    if (target.pathname.endsWith("/gtfs_ingest_storage_cleanup") && init?.method === "DELETE") {
      acknowledgmentAttempts++;
      if (fault === "acknowledgment" && acknowledgmentAttempts === 1) {
        return new Response(JSON.stringify({ message: "injected acknowledgment interruption" }), { status: 503 });
      }
    }
    target.pathname = target.pathname.replace(/^\/rest\/v1/, "");
    const response = await fetch(target, init);
    if (target.pathname.endsWith("/rpc/close_failed_gtfs_version")) {
      closureAttempts++;
      assert.equal(response.status, 200);
      assert.deepEqual(await response.clone().json(), { recorded: true, feedStatusChanged: true });
      if (closureAttempts === 1) return new Response(JSON.stringify({ message: "injected lost closure reply" }), { status: 503 });
    }
    if (init?.method === "PATCH") {
      assert.equal((await response.clone().json()).code, "55000");
      nativeStageRefusals++;
    }
    return response;
  } },
});
const objectPath = process.env.OPENPLAN_PROOF_OBJECT_PATH;
if (objectPath) {
  const bytes = new TextEncoder().encode("Synthetic GTFS cleanup bytes");
  const uploaded = await client.storage.from("gtfs-uploads").upload(objectPath, bytes, { contentType: "application/zip", upsert: false });
  assert.equal(uploaded.error, null);
  const downloaded = await client.storage.from("gtfs-uploads").download(objectPath);
  assert.equal(downloaded.error, null);
  assert.equal(await downloaded.data!.text(), "Synthetic GTFS cleanup bytes");
}
const close = () => failGtfsFeedVersion({ service: client, versionId: process.env.OPENPLAN_PROOF_VERSION_ID!, code: "partial_write", detail: "Synthetic interrupted normal ingest", storagePath: objectPath });
assert.deepEqual(await close(), { recorded: false, feedStatusChanged: false });
assert.deepEqual(await close(), { recorded: true, feedStatusChanged: true });
assert.deepEqual(await close(), { recorded: true, feedStatusChanged: true });
assert.equal(closureAttempts, 3);
const pending = await client.from("gtfs_ingest_storage_cleanup").select("version_id,storage_path");
assert.equal(pending.error, null);
assert.deepEqual(pending.data, [{ version_id: process.env.OPENPLAN_PROOF_VERSION_ID, storage_path: objectPath }]);
await assert.rejects(reapAbandonedGtfsIngests(client), /injected (Storage|acknowledgment) interruption/);
assert.equal(storageAttempts, 1);
const second = await reapAbandonedGtfsIngests(client);
assert.equal(second.scanned, 0);
assert.equal(second.reaped.length, 0);
assert.equal(storageAttempts, 2);
assert.equal(await markGtfsFeedVersionStage(client, process.env.OPENPLAN_PROOF_VERSION_ID!, "parsing"), false);
assert.equal(nativeStageRefusals, 1);
const third = await reapAbandonedGtfsIngests(client);
assert.equal(third.scanned, 0);
assert.equal(storageAttempts, 2);
if (objectPath) {
  const missing = await client.storage.from("gtfs-uploads").download(objectPath);
  assert.ok(missing.error);
  assert.equal(missing.error.statusCode, "404");
}
console.log(JSON.stringify({ closureAttempts, second, third, storageAttempts, nativeStageRefusals, fault, nativeObjectUploadedAndRemoved: Boolean(objectPath), finding: "normal closure survives lost reply; pending removal retries after Storage interruption", scope: objectPath ? "native TypeScript, PostgREST and private Storage; one cleanup boundary interrupted with injected 503" : "native TypeScript and PostgREST; simulated Storage" }, null, 2));
