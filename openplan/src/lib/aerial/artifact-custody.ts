/**
 * Aerial artifact custody — the facts, the vocabulary, and the arithmetic.
 *
 * WHAT WENT WRONG WITHOUT THIS. A ProcessingCallback describes each deliverable
 * as `{kind, downloadUrl, expiresAt, sizeBytes?, contentType?}`. OpenPlan stored
 * that JSON on `aerial_processing_jobs.artifacts` and never fetched the bytes.
 * The orthomosaic, the DSM and the point cloud — the entire product of a flight,
 * and the evidence under whatever exhibit, screening or finding was built on
 * them — stopped existing for OpenPlan the moment the vendor's signed URL
 * lapsed. The job row kept saying `succeeded` either way. An agency defending a
 * decision two years later would discover its evidence had expired on a schedule
 * it was never shown.
 *
 * This module is deliberately PURE and node-free (no `node:crypto`, no fetch, no
 * Supabase) so a server component or a client component can render custody
 * without dragging the fetch/store engine into its bundle. The engine lives in
 * `./artifact-custody-server`.
 *
 * THE ONE RULE THAT IS STRUCTURAL, NOT POLICY. A signed download URL is a bearer
 * credential for an agency's own imagery. Nothing in this file accepts one, and
 * every sentence it produces is assembled from a fixed vocabulary plus numbers —
 * never from a caught error's message, which is how a URL reaches a log.
 */

// ── Deployment configuration ─────────────────────────────────────────────────

export const AERIAL_ARTIFACT_MAX_BYTES_ENV = "OPENPLAN_AERIAL_ARTIFACT_MAX_BYTES";
export const AERIAL_CUSTODY_BUDGET_MS_ENV = "OPENPLAN_AERIAL_CUSTODY_BUDGET_MS";

/**
 * Per-artifact ceiling when the operator has not set one: 256 MiB.
 *
 * WHY THIS ONE IS NOT "UNSET MEANS UNLIMITED", unlike `run-cap.ts` and the
 * engagement layer caps. Those bound a number of ROWS; this bounds bytes moving
 * through a function's memory on the way to object storage, and an unbounded
 * default is how a deployment discovers its disk is full — or its function is
 * OOM-killed — at the exact moment a large point cloud arrives. A ceiling that
 * refuses ONE artifact, loudly and on the record, is strictly better than one
 * that takes down the callback endpoint for every mission in the workspace.
 *
 * It is still configuration: an operator who self-hosts on hardware that can
 * take a 4 GB point cloud raises `OPENPLAN_AERIAL_ARTIFACT_MAX_BYTES` and
 * retries. The refusal names the env var and the operator, never a plan — there
 * is nothing to buy.
 */
export const DEFAULT_AERIAL_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Wall-clock the callback handler will spend taking custody before it stops
 * starting new artifacts: 30s by default.
 *
 * WHAT THIS CHOICE COSTS, stated plainly because it is a real trade. Custody
 * runs INSIDE the callback HTTP handler, because the moment the callback
 * arrives is the only moment the signed URLs are known-good — deferring to a
 * queue means betting the deliverables on a sweep running before `expiresAt`.
 * The price is that the vendor's callback request is held open while OpenPlan
 * downloads, and a serverless platform will kill the function at its own maximum
 * duration regardless of what is set here. So the budget is deliberately far
 * below any platform limit, artifacts that do not fit it are recorded `pending`
 * rather than lost, and `POST /api/aerial/processing-callback/custody` exists to
 * finish them while the URLs are still valid. Deferral is a door, not a dead end.
 */
export const DEFAULT_AERIAL_CUSTODY_BUDGET_MS = 30_000;

/**
 * A positive-integer env var, or null when unset/malformed.
 *
 * Malformed reads as UNSET rather than as zero for the reason
 * `resolveMonthlyRunCap` does: a typo must not become a ceiling of 0 that
 * refuses every artifact in the deployment.
 */
function positiveIntEnv(name: string, env: NodeJS.ProcessEnv): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveAerialArtifactMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv(AERIAL_ARTIFACT_MAX_BYTES_ENV, env) ?? DEFAULT_AERIAL_ARTIFACT_MAX_BYTES;
}

export function resolveAerialCustodyBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv(AERIAL_CUSTODY_BUDGET_MS_ENV, env) ?? DEFAULT_AERIAL_CUSTODY_BUDGET_MS;
}

// ── The bucket and the object path ───────────────────────────────────────────

export const AERIAL_ARTIFACT_BUCKET = "aerial-artifacts";

/**
 * Extension for the stored object, taken from the SOURCE URL's pathname.
 *
 * Data-driven rather than a kind→extension table, because "orthomosaic means
 * .tif" is an assumption about one processing worker's build, and this contract
 * is meant to outlive it. Sanitized hard — lowercase alphanumerics, ≤ 12 chars —
 * because `storage_path` is readable by every workspace member and the pathname
 * is attacker-adjacent input. Falls back to `.bin`, which is honest: the bytes
 * are the bytes.
 */
export function artifactObjectExtension(pathname: string): string {
  const lastSegment = pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0 || dot === lastSegment.length - 1) return "bin";
  const raw = lastSegment.slice(dot + 1).toLowerCase();
  // An "extension" that needed cleaning is not an extension — `%2e%2e%2fetc`
  // scrubs down to a plausible-looking `2e2e2fetc` and would then be written
  // into a member-readable `storage_path`. Reject rather than launder.
  if (!/^[a-z0-9]{1,12}$/.test(raw)) return "bin";
  return raw;
}

/**
 * Durable object path: `<workspace>/<mission>/<job>/<kind>[-<ordinal>].<ext>`.
 *
 * Derived entirely from identifiers OpenPlan owns, so it is the SAME path on a
 * redelivery of the same callback — which is what makes custody idempotent
 * without a second copy. Ordinal 0 is omitted so the ordinary one-per-kind case
 * reads as `orthomosaic.tif`.
 */
export function buildArtifactStoragePath(input: {
  workspaceId: string;
  missionId: string;
  processingJobId: string;
  kind: string;
  ordinal: number;
  extension: string;
}): string {
  const suffix = input.ordinal > 0 ? `-${input.ordinal}` : "";
  return `${input.workspaceId}/${input.missionId}/${input.processingJobId}/${input.kind}${suffix}.${input.extension}`;
}

// ── Custody records ──────────────────────────────────────────────────────────

export const AERIAL_ARTIFACT_CUSTODY_STATES = ["pending", "held", "failed", "refused"] as const;
export type AerialArtifactCustodyState = (typeof AERIAL_ARTIFACT_CUSTODY_STATES)[number];

export const AERIAL_JOB_CUSTODY_STATES = [
  "not_applicable",
  "none",
  "partial",
  "complete",
] as const;
export type AerialJobCustodyState = (typeof AERIAL_JOB_CUSTODY_STATES)[number];

/**
 * Why an artifact is not in custody. A closed vocabulary, on purpose: the
 * alternative is interpolating a caught error's `message`, and a fetch error's
 * message is one of the places a signed URL turns up.
 */
export const AERIAL_CUSTODY_FAILURE_CODES = [
  "source_expired",
  "http_error",
  "unexpected_content_type",
  "empty_body",
  "too_large",
  "network_error",
  "storage_write_failed",
  "budget_exhausted",
] as const;
export type AerialCustodyFailureCode = (typeof AERIAL_CUSTODY_FAILURE_CODES)[number];

/**
 * The columns every custody read projects, named once.
 *
 * Supabase clients in this repo are deliberately untyped, so a column left out
 * of a `.select()` is silently `undefined` at runtime and TypeScript says
 * nothing — a posture computed from a projection missing `state` would report
 * every artifact as not-held, forever, with a green test suite. Shared between
 * the write engine's roll-up and the read loader so the two cannot drift, and
 * exported so a test can assert the string itself.
 */
export const AERIAL_ARTIFACT_CUSTODY_COLUMNS =
  "id, kind, ordinal, state, storage_bucket, storage_path, byte_size, checksum_sha256, content_type, declared_size_bytes, source_expires_at, source_host, failure_code, failure_detail, attempt_count, held_at";

/** The custody row as workspace members read it. Carries no credential. */
export type AerialArtifactCustodyRecord = {
  /** The row's own id — what the download route addresses a held artifact by. */
  id: string;
  kind: string;
  ordinal: number;
  state: AerialArtifactCustodyState;
  storage_bucket: string | null;
  storage_path: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  content_type: string | null;
  declared_size_bytes: number | null;
  source_host: string;
  source_expires_at: string;
  failure_code: string | null;
  failure_detail: string | null;
  attempt_count: number;
  held_at: string | null;
};

export type AerialArtifactCustodyPosture = {
  state: AerialJobCustodyState;
  artifactCount: number;
  heldCount: number;
  pendingCount: number;
  failedCount: number;
  refusedCount: number;
  /** Not held AND the vendor link has already lapsed — these bytes are gone. */
  unrecoverableCount: number;
  /** Not held, link still valid — a retry can still save these. */
  recoverableCount: number;
  label: string;
  detail: string;
  /**
   * What an evidence package built on this job may claim. A package whose
   * underlying deliverables OpenPlan does not hold is not verification-ready,
   * whatever the worker said about the run.
   */
  verificationReadiness: "pending" | "partial";
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatExpiry(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "an unreadable date";
  return parsed.toISOString().slice(0, 10);
}

/**
 * The custody sentence an operator needs, built from records alone.
 *
 * The three states that are NOT "complete" are kept apart because the operator's
 * next action differs: nothing held is an integration problem, some held is a
 * retry, and a lapsed source link is a re-flight or a re-run. Folding them into
 * one "incomplete" would hide which one it is.
 */
export function summarizeAerialArtifactCustody(
  records: readonly AerialArtifactCustodyRecord[],
  now: Date = new Date()
): AerialArtifactCustodyPosture {
  const artifactCount = records.length;

  if (artifactCount === 0) {
    return {
      state: "not_applicable",
      artifactCount: 0,
      heldCount: 0,
      pendingCount: 0,
      failedCount: 0,
      refusedCount: 0,
      unrecoverableCount: 0,
      recoverableCount: 0,
      label: "No artifacts to take custody of",
      detail:
        "This processing job has not reported any artifacts, so there is nothing for OpenPlan to hold. That is not the same as a job whose artifacts could not be retrieved.",
      verificationReadiness: "pending",
    };
  }

  const held = records.filter((r) => r.state === "held");
  const pending = records.filter((r) => r.state === "pending");
  const failed = records.filter((r) => r.state === "failed");
  const refused = records.filter((r) => r.state === "refused");
  const outstanding = records.filter((r) => r.state !== "held");

  const nowMs = now.getTime();
  const expiryOf = (record: AerialArtifactCustodyRecord) => {
    const parsed = new Date(record.source_expires_at).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  };
  // An unreadable expiry counts as LAPSED. Treating it as still-valid would let
  // a malformed timestamp read as "a retry can still save this".
  const unrecoverable = outstanding.filter((r) => {
    const expiry = expiryOf(r);
    return expiry === null || expiry <= nowMs;
  });
  const recoverable = outstanding.length - unrecoverable.length;

  const state: AerialJobCustodyState =
    held.length === artifactCount ? "complete" : held.length === 0 ? "none" : "partial";

  const label =
    state === "complete"
      ? `All ${artifactCount} ${plural(artifactCount, "artifact is", "artifacts are")} in OpenPlan's custody`
      : state === "none"
        ? `None of ${artifactCount} ${plural(artifactCount, "artifact is", "artifacts are")} in OpenPlan's custody`
        : `${held.length} of ${artifactCount} artifacts in OpenPlan's custody`;

  const sentences: string[] = [];

  if (state === "complete") {
    sentences.push(
      `OpenPlan holds its own copy of every artifact this job produced, with a byte count and a SHA-256 for each, so they remain readable after the processing worker's signed links expire.`
    );
  } else {
    sentences.push(
      `${outstanding.length} ${plural(outstanding.length, "artifact exists", "artifacts exist")} only as a time-limited link from the processing worker. OpenPlan does not hold ${plural(outstanding.length, "its", "their")} bytes.`
    );
  }

  if (unrecoverable.length > 0) {
    const soonest = unrecoverable
      .map((r) => r.source_expires_at)
      .sort()
      .at(0);
    sentences.push(
      `${unrecoverable.length} of those ${plural(unrecoverable.length, "link has", "links have")} already lapsed (earliest ${formatExpiry(soonest ?? "")}), so ${plural(unrecoverable.length, "that deliverable", "those deliverables")} can no longer be retrieved and the flight would have to be re-processed.`
    );
  }

  if (recoverable > 0) {
    sentences.push(
      `${recoverable} ${plural(recoverable, "link is", "links are")} still valid and can still be taken into custody.`
    );
  }

  if (refused.length > 0) {
    sentences.push(
      `${refused.length} ${plural(refused.length, "artifact was", "artifacts were")} refused by this deployment's per-artifact size ceiling; raising ${AERIAL_ARTIFACT_MAX_BYTES_ENV} and retrying is what changes that.`
    );
  }

  if (pending.length > 0 && failed.length === 0 && refused.length === 0) {
    sentences.push(
      `${pending.length} ${plural(pending.length, "artifact has", "artifacts have")} not been attempted yet.`
    );
  }

  return {
    state,
    artifactCount,
    heldCount: held.length,
    pendingCount: pending.length,
    failedCount: failed.length,
    refusedCount: refused.length,
    unrecoverableCount: unrecoverable.length,
    recoverableCount: recoverable,
    label,
    detail: sentences.join(" "),
    // Only a job whose deliverables OpenPlan actually holds may carry an
    // evidence package past "pending". This is the whole point of making
    // custody observable: the package badge on the mission page differs.
    verificationReadiness: state === "complete" ? "partial" : "pending",
  };
}

/**
 * The reason sentence stored on a custody row, per failure code.
 *
 * Every branch is built from the code plus numbers the caller measured. There is
 * no parameter here that could carry a URL, and that is the design — see the
 * header. `observed` is a content-type or an HTTP status, both bounded by the
 * caller before they arrive.
 */
export function describeAerialCustodyFailure(input: {
  code: AerialCustodyFailureCode;
  kind: string;
  httpStatus?: number;
  observedContentType?: string;
  maxBytes?: number;
  observedBytes?: number;
  declaredBytes?: number;
  errorName?: string;
  sourceHost?: string;
  sourceExpiresAt?: string;
}): string {
  const subject = `The ${input.kind.replace(/_/g, " ")} could not be taken into OpenPlan's custody`;

  switch (input.code) {
    case "source_expired":
      return `${subject}: the processing worker's download link expired on ${formatExpiry(input.sourceExpiresAt ?? "")}. The bytes are no longer retrievable from ${input.sourceHost ?? "the worker"}; the flight has to be re-processed to produce a fresh link.`;
    case "http_error":
      return `${subject}: ${input.sourceHost ?? "the processing worker"} answered HTTP ${input.httpStatus ?? 0} instead of the file. The link may still be valid — a retry is worth attempting before it expires.`;
    case "unexpected_content_type":
      return `${subject}: ${input.sourceHost ?? "the processing worker"} returned ${input.observedContentType ?? "an unlabelled response"}, which is a web page or an error document, not the artifact. Nothing was stored.`;
    case "empty_body":
      return `${subject}: ${input.sourceHost ?? "the processing worker"} returned an empty response body. Nothing was stored.`;
    case "too_large":
      return `${subject}: it exceeds this deployment's per-artifact ceiling of ${formatBytes(input.maxBytes ?? 0)}${
        input.declaredBytes ? ` and the worker declared ${formatBytes(input.declaredBytes)}` : ""
      }. The download was stopped rather than allowed to fill the deployment's storage. Whoever operates this deployment can raise ${AERIAL_ARTIFACT_MAX_BYTES_ENV} and retry — OpenPlan itself is free and has no usage tiers.`;
    case "network_error":
      return `${subject}: the download from ${input.sourceHost ?? "the processing worker"} failed (${input.errorName ?? "network error"}). The link may still be valid — a retry is worth attempting before it expires.`;
    case "storage_write_failed":
      return `${subject}: the bytes were downloaded but the write into this deployment's private aerial-artifacts bucket failed. Confirm the bucket exists (migration 20260730000004) and that its size limit allows this object.`;
    case "budget_exhausted":
      return `${subject} during the processing callback: the callback's custody time budget (${AERIAL_CUSTODY_BUDGET_MS_ENV}) ran out first. The link is untouched and still valid — retry through POST /api/aerial/processing-callback/custody before it expires.`;
  }
}

// ── Redaction of the vendor descriptor ───────────────────────────────────────

/**
 * The artifact descriptor as it is safe to persist on `aerial_processing_jobs`.
 *
 * `aerial_processing_jobs` is readable by every workspace member, and the raw
 * descriptor's `downloadUrl` is a bearer credential for the agency's imagery.
 * Everything a reader legitimately needs — what kind it is, how big the worker
 * said it was, where it came from, when the link dies — survives; the credential
 * does not. The full payload is still recorded verbatim in
 * `aerial_processing_callbacks`, which is service-role-only.
 */
export type RedactedArtifactDescriptor = {
  kind: string;
  ordinal: number;
  expiresAt: string;
  sizeBytes: number | null;
  contentType: string | null;
  sourceHost: string | null;
};

/** Hostname only — never the path, never the query, which is where the signature lives. */
export function artifactSourceHost(downloadUrl: string): string | null {
  try {
    return new URL(downloadUrl).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Pair each artifact with its position among artifacts of the SAME kind.
 *
 * The contract permits a repeated kind. Without an ordinal, a second
 * orthomosaic would either overwrite the first at its deterministic storage path
 * or be dropped on the unique constraint — and dropping a deliverable is the
 * defect this whole module exists to end. Array order is part of the payload, so
 * the ordinal is stable across a redelivery.
 */
export function assignArtifactOrdinals<T extends { kind: string }>(
  artifacts: readonly T[]
): Array<{ artifact: T; ordinal: number }> {
  const seen = new Map<string, number>();
  return artifacts.map((artifact) => {
    const ordinal = seen.get(artifact.kind) ?? 0;
    seen.set(artifact.kind, ordinal + 1);
    return { artifact, ordinal };
  });
}

export function redactArtifactDescriptors(
  artifacts: readonly {
    kind: string;
    downloadUrl: string;
    expiresAt: string;
    sizeBytes?: number;
    contentType?: string;
  }[]
): RedactedArtifactDescriptor[] {
  return assignArtifactOrdinals(artifacts).map(({ artifact, ordinal }) => ({
    kind: artifact.kind,
    ordinal,
    expiresAt: artifact.expiresAt,
    sizeBytes: artifact.sizeBytes ?? null,
    contentType: artifact.contentType ?? null,
    sourceHost: artifactSourceHost(artifact.downloadUrl),
  }));
}
