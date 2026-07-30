/**
 * Aerial artifact custody — the engine that actually takes possession.
 *
 * SERVER MODULE. It imports `node:crypto` and touches Supabase Storage, so a
 * client component must never import it; render custody from the pure half
 * (`./artifact-custody`) instead.
 *
 * WHEN THIS RUNS, AND WHAT THE CHOICE COSTS. Inside the processing callback
 * handler, after the idempotency ledger and the job-status write. That ordering
 * is deliberate in both directions:
 *
 *   * AFTER the ledger and the status write, because a slow or failed custody
 *     pass must never cost the deployment the knowledge that the job finished.
 *     Those two facts are cheap and they land first.
 *   * INSIDE the handler rather than on a queue, because the callback is the one
 *     moment the signed URLs are known-good. Deferring every artifact to a sweep
 *     means betting the agency's deliverables on that sweep running before
 *     `expiresAt` — and the failure is silent and total.
 *
 * The cost, stated plainly: the vendor's callback request is held open while
 * OpenPlan downloads, and a serverless platform will kill the function at its
 * own maximum duration no matter what budget is configured. So the pass runs
 * under a wall-clock budget well below any platform limit, an artifact that does
 * not fit the budget is written `pending` rather than lost, and
 * `POST /api/aerial/processing-callback/custody` finishes the rest while the
 * links are still valid. Deferral is a door, not a dead end.
 *
 * CREDENTIALS. `downloadUrl` enters this module and leaves through exactly one
 * exit: `fetch`. It is never logged, never interpolated into a failure sentence,
 * never written to a member-readable column. Failure text comes from the closed
 * vocabulary in `describeAerialCustodyFailure`, and network errors contribute
 * only their `name`.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  artifactObjectExtension,
  artifactSourceHost,
  buildArtifactStoragePath,
  describeAerialCustodyFailure,
  resolveAerialArtifactMaxBytes,
  resolveAerialCustodyBudgetMs,
  summarizeAerialArtifactCustody,
  type AerialArtifactCustodyPosture,
  type AerialArtifactCustodyRecord,
  type AerialCustodyFailureCode,
} from "@/lib/aerial/artifact-custody";

/** Content types that mean "this is the vendor's error page, not the artifact". */
const DOCUMENT_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

/** Floor on the per-artifact fetch timeout so a nearly-exhausted budget still tries. */
const MIN_ARTIFACT_TIMEOUT_MS = 2_000;

type CustodyQueryResult = { data: unknown[] | null; error: { message?: string } | null };
type CustodyWriteResult = { error: { message?: string } | null };

/**
 * The narrowest Supabase shape this engine needs.
 *
 * Deliberately structural rather than `SupabaseClient`: it keeps the fetch/store
 * logic testable without a database, and it matches the repo convention that
 * Supabase clients are untyped and results are cast (see
 * `src/lib/knowledge-base/documents.ts`). Callers pass the service-role client
 * through a cast.
 */
export type CustodySupabaseLike = {
  from: (table: string) => {
    upsert: (rows: unknown[], options?: { onConflict?: string }) => PromiseLike<CustodyWriteResult>;
    select: (columns: string) => {
      eq: (column: string, value: string) => PromiseLike<CustodyQueryResult>;
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => { select: (columns: string) => PromiseLike<CustodyQueryResult> };
    };
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: unknown,
        options?: { contentType?: string; upsert?: boolean }
      ) => PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

/**
 * What callers pass: the real SERVICE-ROLE client, directly.
 *
 * Not `CustodySupabaseLike` and not a union, for two reasons that both point the
 * same way. `write-policy-coverage-guard.test.ts` resolves which client a
 * service-role-only write is handed by reading the call site's expression; an
 * `as unknown as CustodySupabaseLike` cast there is unresolvable to that
 * scanner, and an unprovable claim about a service-role write is worth less than
 * a tidy parameter type. (A union of the two also drives tsc into "type
 * instantiation is excessively deep" against supabase-js's generics.) So the
 * narrow structural type stays INTERNAL — it is what keeps the fetch/store logic
 * testable without a database — and tests cast into this parameter instead.
 */
export type CustodySupabaseClient = SupabaseClient;

function asCustodyClient(client: CustodySupabaseClient): CustodySupabaseLike {
  return client as unknown as CustodySupabaseLike;
}

export type CustodyJobContext = {
  processingJobId: string;
  workspaceId: string;
  missionId: string;
};

/** An artifact to take custody of. `downloadUrl` never leaves this object. */
export type CustodyCandidate = {
  kind: string;
  ordinal: number;
  downloadUrl: string;
  expiresAt: string;
  sizeBytes?: number | null;
  contentType?: string | null;
};

type CustodyRowWrite = {
  workspace_id: string;
  mission_id: string;
  processing_job_id: string;
  kind: string;
  ordinal: number;
  state: "pending" | "held" | "failed" | "refused";
  storage_bucket: string | null;
  storage_path: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  content_type: string | null;
  declared_size_bytes: number | null;
  declared_content_type: string | null;
  source_host: string;
  source_expires_at: string;
  failure_code: string | null;
  failure_detail: string | null;
  attempt_count: number;
  last_attempt_at: string;
  held_at: string | null;
};

type FetchOutcome =
  | { ok: true; bytes: Buffer; sha256: string; contentType: string | null }
  | {
      ok: false;
      code: AerialCustodyFailureCode;
      httpStatus?: number;
      observedContentType?: string;
      errorName?: string;
    };

/**
 * Download under a hard byte ceiling, hashing as the bytes arrive.
 *
 * The ceiling is enforced on the STREAM, not on `Content-Length`, because a
 * declared size is the vendor's claim and this function's job is to be the thing
 * that does not trust it. Crossing the ceiling cancels the reader immediately,
 * so a mislabelled 40 GB point cloud costs the ceiling in memory and not one
 * byte more.
 */
async function downloadArtifact(
  downloadUrl: string,
  maxBytes: number,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<FetchOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(downloadUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Only the error's NAME — a fetch failure's `message`/`cause` is one of the
    // places the signed URL turns up, and this string is stored and displayed.
    return {
      ok: false,
      code: "network_error",
      errorName: error instanceof Error ? error.name : "Error",
    };
  }

  if (!response.ok) {
    return { ok: false, code: "http_error", httpStatus: response.status };
  }

  const headerContentType = response.headers.get("content-type");
  const normalizedType = headerContentType?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (normalizedType && DOCUMENT_CONTENT_TYPES.includes(normalizedType)) {
    return { ok: false, code: "unexpected_content_type", observedContentType: normalizedType };
  }

  // A declared Content-Length over the ceiling is refused before a byte moves.
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "too_large" };
  }

  const body = response.body;
  if (!body) {
    return { ok: false, code: "empty_body" };
  }

  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "too_large" };
      }
      const chunk = Buffer.from(value);
      hash.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    return {
      ok: false,
      code: "network_error",
      errorName: error instanceof Error ? error.name : "Error",
    };
  }

  if (total === 0) {
    return { ok: false, code: "empty_body" };
  }

  return {
    ok: true,
    bytes: Buffer.concat(chunks),
    sha256: hash.digest("hex"),
    contentType: normalizedType,
  };
}

function failedRow(
  candidate: CustodyCandidate,
  job: CustodyJobContext,
  sourceHost: string,
  code: AerialCustodyFailureCode,
  detailInput: Parameters<typeof describeAerialCustodyFailure>[0],
  attempted: boolean,
  now: Date,
  priorAttempts: number
): CustodyRowWrite {
  return {
    workspace_id: job.workspaceId,
    mission_id: job.missionId,
    processing_job_id: job.processingJobId,
    kind: candidate.kind,
    ordinal: candidate.ordinal,
    // `budget_exhausted` is NOT a failure of the artifact: nothing was tried, the
    // link is untouched, and a retry is expected. It stays `pending` so the
    // sweep's working set and the operator's reading of it are both honest.
    state: code === "budget_exhausted" ? "pending" : code === "too_large" ? "refused" : "failed",
    storage_bucket: null,
    storage_path: null,
    byte_size: null,
    checksum_sha256: null,
    content_type: null,
    declared_size_bytes: candidate.sizeBytes ?? null,
    declared_content_type: candidate.contentType ?? null,
    source_host: sourceHost,
    source_expires_at: candidate.expiresAt,
    failure_code: code,
    failure_detail: describeAerialCustodyFailure(detailInput),
    // Carried forward, not reset. `attempt_count` is read back and displayed;
    // a column that says "1" after ten retries is a count this table asserts and
    // does not keep, which is the same class of untruth as an expired link
    // rendered as an available file.
    attempt_count: priorAttempts + (attempted ? 1 : 0),
    last_attempt_at: now.toISOString(),
    held_at: null,
  };
}

/**
 * Take custody of one artifact. Returns the row to write; never throws.
 *
 * The row is the product either way — "these bytes are here, this many, this
 * hash" and "they are not, and here is why" are both facts the operator needs,
 * and a thrown exception would produce neither.
 */
async function custodyOfOne(
  candidate: CustodyCandidate,
  job: CustodyJobContext,
  options: {
    supabase: CustodySupabaseLike;
    maxBytes: number;
    timeoutMs: number;
    now: Date;
    fetchImpl: typeof fetch;
    priorAttempts: number;
  }
): Promise<CustodyRowWrite> {
  const { supabase, maxBytes, timeoutMs, now, fetchImpl, priorAttempts } = options;
  const sourceHost = artifactSourceHost(candidate.downloadUrl) ?? "the processing worker";
  const base = { kind: candidate.kind, sourceHost, sourceExpiresAt: candidate.expiresAt };

  const expiresAtMs = new Date(candidate.expiresAt).getTime();
  if (!Number.isNaN(expiresAtMs) && expiresAtMs <= now.getTime()) {
    // Do not spend the budget on a link that is already dead — and do not report
    // the resulting 403 as if the worker had misbehaved.
    return failedRow(
      candidate,
      job,
      sourceHost,
      "source_expired",
      { ...base, code: "source_expired" },
      false,
      now,
      priorAttempts
    );
  }

  const download = await downloadArtifact(candidate.downloadUrl, maxBytes, timeoutMs, fetchImpl);

  if (!download.ok) {
    return failedRow(
      candidate,
      job,
      sourceHost,
      download.code,
      {
        ...base,
        code: download.code,
        httpStatus: download.httpStatus,
        observedContentType: download.observedContentType,
        errorName: download.errorName,
        maxBytes,
        declaredBytes: candidate.sizeBytes ?? undefined,
      },
      true,
      now,
      priorAttempts
    );
  }

  let sourcePathname = "";
  try {
    sourcePathname = new URL(candidate.downloadUrl).pathname;
  } catch {
    sourcePathname = "";
  }

  const storagePath = buildArtifactStoragePath({
    workspaceId: job.workspaceId,
    missionId: job.missionId,
    processingJobId: job.processingJobId,
    kind: candidate.kind,
    ordinal: candidate.ordinal,
    extension: artifactObjectExtension(sourcePathname),
  });

  const uploadContentType =
    download.contentType ?? candidate.contentType ?? "application/octet-stream";

  // `upsert` is what makes a redelivered callback store ONE copy: the path is
  // derived from ids OpenPlan owns, so the second write lands on the first
  // object rather than beside it.
  const { error: uploadError } = await supabase.storage
    .from(AERIAL_ARTIFACT_BUCKET)
    .upload(storagePath, download.bytes, { contentType: uploadContentType, upsert: true });

  if (uploadError) {
    return failedRow(
      candidate,
      job,
      sourceHost,
      "storage_write_failed",
      { ...base, code: "storage_write_failed" },
      true,
      now,
      priorAttempts
    );
  }

  return {
    workspace_id: job.workspaceId,
    mission_id: job.missionId,
    processing_job_id: job.processingJobId,
    kind: candidate.kind,
    ordinal: candidate.ordinal,
    state: "held",
    storage_bucket: AERIAL_ARTIFACT_BUCKET,
    storage_path: storagePath,
    byte_size: download.bytes.byteLength,
    checksum_sha256: download.sha256,
    content_type: uploadContentType,
    declared_size_bytes: candidate.sizeBytes ?? null,
    declared_content_type: candidate.contentType ?? null,
    source_host: sourceHost,
    source_expires_at: candidate.expiresAt,
    failure_code: null,
    failure_detail: null,
    attempt_count: priorAttempts + 1,
    last_attempt_at: now.toISOString(),
    held_at: now.toISOString(),
  };
}

/**
 * What custody already says about an artifact, before this pass runs.
 *
 * WHY THIS READ EXISTS, and it is not an optimization. The upsert below writes
 * every column of the row, so a pass that re-attempts an artifact ALREADY in
 * custody overwrites `state`, `storage_bucket`, `storage_path`, `byte_size`,
 * `checksum_sha256` and `held_at`. A worker that redelivers a `succeeded`
 * callback under a NEW callbackId — the ordinary at-least-once retry, which the
 * ledger's callbackId dedupe does not catch — therefore made OpenPlan erase its
 * own proof of custody and replace it with "the download link expired, the
 * flight has to be re-processed", while the bytes sat in the bucket at a path
 * nothing recorded any more. That is this feature's own defect, inverted: not
 * "we lost the bytes and said we had them" but "we have the bytes and told the
 * agency they were gone". Both send a planner to re-fly.
 */
type PriorCustody = { state: string; attemptCount: number };

function priorCustodyKey(kind: string, ordinal: number): string {
  return `${kind}:${ordinal}`;
}

async function readPriorCustody(
  supabase: CustodySupabaseLike,
  processingJobId: string
): Promise<{ ok: true; byKey: Map<string, PriorCustody> } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("aerial_artifact_custody")
    .select("kind, ordinal, state, attempt_count")
    .eq("processing_job_id", processingJobId);

  if (error) return { ok: false, message: error.message ?? "unknown database error" };

  const byKey = new Map<string, PriorCustody>();
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof raw.kind !== "string") continue;
    byKey.set(priorCustodyKey(raw.kind, typeof raw.ordinal === "number" ? raw.ordinal : 0), {
      state: typeof raw.state === "string" ? raw.state : "pending",
      attemptCount: typeof raw.attempt_count === "number" ? raw.attempt_count : 0,
    });
  }
  return { ok: true, byKey };
}

export type CustodyPassResult = {
  posture: AerialArtifactCustodyPosture;
  records: AerialArtifactCustodyRecord[];
  /** Why the roll-up could not be re-read, when that happened. Never an empty list posing as success. */
  unreadableReason: string | null;
};

/**
 * Run a custody pass over `candidates`, persist a row for each, and roll the
 * result up onto the job.
 *
 * PARTIAL CUSTODY IS THE NORMAL CASE and is treated as such: four artifacts with
 * one failed fetch produces three `held` rows, one `failed` row, and a job whose
 * state is `partial`. It is never collapsed into total success or total failure,
 * because the operator's next action depends on which artifact is missing.
 */
export async function runAerialCustodyPass(input: {
  supabase: CustodySupabaseClient;
  job: CustodyJobContext;
  candidates: readonly CustodyCandidate[];
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Milliseconds already spent by the caller, deducted from the budget. */
  elapsedMs?: number;
}): Promise<CustodyPassResult> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxBytes = resolveAerialArtifactMaxBytes(env);
  const budgetMs = resolveAerialCustodyBudgetMs(env);
  const startedAt = Date.now();
  const alreadySpent = input.elapsedMs ?? 0;

  const supabase = asCustodyClient(input.supabase);

  // What is already held, read BEFORE anything is written. An unreadable prior
  // record is not an empty one: overwriting a row this pass cannot see is how a
  // held artifact gets recorded as lost. Nothing is attempted, nothing is
  // written, and the reason is returned for the caller to state.
  const prior = await readPriorCustody(supabase, input.job.processingJobId);
  if (!prior.ok) {
    const count = input.candidates.length;
    const reason =
      `Artifact custody was not attempted for this processing job: the custody record OpenPlan already holds could not be read (${prior.message}). ` +
      `${count} ${count === 1 ? "artifact was" : "artifacts were"} left untouched rather than overwritten, because a pass that cannot see what is already held can erase the record of bytes this deployment does have. ` +
      `Retry through POST /api/aerial/processing-callback/custody while the processing worker's links are still valid.`;
    return {
      posture: {
        ...summarizeAerialArtifactCustody([], now),
        artifactCount: count,
        label: "Artifact custody could not be established",
        detail: reason,
        verificationReadiness: "pending",
      },
      records: [],
      unreadableReason: reason,
    };
  }

  const rows: CustodyRowWrite[] = [];

  for (const candidate of input.candidates) {
    const existing = prior.byKey.get(priorCustodyKey(candidate.kind, candidate.ordinal));

    // Already in OpenPlan's custody. Do not re-download it, and above all do not
    // rewrite its row — the bytes, the path and the hash are already recorded.
    if (existing?.state === "held") continue;

    const priorAttempts = existing?.attemptCount ?? 0;

    const remaining = budgetMs - alreadySpent - (Date.now() - startedAt);
    if (remaining <= 0) {
      const sourceHost = artifactSourceHost(candidate.downloadUrl) ?? "the processing worker";
      rows.push(
        failedRow(
          candidate,
          input.job,
          sourceHost,
          "budget_exhausted",
          {
            kind: candidate.kind,
            sourceHost,
            sourceExpiresAt: candidate.expiresAt,
            code: "budget_exhausted",
          },
          false,
          now,
          priorAttempts
        )
      );
      continue;
    }

    rows.push(
      await custodyOfOne(candidate, input.job, {
        supabase,
        maxBytes,
        timeoutMs: Math.max(remaining, MIN_ARTIFACT_TIMEOUT_MS),
        now,
        fetchImpl,
        priorAttempts,
      })
    );
  }

  if (rows.length > 0) {
    // Idempotent on (processing_job_id, kind, ordinal): a redelivery updates the
    // same rows instead of accumulating a second set.
    const { error: writeError } = await supabase
      .from("aerial_artifact_custody")
      .upsert(rows, { onConflict: "processing_job_id,kind,ordinal" });

    // A FAILED WRITE IS NOT AN EMPTY RESULT EITHER, and discarding this error was
    // the sharpest way left to lie with this table. `finalizeAerialCustodyState`
    // re-reads the rows to build its summary; if the write above failed, that
    // read returns nothing and the summary says "This processing job has not
    // reported any artifacts, so there is nothing for OpenPlan to hold" —
    // reassuring, false, and copied verbatim into the evidence package's notes,
    // while the bytes just uploaded sit in the bucket with nothing recording
    // where. So the roll-up is NOT written (the job keeps whatever it honestly
    // said before) and the reason is returned instead.
    if (writeError) {
      const held = rows.filter((row) => row.state === "held").length;
      const reason =
        `Artifact custody could not be recorded: writing the custody rows for this processing job failed (${writeError.message ?? "unknown database error"}). ` +
        `${held} of ${rows.length} ${rows.length === 1 ? "artifact was" : "artifacts were"} fetched during this pass, but OpenPlan has no record of what it holds or where, so whether these deliverables survive the processing worker's links is UNESTABLISHED — it is not "no artifacts". ` +
        `Retry through POST /api/aerial/processing-callback/custody once the database accepts writes again, while the worker's links are still valid.`;
      return {
        posture: {
          ...summarizeAerialArtifactCustody([], now),
          artifactCount: rows.length,
          heldCount: 0,
          label: "Artifact custody could not be recorded",
          detail: reason,
          verificationReadiness: "pending",
        },
        records: [],
        unreadableReason: reason,
      };
    }
  }

  return finalizeAerialCustodyState({
    supabase: input.supabase,
    processingJobId: input.job.processingJobId,
    now,
  });
}

/**
 * Re-read every custody row for a job, summarize, and write the roll-up.
 *
 * Re-read rather than summarized from `rows` in memory, because a retry pass
 * only carries the artifacts it retried — computing the job's state from that
 * subset would report `complete` the moment the last outstanding artifact
 * succeeded, regardless of the ones that failed earlier.
 */
export async function finalizeAerialCustodyState(input: {
  supabase: CustodySupabaseClient;
  processingJobId: string;
  now?: Date;
}): Promise<CustodyPassResult> {
  const now = input.now ?? new Date();

  const supabase = asCustodyClient(input.supabase);

  const { data, error } = await supabase
    .from("aerial_artifact_custody")
    .select(AERIAL_ARTIFACT_CUSTODY_COLUMNS)
    .eq("processing_job_id", input.processingJobId);

  if (error) {
    // A failed read is NOT an empty result. Reporting `not_applicable` here
    // would tell the operator this job had no artifacts to hold.
    return {
      posture: summarizeAerialArtifactCustody([], now),
      records: [],
      unreadableReason: `Artifact custody for this processing job could not be read: ${error.message ?? "unknown database error"}`,
    };
  }

  const records = (data ?? []) as AerialArtifactCustodyRecord[];
  const posture = summarizeAerialArtifactCustody(records, now);

  // `.select("id")` so the roll-up can see whether it changed anything. Under
  // RLS an UPDATE that matches no row succeeds with `error: null`, and a custody
  // state that silently failed to land would leave a job saying its bytes were
  // safe when nothing was written — the same silence this whole feature exists
  // to break, one level up.
  const { data: updated, error: updateError } = await supabase
    .from("aerial_processing_jobs")
    .update({
      artifact_custody_state: posture.state,
      artifact_custody_updated_at: now.toISOString(),
    })
    .eq("id", input.processingJobId)
    .select("id");

  const rollUpLanded = !updateError && (updated ?? []).length > 0;

  return {
    posture,
    records,
    unreadableReason: rollUpLanded
      ? null
      : `Artifact custody was assessed as "${posture.state}", but the roll-up could not be written back to the processing job row${updateError?.message ? `: ${updateError.message}` : " (no matching job row)"}.`,
  };
}
