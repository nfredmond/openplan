import { constants } from "node:fs";
import { open, link, unlink, type FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import type { GtfsOwnedWork } from "./managed-worker-attempt";
import { verifyGtfsAttempt, verifyGtfsArchive, renewGtfsAttempt } from "./managed-worker-service";
import { readRetainedGtfsArchive } from "./retained-archive";
import { resolveGtfsLimits, type GtfsLimitEnv } from "./limits";
import { superviseGtfsParse, type GtfsParseProcessOptions } from "./parse-supervisor";

const id = z.string().uuid();
const positive = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ byteSize: positive, sha256: hash, parsed: z.boolean() }).strict();
const bindingSchema = z.object({ schemaVersion: z.literal(1), installationId: id, target: z.string(),
  versionId: id, token: id, workspaceId: id, feedId: id, actorId: id,
  parserBuild: z.string().regex(/^[a-f0-9]{40,64}$/), limits: z.record(z.string(), positive),
  maxOutputBytes: positive, archive: z.object({ path: z.string(), sha256: hash, bytes: positive }).strict(),
}).strict();
const savedSchema = z.object({ binding: bindingSchema,
  output: z.object({ name: z.string().regex(/^parsed-[a-f0-9-]{36}\.json$/), receipt: receiptSchema }).strict().nullable(),
}).strict();

export type GtfsArtifactOptions = {
  directory: string; installationId: string; target: string;
  /** Exact deployed parser build, supplied by the worker installation. */
  parserBuild: string;
  owned: GtfsOwnedWork;
  service: Pick<SupabaseClient, "rpc" | "storage">;
  env?: GtfsLimitEnv;
  parser: Pick<GtfsParseProcessOptions, "maxOutputBytes" | "maxOldSpaceMb" | "renewEveryMs" |
    "renewTimeoutMs" | "maxRuntimeMs" | "terminationGraceMs">;
};

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function syncDirectory(directory: string) {
  const file = await open(directory, "r");
  try { await file.sync(); } finally { await file.close(); }
}

/** Open one private regular file, hash its actual bytes, and retain that same
 * descriptor for consumption. A missing or changed saved artifact is an error,
 * never permission to silently regenerate published output.
 */
async function checkedFile(path: string, expected: { bytes: number; sha256: string }, signal: AbortSignal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    requireMatch(before.isFile() && before.uid === process.getuid?.() && (before.mode & 0o077) === 0,
      "GTFS artifact file is not private");
    requireMatch(before.size === expected.bytes, "GTFS artifact size differs");
    const digest = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < before.size;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      requireMatch(bytesRead > 0, "GTFS artifact read is incomplete");
      digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await file.stat();
    requireMatch(after.size === before.size && after.mtimeMs === before.mtimeMs && digest.digest("hex") === expected.sha256,
      "GTFS artifact content differs");
    signal.throwIfAborted();
    return file;
  } catch (error) { await file.close(); throw error; }
}

/** Connect retained Storage bytes and the supervised parser within an owned
 * attempt. Keep this directory separate from the command journal. The caller
 * must await consumption; only a validated database completion may publish it.
 */
export async function withGtfsParsedArtifact<T>(options: GtfsArtifactOptions,
  consume: (artifact: { output: FileHandle; receipt: z.infer<typeof receiptSchema>; retained: boolean }, signal: AbortSignal) => Promise<T>) {
  const { owned, service, directory } = options;
  const snapshot = verifyGtfsAttempt(owned.snapshot, { versionId: owned.snapshot.versionId, token: owned.snapshot.claim.token });
  requireMatch(snapshot.state === "running" && snapshot.active && snapshot.archive !== null,
    "GTFS artifact needs an active retained archive");
  const archive = verifyGtfsArchive(snapshot.archive, snapshot);
  const limits = resolveGtfsLimits(options.env);
  const target = new URL(options.target);
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "GTFS artifact target is invalid");
  const binding = bindingSchema.parse({ schemaVersion: 1, installationId: options.installationId,
    target: target.href.replace(/\/$/, ""), versionId: snapshot.versionId, token: snapshot.claim.token,
    workspaceId: snapshot.workspaceId, feedId: snapshot.feedId, actorId: snapshot.actorId,
    archive, limits, parserBuild: options.parserBuild, maxOutputBytes: options.parser.maxOutputBytes });
  requireMatch(archive.bytes <= limits.maxArchiveBytes, "GTFS artifact archive exceeds configured bound");
  owned.signal.throwIfAborted();
  const lock = await acquireConnectorLock(directory);
  const ending = new AbortController(), signal = AbortSignal.any([owned.signal, lock.signal, ending.signal]);
  let input: FileHandle | undefined, output: FileHandle | undefined;
  const renew = (otherSignal: AbortSignal) => renewGtfsAttempt(service,
    { versionId: snapshot.versionId, token: snapshot.claim.token }, AbortSignal.any([signal, otherSignal]));
  try {
    signal.throwIfAborted();
    requireMatch(await renew(signal), "GTFS artifact ownership is unconfirmed");
    let saved: z.infer<typeof savedSchema>;
    try { saved = savedSchema.parse(await readPrivateJson(join(directory, "pending.json"), 65536)); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      saved = { binding, output: null };
      await writeConnectorJournal(directory, saved);
    }
    requireMatch(isDeepStrictEqual(saved.binding, binding), "GTFS artifact binding differs");
    signal.throwIfAborted();
    const archivePath = join(directory, "archive.zip");
    try { input = await checkedFile(archivePath, archive, signal); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT") || saved.output) throw error;
      const read = await readRetainedGtfsArchive(service, { workspaceId: snapshot.workspaceId,
        feedId: snapshot.feedId, versionId: snapshot.versionId, storagePath: archive.path,
        checksumSha256: archive.sha256, byteSize: archive.bytes }, { signal, env: options.env });
      requireMatch(read.ok, "GTFS retained archive could not be verified");
      signal.throwIfAborted();
      const temporary = join(directory, `archive-${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(read.bytes); await file.sync(); } finally { await file.close(); }
      signal.throwIfAborted();
      // Exclusive link refuses an unexpected object at the destination.
      await link(temporary, archivePath); await unlink(temporary); await syncDirectory(directory);
      input = await checkedFile(archivePath, archive, signal);
    }
    await owned.deliver("archive-confirmation", { operation: "confirm_archive", input: archive });
    const retained = saved.output !== null;
    if (!saved.output) {
      await owned.deliver("parsing", { operation: "stage", input: "parsing" });
      const name = `parsed-${randomUUID()}.json`;
      const writing = await open(join(directory, name), "wx+", 0o600);
      try {
        const result = await superviseGtfsParse({ ...options.parser, archive: input, output: writing,
          byteSize: archive.bytes, checksumSha256: archive.sha256, limits, signal, renew });
        requireMatch(result.ok, "GTFS artifact parsing was interrupted");
        const receipt = receiptSchema.parse(result.receipt);
        requireMatch(receipt.byteSize <= binding.maxOutputBytes, "GTFS artifact output exceeds configured bound");
        signal.throwIfAborted();
        await writing.sync(); await syncDirectory(directory);
        saved = { binding, output: { name, receipt } };
        await writeConnectorJournal(directory, saved);
      } finally { await writing.close(); }
    }
    const complete = saved.output!;
    requireMatch(complete.receipt.byteSize <= binding.maxOutputBytes, "GTFS saved output exceeds configured bound");
    output = await checkedFile(join(directory, complete.name),
      { bytes: complete.receipt.byteSize, sha256: complete.receipt.sha256 }, signal);
    signal.throwIfAborted();
    return await consume({ output, receipt: structuredClone(complete.receipt), retained }, signal);
  } finally {
    ending.abort();
    await output?.close(); await input?.close(); await lock.release();
  }
}
