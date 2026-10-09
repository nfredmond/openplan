import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const app = process.cwd();
const require = createRequire(app + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { readRetainedGtfsArchive } = await import(process.env.OPENPLAN_PROOF_ARCHIVE_MODULE ?? app + "/src/lib/gtfs/retained-archive.ts");
const { parseGtfsFeed } = await import(app + "/src/lib/gtfs/parse.ts");
const url = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const client = createClient(url, process.env.OPENPLAN_PROOF_STORAGE_TOKEN!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(input));
    assert.equal(target.origin, new URL(url).origin);
    assert.ok(target.pathname.startsWith('/storage/v1/'));
    target.pathname = target.pathname.slice('/storage/v1'.length);
    return fetch(target, init);
  } },
});
const phase = process.argv[2];
if (phase === 'seed') {
  const bytes = readFileSync(process.argv[3]);
  const workspaceId = randomUUID(), feedId = randomUUID(), versionId = randomUUID();
  const identity = { workspaceId, feedId, versionId, storagePath: `${workspaceId}/${feedId}/${versionId}.zip`,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length };
  const uploaded = await client.storage.from('gtfs-uploads').upload(identity.storagePath, bytes, { contentType: 'application/zip', upsert: false });
  assert.equal(uploaded.error, null, 'Native fixture upload failed');
  console.log(JSON.stringify(identity));
} else {
  const identity = JSON.parse(process.env.OPENPLAN_PROOF_ARCHIVE_IDENTITY!);
  if (phase === 'cleanup') {
    const removed = await client.storage.from('gtfs-uploads').remove([identity.storagePath]);
    assert.equal(removed.error, null, 'Native fixture cleanup failed');
  } else {
    assert.equal(phase, 'recover');
    const recovered = await readRetainedGtfsArchive(client, identity);
    assert.equal(recovered.ok, true, 'Native retained archive recovery failed');
    const parsed = await parseGtfsFeed(recovered.bytes);
    assert.equal(parsed.ok, true, 'Recovered publisher archive did not parse');
    assert.ok(parsed.feed.routes.length > 0 && parsed.feed.stops.length > 0);
    const changed = Uint8Array.from(recovered.bytes);
    changed[changed.length - 1] ^= 1;
    const replaced = await client.storage.from('gtfs-uploads').upload(identity.storagePath, changed, { contentType: 'application/zip', upsert: true });
    assert.equal(replaced.error, null, 'Native corruption fixture failed');
    const mismatch = await readRetainedGtfsArchive(client, identity);
    assert.deepEqual(mismatch, { ok: false, code: 'archive_mismatch' }, 'Changed archive was accepted');
    const restored = await client.storage.from('gtfs-uploads').upload(identity.storagePath, recovered.bytes, { contentType: 'application/zip', upsert: true });
    assert.equal(restored.error, null, 'Native fixture restoration failed');
    assert.equal((await readRetainedGtfsArchive(client, identity)).ok, true);
    const removed = await client.storage.from('gtfs-uploads').remove([identity.storagePath]);
    assert.equal(removed.error, null);
    const missing = await readRetainedGtfsArchive(client, identity);
    assert.deepEqual(missing, { ok: false, code: 'archive_unavailable' });
    console.log(JSON.stringify({ identity, recoveredAcrossProcesses: true, alteredObjectRefused: true,
      restoredObjectReadable: true, missingObjectUnavailable: true,
      parsedRoutes: parsed.feed.routes.length, parsedStops: parsed.feed.stops.length,
      maxRssKiB: process.resourceUsage().maxRSS }));
  }
}
