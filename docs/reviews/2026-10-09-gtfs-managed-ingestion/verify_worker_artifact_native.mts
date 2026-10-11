import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withGtfsParsedArtifact } from "../../../openplan/src/lib/gtfs/managed-worker-artifact.ts";
const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const url = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const identity = JSON.parse(process.env.OPENPLAN_PROOF_ARCHIVE_IDENTITY!);
const { workspaceId, feedId, versionId } = identity;
const token = "ec000000-0000-4000-8000-000000000001";
const id = "ec000000-0000-4000-8000-000000000002";
let downloads = 0, renewals = 0;
const delivered: string[] = [];
const service = createClient(url, process.env.OPENPLAN_PROOF_STORAGE_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(input));
    assert.equal(target.origin, new URL(url).origin);
    if (target.pathname === "/rest/v1/rpc/renew_gtfs_ingest") {
      assert.deepEqual(JSON.parse(String(init?.body)), { p_version: versionId, p_token: token });
      renewals++;
      return new Response("true", { headers: { "Content-Type": "application/json" } });
    }
    assert.ok(target.pathname.startsWith("/storage/v1/"));
    assert.equal(init?.method, "GET");
    downloads++;
    target.pathname = target.pathname.slice("/storage/v1".length);
    return fetch(target, init);
  } },
});
const [directory, mode] = process.argv.slice(2);
try {
  const result = await withGtfsParsedArtifact({ directory, installationId: id, target: url,
    parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!, service,
    owned: { signal: new AbortController().signal,
      snapshot: { schemaVersion: 1, versionId, workspaceId, feedId, actorId: id, requestId: id,
        state: "running", stage: "pending", attempts: 1, active: true, prepared: false,
        claim: { token, version_id: versionId, attempt: 1,
          claimed_at: "2026-10-09T12:00:00Z", initial_lease_until: "2026-10-09T12:02:00Z" },
        source: { kind: "url", provisionalName: "Retained public archive",
          sourceUrl: "https://example.invalid/retained.zip", normalizedSourceUrl: "https://example.invalid/retained.zip" },
        archive: { path: identity.storagePath, sha256: identity.checksumSha256, bytes: identity.byteSize },
        archiveConfirmed: false, plan: null, tract: null, completion: null },
      deliver: async (slot, command) => {
        assert.ok(slot === "archive-confirmation" || slot === "parsing");
        delivered.push(command.operation);
        return { commandId: id, receipt: { versionId, stage: "parsing" }, retained: false };
      },
    }, env: {}, parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384,
      renewEveryMs: 100, renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 },
  }, async ({ output, receipt, retained }) => {
    const parsed = JSON.parse(await output.readFile("utf8"));
    assert.equal(parsed.ok, true, "Publisher archive did not parse");
    assert.equal(receipt.parsed, true);
    assert.ok(parsed.feed.routes.length > 0 && parsed.feed.stops.length > 0);
    const summary = { event: "artifact", receipt, retained, downloads, renewals, delivered,
      routes: parsed.feed.routes.length, stops: parsed.feed.stops.length, maxRssKiB: process.resourceUsage().maxRSS };
    if (mode === "crash") {
      console.log(JSON.stringify(summary));
      await new Promise(() => { setInterval(() => {}, 1000); });
    }
    return summary;
  });
  assert.notEqual(mode, "corrupt", "Corrupt artifact was accepted");
  console.log(JSON.stringify(result));
} catch (error) {
  if (mode !== "corrupt") throw error;
  assert.equal((error as Error).message, "GTFS artifact content differs");
  assert.equal(downloads, 0);
  console.log(JSON.stringify({ event: "corruption-refused", downloads }));
}
