import { Blob as ServerBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import { AERIAL_ARTIFACT_BUCKET } from "@/lib/aerial/artifact-custody";
import {
  runAerialCustodyPass,
  type CustodySupabaseClient,
  type CustodySupabaseLike,
} from "@/lib/aerial/artifact-custody-server";

/**
 * Aerial artifact custody and the workspace storage limit (migration
 * 20261017000010, storage-quota.ts). Custody checks the workspace total with
 * the measured bytes before it stores an artifact, refuses when the total
 * cannot be read, and does not refuse a retry whose earlier attempt already
 * left the exact same object, because reconciling it adds no bytes.
 *
 * Kept apart from aerial-artifact-custody.test.ts, whose case count the
 * immutable-custody source controls pin.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const JOB = { processingJobId: JOB_ID, workspaceId: WORKSPACE_ID, missionId: MISSION_ID };
const SIGNED_URL = "https://worker.example.net/outputs/ortho.tif?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=3600";
const FUTURE = "2099-01-01T00:00:00Z";
const STORED_PATH = `${WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`;
const LIMIT_1028 = { OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES: "1028" } as unknown as NodeJS.ProcessEnv;

type Harness = {
  supabase: CustodySupabaseLike;
  upserted: Record<string, unknown>[][];
  uploads: string[];
  objects: Map<string, Buffer>;
  storageUsedBytes: unknown;
  storageUsageError: { message?: string } | null;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
};

function harness(): Harness {
  const state: Harness = {
    supabase: null as unknown as CustodySupabaseLike,
    upserted: [],
    uploads: [],
    objects: new Map(),
    storageUsedBytes: 0,
    storageUsageError: null,
    rpcCalls: [],
  };
  state.supabase = {
    from: (table: string) => ({
      upsert: (rows: unknown[]) => {
        if (table === "aerial_artifact_custody") state.upserted.push(rows as Record<string, unknown>[]);
        return Promise.resolve({ error: null });
      },
      select: (columns: string) => ({
        eq: () => Promise.resolve({
          data: columns === "kind, ordinal, state, attempt_count" ? [] : state.upserted.flat(),
          error: null,
        }),
      }),
      update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: JOB_ID }], error: null }) }) }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve(
        state.storageUsageError ? { data: null, error: state.storageUsageError } : { data: state.storageUsedBytes, error: null }
      );
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, options?: { upsert?: boolean }) => {
          expect(bucket).toBe(AERIAL_ARTIFACT_BUCKET);
          state.uploads.push(path);
          if (state.objects.has(path) && options?.upsert !== true) {
            return Promise.resolve({ error: { message: "Object already exists" } });
          }
          state.objects.set(path, Buffer.from(body as Buffer));
          return Promise.resolve({ error: null });
        },
        download: (path: string) => ({ asStream: async () => ({
          data: state.objects.has(path)
            ? new ServerBlob([new Uint8Array(state.objects.get(path)!)]).stream() as unknown as ReadableStream<Uint8Array>
            : null,
          error: null,
        }) }),
      }),
    },
  };
  return state;
}

function pass(h: Harness, bytes: Uint8Array<ArrayBuffer>, env?: NodeJS.ProcessEnv) {
  return runAerialCustodyPass({
    supabase: h.supabase as unknown as CustodySupabaseClient,
    storageClientFactory: () => h.supabase as unknown as CustodySupabaseClient,
    job: JOB,
    candidates: [{ kind: "orthomosaic", ordinal: 0, downloadUrl: SIGNED_URL, expiresAt: FUTURE, sizeBytes: bytes.byteLength, contentType: "image/tiff" }],
    env,
    fetchImpl: vi.fn().mockResolvedValue(
      new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/tiff" } })
    ) as unknown as typeof fetch,
  });
}

describe("aerial artifact custody and the workspace storage limit", () => {
  it("checks this workspace's use with the measured bytes before storing", async () => {
    const h = harness();
    h.storageUsedBytes = 1024;
    await pass(h, new Uint8Array([1, 2, 3, 4]), LIMIT_1028);
    expect(h.rpcCalls).toEqual([{ fn: "workspace_storage_bytes", args: { p_workspace_id: WORKSPACE_ID } }]);
    // 1024 used + 4 measured = 1028, exactly the limit: stored.
    expect(h.uploads).toEqual([STORED_PATH]);
    expect(h.upserted[0][0]).toMatchObject({ state: "held" });
  });

  it("stores nothing and says why when the artifact would go over the limit", async () => {
    const h = harness();
    h.storageUsedBytes = 1025;
    await pass(h, new Uint8Array([1, 2, 3, 4]), LIMIT_1028);
    expect(h.uploads).toHaveLength(0);
    const row = h.upserted[0][0];
    expect(row).toMatchObject({ state: "failed", failure_code: "workspace_storage_full", storage_path: null, attempt_count: 1 });
    expect(String(row.failure_detail)).toContain("over its storage limit");
    expect(String(row.failure_detail)).not.toContain(SIGNED_URL);
  });

  it("stores nothing when the workspace's use cannot be read", async () => {
    const h = harness();
    h.storageUsageError = { message: "permission denied for function workspace_storage_bytes" };
    await pass(h, new Uint8Array([1, 2, 3, 4]));
    expect(h.uploads).toHaveLength(0);
    expect(h.upserted[0][0]).toMatchObject({ state: "failed", failure_code: "workspace_storage_unreadable", storage_path: null });
  });

  // A retry after a lost acknowledgement: the first attempt already stored
  // this exact object, so taking custody adds no bytes. The limit may not
  // refuse what is only reconciliation.
  it("does not refuse a retry whose earlier attempt already stored the same bytes", async () => {
    const h = harness();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    h.objects.set(STORED_PATH, Buffer.from(bytes));
    // The stored object is already in the total, so the workspace sits at its limit.
    h.storageUsedBytes = 1028;
    await pass(h, bytes, LIMIT_1028);
    expect(h.upserted[0][0]).toMatchObject({ state: "held", storage_path: STORED_PATH, byte_size: 4 });
    expect(h.objects.get(STORED_PATH)!.equals(Buffer.from(bytes))).toBe(true);
  });

  it("still refuses when the object already at that path holds different bytes", async () => {
    const h = harness();
    h.objects.set(STORED_PATH, Buffer.from([9, 9, 9, 9]));
    h.storageUsedBytes = 1028;
    await pass(h, new Uint8Array([1, 2, 3, 4]), LIMIT_1028);
    expect(h.uploads).toHaveLength(0);
    expect(h.upserted[0][0]).toMatchObject({ state: "failed", failure_code: "workspace_storage_full", storage_path: null });
  });
});
