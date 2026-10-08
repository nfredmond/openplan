import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Unexpected storage access"); } }));
import { loadArtifactBytes, readContainedLocalArtifact } from "@/lib/models/artifact-source";
let root: string;
let allowed: string;
let foreign: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "openplan-artifact-containment-"));
  allowed = path.join(root, "run-a"); foreign = path.join(root, "run-b");
  await mkdir(allowed); await mkdir(foreign);
  await writeFile(path.join(allowed, "valid.json"), '{"own":true}');
  await writeFile(path.join(foreign, "foreign.json"), '{"foreign":true}');
  vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", root);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it("reads ordinary files and links contained in the same run", async () => {
  await symlink(path.join(allowed, "valid.json"), path.join(allowed, "alias.json"));
  for (const name of ["valid.json", "alias.json"]) {
    const bytes = await loadArtifactBytes("local://" + path.join(allowed, name), { bucket: "run-artifacts", objectPathPrefix: "run-a/", localRoot: allowed });
    expect(new TextDecoder().decode(bytes)).toBe('{"own":true}');
  }
});
it("refuses a file symlink to another run", async () => {
  await symlink(path.join(foreign, "foreign.json"), path.join(allowed, "escape.json"));
  await expect(loadArtifactBytes("local://" + path.join(allowed, "escape.json"), { bucket: "run-artifacts", objectPathPrefix: "run-a/", localRoot: allowed })).rejects.toThrow("target escapes");
});
it("refuses a nested directory symlink to another run", async () => {
  await symlink(foreign, path.join(allowed, "nested"));
  await expect(readContainedLocalArtifact(path.join(allowed, "nested", "foreign.json"), allowed)).rejects.toThrow("target escapes");
});
it("refuses a run directory redirected to another run", async () => {
  const redirected = path.join(root, "redirected-run"); await symlink(foreign, redirected);
  await expect(readContainedLocalArtifact(path.join(redirected, "foreign.json"), redirected)).rejects.toThrow("run directory is redirected");
});
it("permits an explicitly configured root alias", async () => {
  const alias = root + "-alias"; await symlink(root, alias);
  try {
    vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", alias);
    const bytes = await readContainedLocalArtifact(path.join(alias, "run-a", "valid.json"), path.join(alias, "run-a"));
    expect(new TextDecoder().decode(bytes)).toBe('{"own":true}');
  } finally { await rm(alias); }
});
it("refuses a scope outside the configured worker root", async () => {
  vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", allowed);
  await expect(readContainedLocalArtifact(path.join(foreign, "foreign.json"), foreign)).rejects.toThrow("escapes the worker-local root");
});
