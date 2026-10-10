import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GTFS_FAILURE_CODES } from "./types";
import { assessFeedVersionCollapse } from "./persist";

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
const attemptSchema = z.object({ schemaVersion: z.literal(1), versionId: id, feedId: id, workspaceId: id, requestId: id, actorId: id,
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
export type GtfsArchiveScope = { workspaceId: string; feedId: string; versionId: string };
export type GtfsArchiveIdentity = z.infer<typeof archiveSchema>;
export type GtfsOutputPlan = z.infer<typeof planSchema>;
export type GtfsTractOutcome = z.infer<typeof tractSchema>;

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
    verifyGtfsArchive(value.archive, value);
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
    verifyGtfsOutputPlan(value.plan);
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

export function verifyGtfsArchive(raw: unknown, scope: GtfsArchiveScope): GtfsArchiveIdentity {
  const archive = archiveSchema.parse(raw);
  const path = `${id.parse(scope.workspaceId)}/${id.parse(scope.feedId)}/${id.parse(scope.versionId)}.zip`;
  requireMatch(archive.path === path, "GTFS archive scope differs");
  return archive;
}

export function verifyGtfsOutputPlan(raw: unknown): GtfsOutputPlan {
  const plan = planSchema.parse(raw);
  requireMatch(plan.routeBatches >= Math.ceil(plan.routeRows / 1000) && plan.routeBatches <= plan.routeRows
    && plan.stopBatches >= Math.ceil(plan.stopRows / 1000) && plan.stopBatches <= plan.stopRows,
  "GTFS output plan capacity differs");
  return plan;
}

const manifestSchema = z.array(z.object({ kind: z.enum(["route", "stop"]), ordinal: count,
  rows: positive.max(1000), hash }).strict()).min(1);
export type GtfsBatchManifest = z.infer<typeof manifestSchema>;

export function verifyGtfsManifest(raw: unknown, plan: GtfsOutputPlan): GtfsBatchManifest {
  const manifest = manifestSchema.parse(raw), rows = { route: 0, stop: 0 }, batches = { route: 0, stop: 0 };
  let sawStops = false;
  for (const batch of manifest) {
    requireMatch(batch.ordinal === batches[batch.kind] && !(sawStops && batch.kind === "route"), "GTFS manifest order differs");
    sawStops ||= batch.kind === "stop";
    batches[batch.kind]++;
    rows[batch.kind] += batch.rows;
  }
  requireMatch(rows.route === plan.routeRows && rows.stop === plan.stopRows
    && batches.route === plan.routeBatches && batches.stop === plan.stopBatches, "GTFS manifest totals differ");
  return manifest;
}

function attemptArgs(scope: GtfsAttemptScope) {
  return { p_version: id.parse(scope.versionId), p_token: id.parse(scope.token) };
}

export function stageGtfsAttemptCommand(scope: GtfsAttemptScope, next: "fetching" | "parsing") {
  const args = { ...attemptArgs(scope), p_stage: z.enum(["fetching", "parsing"]).parse(next) };
  return { name: "stage_gtfs_ingest" as const, args, verify(raw: unknown) {
    const receipt = z.object({ versionId: id, stage: z.enum(["fetching", "parsing"]) }).strict().parse(
      raw);
    requireMatch(receipt.versionId === args.p_version && receipt.stage === args.p_stage, "GTFS stage receipt differs");
    return receipt;
  } };
}

export function prepareGtfsArchiveCommand(scope: GtfsAttemptScope & GtfsArchiveScope, raw: GtfsArchiveIdentity) {
  const args = { ...attemptArgs(scope), p_archive: verifyGtfsArchive(raw, scope) };
  return { name: "prepare_gtfs_archive" as const, args, verify(raw: unknown) {
    const receipt = z.object({ versionId: id, archive: archiveSchema, preparedAt: date }).strict().parse(
      raw);
    requireMatch(receipt.versionId === args.p_version && JSON.stringify(receipt.archive) === JSON.stringify(args.p_archive), "GTFS archive preparation receipt differs");
    return receipt;
  } };
}

/** Confirmation records verified bytes. The caller must first reconcile actual
 * private Storage contents; a returned metadata receipt cannot do that check.
 */
export function confirmGtfsArchiveCommand(scope: GtfsAttemptScope & GtfsArchiveScope, raw: GtfsArchiveIdentity) {
  const args = { ...attemptArgs(scope), p_archive: verifyGtfsArchive(raw, scope) };
  return { name: "confirm_gtfs_archive" as const, args, verify(raw: unknown) {
    const receipt = z.object({ versionId: id, archive: archiveSchema, confirmedAt: date }).strict().parse(
      raw);
    requireMatch(receipt.versionId === args.p_version && JSON.stringify(receipt.archive) === JSON.stringify(args.p_archive), "GTFS archive confirmation receipt differs");
    return receipt;
  } };
}

export function prepareGtfsOutputCommand(scope: GtfsAttemptScope, raw: GtfsOutputPlan) {
  const args = { ...attemptArgs(scope), p_plan: verifyGtfsOutputPlan(raw) };
  return { name: "prepare_gtfs_derived" as const, args, verify(raw: unknown) {
    const receipt = z.object({ version: id, token: id, removedRoutes: count, removedStops: count, removedTracts: count, plan: planSchema }).strict().parse(
      raw);
    requireMatch(receipt.version === args.p_version && receipt.token === args.p_token
      && JSON.stringify(receipt.plan) === JSON.stringify(args.p_plan), "GTFS output preparation receipt differs");
    return receipt;
  } };
}

export function writeGtfsBatchCommand(scope: GtfsAttemptScope & { workspaceId: string },
  command: { id: string; kind: "route" | "stop"; ordinal: number; rows: ReadonlyArray<Record<string, unknown>> }) {
  const args = { ...attemptArgs(scope), p_command: id.parse(command.id), p_kind: z.enum(["route", "stop"]).parse(command.kind),
    p_ordinal: count.parse(command.ordinal), p_rows: z.array(z.record(z.string(), z.json())).min(1).max(1000).parse(command.rows) };
  const workspaceId = id.parse(scope.workspaceId);
  requireMatch(args.p_rows.every(row => row.workspace_id === workspaceId && row.feed_version_id === args.p_version), "GTFS batch row scope differs");
  return { name: "write_gtfs_ingest_batch" as const, args, verify(raw: unknown) {
    const receipt = z.object({ command: id, rows: positive.max(1000), hash }).strict().parse(raw);
    requireMatch(receipt.command === args.p_command && receipt.rows === args.p_rows.length, "GTFS batch receipt differs");
    return receipt;
  } };
}

export function computeGtfsTractsCommand(scope: GtfsAttemptScope,
  command: { id: string; plan: GtfsOutputPlan; manifest: GtfsBatchManifest }) {
  const plan = verifyGtfsOutputPlan(command.plan);
  const args = { ...attemptArgs(scope), p_command: id.parse(command.id), p_plan: plan, p_manifest: verifyGtfsManifest(command.manifest, plan) };
  return { name: "compute_managed_gtfs_tracts" as const, args, verify(raw: unknown) {
    const receipt = tractSchema.parse(raw);
    verifyTract(receipt, args.p_version);
    requireMatch(receipt.command === args.p_command, "GTFS tract command receipt differs");
    return receipt;
  } };
}

const metadataSchema = z.object({ agency_count: count, route_count: positive, stop_count: positive, trip_count: count,
  stop_time_row_count: count, calendar_service_count: count, frequency_trip_count: count, scheduled_trip_count: count,
  service_start_date: z.string().nullable().optional(), service_end_date: z.string().nullable().optional(),
  feed_info_version: z.string().nullable().optional(), feed_info_publisher_name: z.string().nullable().optional(),
  feed_info_start_date: z.string().nullable().optional(), feed_info_end_date: z.string().nullable().optional(), parse_warnings: z.array(z.json()) }).strict();
export type GtfsCompletionMetadata = z.infer<typeof metadataSchema>;

export function completeGtfsAttemptCommand(scope: GtfsAttemptScope & GtfsArchiveScope,
  command: { id: string; archive: GtfsArchiveIdentity; plan: GtfsOutputPlan; manifest: GtfsBatchManifest;
    metadata: GtfsCompletionMetadata; tract: GtfsTractOutcome }) {
  const plan = verifyGtfsOutputPlan(command.plan), tract = tractSchema.parse(command.tract);
  const args = { ...attemptArgs(scope), p_command: id.parse(command.id), p_archive: verifyGtfsArchive(command.archive, scope), p_plan: plan,
    p_manifest: verifyGtfsManifest(command.manifest, plan), p_metadata: metadataSchema.parse(command.metadata), p_tract_command: tract.command };
  verifyTract(tract, args.p_version);
  return { name: "complete_gtfs_ingest" as const, args, verify(raw: unknown) {
    const receipt = completionSchema.parse(raw);
    requireMatch(receipt.command === args.p_command && receipt.version === args.p_version && receipt.routeRows === plan.routeRows
      && receipt.stopRows === plan.stopRows && JSON.stringify(receipt.tractOutcome) === JSON.stringify(tract), "GTFS finalization receipt differs");
    return receipt;
  } };
}

export function failGtfsAttemptCommand(scope: GtfsAttemptScope,
  command: { id: string; code: typeof GTFS_FAILURE_CODES[number]; detail: string }) {
  const args = { ...attemptArgs(scope), p_command: id.parse(command.id), p_code: z.enum(GTFS_FAILURE_CODES).parse(command.code),
    p_detail: z.string().min(1).max(2000).refine(value => value.trim().length > 0).parse(command.detail) };
  return { name: "fail_gtfs_ingest" as const, args, verify(raw: unknown) {
    const receipt = z.object({ command: id, version: id, state: z.literal("failed"),
      closure: z.object({ recorded: z.literal(true), feedStatusChanged: z.boolean() }).strict(), cleanupPending: z.boolean(), closedAt: date }).strict().parse(
      raw);
    requireMatch(receipt.command === args.p_command && receipt.version === args.p_version, "GTFS failure receipt differs");
    return receipt;
  } };
}

const basisSchema = z.object({ feedId: id, versionId: id, routeCount: positive, stopCount: positive,
  previousVersionId: id.nullable(), previousRouteCount: count.nullable(), previousStopCount: count.nullable() }).strict();
const adoptionSchema = z.union([
  z.object({ command: id, version: id, adopted: z.literal(false), withheld: z.literal(true), basis: basisSchema }).strict(),
  z.object({ command: id, version: id, adopted: z.literal(true), alreadyCurrent: z.literal(true), basis: basisSchema, adoptedAt: date.nullable() }).strict(),
  z.object({ command: id, version: id, adopted: z.literal(true), alreadyCurrent: z.literal(false), basis: basisSchema,
    reviewAccepted: z.literal(false), adoptedAt: date }).strict(),
]);

/** Workers may attempt ordinary adoption. This interface cannot send review
 * acceptance or override the existing material-shrinkage safeguard.
 */
export function adoptGtfsAttemptCommand(scope: GtfsArchiveScope & { actorId: string },
  command: { id: string; routeCount: number; stopCount: number }) {
  const args = { p_workspace: id.parse(scope.workspaceId), p_version: id.parse(scope.versionId), p_actor: id.parse(scope.actorId),
    p_command: id.parse(command.id), p_review: null };
  const feedId = id.parse(scope.feedId), routeCount = positive.parse(command.routeCount), stopCount = positive.parse(command.stopCount);
  return { name: "adopt_gtfs_ingest" as const, args, verify(raw: unknown) {
    const receipt = adoptionSchema.parse(raw);
    const basis = receipt.basis;
    requireMatch(receipt.command === args.p_command && receipt.version === args.p_version && basis.feedId === feedId
      && basis.versionId === args.p_version && basis.routeCount === routeCount && basis.stopCount === stopCount, "GTFS adoption receipt scope differs");
    requireMatch(basis.previousVersionId === null ? basis.previousRouteCount === null && basis.previousStopCount === null
      : basis.previousRouteCount !== null && basis.previousStopCount !== null, "GTFS adoption predecessor differs");
    const previous = basis.previousVersionId === null ? null : { routeCount: basis.previousRouteCount!, stopCount: basis.previousStopCount! };
    const collapsed = assessFeedVersionCollapse(previous, { routeCount, stopCount }).collapsed;
    requireMatch(receipt.adopted !== collapsed, "GTFS adoption outcome differs from shrinkage evidence");
    requireMatch(!receipt.adopted || !receipt.alreadyCurrent || basis.previousVersionId === args.p_version, "GTFS current adoption predecessor differs");
    return receipt;
  } };
}


export type GtfsPreparedCommand = {
  name: "stage_gtfs_ingest" | "prepare_gtfs_archive" | "confirm_gtfs_archive" | "prepare_gtfs_derived"
    | "write_gtfs_ingest_batch" | "compute_managed_gtfs_tracts" | "complete_gtfs_ingest" | "fail_gtfs_ingest" | "adopt_gtfs_ingest";
  args: Record<string, unknown>;
  verify: (raw: unknown) => unknown;
};

/** Return raw evidence for durable storage. The prepared verifier must accept
 * it before a caller resolves its journal or uses the returned state.
 */
export async function sendGtfsPreparedCommand(service: GtfsWorkerService, command: GtfsPreparedCommand, signal: AbortSignal): Promise<unknown> {
  return call(service, command.name, command.args, signal);
}

export async function stageGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope, next: "fetching" | "parsing", signal: AbortSignal) {
  const prepared = stageGtfsAttemptCommand(scope, next);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function prepareGtfsArchive(service: GtfsWorkerService, scope: GtfsAttemptScope & GtfsArchiveScope, raw: GtfsArchiveIdentity, signal: AbortSignal) {
  const prepared = prepareGtfsArchiveCommand(scope, raw);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function confirmGtfsArchive(service: GtfsWorkerService, scope: GtfsAttemptScope & GtfsArchiveScope, raw: GtfsArchiveIdentity, signal: AbortSignal) {
  const prepared = confirmGtfsArchiveCommand(scope, raw);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function prepareGtfsOutput(service: GtfsWorkerService, scope: GtfsAttemptScope, raw: GtfsOutputPlan, signal: AbortSignal) {
  const prepared = prepareGtfsOutputCommand(scope, raw);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function writeGtfsBatch(service: GtfsWorkerService, scope: GtfsAttemptScope & { workspaceId: string },
  command: { id: string; kind: "route" | "stop"; ordinal: number; rows: ReadonlyArray<Record<string, unknown>> }, signal: AbortSignal) {
  const prepared = writeGtfsBatchCommand(scope, command);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function computeGtfsTracts(service: GtfsWorkerService, scope: GtfsAttemptScope,
  command: { id: string; plan: GtfsOutputPlan; manifest: GtfsBatchManifest }, signal: AbortSignal) {
  const prepared = computeGtfsTractsCommand(scope, command);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function completeGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope & GtfsArchiveScope,
  command: { id: string; archive: GtfsArchiveIdentity; plan: GtfsOutputPlan; manifest: GtfsBatchManifest;
    metadata: GtfsCompletionMetadata; tract: GtfsTractOutcome }, signal: AbortSignal) {
  const prepared = completeGtfsAttemptCommand(scope, command);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function failGtfsAttempt(service: GtfsWorkerService, scope: GtfsAttemptScope,
  command: { id: string; code: typeof GTFS_FAILURE_CODES[number]; detail: string }, signal: AbortSignal) {
  const prepared = failGtfsAttemptCommand(scope, command);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}

export async function adoptGtfsAttempt(service: GtfsWorkerService, scope: GtfsArchiveScope & { actorId: string },
  command: { id: string; routeCount: number; stopCount: number }, signal: AbortSignal) {
  const prepared = adoptGtfsAttemptCommand(scope, command);
  return prepared.verify(await sendGtfsPreparedCommand(service, prepared, signal));
}
