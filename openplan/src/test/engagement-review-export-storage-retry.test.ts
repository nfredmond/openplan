import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import native from "./fixtures/decision-link-native.json";

// A retried campaign review export is charged only for the review files not
// already stored at their paths (KI-2026-10-12-014). The fake bucket below keeps
// real objects, so what the worker lists, uploads and reconciles is what a
// second attempt finds.
const m = vi.hoisted(() => ({ service: vi.fn(), pdf: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: m.service }));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: m.pdf }));
import { processNextEngagementReport } from "@/lib/engagement/review-export-worker";
import { workspaceStorageFullMessage } from "@/lib/workspaces/storage-quota";

const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const OTHER_FILES_BYTES = 500;

let root: string;
let job: { id: string; report_id: string; workspace_id: string; campaign_id: string; scope: string; snapshot_text: string; snapshot_sha256: string };
let updates: Record<string, unknown>[];
let objects: Map<string, Buffer>;
let uploadsBeforeDrop: number;
let listFails: boolean;
let rpc: ReturnType<typeof vi.fn>;
let upload: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;

const storedBytes = () => [...objects.values()].reduce((total, bytes) => total + bytes.length, 0);
const jobFolder = () => `${job.workspace_id}/${job.report_id}/${job.id}`;
const finishCalls = () => rpc.mock.calls.filter(([name]) => name === "finish_engagement_report");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  root = await mkdtemp(join(tmpdir(), "openplan-synthetic-review-retry-"));
  updates = [];
  objects = new Map();
  uploadsBeforeDrop = Number.POSITIVE_INFINITY;
  listFails = false;
  const snapshot = { schema: 2, capturedAt: "2026-09-14T12:00:00Z", scope: "internal", filters: {}, campaign: { id: native.scope.campaignId, title: "SYNTHETIC retry archive", summary: null, configurationVersionId: null }, items: [], sessions: [], answers: [], responses: [], definitions: [], workspaceId: native.scope.workspaceId, decisionLinkHistoryScope: "campaign", decisionLinkCount: 2, decisionLinks: native.withdrawn.entries };
  const raw = JSON.stringify(snapshot);
  job = { id: "50000000-0000-4000-8000-000000000015", report_id: "60000000-0000-4000-8000-000000000016", campaign_id: native.scope.campaignId, workspace_id: native.scope.workspaceId, scope: "internal", snapshot_text: raw, snapshot_sha256: hash(raw) };
  // workspace_storage_bytes: other files in the workspace plus every object this fake holds.
  rpc = vi.fn(async (name: string) => {
    if (name === "workspace_storage_bytes") return { data: OTHER_FILES_BYTES + storedBytes(), error: null };
    return { data: name === "claim_engagement_report" ? { ...job } : null, error: null };
  });
  upload = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (objects.has(path)) return { error: { message: "The resource already exists" } };
    if (uploadsBeforeDrop <= 0) return { error: { message: "SYNTHETIC connection dropped" } };
    uploadsBeforeDrop -= 1;
    objects.set(path, Buffer.from(bytes));
    return { error: null };
  });
  const download = vi.fn(async (path: string) => {
    const stored = objects.get(path);
    return stored ? { data: new Blob([new Uint8Array(stored)]), error: null } : { data: null, error: { message: "Object not found" } };
  });
  list = vi.fn(async (parent: string, options?: { search?: string }) => {
    if (listFails) return { data: null, error: { message: "SYNTHETIC list unavailable" } };
    const entries = [...objects.entries()]
      .filter(([path]) => path.startsWith(`${parent}/`) && !path.slice(parent.length + 1).includes("/"))
      .map(([path, bytes]) => ({ name: path.slice(parent.length + 1), id: hash(path).slice(0, 8), metadata: { size: bytes.length } }))
      .filter((entry) => entry.name.startsWith(options?.search ?? ""));
    return { data: entries, error: null };
  });
  m.pdf.mockResolvedValue({ engine: "chrome", bytes: new Uint8Array([37, 80, 68, 70]) });
  m.service.mockReturnValue({
    rpc,
    storage: { from: (bucket: string) => {
      if (bucket !== "report-artifacts") throw new Error(`Unexpected bucket ${bucket}`);
      return { upload, download, list };
    } },
    from: () => ({ update: (value: Record<string, unknown>) => {
      updates.push(value);
      const builder = { eq: () => builder, select: () => builder, maybeSingle: async () => ({ data: { id: job.id }, error: null }) };
      return builder;
    } }),
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** First attempt stores one review file, then the connection drops. Returns the bytes of each file. */
async function partialFirstAttempt(): Promise<{ stored: number; remaining: number }> {
  uploadsBeforeDrop = 1;
  expect(await processNextEngagementReport(root)).toBe(true);
  expect(updates.at(-1)).toMatchObject({ status: "failed", failure_detail: "File storage unavailable" });
  expect(objects.size).toBe(1);
  // The worker's own record of the three rendered files, kept for the retry.
  const saved = JSON.parse(await readFile(join(root, "engagement", job.id, "files.json"), "utf8")) as { files: Array<{ byteLength: number }> };
  expect(saved.files).toHaveLength(3);
  const total = saved.files.reduce((sum, file) => sum + file.byteLength, 0);
  const stored = storedBytes();
  uploadsBeforeDrop = Number.POSITIVE_INFINITY;
  upload.mockClear();
  updates = [];
  return { stored, remaining: total - stored };
}

describe("campaign review export retry near the workspace storage limit", () => {
  it("charges a retry only for the review files not already stored, so it fits exactly", async () => {
    const { stored, remaining } = await partialFirstAttempt();
    expect(stored).toBeGreaterThan(0);
    // Exactly enough room for the two files still missing. Charging all three
    // again would count the stored file twice and refuse.
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(OTHER_FILES_BYTES + stored + remaining));

    expect(await processNextEngagementReport(root)).toBe(true);
    expect(updates.filter((row) => row.status === "failed")).toEqual([]);
    expect(objects.size).toBe(3);
    expect(finishCalls()).toHaveLength(1);
    expect(list).toHaveBeenCalledWith(jobFolder(), expect.objectContaining({ search: expect.any(String) }));
  });

  it("still refuses a retry whose missing files would pass the limit by one byte", async () => {
    const { stored, remaining } = await partialFirstAttempt();
    const quota = OTHER_FILES_BYTES + stored + remaining - 1;
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(quota));

    expect(await processNextEngagementReport(root)).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      failure_detail: workspaceStorageFullMessage(OTHER_FILES_BYTES + stored, quota, remaining),
    });
    expect(upload).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
    expect(finishCalls()).toHaveLength(0);
  });

  it("finishes a retry with nothing left to store even when the workspace is at its limit", async () => {
    // The first attempt stored every file; its custody commit is then retried.
    expect(await processNextEngagementReport(root)).toBe(true);
    expect(objects.size).toBe(3);
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(OTHER_FILES_BYTES + storedBytes()));
    rpc.mockClear();
    updates = [];

    expect(await processNextEngagementReport(root)).toBe(true);
    expect(updates.some((row) => row.status === "failed")).toBe(false);
    expect(rpc.mock.calls.some(([name]) => name === "workspace_storage_bytes")).toBe(false);
    expect(finishCalls()).toHaveLength(1);
  });

  it("charges an object of a different size at the path in full", async () => {
    const { stored, remaining } = await partialFirstAttempt();
    const [path, bytes] = [...objects.entries()][0];
    objects.set(path, Buffer.concat([bytes, Buffer.from("SYNTHETIC extra")]));
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(OTHER_FILES_BYTES + storedBytes() + remaining));

    expect(await processNextEngagementReport(root)).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      failure_detail: workspaceStorageFullMessage(OTHER_FILES_BYTES + storedBytes(), OTHER_FILES_BYTES + storedBytes() + remaining, remaining + stored),
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("charges every file in full when what is stored cannot be listed", async () => {
    const { stored, remaining } = await partialFirstAttempt();
    listFails = true;
    const quota = OTHER_FILES_BYTES + stored + remaining;
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(quota));

    expect(await processNextEngagementReport(root)).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      failure_detail: workspaceStorageFullMessage(OTHER_FILES_BYTES + stored, quota, stored + remaining),
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
