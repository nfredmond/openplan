import { createHash } from "node:crypto";
import { Blob as ServerBlob } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PROCESSING_ARTIFACT_KINDS } from "@/lib/aerial/processing-contract";

import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  AERIAL_ARTIFACT_MAX_BYTES_ENV,
  DEFAULT_AERIAL_ARTIFACT_MAX_BYTES,
  artifactObjectExtension,
  assignArtifactOrdinals,
  buildArtifactStoragePath,
  redactArtifactDescriptors,
  resolveAerialArtifactMaxBytes,
  summarizeAerialArtifactCustody,
  type AerialArtifactCustodyRecord,
} from "@/lib/aerial/artifact-custody";
import {
  runAerialCustodyPass,
  type CustodySupabaseClient,
  type CustodySupabaseLike,
} from "@/lib/aerial/artifact-custody-server";

/**
 * THE DEFECT THESE GUARD. `aerial_processing_jobs.artifacts` held the worker's
 * own `{kind, downloadUrl, expiresAt}` JSON and OpenPlan never fetched a byte.
 * Every deliverable of a drone flight — and the evidence under any exhibit,
 * screening or finding built on it — became permanently unreachable when the
 * vendor's signed link lapsed, while the job row went on saying `succeeded`.
 *
 * So the facts asserted below are, in order: the bytes are actually stored, the
 * record says which artifacts are held and which are NOT, a failure never reads
 * as success, a ceiling refuses rather than fills the disk, and the signed URL
 * never appears in anything a person or a log can read.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const JOB = { processingJobId: JOB_ID, workspaceId: WORKSPACE_ID, missionId: MISSION_ID };

/** A signed URL. If this string turns up in a stored row or a log, custody leaked a credential. */
const SIGNED_URL =
  "https://worker.example.net/outputs/ortho.tif?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=3600";

const FUTURE = "2099-01-01T00:00:00Z";

type Harness = {
  supabase: CustodySupabaseLike;
  upserted: Record<string, unknown>[][];
  uploads: Array<{ path: string; body: unknown; options?: { contentType?: string; upsert?: boolean } }>;
  jobUpdates: Record<string, unknown>[];
  custodySelectColumns: string[];
  objects: Map<string, Buffer>;
  storageReadOverride?: Blob | null;
  storageReadError?: { message?: string } | null;
  uploadAcknowledgementError?: { message?: string } | null;
  uploadAcknowledgementThrows?: boolean;
  /** Rows the roll-up re-read returns. Defaults to whatever was upserted. */
  rollupRows?: Record<string, unknown>[];
  rollupError?: { message?: string } | null;
  /** Rows the PRE-read returns. Defaults to whatever was upserted so far. */
  priorRows?: Record<string, unknown>[];
  priorError?: { message?: string } | null;
  uploadError?: { message?: string } | null;
  upsertError?: { message?: string; code?: string } | null;
};

/** The projection the pre-read uses; the roll-up read uses the shared constant. */
const PRIOR_CUSTODY_SELECT = "kind, ordinal, state, attempt_count";

function harness(): Harness {
  const state: Harness = {
    supabase: null as unknown as CustodySupabaseLike,
    upserted: [],
    uploads: [],
    jobUpdates: [],
    custodySelectColumns: [],
    objects: new Map(),
    uploadError: null,
    rollupError: null,
    priorError: null,
  };

  state.supabase = {
    from: (table: string) => ({
      upsert: (rows: unknown[]) => {
        if (table === "aerial_artifact_custody") {
          if (state.upsertError) return Promise.resolve({ error: state.upsertError });
          state.upserted.push(rows as Record<string, unknown>[]);
        }
        return Promise.resolve({ error: null });
      },
      select: (columns: string) => {
        if (table === "aerial_artifact_custody") state.custodySelectColumns.push(columns);
        const isPrior = columns === PRIOR_CUSTODY_SELECT;
        const error = isPrior ? state.priorError : state.rollupError;
        const rows = isPrior
          ? (state.priorRows ?? state.upserted.flat())
          : (state.rollupRows ?? state.upserted.flat());
        return {
          eq: () =>
            Promise.resolve(error ? { data: null, error } : { data: rows, error: null }),
        };
      },
      update: (values: Record<string, unknown>) => {
        if (table === "aerial_processing_jobs") state.jobUpdates.push(values);
        return {
          eq: () => ({
            select: () => Promise.resolve({ data: [{ id: JOB_ID }], error: null }),
          }),
        };
      },
    }),
    // workspace_storage_bytes: an empty workspace, so custody may store.
    rpc: () => Promise.resolve({ data: 0, error: null }),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, options?: { contentType?: string; upsert?: boolean }) => {
          expect(bucket).toBe(AERIAL_ARTIFACT_BUCKET);
          state.uploads.push({ path, body, options });
          if (!state.uploadError) {
            if (state.objects.has(path) && options?.upsert !== true) {
              return Promise.resolve({ error: { message: "Object already exists" } });
            }
            state.objects.set(path, Buffer.from(body as Buffer));
          }
          if (state.uploadAcknowledgementThrows) return Promise.reject(new Error("Synthetic lost upload acknowledgement"));
          return Promise.resolve({ error: state.uploadError ?? state.uploadAcknowledgementError ?? null });
        },
        download: (path: string) => ({ asStream: async () => ({
          data: state.storageReadOverride !== undefined ? state.storageReadOverride?.stream() ?? null
            : state.objects.has(path) ? new ServerBlob([new Uint8Array(state.objects.get(path)!)]).stream() as unknown as ReadableStream<Uint8Array> : null,
          error: state.storageReadError ?? null,
        }) }),
      }),
    },
  };

  return state;
}

function okResponse(body: BodyInit, contentType = "image/tiff", extraHeaders: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { "content-type": contentType, ...extraHeaders } });
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "orthomosaic",
    ordinal: 0,
    downloadUrl: SIGNED_URL,
    expiresAt: FUTURE,
    sizeBytes: 3,
    contentType: "image/tiff",
    ...overrides,
  };
}

describe("preserved concurrent custody", () => {
  const heldRecord = () => ({
    kind: "orthomosaic", ordinal: 0, state: "held", storage_bucket: AERIAL_ARTIFACT_BUCKET,
    storage_path: "original/orthomosaic.tif", byte_size: 3, checksum_sha256: "a".repeat(64),
    source_host: "worker.example.net", source_expires_at: FUTURE, attempt_count: 1,
    held_at: "2026-07-30T00:00:00Z",
  });
  it("rereads preserved held rows after a conflicting bulk write", async () => {
    const h = harness();
    h.upsertError = { code: "23514", message: "Original held aerial custody cannot be replaced" };
    h.rollupRows = [{ ...heldRecord(), kind: "orthomosaic", ordinal: 0 }];
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient, job: JOB,
      candidates: [candidate()], fetchImpl: vi.fn().mockResolvedValue(okResponse("abc")),
    });
    expect(result.unreadableReason, "Conflict recovery reads preserved custody").toBeNull();
    expect(result.posture.state, "Preserved complete roster stays complete").toBe("complete");
    expect(result.records[0].checksum_sha256, "Conflict recovery keeps original checksum").toBe(heldRecord().checksum_sha256);
    expect(h.jobUpdates[0]?.artifact_custody_state).toBe("complete");
    expect(h.custodySelectColumns).toEqual([PRIOR_CUSTODY_SELECT, AERIAL_ARTIFACT_CUSTODY_COLUMNS]);
  });

  it("does not publish a partial retained roster as complete after bulk rollback", async () => {
    const h = harness();
    h.upsertError = { code: "23514", message: "Original held aerial custody cannot be replaced" };
    h.rollupRows = [{ ...heldRecord(), kind: "orthomosaic", ordinal: 0 }];
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient, job: JOB,
      candidates: [candidate(), candidate({ kind: "point_cloud" })],
      fetchImpl: vi.fn().mockImplementation(async () => okResponse("abc")),
    });
    expect(result.unreadableReason, "Missing expected identity requires retry").toContain("1 expected");
    expect(result.posture.state, "Bulk rollback cannot make partial roster complete").toBe("partial");
    expect(result.posture.artifactCount).toBe(2);
    expect(result.posture.heldCount).toBe(1);
    expect(h.jobUpdates, "Incomplete roster leaves job rollup unchanged").toHaveLength(0);
  });

  it("keeps an unreadable conflict reread retryable", async () => {
    const h = harness();
    h.upsertError = { code: "23514", message: "Original held aerial custody cannot be replaced" };
    h.rollupError = { message: "Synthetic read interruption" };
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient, job: JOB,
      candidates: [candidate()], fetchImpl: vi.fn().mockResolvedValue(okResponse("abc")),
    });
    expect(result.unreadableReason, "Unreadable conflict reread cannot publish success").toContain("could not be read");
    expect(h.jobUpdates).toHaveLength(0);
  });

  it("counts existing pending records alongside missing original identities", async () => {
    const h = harness();
    h.upsertError = { code: "23514", message: "Original held aerial custody cannot be replaced" };
    h.rollupRows = [heldRecord(), { kind: "point_cloud", ordinal: 0, state: "pending", source_expires_at: FUTURE }];
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient, job: JOB,
      candidates: [candidate(), candidate({ kind: "point_cloud" }), candidate({ kind: "dtm" })],
      fetchImpl: vi.fn().mockImplementation(async () => okResponse("abc")),
    });
    expect(result.posture.pendingCount, "Missing roster retains existing pending count").toBe(2);
    expect(result.posture.artifactCount).toBe(3);
    expect(h.jobUpdates).toHaveLength(0);
  });

  it("does not recover unrelated constraint or serialization errors as held conflicts", async () => {
    for (const error of [
      { code: "23514", message: "Unrelated validation constraint" },
      { code: "40001", message: "Original held aerial custody cannot be replaced" },
    ]) {
      const h = harness(); h.upsertError = error; h.rollupRows = [heldRecord()];
      const result = await runAerialCustodyPass({
        supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient, job: JOB,
        candidates: [candidate()], fetchImpl: vi.fn().mockImplementation(async () => okResponse("abc")),
      });
      expect(result.unreadableReason, "Only the named held constraint enters recovery").toContain("could not be recorded");
      expect(h.custodySelectColumns).toEqual([PRIOR_CUSTODY_SELECT]);
      expect(h.jobUpdates).toHaveLength(0);
    }
  });
});

/** Every string a person or a log could read out of a custody row. */
function readableStrings(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows);
}

describe("aerial artifact custody — taking the bytes", () => {
  it("recovers an unchanged original object after its custody-row write was interrupted", async () => {
    const h = harness();
    const bytes = Buffer.from([1, 2, 3]);
    h.upsertError = { message: "Synthetic row acknowledgement unavailable" };
    const pass = () => runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB, candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(bytes)) as unknown as typeof fetch,
    });
    await pass();
    h.upsertError = null;
    const recovered = await pass();
    expect(recovered.records[0]?.state, "Matching retained bytes restore the missing custody row").toBe("held");
    expect(recovered.records[0]?.checksum_sha256, "Reconciliation checks the actual original hash").toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(h.objects.size).toBe(1);
  });

  it("reconciles actual bytes when the upload acknowledgement is unavailable", async () => {
    const h = harness();
    h.uploadAcknowledgementError = { message: "Synthetic acknowledgement unavailable after storage" };
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB, candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(Buffer.from([1, 2, 3]))) as unknown as typeof fetch,
    });
    expect(result.records[0]?.state, "An uncertain upload reply requires actual matching bytes").toBe("held");
  });

  it("reconciles retained bytes after a thrown upload acknowledgement", async () => {
    const h = harness();
    h.uploadAcknowledgementThrows = true;
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB, candidates: [candidate()],
      fetchImpl: async () => okResponse(Buffer.from([1, 2, 3])),
    });
    expect(result.records[0]?.state, "Thrown acknowledgement requires actual byte reconciliation").toBe("held");
  });

  it("cancels reconciliation as soon as actual streamed bytes exceed the expected size", async () => {
    const h = harness();
    const canceled = vi.fn();
    let reads = 0;
    h.supabase.storage.from = () => ({
      upload: async () => ({ error: null }),
      download: (_path, _options, parameters) => ({ asStream: async () => {
        expect(parameters.cache).toBe("no-store");
        expect(parameters.signal).toBeInstanceOf(AbortSignal);
        return { data: new ReadableStream({
          pull(controller) {
            reads += 1;
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          },
          cancel: canceled,
        }, { highWaterMark: 0 }), error: null };
      } }),
    });
    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB, candidates: [candidate()],
      fetchImpl: async () => okResponse(Buffer.from([1, 2, 3])),
    });
    expect(result.records[0]?.state, "Oversized stream cannot become held").toBe("failed");
    expect(reads, "Oversized stream stops at its first excessive chunk").toBe(1);
    expect(canceled, "Oversized network reader is canceled").toHaveBeenCalledOnce();
  });

  it("forwards pass cancellation through the Storage transport factory", async () => {
    const h = harness();
    const controller = new AbortController();
    let transport: typeof fetch | undefined;
    h.supabase.storage.from = () => ({
      upload: async () => {
        controller.abort();
        await transport!("https://storage.example.invalid/object", { method: "POST" });
        return { error: null };
      },
      download: () => ({ asStream: async () => { throw new Error("Canceled pass must not read Storage"); } }),
    });
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    try {
      const result = await runAerialCustodyPass({
        supabase: h.supabase as unknown as CustodySupabaseClient,
        storageClientFactory: (fetchImpl) => {
          transport = fetchImpl;
          return h.supabase as unknown as CustodySupabaseClient;
        },
        signal: controller.signal,
        job: JOB, candidates: [candidate()],
        fetchImpl: async () => okResponse(Buffer.from([1, 2, 3])),
      });
      expect(result.records[0]?.state, "Canceled transport cannot record held bytes").toBe("failed");
      expect(network, "Canceled transport starts no network request").not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses missing, unreadable, differently sized or changed actual storage bytes", async () => {
    for (const scenario of ["missing", "unreadable", "size", "hash"] as const) {
      const h = harness();
      if (scenario === "missing") h.storageReadOverride = null;
      if (scenario === "unreadable") h.storageReadError = { message: "Synthetic read unavailable" };
      if (scenario === "size") h.storageReadOverride = new ServerBlob([new Uint8Array([1, 2])]) as unknown as Blob;
      if (scenario === "hash") h.storageReadOverride = new ServerBlob([new Uint8Array([9, 8, 7])]) as unknown as Blob;
      const result = await runAerialCustodyPass({
        supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
        job: JOB, candidates: [candidate()],
        fetchImpl: vi.fn().mockResolvedValue(okResponse(Buffer.from([1, 2, 3]))) as unknown as typeof fetch,
      });
      expect(result.records.some((row) => row.state === "held"), "Unconfirmed actual bytes cannot become held: " + scenario).toBe(false);
    }
  });

  it("never replaces original storage bytes after its first custody-row write fails", async () => {
    const h = harness();
    const original = Buffer.from([1, 2, 3]);
    const replacement = Buffer.from([9, 8, 7]);
    h.upsertError = { message: "Synthetic custody-row write interruption" };
    const first = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(original)) as unknown as typeof fetch,
    });
    expect(first.unreadableReason).toContain("could not be recorded");
    expect(h.upserted).toHaveLength(0);
    const key = h.uploads[0].path;
    expect(h.objects.get(key)?.equals(original), "The first object exists before the interrupted row write").toBe(true);

    h.upsertError = null;
    const replay = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(replacement)) as unknown as typeof fetch,
    });
    expect(h.objects.get(key)?.equals(original), "A retry never replaces the original stored bytes").toBe(true);
    expect(replay.records.some((row) => row.state === "held"), "Different incoming bytes cannot become held at the original key").toBe(false);
  });

  it("downloads the artifact, stores it on a workspace/mission/job path, and records size + sha256", async () => {
    const h = harness();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // sha256 of 0x01020203... computed by the engine; assert it is a real digest
    // of THESE bytes rather than a placeholder.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(bytes));

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate({ sizeBytes: 4 })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].path).toBe(
      `${WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`
    );
    expect(h.uploads[0].options).toMatchObject({ upsert: false, contentType: "image/tiff" });
    expect(Buffer.from(h.uploads[0].body as Buffer).equals(Buffer.from(bytes))).toBe(true);

    const row = h.upserted[0][0];
    expect(row.state).toBe("held");
    expect(row.byte_size).toBe(4);
    expect(row.storage_bucket).toBe(AERIAL_ARTIFACT_BUCKET);
    expect(row.checksum_sha256).toBe(
      createHash("sha256").update(Buffer.from(bytes)).digest("hex")
    );
    expect(result.posture.state).toBe("complete");
    expect(result.posture.verificationReadiness).toBe("partial");
    expect(h.jobUpdates[0]).toMatchObject({ artifact_custody_state: "complete" });
  });

  it("re-reads the roll-up with every column the summary depends on", async () => {
    const h = harness();
    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(new Uint8Array([1]))) as unknown as typeof fetch,
    });

    // Two reads: the pre-read that decides what is already held, and the
    // roll-up re-read the summary is computed from.
    expect(h.custodySelectColumns).toHaveLength(2);
    // The pre-read must project `state` — without it nothing is recognised as
    // already held and every replay rewrites a held row.
    expect(h.custodySelectColumns[0]).toContain("state");
    expect(h.custodySelectColumns[0]).toContain("attempt_count");

    // A missing `state` here would make every artifact read as not-held forever,
    // and nothing would fail at build: these clients are untyped by convention.
    const rollup = h.custodySelectColumns[1];
    for (const column of ["kind", "ordinal", "state", "storage_path", "byte_size", "checksum_sha256", "source_expires_at", "failure_code"]) {
      expect(AERIAL_ARTIFACT_CUSTODY_COLUMNS).toContain(column);
      expect(rollup).toContain(column);
    }
  });

  it("refuses an artifact larger than the ceiling instead of buffering it, and names the env var", async () => {
    const h = harness();
    // 40 chunks of 1 KiB against a 4 KiB ceiling: the reader must stop early.
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= 40) {
          controller.close();
          return;
        }
        emitted += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "application/octet-stream" } }));

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate({ kind: "point_cloud", sizeBytes: 1024 })],
      env: { [AERIAL_ARTIFACT_MAX_BYTES_ENV]: "4096" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const row = h.upserted[0][0];
    expect(row.state).toBe("refused");
    expect(row.failure_code).toBe("too_large");
    expect(row.storage_path).toBeNull();
    expect(String(row.failure_detail)).toContain(AERIAL_ARTIFACT_MAX_BYTES_ENV);
    expect(h.uploads).toHaveLength(0);
    // Stopped early — it did not read all 40 KiB before deciding.
    expect(emitted).toBeLessThan(40);
    expect(result.posture.state).toBe("none");
  });

  it("refuses on a declared Content-Length over the ceiling before a byte moves", async () => {
    const h = harness();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]) as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "99999999" },
      })
    );

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate({ kind: "mesh" })],
      env: { [AERIAL_ARTIFACT_MAX_BYTES_ENV]: "1024" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(h.upserted[0][0].failure_code).toBe("too_large");
    expect(h.uploads).toHaveLength(0);
  });

  it("treats an HTML body as the worker's error page, not as the artifact", async () => {
    const h = harness();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse(new TextEncoder().encode("<html>403</html>"), "text/html; charset=utf-8"));

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const row = h.upserted[0][0];
    expect(row.state).toBe("failed");
    expect(row.failure_code).toBe("unexpected_content_type");
    expect(h.uploads).toHaveLength(0);
  });

  it("does not spend the budget on a link that already expired, and says so", async () => {
    const h = harness();
    const fetchImpl = vi.fn();

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate({ expiresAt: "2020-01-01T00:00:00Z" })],
      now: new Date("2026-07-30T00:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    const row = h.upserted[0][0];
    expect(row.state).toBe("failed");
    expect(row.failure_code).toBe("source_expired");
    expect(String(row.failure_detail)).toContain("re-processed");
  });

  it("records an HTTP error as failed and a storage write failure as failed, never as held", async () => {
    const httpHarness = harness();
    await runAerialCustodyPass({
      supabase: httpHarness.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => httpHarness.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(new Response("nope", { status: 502 })) as unknown as typeof fetch,
    });
    expect(httpHarness.upserted[0][0]).toMatchObject({ state: "failed", failure_code: "http_error" });
    expect(String(httpHarness.upserted[0][0].failure_detail)).toContain("502");

    const storeHarness = harness();
    storeHarness.uploadError = { message: "bucket not found" };
    await runAerialCustodyPass({
      supabase: storeHarness.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => storeHarness.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(new Uint8Array([9]))) as unknown as typeof fetch,
    });
    expect(storeHarness.upserted[0][0]).toMatchObject({
      state: "failed",
      failure_code: "storage_write_failed",
      storage_path: null,
    });
  });

  it("leaves an artifact the time budget could not reach as pending, untouched and retryable", async () => {
    const h = harness();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(new Uint8Array([1])));

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate(), candidate({ kind: "point_cloud" })],
      // The caller already burned the whole budget before custody started.
      elapsedMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    for (const row of h.upserted[0]) {
      expect(row.state).toBe("pending");
      expect(row.failure_code).toBe("budget_exhausted");
      expect(row.attempt_count).toBe(0);
      expect(String(row.failure_detail)).toContain("/api/aerial/processing-callback/custody");
    }
  });

  it("reports four artifacts with one failure as PARTIAL — never as total success or total failure", async () => {
    const h = harness();
    const fetchImpl = vi
      .fn()
      .mockImplementation((url: string) =>
        url.includes("dsm")
          ? Promise.resolve(new Response("nope", { status: 500 }))
          : Promise.resolve(okResponse(new Uint8Array([1, 2])))
      );

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [
        candidate({ kind: "orthomosaic" }),
        candidate({ kind: "dsm", downloadUrl: "https://worker.example.net/outputs/dsm.tif?sig=x" }),
        candidate({ kind: "dtm", downloadUrl: "https://worker.example.net/outputs/dtm.tif?sig=x" }),
        candidate({ kind: "point_cloud", downloadUrl: "https://worker.example.net/outputs/cloud.laz?sig=x" }),
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.posture.state).toBe("partial");
    expect(result.posture.heldCount).toBe(3);
    expect(result.posture.failedCount).toBe(1);
    expect(result.posture.label).toBe("3 of 4 artifacts in OpenPlan's custody");
    // Partial custody may not present as verified evidence.
    expect(result.posture.verificationReadiness).toBe("pending");
    expect(h.jobUpdates[0]).toMatchObject({ artifact_custody_state: "partial" });
  });

  it("never lets the signed URL reach a stored row", async () => {
    const cases: Array<() => Promise<Response>> = [
      () => Promise.resolve(okResponse(new Uint8Array([1]))),
      () => Promise.resolve(new Response("nope", { status: 403 })),
      () => Promise.resolve(okResponse(new TextEncoder().encode("<html/>"), "text/html")),
      () => Promise.reject(Object.assign(new Error(`fetch failed for ${SIGNED_URL}`), { name: "TypeError" })),
    ];

    for (const impl of cases) {
      const h = harness();
      await runAerialCustodyPass({
        supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
        job: JOB,
        candidates: [candidate()],
        fetchImpl: vi.fn().mockImplementation(impl) as unknown as typeof fetch,
      });

      const stored = readableStrings(h.upserted.flat());
      expect(stored).not.toContain("X-Amz-Signature");
      expect(stored).not.toContain("deadbeefcafe");
      expect(stored).not.toContain(SIGNED_URL);
      // The credential-free half of the source IS kept, because an operator
      // needs to know who to chase.
      expect(stored).toContain("worker.example.net");
    }
  });

  it("stores one copy, not two, when the same callback is replayed", async () => {
    const h = harness();
    // A fresh Response per call: a Response body is a stream and can only be
    // consumed once.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(okResponse(new Uint8Array([7]))));
    const pass = () =>
      runAerialCustodyPass({
        supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
        job: JOB,
        candidates: [candidate()],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

    await pass();
    await pass();

    // ONE download and ONE object. A worker that redelivers `succeeded` under a
    // new callbackId gets past the ledger's dedupe, so the second pass is real
    // traffic; an artifact already held must not be fetched again at all.
    expect(h.uploads.map((u) => u.path)).toEqual([
      `${WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`,
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.objects.size, "Replay preserves one original object").toBe(1);
    expect(h.objects.get(h.uploads[0].path)?.equals(Buffer.from([7])), "Replay preserves its original byte contents").toBe(true);
    // And the second pass wrote no custody row at all — the held one stands.
    expect(h.upserted).toHaveLength(1);
  });

  /**
   * THE INVERSION. A redelivered `succeeded` callback whose signed link has
   * since lapsed used to overwrite the `held` row with
   * `state: failed, failure_code: source_expired`, nulling `storage_path`,
   * `byte_size`, `checksum_sha256` and `held_at` — so OpenPlan erased its own
   * proof of custody, told the agency the deliverable was gone and it had to
   * re-fly, and orphaned the object still sitting in the bucket at a path
   * nothing recorded any more. Custody exists to stop a planner acting on a
   * false statement about the bytes; this was that same statement, pointing the
   * other way.
   */
  it("never downgrades an artifact it already holds when the link has since lapsed", async () => {
    const h = harness();
    h.priorRows = [
      {
        kind: "orthomosaic",
        ordinal: 0,
        state: "held",
        attempt_count: 1,
      },
    ];
    h.rollupRows = [
      {
        kind: "orthomosaic",
        ordinal: 0,
        state: "held",
        storage_bucket: AERIAL_ARTIFACT_BUCKET,
        storage_path: `${WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`,
        byte_size: 4,
        checksum_sha256: "b".repeat(64),
        source_host: "worker.example.net",
        source_expires_at: "2020-01-01T00:00:00Z",
        failure_code: null,
        attempt_count: 1,
      },
    ];
    const fetchImpl = vi.fn();

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate({ expiresAt: "2020-01-01T00:00:00Z" })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(h.upserted).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.posture.state).toBe("complete");
    expect(h.jobUpdates[0]).toMatchObject({ artifact_custody_state: "complete" });
  });

  it("carries the attempt count forward instead of resetting it to one", async () => {
    const h = harness();
    h.priorRows = [{ kind: "orthomosaic", ordinal: 0, state: "failed", attempt_count: 3 }];
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(new Uint8Array([9])));

    await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // A column named attempt_count that says "1" after four attempts is a count
    // the table asserts and does not keep.
    expect(h.upserted[0][0]).toMatchObject({ state: "held", attempt_count: 4 });
  });

  /**
   * A FAILED WRITE IS NOT AN EMPTY RESULT. The summary is built by re-reading the
   * rows this pass just wrote; when the write fails, that read comes back empty
   * and the "no artifacts at all" sentence — which is copied verbatim into the
   * evidence package's source-context notes — becomes a reassuring lie told about
   * bytes that were fetched and are now sitting in the bucket unrecorded.
   */
  it("does not report a failed custody WRITE as a job with no artifacts", async () => {
    const h = harness();
    h.upsertError = { message: 'new row violates check constraint "aerial_artifact_custody_kind_check"' };

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(new Uint8Array([5]))) as unknown as typeof fetch,
    });

    expect(result.unreadableReason).toContain("could not be recorded");
    expect(result.posture.detail).not.toContain("has not reported any artifacts");
    expect(result.posture.artifactCount).toBe(1);
    expect(result.posture.verificationReadiness).toBe("pending");
    // And the job's roll-up is left alone rather than being told "not_applicable".
    expect(h.jobUpdates).toHaveLength(0);
  });

  /**
   * ONE VOCABULARY, TWO PLACES. The migration's `kind` CHECK is a hand-copy of
   * `PROCESSING_ARTIFACT_KINDS`, and the two drift silently: adding a kind to
   * the TypeScript enum without amending the constraint makes every custody
   * upsert for a job containing that artifact fail the CHECK — so the deliverable
   * is fetched, uploaded, and then not recorded. Nothing in the type system or
   * the build can see that. This can.
   */
  it("keeps the migration's kind constraint identical to the contract's kinds", () => {
    // The EFFECTIVE constraint is the last one applied in migration order:
    // 20260730000004 created it inline, 20260811000003 dropped and re-added it
    // to admit ortho_preview. Reading only the original file would freeze this
    // guard at the first revision and let the contract and the database drift
    // behind a green test.
    const dir = join(process.cwd(), "supabase/migrations");
    const kindChecks = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .flatMap((file) => {
        const sql = readFileSync(join(dir, file), "utf8");
        return sql.includes("aerial_artifact_custody")
          ? [...sql.matchAll(/CHECK \(\s*kind IN \(([^)]*)\)\s*\)/g)].map((m) => m[1])
          : [];
      });
    expect(kindChecks.length, "no kind CHECK found where this guard looks").toBeGreaterThan(0);

    const inSql = kindChecks[kindChecks.length - 1]
      .split(",")
      .map((token) => token.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();

    expect(inSql).toEqual([...PROCESSING_ARTIFACT_KINDS].sort());
  });

  it("attempts nothing when the custody it already holds cannot be read", async () => {
    const h = harness();
    h.priorError = { message: "permission denied for table aerial_artifact_custody" };
    const fetchImpl = vi.fn();

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Nothing fetched, nothing written, nothing rolled up — and the reason is
    // stated rather than presented as "this job has no artifacts".
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.upserted).toHaveLength(0);
    expect(h.jobUpdates).toHaveLength(0);
    expect(result.unreadableReason).toContain("could not be read");
    expect(result.posture.artifactCount).toBe(1);
    expect(result.posture.verificationReadiness).toBe("pending");
    expect(result.posture.detail).not.toContain("has not reported any artifacts");
  });

  it("does not claim custody state from a failed read of the custody table", async () => {
    const h = harness();
    h.rollupError = { message: "permission denied for table aerial_artifact_custody" };

    const result = await runAerialCustodyPass({
      supabase: h.supabase as unknown as CustodySupabaseClient,
      storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
      job: JOB,
      candidates: [candidate()],
      fetchImpl: vi.fn().mockResolvedValue(okResponse(new Uint8Array([1]))) as unknown as typeof fetch,
    });

    expect(result.unreadableReason).toContain("could not be read");
    expect(result.posture.verificationReadiness).toBe("pending");
    // And the job row is NOT stamped 'complete' off an unreadable table.
    expect(h.jobUpdates).toHaveLength(0);
  });
});

describe("aerial artifact custody — the record a person reads", () => {
  const record = (overrides: Partial<AerialArtifactCustodyRecord>): AerialArtifactCustodyRecord => ({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "orthomosaic",
    ordinal: 0,
    state: "held",
    storage_bucket: AERIAL_ARTIFACT_BUCKET,
    storage_path: "a/b/c/orthomosaic.tif",
    byte_size: 10,
    checksum_sha256: "a".repeat(64),
    content_type: "image/tiff",
    declared_size_bytes: 10,
    source_host: "worker.example.net",
    source_expires_at: FUTURE,
    failure_code: null,
    failure_detail: null,
    attempt_count: 1,
    held_at: "2026-07-30T00:00:00Z",
    bounds_west: null,
    bounds_south: null,
    bounds_east: null,
    bounds_north: null,
    crs: null,
    pixel_size_m: null,
    ...overrides,
  });

  it("keeps 'no artifacts' apart from 'artifacts we could not take'", () => {
    const none = summarizeAerialArtifactCustody([]);
    expect(none.state).toBe("not_applicable");
    expect(none.detail).toContain("not the same as");

    const failed = summarizeAerialArtifactCustody([
      record({ state: "failed", failure_code: "http_error", storage_path: null }),
    ]);
    expect(failed.state).toBe("none");
  });

  it("says plainly when a lapsed link means the deliverable is gone", () => {
    const posture = summarizeAerialArtifactCustody(
      [
        record({ kind: "orthomosaic" }),
        record({ kind: "point_cloud", state: "failed", source_expires_at: "2026-01-05T00:00:00Z" }),
      ],
      new Date("2026-07-30T00:00:00Z")
    );

    expect(posture.state).toBe("partial");
    expect(posture.unrecoverableCount).toBe(1);
    expect(posture.recoverableCount).toBe(0);
    expect(posture.detail).toContain("2026-01-05");
    expect(posture.detail).toContain("can no longer be retrieved");
  });

  it("counts an unreadable expiry as lapsed rather than as still-retryable", () => {
    const posture = summarizeAerialArtifactCustody(
      [record({ state: "failed", source_expires_at: "not-a-date" })],
      new Date("2026-07-30T00:00:00Z")
    );
    expect(posture.unrecoverableCount).toBe(1);
    expect(posture.recoverableCount).toBe(0);
  });
});

describe("aerial artifact custody — paths, ordinals and redaction", () => {
  it("derives the object extension from the source path and refuses anything odd", () => {
    expect(artifactObjectExtension("/outputs/ortho.TIF")).toBe("tif");
    expect(artifactObjectExtension("/outputs/cloud.laz")).toBe("laz");
    expect(artifactObjectExtension("/outputs/no-extension")).toBe("bin");
    expect(artifactObjectExtension("/outputs/x." + "a".repeat(40))).toBe("bin");
    expect(artifactObjectExtension("/outputs/x.%2e%2e%2fetc")).toBe("bin");
  });

  it("gives a repeated kind its own path instead of overwriting the first", () => {
    const ordinals = assignArtifactOrdinals([
      { kind: "orthomosaic" },
      { kind: "orthomosaic" },
      { kind: "dsm" },
    ]);
    expect(ordinals.map((o) => o.ordinal)).toEqual([0, 1, 0]);

    expect(
      buildArtifactStoragePath({
        workspaceId: "w",
        missionId: "m",
        processingJobId: "j",
        kind: "orthomosaic",
        ordinal: 1,
        extension: "tif",
      })
    ).toBe("w/m/j/orthomosaic-1.tif");
  });

  it("strips the download URL from what the job row keeps", () => {
    const redacted = redactArtifactDescriptors([
      { kind: "orthomosaic", downloadUrl: SIGNED_URL, expiresAt: FUTURE, sizeBytes: 5, contentType: "image/tiff" },
    ]);

    expect(JSON.stringify(redacted)).not.toContain("X-Amz-Signature");
    expect(redacted[0]).toEqual({
      kind: "orthomosaic",
      ordinal: 0,
      expiresAt: FUTURE,
      sizeBytes: 5,
      contentType: "image/tiff",
      sourceHost: "worker.example.net",
    });
  });

  it("has an operator-settable ceiling with a bounded default", () => {
    expect(resolveAerialArtifactMaxBytes({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_AERIAL_ARTIFACT_MAX_BYTES);
    expect(
      resolveAerialArtifactMaxBytes({ [AERIAL_ARTIFACT_MAX_BYTES_ENV]: "4096" } as unknown as NodeJS.ProcessEnv)
    ).toBe(4096);
    // A typo must not become a ceiling of zero that refuses every artifact.
    expect(
      resolveAerialArtifactMaxBytes({ [AERIAL_ARTIFACT_MAX_BYTES_ENV]: "lots" } as unknown as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_AERIAL_ARTIFACT_MAX_BYTES);
  });
});
