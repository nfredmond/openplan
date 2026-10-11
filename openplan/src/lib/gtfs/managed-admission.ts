import { constants } from "node:fs";
import { open, link, unlink, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { normalizeGtfsSourceUrl } from "./ingest";
import { resolveGtfsLimits, type GtfsLimitEnv } from "./limits";
import { gtfsIntakeStorage } from "./managed-worker-intake";
import { sendGtfsPreparedCommand, readGtfsStatus } from "./managed-worker-service";
import { GTFS_UPLOADS_BUCKET } from "./persist";
import { readRetainedGtfsArchive } from "./retained-archive";
import type { GtfsArtifactOptions } from "./managed-worker-artifact";

const id = z.string().uuid().transform(value => value.toLowerCase());
const positive = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bytesSchema = z.object({ sha256: hash, bytes: positive }).strict();
const sourceSchema = z.object({ kind: z.enum(["url", "catalog", "upload"]), provisionalName: z.string().trim().min(1).max(120),
  sourceUrl: z.string().nullable().optional(), normalizedSourceUrl: z.string().nullable().optional(),
  catalogProvider: z.string().nullable().optional(), catalogSourceId: z.string().nullable().optional(),
  catalogRowStatus: z.string().nullable().optional(), uploadSha256: hash.nullable().optional(), uploadBytes: positive.nullable().optional() }).strict();
const responseSchema = z.object({ requestId: id, feedId: id, versionId: id, createdFeed: z.boolean() }).strict();
const scopeSchema = z.object({ workspaceId: id, actorId: id, requestId: id }).strict();
const resolvedSchema = z.object({ feedId: id.nullable(), source: sourceSchema }).strict();
const bindingSchema = scopeSchema.extend({ schemaVersion: z.literal(1), target: z.string(), installationId: id, intent: z.json() }).strict();
const savedSchema = z.object({ binding: bindingSchema, resolved: resolvedSchema.nullable(), archive: bytesSchema.nullable(), response: responseSchema.nullable() }).strict();
export type GtfsSavedSubmission = z.infer<typeof savedSchema>;

export type GtfsAdmissionSource = z.infer<typeof sourceSchema>;
export type GtfsAdmissionResponse = z.infer<typeof responseSchema>;
export type GtfsAdmissionOptions = {
  directory: string; target: string; installationId: string; workspaceId: string; actorId: string; requestId: string;
  /** Exact route-validated user intent, retained before resolving mutable catalogs. */
  intent: unknown; signal: AbortSignal; service: GtfsArtifactOptions["service"];
  serviceKey: string; storageFetch?: typeof fetch; env?: GtfsLimitEnv; uploadTimeoutMs?: number;
  /** Uploaded bytes, if present. A retained request can recover its saved bytes
   * without another client upload. Different supplied bytes remain a refusal. */
  upload?: Uint8Array;
  resolve: (archive: z.infer<typeof bytesSchema> | null) => Promise<z.infer<typeof resolvedSchema>>;
};

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
function absent(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
function checkedSource(raw: unknown) {
  const source = sourceSchema.parse(raw);
  if (source.kind === "upload") {
    requireMatch(source.sourceUrl == null && source.normalizedSourceUrl == null && source.uploadSha256 != null && source.uploadBytes != null,
      "GTFS uploaded admission source differs");
  } else {
    requireMatch(typeof source.sourceUrl === "string" && !!normalizeGtfsSourceUrl(source.sourceUrl)
      && normalizeGtfsSourceUrl(source.sourceUrl) === source.normalizedSourceUrl
      && source.uploadSha256 == null && source.uploadBytes == null, "GTFS resolved admission source differs");
    requireMatch(source.kind !== "catalog" || !!source.catalogSourceId?.trim(), "GTFS admission catalog identity missing");
  }
  return source;
}

/** Read private retained intent for unattended recovery. This record grants no
 * write authority; recovery must recheck the original actor before admission.
 */
export async function readGtfsSavedSubmission(directory: string): Promise<GtfsSavedSubmission> {
  const saved = savedSchema.parse(await readPrivateJson(join(directory, "pending.json"), 65536));
  if (saved.resolved) checkedSource(saved.resolved.source);
  return saved;
}

/** Admission creates the existing feed/version identity. A receipt alone does
 * not establish Storage custody, processing, adoption or current permissions.
 */
export function gtfsAdmissionCommand(scope: { workspaceId: string; actorId: string; requestId: string }, raw: { feedId: string | null; source: GtfsAdmissionSource }) {
  const identity = scopeSchema.parse(scope), resolved = resolvedSchema.parse(raw), source = checkedSource(resolved.source);
  const args = { p_request: identity.requestId, p_workspace: identity.workspaceId, p_actor: identity.actorId, p_feed: resolved.feedId, p_source: source };
  return { name: "admit_gtfs_ingest" as const, args, verify(rawResponse: unknown) {
    const receipt = responseSchema.parse(rawResponse);
    requireMatch(receipt.requestId === identity.requestId && receipt.createdFeed === (resolved.feedId === null)
      && (resolved.feedId === null || resolved.feedId === receipt.feedId), "GTFS admission receipt scope differs");
    return receipt;
  } };
}

async function syncDirectory(directory: string) {
  const file = await open(directory, "r"); try { await file.sync(); } finally { await file.close(); }
}
async function verifyLocalArchive(path: string, expected: z.infer<typeof bytesSchema>, signal: AbortSignal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    requireMatch(before.isFile() && before.uid === process.getuid?.() && (before.mode & 0o077) === 0, "GTFS admission archive is not private");
    requireMatch(before.size === expected.bytes, "GTFS admission archive size differs");
    const digest = createHash("sha256"), buffer = Buffer.alloc(expected.bytes);
    for (let offset = 0; offset < before.size;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, offset, Math.min(65536, before.size - offset), offset);
      requireMatch(bytesRead > 0, "GTFS admission archive read is incomplete"); digest.update(buffer.subarray(offset, offset + bytesRead)); offset += bytesRead;
    }
    const after = await file.stat();
    requireMatch(after.size === before.size && after.mtimeMs === before.mtimeMs && digest.digest("hex") === expected.sha256,
      "GTFS admission archive content differs");
    signal.throwIfAborted();
    return buffer;
  } finally { await file.close(); }
}
async function whileActive<T>(promise: PromiseLike<T>, signal: AbortSignal) {
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

/** Retain original intent and resolved source before submitting an admission.
 * Uploaded bytes and their hash reach private durable storage before admission
 * prepares their database identity. Catalog/URL recovery uses the saved source.
 * Route authorization must precede this call; SQL rechecks the original actor.
 */
export async function admitGtfsSubmission(options: GtfsAdmissionOptions) {
  const target = new URL(options.target);
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "GTFS admission target is invalid");
  requireMatch(isAbsolute(options.directory), "GTFS admission directory must be absolute");
  const binding = bindingSchema.parse({ schemaVersion: 1, installationId: options.installationId, target: target.href.replace(/\/$/, ""),
    workspaceId: options.workspaceId, actorId: options.actorId, requestId: options.requestId, intent: options.intent });
  const limits = resolveGtfsLimits(options.env);
  const timeoutMs = z.number().int().positive().max(2_147_483_647).parse(Math.min(options.uploadTimeoutMs ?? limits.parseBudgetMs, limits.parseBudgetMs));
  options.signal.throwIfAborted();
  requireMatch(options.upload === undefined || options.upload.byteLength <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");
  // Capture mutable caller bytes before the first asynchronous filesystem read.
  const upload = options.upload ? new Uint8Array(options.upload) : null;
  const uploaded = upload ? bytesSchema.parse({ sha256: createHash("sha256").update(upload).digest("hex"), bytes: upload.length }) : null;
  requireMatch(uploaded === null || uploaded.bytes <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");
  const lock = await acquireConnectorLock(options.directory), ending = new AbortController();
  const signal = AbortSignal.any([options.signal, lock.signal, ending.signal]);
  const save = async (record: z.infer<typeof savedSchema>) => {
    signal.throwIfAborted();
    requireMatch(Buffer.byteLength(JSON.stringify(record)) <= 65536, "GTFS admission record exceeds configured bound");
    await writeConnectorJournal(options.directory, record); signal.throwIfAborted();
  };
  try {
    let saved: z.infer<typeof savedSchema>;
    try { saved = savedSchema.parse(await readPrivateJson(join(options.directory, "pending.json"), 65536)); }
    catch (error) {
      if (!absent(error)) throw error;
      try { await lstat(join(options.directory, "archive.zip")); throw new Error("GTFS admission file has no binding"); }
      catch (fileError) { if (!absent(fileError)) throw fileError; }
      saved = { binding, resolved: null, archive: uploaded, response: null }; await save(saved);
    }
    requireMatch(isDeepStrictEqual(saved.binding, binding), "GTFS admission binding differs");
    requireMatch(uploaded === null || isDeepStrictEqual(saved.archive, uploaded), "GTFS admission uploaded bytes differ");
    requireMatch(saved.archive === null || saved.archive.bytes <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");
    if (!saved.resolved) {
      requireMatch(saved.response === null, "GTFS admission response has no resolved source");
      saved.resolved = resolvedSchema.parse(await options.resolve(saved.archive ? structuredClone(saved.archive) : null));
      saved.resolved.source = checkedSource(saved.resolved.source);
      await save(saved);
    }
    const resolved = resolvedSchema.parse(saved.resolved), source = checkedSource(resolved.source);
    const archiveIdentity = saved.archive;
    requireMatch(source.kind === "upload" ? archiveIdentity !== null && source.uploadSha256 === archiveIdentity.sha256 && source.uploadBytes === archiveIdentity.bytes
      : archiveIdentity === null, "GTFS admission upload differs from resolved source");
    let retainedBytes: Uint8Array | null = null;
    if (archiveIdentity) {
      const path = join(options.directory, "archive.zip");
      try { retainedBytes = await verifyLocalArchive(path, archiveIdentity, signal); }
      catch (error) {
        if (!absent(error)) throw error;
        requireMatch(upload !== null, "GTFS admission saved archive is unavailable");
        const temporary = join(options.directory, `upload-${randomUUID()}.tmp`);
        try {
          const file = await open(temporary, "wx", 0o600);
          try { await file.writeFile(upload); await file.sync(); } finally { await file.close(); }
          signal.throwIfAborted(); await link(temporary, path); await syncDirectory(options.directory);
        } finally { await unlink(temporary).catch(error => { if (!absent(error)) throw error; }); }
        retainedBytes = await verifyLocalArchive(path, archiveIdentity, signal);
      }
    }
    const scope = { workspaceId: binding.workspaceId, actorId: binding.actorId, requestId: binding.requestId };
    const command = gtfsAdmissionCommand(scope, resolved);
    if (saved.response) command.verify(saved.response);
    // Replays still reach SQL for its current original-actor permission check.
    const response = command.verify(await sendGtfsPreparedCommand(options.service, command, signal));
    requireMatch(saved.response === null || isDeepStrictEqual(saved.response, response), "GTFS retained admission response differs");
    saved.response = response; await save(saved);
    const readStatus = () => readGtfsStatus(options.service, { ...scope, versionId: response.versionId }, signal);
    let status = await readStatus();
    requireMatch(status.requestId === binding.requestId && status.feedId === response.feedId, "GTFS admission status scope differs");
    if (archiveIdentity && retainedBytes && status.state === "awaiting_archive") {
      const archive = { path: `${binding.workspaceId}/${response.feedId}/${response.versionId}.zip`, ...archiveIdentity };
      const remoteIdentity = { workspaceId: binding.workspaceId, feedId: response.feedId, versionId: response.versionId,
        storagePath: archive.path, checksumSha256: archive.sha256, byteSize: archive.bytes };
      let remote = await readRetainedGtfsArchive(options.service, remoteIdentity, { signal, env: options.env });
      signal.throwIfAborted();
      requireMatch(remote.ok || remote.code === "archive_unavailable", "GTFS admission immutable archive differs or is unconfirmed");
      if (!remote.ok) {
        const deadline = new AbortController(), uploadSignal = AbortSignal.any([signal, deadline.signal]);
        const timer = setTimeout(() => deadline.abort(new Error("GTFS admission upload acknowledgement unavailable")), timeoutMs);
        try {
          const storage = gtfsIntakeStorage(binding.target, options.serviceKey, uploadSignal, options.storageFetch);
          await whileActive(storage.storage.from(GTFS_UPLOADS_BUCKET).upload(archive.path, retainedBytes, { contentType: "application/zip", upsert: false }), uploadSignal);
        } catch { signal.throwIfAborted(); }
        finally { clearTimeout(timer); deadline.abort(); }
        remote = await readRetainedGtfsArchive(options.service, remoteIdentity, { signal, env: options.env });
      }
      signal.throwIfAborted(); requireMatch(remote.ok, "GTFS admission upload is unconfirmed");
      const confirmation = { name: "confirm_gtfs_archive" as const, args: { p_version: response.versionId, p_token: null, p_archive: archive },
        verify(raw: unknown) {
          const receipt = z.object({ versionId: id, archive: z.object({ path: z.string(), sha256: hash, bytes: positive }).strict(), confirmedAt: z.iso.datetime({ offset: true }) }).strict().parse(raw);
          requireMatch(receipt.versionId === response.versionId && isDeepStrictEqual(receipt.archive, archive), "GTFS admission confirmation differs");
          return receipt;
        } };
      confirmation.verify(await sendGtfsPreparedCommand(options.service, confirmation, signal));
      status = await readStatus();
      requireMatch(status.requestId === binding.requestId && status.feedId === response.feedId && status.archiveConfirmed
        && status.state !== "awaiting_archive", "GTFS confirmed admission status differs");
    }
    signal.throwIfAborted();
    return { registration: response, status };
  } finally { ending.abort(); await lock.release(); }
}
