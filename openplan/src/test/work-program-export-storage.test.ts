import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORK_PROGRAM_EXPORT_RETRY_DETAIL,
  storeWorkProgramExport,
  workProgramExportFailureDetail,
} from "@/lib/programs/work-program/export-storage";
import { WORKSPACE_STORAGE_UNREADABLE_MESSAGE, workspaceStorageFullMessage } from "@/lib/workspaces/storage-quota";

// The Documents worker's work program export lands in kb-documents under the
// workspace id, so it counts toward the workspace storage limit
// (KI-2026-10-12-014). The fake bucket keeps real objects.
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const BYTES = Buffer.from("SYNTHETIC work program export");
const CHECKSUM = createHash("sha256").update(BYTES).digest("hex");
const OBJECT_PATH = `${WORKSPACE_ID}/33333333-3333-4333-8333-333333333333/${CHECKSUM}.pdf`;
const INPUT = { workspaceId: WORKSPACE_ID, objectPath: OBJECT_PATH, bytes: BYTES, checksum: CHECKSUM, contentType: "application/pdf" };

let objects: Map<string, Buffer>;
let storageUse: { data: unknown; error: { message: string } | null };
let rpc: ReturnType<typeof vi.fn>;
let upload: ReturnType<typeof vi.fn>;
let buckets: string[];

function service() {
  return {
    rpc,
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return {
          upload,
          download: async (path: string) => {
            const stored = objects.get(path);
            return stored ? { data: new Blob([new Uint8Array(stored)]), error: null } : { data: null, error: { message: "Object not found" } };
          },
          list: async (parent: string, options?: { search?: string }) => ({
            data: [...objects.entries()]
              .filter(([path]) => path.startsWith(`${parent}/`))
              .map(([path, bytes]) => ({ name: path.slice(parent.length + 1), id: "object", metadata: { size: bytes.length } }))
              .filter((entry) => entry.name.startsWith(options?.search ?? "")),
            error: null,
          }),
        };
      },
    },
  } as unknown as Parameters<typeof storeWorkProgramExport>[0];
}

beforeEach(() => {
  vi.unstubAllEnvs();
  objects = new Map();
  buckets = [];
  storageUse = { data: 0, error: null };
  rpc = vi.fn(async (name: string) => {
    if (name !== "workspace_storage_bytes") throw new Error(`Unexpected rpc ${name}`);
    return storageUse;
  });
  upload = vi.fn(async (path: string, bytes: Buffer) => {
    if (objects.has(path)) return { error: { message: "The resource already exists" } };
    objects.set(path, Buffer.from(bytes));
    return { error: null };
  });
});

describe("work program export storage", () => {
  it("checks the workspace storage limit with the file's size, then stores it in kb-documents", async () => {
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(100 + BYTES.length));
    storageUse = { data: 100, error: null };
    await storeWorkProgramExport(service(), INPUT);
    expect(rpc).toHaveBeenCalledWith("workspace_storage_bytes", { p_workspace_id: WORKSPACE_ID });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0]);
    expect(upload).toHaveBeenCalledWith(OBJECT_PATH, BYTES, { contentType: "application/pdf", upsert: false });
    expect(new Set(buckets)).toEqual(new Set(["kb-documents"]));
  });

  it("refuses with the planner storage message when the file would pass the limit, storing nothing", async () => {
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(100 + BYTES.length - 1));
    storageUse = { data: 100, error: null };
    const refusal = await storeWorkProgramExport(service(), INPUT).catch((error: unknown) => error);
    expect(workProgramExportFailureDetail(refusal)).toBe(
      workspaceStorageFullMessage(100, 100 + BYTES.length - 1, BYTES.length)
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses when storage use cannot be read, storing nothing", async () => {
    storageUse = { data: null, error: { message: "permission denied for function workspace_storage_bytes" } };
    const refusal = await storeWorkProgramExport(service(), INPUT).catch((error: unknown) => error);
    expect(workProgramExportFailureDetail(refusal)).toBe(WORKSPACE_STORAGE_UNREADABLE_MESSAGE);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not refuse a retry whose earlier attempt already stored this file, at the limit", async () => {
    objects.set(OBJECT_PATH, Buffer.from(BYTES));
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(100 + BYTES.length));
    storageUse = { data: 100 + BYTES.length, error: null };
    await expect(storeWorkProgramExport(service(), INPUT)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the retry wording for failures that are not the storage limit", async () => {
    objects.set(OBJECT_PATH, Buffer.from("SYNTHETIC different bytes, same length!"));
    const failure = await storeWorkProgramExport(service(), INPUT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Artifact storage unavailable");
    expect(workProgramExportFailureDetail(failure)).toBe(WORK_PROGRAM_EXPORT_RETRY_DETAIL);
  });
});
