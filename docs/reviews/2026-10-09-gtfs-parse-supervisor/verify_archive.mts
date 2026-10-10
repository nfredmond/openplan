import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { superviseGtfsParse } from "../../../openplan/src/lib/gtfs/parse-supervisor";
import { parseGtfsFeed } from "../../../openplan/src/lib/gtfs/parse";
import { resolveGtfsLimits } from "../../../openplan/src/lib/gtfs/limits";

const [archivePath, proofDirectory] = process.argv.slice(2);
assert(archivePath && proofDirectory, "Provide a retained archive and a new proof directory");
await mkdir(proofDirectory, { mode: 0o700 });
const source = await readFile(archivePath);
const identity = { byteSize: source.length, checksumSha256: createHash("sha256").update(source).digest("hex") };
const archive = await open(archivePath, "r"), outputPath = path.join(proofDirectory, "parsed.json");
const output = await open(outputPath, "wx+", 0o600);
const renewals: string[] = [];
const limits = resolveGtfsLimits({});
try {
  const result = await superviseGtfsParse({ archive, output, ...identity, limits,
    maxOutputBytes: 16 * 1024 * 1024, maxOldSpaceMb: 512,
    renewEveryMs: 50, renewTimeoutMs: 1000, maxRuntimeMs: 60_000, terminationGraceMs: 500,
    signal: new AbortController().signal,
    renew: async () => { renewals.push(new Date().toISOString()); return true; },
  });
  assert.equal(result.ok, true, "Supervised parser did not retain a result");
  const independent = await parseGtfsFeed(source, { limits });
  assert.equal(independent.ok, true, "Publisher fixture did not parse directly");
  const retained = JSON.parse(await readFile(outputPath, "utf8")) as typeof independent;
  assert.equal(retained.ok, true);
  assert(Number.isFinite(retained.feed.stats.elapsedMs) && retained.feed.stats.elapsedMs >= 0);
  // Duration differs across processes. All source and derived values must match.
  assert.deepEqual({ ...retained, feed: { ...retained.feed, stats: { ...retained.feed.stats, elapsedMs: 0 } } },
    { ...independent, feed: { ...independent.feed, stats: { ...independent.feed.stats, elapsedMs: 0 } } });
  assert(renewals.length >= 3, "No renewal between admission and final confirmation was observed");
  const record = { checkedAt: new Date().toISOString(), archive: identity, output: result.receipt,
    routes: retained.feed.routes.length, stops: retained.feed.stops.length,
    trips: retained.feed.stats.tripRows, renewals,
    boundary: "Actual parser child and retained local bytes; renewal is a controlled callback, not a database lease. No import route, queue, Storage custody, publication or planner journey is exercised." };
  await writeFile(path.join(proofDirectory, "result.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(record));
} finally { await archive.close(); await output.close(); }
