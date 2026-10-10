// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
import { loadArtifactBytes, resolveRunWorkDir } from "@/lib/models/artifact-source";

const runs = ["12345678-1234-4123-8123-123456789abc", "12345678-1234-4567-8567-987654321abc"];
afterEach(() => vi.unstubAllEnvs());

it("reads only the authorized full run directory with actual filesystem bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openplan-run-identity-"));
  vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", root);
  try {
    for (const run of runs) {
      const directory = path.join(root, "runs", run);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "output.json"), JSON.stringify({ run }));
    }
    const legacy = path.join(root, "runs", runs[0].slice(0, 12));
    await mkdir(legacy);
    await writeFile(path.join(legacy, "output.json"), "unknown historical owner");
    for (const run of runs) {
      const scope = { bucket: "run-artifacts", objectPathPrefix: `model-runs/${run}/`, localRoot: resolveRunWorkDir(root, run) };
      const bytes = await loadArtifactBytes(`local://${path.join(root, "runs", run, "output.json")}`, scope);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ run });
      const other = runs.find((value) => value !== run)!;
      await expect(loadArtifactBytes(`local://${path.join(root, "runs", other, "output.json")}`, scope)).rejects.toThrow("escapes");
      await expect(loadArtifactBytes(`local://${path.join(legacy, "output.json")}`, scope)).rejects.toThrow("escapes");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["../../escape", runs[0].toUpperCase(), runs[0].slice(0, 12)])("refuses noncanonical identity %s", (run) => {
  expect(() => resolveRunWorkDir("/tmp/owned", run)).toThrow("canonical UUID");
});
