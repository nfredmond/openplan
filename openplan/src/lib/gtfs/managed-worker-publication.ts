import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";
import { decodeGtfsParsedArtifact } from "./parsed-artifact";
import { toRouteServiceLevelRows, toStopServiceLevelRows, countDistinctServices, resolveFeedDisplayName } from "./persist";
import { verifyGtfsArchive, verifyGtfsOutputPlan, verifyGtfsCompletionMetadata, writeGtfsBatchCommand, computeGtfsTractsCommand,
  completeGtfsAttemptCommand, failGtfsAttemptCommand, type GtfsBatchManifest } from "./managed-worker-service";
import { withGtfsParsedArtifact, type GtfsArtifactOptions } from "./managed-worker-artifact";
import type { GtfsOwnedWork } from "./managed-worker-attempt";
import type { GtfsFailureCode } from "./types";
import type { GtfsDurableMutation } from "./managed-worker-dispatch";

type Terminal = Extract<GtfsDurableMutation, { operation: "complete" | "fail" }>;
type Artifact = { output: FileHandle; receipt: { byteSize: number; sha256: string; parsed: boolean } };
function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Publish only the rows from the exact retained parser output. Database receipt
 * hashes form the ordered manifest; parser counts remain separate for adoption.
 * Return an explicit terminal request for the ownership coordinator to deliver.
 */
export async function publishGtfsParsedArtifact(owned: GtfsOwnedWork, artifact: Artifact,
  options: { maxOutputBytes: number; batchSize: number }) {
  const batchSize = z.number().int().min(1).max(1000).parse(options.batchSize);
  const bound = z.number().int().positive().max(2_147_483_647).parse(options.maxOutputBytes);
  const receipt = z.object({ byteSize: z.number().int().positive().max(bound),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), parsed: z.boolean() }).strict().parse(artifact.receipt);
  const snapshot = owned.snapshot;
  const scope = { versionId: snapshot.versionId, token: snapshot.claim.token, workspaceId: snapshot.workspaceId,
    feedId: snapshot.feedId, actorId: snapshot.actorId };
  const archive = verifyGtfsArchive(snapshot.archive, scope);
  owned.signal.throwIfAborted();
  const before = await artifact.output.stat();
  requireMatch(before.isFile() && before.size === receipt.byteSize, "GTFS publication artifact size differs");
  const bytes = Buffer.alloc(receipt.byteSize);
  for (let offset = 0; offset < bytes.length;) {
    owned.signal.throwIfAborted();
    const { bytesRead } = await artifact.output.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
    requireMatch(bytesRead > 0, "GTFS publication artifact read is incomplete");
    offset += bytesRead;
  }
  const after = await artifact.output.stat();
  requireMatch(after.size === before.size && after.mtimeMs === before.mtimeMs
    && createHash("sha256").update(bytes).digest("hex") === receipt.sha256, "GTFS publication artifact content differs");
  const parsed = decodeGtfsParsedArtifact(JSON.parse(bytes.toString("utf8")), { parsed: receipt.parsed, archiveBytes: archive.bytes });
  const failure = (code: GtfsFailureCode, detail: string) => {
    failGtfsAttemptCommand(scope, { id: scope.token, code, detail });
    return { terminal: { operation: "fail", input: { code, detail } } satisfies Terminal, summary: null };
  };
  if (!parsed.ok) return failure(parsed.code, parsed.detail);
  const feed = parsed.feed;
  const routeRows = toRouteServiceLevelRows(feed, scope), stopMapping = toStopServiceLevelRows(feed, scope);
  if (routeRows.length === 0 || stopMapping.rows.length === 0) {
    return failure("no_usable_service", "The retained feed has no service levels that can be stored for both routes and placed stops.");
  }
  const plan = verifyGtfsOutputPlan({ sha256: receipt.sha256, bytes: receipt.byteSize,
    routeRows: routeRows.length, stopRows: stopMapping.rows.length,
    routeBatches: Math.ceil(routeRows.length / batchSize), stopBatches: Math.ceil(stopMapping.rows.length / batchSize) });
  const metadata = verifyGtfsCompletionMetadata({ agency_count: feed.agencies.length, route_count: feed.routes.length, stop_count: feed.stops.length,
    trip_count: feed.stats.tripRows, stop_time_row_count: feed.stats.stopTimesRows, calendar_service_count: countDistinctServices(feed),
    frequency_trip_count: feed.stats.frequencyTrips, scheduled_trip_count: feed.stats.scheduledTrips,
    service_start_date: feed.serviceWindow.startDate, service_end_date: feed.serviceWindow.endDate,
    feed_info_version: feed.feedInfo?.version ?? null, feed_info_publisher_name: feed.feedInfo?.publisherName ?? null,
    feed_info_start_date: feed.feedInfo?.startDate ?? null, feed_info_end_date: feed.feedInfo?.endDate ?? null, parse_warnings: feed.warnings });
  owned.signal.throwIfAborted();
  await owned.deliver("prepare-output", { operation: "prepare_output", input: plan });
  const manifest: GtfsBatchManifest = [];
  for (const [kind, allRows] of [["route", routeRows], ["stop", stopMapping.rows]] as const) {
    for (let offset = 0, ordinal = 0; offset < allRows.length; offset += batchSize, ordinal++) {
      owned.signal.throwIfAborted();
      const input = { kind, ordinal, rows: allRows.slice(offset, offset + batchSize) };
      const delivered = await owned.deliver(`${kind}-${ordinal}`, { operation: "batch", input });
      const checked = writeGtfsBatchCommand(scope, { ...input, id: delivered.commandId }).verify(delivered.receipt);
      manifest.push({ kind, ordinal, rows: checked.rows, hash: checked.hash });
    }
  }
  owned.signal.throwIfAborted();
  const computed = await owned.deliver("tracts", { operation: "tracts", input: { plan, manifest } });
  const tract = computeGtfsTractsCommand(scope, { id: computed.commandId, plan, manifest }).verify(computed.receipt);

  const input = { archive, plan, manifest, metadata, tract };
  completeGtfsAttemptCommand(scope, { ...input, id: scope.token });
  owned.signal.throwIfAborted();
  return { terminal: { operation: "complete", input } satisfies Terminal,
    summary: { routeCount: feed.routes.length, stopCount: feed.stops.length, displayName: resolveFeedDisplayName(feed),
      routeServiceLevelRows: routeRows.length, stopServiceLevelRows: stopMapping.rows.length,
      droppedForMissingCoordinates: stopMapping.droppedForMissingCoordinates } };
}

export function processGtfsRetainedArchive(options: GtfsArtifactOptions & { batchSize: number }) {
  const batchSize = z.number().int().min(1).max(1000).parse(options.batchSize);
  const maxOutputBytes = options.parser.maxOutputBytes;
  return withGtfsParsedArtifact(options, (artifact, signal) => publishGtfsParsedArtifact({ ...options.owned, signal }, artifact,
    { maxOutputBytes, batchSize }));
}
