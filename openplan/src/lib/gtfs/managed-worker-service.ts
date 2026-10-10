import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const id = z.string().uuid().transform(value => value.toLowerCase());
const date = z.iso.datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(2_147_483_647);
const positive = count.positive();
const claimSchema = z.object({ token: id, version_id: id, attempt: positive,
  claimed_at: date, initial_lease_until: date }).strict();
const archiveSchema = z.object({ path: z.string(), sha256: hash, bytes: z.number().int().positive().safe() }).strict();
const planSchema = z.object({ sha256: hash, bytes: positive, routeRows: positive, stopRows: positive,
  routeBatches: positive, stopBatches: positive }).strict();
const sourceSchema = z.object({ kind: z.enum(["upload", "url", "catalog"]), provisionalName: z.string().min(1).max(120).refine(value => value.trim().length > 0),
  sourceUrl: z.string().nullable().optional(), normalizedSourceUrl: z.string().nullable().optional(),
  catalogProvider: z.string().nullable().optional(), catalogSourceId: z.string().nullable().optional(),
  catalogRowStatus: z.string().nullable().optional(), uploadSha256: hash.nullable().optional(),
  uploadBytes: z.number().int().positive().safe().nullable().optional() }).strict();
const tractSchema = z.object({ command: id, version: id, computed: z.boolean(), rows: count.nullable(),
  computedAt: date.nullable(), errorCode: z.string().nullable(), errorDetail: z.string().max(500).nullable() }).strict();
const completionSchema = z.object({ command: id, version: id, status: z.literal("ready"), routeRows: positive,
  stopRows: positive, tractOutcome: tractSchema }).strict();
const state = z.enum(["awaiting_archive", "queued", "running", "ready", "failed", "cancelled"]);
const stage = z.enum(["pending", "fetching", "parsing", "ready", "failed"]);
const attemptSchema = z.object({ schemaVersion: z.literal(1), versionId: id, feedId: id, workspaceId: id, requestId: id,
  state, stage, attempts: positive, claim: claimSchema, active: z.boolean(), prepared: z.boolean(),
  source: sourceSchema, archive: archiveSchema.nullable(), archiveConfirmed: z.boolean(), plan: planSchema.nullable(),
  tract: tractSchema.nullable(), completion: completionSchema.nullable() }).strict();
const statusSchema = z.object({ schemaVersion: z.literal(1), requestId: id, versionId: id, feedId: id, workspaceId: id,
  state, stage, attempts: count, leaseUntil: date.nullable(), archiveConfirmed: z.boolean(), submittedAt: date,
  isCurrent: z.boolean(), failureCode: z.string().nullable(), failureDetail: z.string().nullable(),
  submitterAccessUnavailable: z.boolean() }).strict();

export type GtfsWorkerService = Pick<SupabaseClient, "rpc">;
export type GtfsAttemptScope = { versionId: string; token: string };
export type GtfsAttemptSnapshot = z.infer<typeof attemptSchema>;
export type GtfsMemberStatus = z.infer<typeof statusSchema>;

function requireMatch(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function verifyClaim(raw: unknown, scope: GtfsAttemptScope) {
  const claim = claimSchema.parse(raw);
  requireMatch(claim.version_id === id.parse(scope.versionId) && claim.token === id.parse(scope.token), "GTFS claim scope differs");
  requireMatch(Date.parse(claim.initial_lease_until) > Date.parse(claim.claimed_at), "GTFS claim interval differs");
  return claim;
}

/** A retained inactive claim is history. It never grants a fresh attempt. */
export function verifyGtfsClaim(raw: unknown, scope: GtfsAttemptScope) {
  if (raw === null) return null;
  const response = z.object({ claim: claimSchema, active: z.boolean() }).strict().parse(raw);
  const claim = verifyClaim(response.claim, scope);
  return { claim, active: response.active };
}

function verifyState(value: { state: z.infer<typeof state>; stage: z.infer<typeof stage> }) {
  const expected = value.state === "ready" ? value.stage === "ready"
    : value.state === "failed" || value.state === "cancelled" ? value.stage === "failed"
      : value.stage === "pending" || value.stage === "fetching" || value.stage === "parsing";
  requireMatch(expected, "GTFS execution and public stage differ");
}

function verifyTract(tract: z.infer<typeof tractSchema>, versionId: string) {
  requireMatch(tract.version === versionId, "GTFS tract scope differs");
  requireMatch(tract.computed
    ? tract.rows !== null && tract.computedAt !== null && tract.errorCode === null && tract.errorDetail === null
    : tract.rows === null && tract.computedAt === null && !!tract.errorCode && tract.errorDetail !== null,
  "GTFS tract outcome differs");
}

/** Validate native state before any worker uses its source or retained artifacts. */
export function verifyGtfsAttempt(raw: unknown, scope: GtfsAttemptScope): GtfsAttemptSnapshot {
  const value = attemptSchema.parse(raw), claim = verifyClaim(value.claim, scope);
  requireMatch(value.versionId === claim.version_id, "GTFS attempt scope differs");
  requireMatch(claim.attempt <= value.attempts, "GTFS claim is ahead of execution");
  verifyState(value);
  requireMatch(!value.active || (value.state === "running" && claim.attempt === value.attempts), "GTFS active attempt differs");
  requireMatch(!value.prepared || (value.plan !== null && claim.attempt === value.attempts), "GTFS preparation ownership differs");
  requireMatch(!value.archiveConfirmed || value.archive !== null, "GTFS confirmed archive missing");
  requireMatch(value.stage !== "parsing" || value.archiveConfirmed, "GTFS parsing archive unconfirmed");
  if (value.archive) {
    requireMatch(value.archive.path === `${value.workspaceId}/${value.feedId}/${value.versionId}.zip`, "GTFS archive scope differs");
  }
  if (value.source.kind === "upload") {
    requireMatch(value.source.sourceUrl == null && value.source.normalizedSourceUrl == null && value.archive !== null
      && value.archive.sha256 === value.source.uploadSha256 && value.archive.bytes === value.source.uploadBytes,
    "GTFS upload source differs from archive");
  } else {
    requireMatch(typeof value.source.sourceUrl === "string" && /^https?:\/\//.test(value.source.sourceUrl)
      && typeof value.source.normalizedSourceUrl === "string" && value.source.uploadSha256 == null
      && value.source.uploadBytes == null, "GTFS URL source differs");
    requireMatch(value.source.kind !== "catalog" || !!value.source.catalogSourceId?.trim(), "GTFS catalog identity missing");
  }
  if (value.plan) {
    requireMatch(value.plan.routeBatches >= Math.ceil(value.plan.routeRows / 1000) && value.plan.routeBatches <= value.plan.routeRows
      && value.plan.stopBatches >= Math.ceil(value.plan.stopRows / 1000) && value.plan.stopBatches <= value.plan.stopRows,
    "GTFS output plan capacity differs");
  }
  if (value.tract) verifyTract(value.tract, value.versionId);
  if (value.completion) {
    verifyTract(value.completion.tractOutcome, value.versionId);
    requireMatch(value.state === "ready" && value.completion.version === value.versionId && value.plan !== null
      && value.completion.routeRows === value.plan.routeRows && value.completion.stopRows === value.plan.stopRows
      && JSON.stringify(value.completion.tractOutcome) === JSON.stringify(value.tract), "GTFS completion evidence differs");
  }
  requireMatch(value.state !== "ready" || claim.attempt !== value.attempts || value.completion !== null, "GTFS ready receipt missing");
  return value;
}

/** Status reads contain no worker token or private source metadata. */
export function verifyGtfsStatus(raw: unknown, scope: { workspaceId: string; versionId: string }): GtfsMemberStatus {
  const value = statusSchema.parse(raw);
  requireMatch(value.workspaceId === id.parse(scope.workspaceId) && value.versionId === id.parse(scope.versionId), "GTFS member status scope differs");
  verifyState(value);
  requireMatch(!value.isCurrent || value.state === "ready", "GTFS current version is not ready");
  requireMatch(value.state !== "running" || (value.attempts > 0 && value.leaseUntil !== null), "GTFS running lease missing");
  requireMatch(value.state === "running" || value.leaseUntil === null, "GTFS inactive lease retained");
  requireMatch(value.stage !== "failed" || value.failureCode !== null, "GTFS failure code missing");
  return value;
}

/** Bound acknowledgement separately from transport compliance. An unavailable
 * reply leaves the command outcome unknown. Callers retain their journal and
 * reconcile the same command; this function never retries or reports failure.
 */
async function call(service: GtfsWorkerService, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error("GTFS worker acknowledgement unavailable");
  const payload = structuredClone(args), request = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (data: unknown, unavailable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      request.abort();
      if (unavailable) reject(new Error("GTFS worker acknowledgement unavailable"));
      else resolve(data);
    };
    const abort = () => finish(undefined, true);
    const timer = setTimeout(abort, 10_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    Promise.resolve().then(() => {
      if (request.signal.aborted) throw new Error("cancelled");
      return service.rpc(name, payload).abortSignal(request.signal);
    }).then(result => finish(result.data, !!result.error), () => finish(undefined, true));
  });
}

export async function listGtfsCandidates(service: GtfsWorkerService, limit: number, signal: AbortSignal) {
  const boundedLimit = z.number().int().min(1).max(100).parse(limit);
  const raw = await call(service, "list_gtfs_ingest_candidates", { p_limit: boundedLimit }, signal);
  const rows = z.array(z.object({ version_id: id }).strict()).max(boundedLimit).parse(raw);
  const versions = rows.map(row => row.version_id);
  requireMatch(new Set(versions).size === versions.length, "GTFS queue duplicated a version");
  return versions;
}

export async function claimGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope, signal: AbortSignal) {
  const expected = { versionId: id.parse(scope.versionId), token: id.parse(scope.token) };
  return verifyGtfsClaim(await call(service, "claim_gtfs_ingest", { p_version: expected.versionId, p_token: expected.token }, signal), expected);
}

export async function readGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope, signal: AbortSignal) {
  const expected = { versionId: id.parse(scope.versionId), token: id.parse(scope.token) };
  return verifyGtfsAttempt(await call(service, "read_gtfs_ingest_attempt", { p_version: expected.versionId, p_token: expected.token }, signal), expected);
}

export async function renewGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope, signal: AbortSignal) {
  const versionId = id.parse(scope.versionId), token = id.parse(scope.token);
  return z.boolean().parse(await call(service, "renew_gtfs_ingest", { p_version: versionId, p_token: token }, signal));
}

export async function readGtfsStatus(service: GtfsWorkerService, scope: { workspaceId: string; versionId: string; actorId: string }, signal: AbortSignal) {
  const expected = { workspaceId: id.parse(scope.workspaceId), versionId: id.parse(scope.versionId), actorId: id.parse(scope.actorId) };
  return verifyGtfsStatus(await call(service, "read_gtfs_ingest_status", {
    p_workspace: expected.workspaceId, p_version: expected.versionId, p_actor: expected.actorId,
  }, signal), expected);
}
