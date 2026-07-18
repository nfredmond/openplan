import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (objectPath: string) => downloadMock(bucket, objectPath),
      }),
    },
  }),
}));

vi.mock("node:fs/promises", () => {
  const readFile = (...args: unknown[]) => readFileMock(...args);
  return { readFile, default: { readFile } };
});

import {
  loadJsonArtifact,
  parseStorageRef,
  resolveRunWorkDir,
  workerLocalRoot,
} from "@/app/api/models/[modelId]/runs/[modelRunId]/volumes/artifact-source";

describe("parseStorageRef", () => {
  it("parses a bucket + object path from a storage:// reference", () => {
    expect(parseStorageRef("storage://run-artifacts/model-runs/abc/volumes.geojson")).toEqual({
      bucket: "run-artifacts",
      objectPath: "model-runs/abc/volumes.geojson",
    });
  });

  it("returns null for non-storage or malformed references", () => {
    expect(parseStorageRef("https://example.com/x.geojson")).toBeNull();
    expect(parseStorageRef("local:///tmp/x.geojson")).toBeNull();
    expect(parseStorageRef("storage://only-bucket")).toBeNull();
    expect(parseStorageRef("storage://bucket/")).toBeNull();
  });
});

describe("workerLocalRoot", () => {
  const original = process.env.OPENPLAN_WORKER_LOCAL_ROOT;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENPLAN_WORKER_LOCAL_ROOT;
    else process.env.OPENPLAN_WORKER_LOCAL_ROOT = original;
  });

  it("reflects the env flag", () => {
    delete process.env.OPENPLAN_WORKER_LOCAL_ROOT;
    expect(workerLocalRoot()).toBeNull();
    process.env.OPENPLAN_WORKER_LOCAL_ROOT = "/srv/runs";
    expect(workerLocalRoot()).toBe("/srv/runs");
    expect(resolveRunWorkDir("/srv/runs", "abcdef0123456789")).toBe("/srv/runs/runs/abcdef012345");
  });
});

describe("loadJsonArtifact", () => {
  const original = process.env.OPENPLAN_WORKER_LOCAL_ROOT;

  beforeEach(() => {
    downloadMock.mockReset();
    readFileMock.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.OPENPLAN_WORKER_LOCAL_ROOT;
    else process.env.OPENPLAN_WORKER_LOCAL_ROOT = original;
  });

  it("downloads a storage:// reference via the service-role client", async () => {
    const payload = { type: "FeatureCollection", features: [] };
    downloadMock.mockResolvedValue({
      data: { text: async () => JSON.stringify(payload) },
      error: null,
    });

    const result = await loadJsonArtifact(
      "storage://run-artifacts/model-runs/abc/volumes.geojson"
    );

    expect(result).toEqual(payload);
    expect(downloadMock).toHaveBeenCalledWith(
      "run-artifacts",
      "model-runs/abc/volumes.geojson"
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("throws when the storage download errors", async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    await expect(
      loadJsonArtifact("storage://run-artifacts/missing.geojson")
    ).rejects.toThrow(/Storage download failed/);
  });

  it("refuses local:// reads unless OPENPLAN_WORKER_LOCAL_ROOT is set", async () => {
    delete process.env.OPENPLAN_WORKER_LOCAL_ROOT;
    await expect(loadJsonArtifact("local:///tmp/volumes.geojson")).rejects.toThrow(
      /Local artifact reads are disabled/
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("reads local:// paths inside the worker root when the dev flag is set", async () => {
    process.env.OPENPLAN_WORKER_LOCAL_ROOT = "/srv/runs";
    const payload = { type: "FeatureCollection", features: [] };
    readFileMock.mockResolvedValue(JSON.stringify(payload));

    const result = await loadJsonArtifact("local:///srv/runs/runs/abc/volumes.geojson");

    expect(result).toEqual(payload);
    expect(readFileMock).toHaveBeenCalledWith("/srv/runs/runs/abc/volumes.geojson", "utf8");
  });

  it("refuses local paths that escape the worker root", async () => {
    process.env.OPENPLAN_WORKER_LOCAL_ROOT = "/srv/runs";
    await expect(loadJsonArtifact("local:///etc/passwd")).rejects.toThrow(
      /escapes the worker-local root/
    );
    await expect(loadJsonArtifact("local:///srv/runs/../secrets.env")).rejects.toThrow(
      /escapes the worker-local root/
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("refuses storage refs outside the read scope", async () => {
    await expect(
      loadJsonArtifact("storage://engagement-photos/private/photo.json", {
        bucket: "run-artifacts",
        objectPathPrefix: "model-runs/abc/",
      })
    ).rejects.toThrow(/outside this run's scope/);
    await expect(
      loadJsonArtifact("storage://run-artifacts/model-runs/other-run/volumes.geojson", {
        bucket: "run-artifacts",
        objectPathPrefix: "model-runs/abc/",
      })
    ).rejects.toThrow(/outside this run's scope/);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("refuses remote URLs for scoped reads", async () => {
    await expect(
      loadJsonArtifact("https://evil.example/x.json", {
        bucket: "run-artifacts",
        objectPathPrefix: "model-runs/abc/",
      })
    ).rejects.toThrow(/not supported for scoped artifact reads/);
  });

  it("contains scoped local reads to the provided localRoot", async () => {
    process.env.OPENPLAN_WORKER_LOCAL_ROOT = "/srv/runs";
    readFileMock.mockResolvedValue(JSON.stringify({ ok: true }));

    await expect(
      loadJsonArtifact("local:///srv/runs/runs/other-run/volumes.geojson", {
        bucket: "run-artifacts",
        objectPathPrefix: "model-runs/abc/",
        localRoot: "/srv/runs/runs/abcdef012345",
      })
    ).rejects.toThrow(/escapes the worker-local root/);

    const ok = await loadJsonArtifact(
      "local:///srv/runs/runs/abcdef012345/run_output/volumes.geojson",
      {
        bucket: "run-artifacts",
        objectPathPrefix: "model-runs/abc/",
        localRoot: "/srv/runs/runs/abcdef012345",
      }
    );
    expect(ok).toEqual({ ok: true });
  });
});
