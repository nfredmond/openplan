import { constants } from "node:fs";
import { open, link, unlink, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { fetchGtfsFeedBytes, type GtfsFetchOptions } from "./fetch";
import { resolveGtfsLimits } from "./limits";
import { GTFS_UPLOADS_BUCKET } from "./persist";
import { readRetainedGtfsArchive } from "./retained-archive";
import { readGtfsAttempt, verifyGtfsAttempt, verifyGtfsArchive } from "./managed-worker-service";
import { processGtfsRetainedArchive } from "./managed-worker-publication";
import type { GtfsArtifactOptions } from "./managed-worker-artifact";
import type { GtfsOwnedWork } from "./managed-worker-attempt";

const positive = z.number().int().positive().safe();
const archiveSchema = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: positive }).strict();
const savedSchema = z.object({ binding: z.json(), archive: archiveSchema.nullable(),
  provenance: z.object({ finalUrl: z.string(), hops: z.array(z.string()), httpStatus: positive,
    contentType: z.string().nullable() }).strict().nullable() }).strict();

export type GtfsIntakeOptions = {
  /** Version-scoped private directory, shared by replacement attempts. */
  directory: string; installationId: string; target: string;
  owned: GtfsOwnedWork; service: GtfsArtifactOptions["service"];
  /** Kept in memory only. Never retained in the source journal. */
  serviceKey: string;
  storageFetch?: typeof fetch;
  fetchOptions?: Omit<GtfsFetchOptions, "signal">;
  uploadTimeoutMs?: number;
};

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
function absent(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function syncDirectory(directory: string) {
  const descriptor = await open(directory, "r");
  try { await descriptor.sync(); } finally { await descriptor.close(); }
}

/** Carry cancellation into the SDK's actual upload transport. The installed
 * upload helper does not forward an AbortSignal in its file options.
 */
export function gtfsIntakeStorage(target: string, key: string, signal: AbortSignal, transport: typeof fetch = fetch) {
  return createClient(target, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      signal.throwIfAborted();
      const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const active = inherited ? AbortSignal.any([signal, inherited]) : signal;
      return transport(input, { ...init, signal: active });
    } } });
}

/** Bound acknowledgement even if a custom transport ignores cancellation.
 * A late write remains unknown and subject to immutable-key reconciliation.
 */
async function whileActive<T>(operation: PromiseLike<T>, signal: AbortSignal) {
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Read and hash the same private descriptor used for upload. A complete linked
 * file can survive a crash before its receipt; a saved receipt cannot authorize
 * regenerating missing bytes from a mutable publisher URL.
 */
async function localBytes(path: string, maxBytes: number, signal: AbortSignal) {
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat();
    requireMatch(before.isFile() && before.uid === process.getuid?.() && (before.mode & 0o077) === 0,
      "GTFS source file is not private");
    requireMatch(before.size > 0 && before.size <= maxBytes, "GTFS source size exceeds configured bound");
    const bytes = Buffer.alloc(before.size);
    for (let offset = 0; offset < bytes.length;) {
      signal.throwIfAborted();
      const result = await descriptor.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      requireMatch(result.bytesRead > 0, "GTFS source read is incomplete");
      offset += result.bytesRead;
    }
    const after = await descriptor.stat();
    requireMatch(after.size === before.size && after.mtimeMs === before.mtimeMs, "GTFS source changed while reading");
    signal.throwIfAborted();
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { await descriptor.close(); }
}

/** Save exact source bytes before preparing a database archive or uploading.
 * Recovery uses a version-scoped binding without a claim token, so replacement
 * attempts reuse the same source while database commands remain attempt-bound.
 */
export async function prepareGtfsSourceArchive(options: GtfsIntakeOptions) {
  const { owned, service, directory } = options;
  const snapshot = verifyGtfsAttempt(owned.snapshot, { versionId: owned.snapshot.versionId, token: owned.snapshot.claim.token });
  requireMatch(snapshot.active && snapshot.state === "running", "GTFS intake needs an active attempt");
  const target = new URL(options.target);
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "GTFS intake target is invalid");
  const normalizedTarget = target.href.replace(/\/$/, "");
  const binding = z.json().parse({ schemaVersion: 1, installationId: z.string().uuid().parse(options.installationId),
    target: normalizedTarget, versionId: snapshot.versionId, workspaceId: snapshot.workspaceId,
    feedId: snapshot.feedId, actorId: snapshot.actorId, requestId: snapshot.requestId, source: snapshot.source });
  const limits = resolveGtfsLimits(options.fetchOptions?.env);
  const timeoutMs = z.number().int().positive().max(2_147_483_647).parse(
    Math.min(options.uploadTimeoutMs ?? limits.parseBudgetMs, limits.parseBudgetMs));
  owned.signal.throwIfAborted();
  const lock = await acquireConnectorLock(directory);
  const ending = new AbortController(), signal = AbortSignal.any([owned.signal, lock.signal, ending.signal]);
  const save = async (record: z.infer<typeof savedSchema>) => {
    signal.throwIfAborted();
    requireMatch(Buffer.byteLength(JSON.stringify(record)) <= 65536, "GTFS source record exceeds configured bound");
    await writeConnectorJournal(directory, record);
    signal.throwIfAborted();
  };
  try {
    signal.throwIfAborted();
    let saved: z.infer<typeof savedSchema>;
    try { saved = savedSchema.parse(await readPrivateJson(join(directory, "pending.json"), 65536)); }
    catch (error) {
      if (!absent(error)) throw error;
      try {
        await lstat(join(directory, "archive.zip"));
        throw new Error("GTFS source file has no binding");
      } catch (existing) { if (!absent(existing)) throw existing; }
      saved = { binding, archive: null, provenance: null };
      await save(saved);
    }
    requireMatch(isDeepStrictEqual(saved.binding, binding), "GTFS source binding differs");
    const path = `${snapshot.workspaceId}/${snapshot.feedId}/${snapshot.versionId}.zip`;
    const localPath = join(directory, "archive.zip");
    let local;
    try { local = await localBytes(localPath, limits.maxArchiveBytes, signal); }
    catch (error) {
      if (!absent(error) || saved.archive) throw error;
      let bytes: Uint8Array;
      if (snapshot.archive) {
        const read = await readRetainedGtfsArchive(service, { workspaceId: snapshot.workspaceId, feedId: snapshot.feedId,
          versionId: snapshot.versionId, storagePath: snapshot.archive.path, checksumSha256: snapshot.archive.sha256,
          byteSize: snapshot.archive.bytes }, { signal, env: options.fetchOptions?.env });
        requireMatch(read.ok, "GTFS prepared source cannot be recovered from Storage");
        bytes = read.bytes;
      } else {
        requireMatch(snapshot.source.kind !== "upload", "GTFS uploaded source is not retained");
        await owned.deliver("fetching", { operation: "stage", input: "fetching" });
        const fetched = await fetchGtfsFeedBytes(snapshot.source.sourceUrl!, { ...options.fetchOptions, signal });
        if (!fetched.ok) return { ok: false as const, terminal: { operation: "fail" as const,
          input: { code: fetched.code, detail: fetched.detail } } };
        bytes = fetched.bytes;
        saved.provenance = { finalUrl: fetched.finalUrl, hops: fetched.hops, httpStatus: fetched.httpStatus, contentType: fetched.contentType };
        // Retain provenance before publishing the complete local file.
        await save(saved);
      }
      signal.throwIfAborted();
      const temporary = join(directory, `source-${randomUUID()}.tmp`);
      try {
        const writing = await open(temporary, "wx", 0o600);
        try { await writing.writeFile(bytes); await writing.sync(); } finally { await writing.close(); }
        signal.throwIfAborted();
        await link(temporary, localPath);
        await syncDirectory(directory);
      } finally { await unlink(temporary).catch(error => { if (!absent(error)) throw error; }); }
      local = await localBytes(localPath, limits.maxArchiveBytes, signal);
    }
    const archive = verifyGtfsArchive({ path, sha256: local.sha256, bytes: local.bytes.length }, snapshot);
    requireMatch(!saved.archive || isDeepStrictEqual(saved.archive, archive), "GTFS saved source bytes differ");
    requireMatch(!snapshot.archive || isDeepStrictEqual(snapshot.archive, archive), "GTFS prepared source bytes differ");
    saved.archive = archive;
    await save(saved);
    signal.throwIfAborted();
    await owned.deliver("archive-preparation", { operation: "prepare_archive", input: archive });

    const identity = { workspaceId: snapshot.workspaceId, feedId: snapshot.feedId, versionId: snapshot.versionId,
      storagePath: archive.path, checksumSha256: archive.sha256, byteSize: archive.bytes };
    let remote = await readRetainedGtfsArchive(service, identity, { signal, env: options.fetchOptions?.env });
    signal.throwIfAborted();
    requireMatch(remote.ok || remote.code === "archive_unavailable", "GTFS immutable archive differs or is unconfirmed");
    if (!remote.ok) {
      const timeout = new AbortController(), uploadSignal = AbortSignal.any([signal, timeout.signal]);
      const timer = setTimeout(() => timeout.abort(new Error("GTFS upload acknowledgement unavailable")), timeoutMs);
      try {
        const upload = gtfsIntakeStorage(normalizedTarget, options.serviceKey, uploadSignal, options.storageFetch);
        // Never update or overwrite this key, including after an uncertain reply.
        await whileActive(upload.storage.from(GTFS_UPLOADS_BUCKET).upload(archive.path, local.bytes,
          { contentType: "application/zip", upsert: false }), uploadSignal);
      } catch {
        signal.throwIfAborted();
        // An upload error is neither failure nor success. Inspect actual bytes.
      } finally { clearTimeout(timer); timeout.abort(); }
      remote = await readRetainedGtfsArchive(service, identity, { signal, env: options.fetchOptions?.env });
    }
    signal.throwIfAborted();
    requireMatch(remote.ok, "GTFS uploaded archive is unconfirmed");
    await owned.deliver("archive-confirmation", { operation: "confirm_archive", input: archive });
    const refreshed = await readGtfsAttempt(service, { versionId: snapshot.versionId, token: snapshot.claim.token }, signal);
    requireMatch(refreshed.active && refreshed.state === "running" && refreshed.archiveConfirmed
      && isDeepStrictEqual(refreshed.claim, snapshot.claim) && isDeepStrictEqual(refreshed.archive, archive)
      && isDeepStrictEqual({ ...refreshed, stage: snapshot.stage, archive: snapshot.archive,
        archiveConfirmed: snapshot.archiveConfirmed }, snapshot), "GTFS refreshed intake scope differs");
    signal.throwIfAborted();
    return { ok: true as const, owned: { ...owned, snapshot: refreshed }, archive };
  } finally { ending.abort(); await lock.release(); }
}

/** Join source custody to the existing parser and guarded row publication.
 * Source and parser directories have separate locks and recovery records.
 */
export async function processGtfsSourceArchive(options: GtfsIntakeOptions & {
  artifact: Omit<GtfsArtifactOptions, "owned" | "service" | "installationId" | "target" | "env">;
  batchSize: number;
}) {
  requireMatch(options.directory !== options.artifact.directory, "GTFS intake and parser directories must differ");
  const intake = await prepareGtfsSourceArchive(options);
  if (!intake.ok) return { terminal: intake.terminal, summary: null };
  return processGtfsRetainedArchive({ ...options.artifact, batchSize: options.batchSize, owned: intake.owned,
    service: options.service, installationId: options.installationId, target: options.target, env: options.fetchOptions?.env });
}
