import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const control = vi.hoisted(() => ({ target: "", root: "", parent: "", foreign: "", foreignAncestor: "", phase: "", changed: false, openCount: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  async function change(at: string) {
    if (control.changed || at !== control.phase) return;
    control.changed = true;
    const source = at === "ancestor" ? path.dirname(control.root) : at === "resolved" ? control.root : at === "final-file" ? control.target : control.parent;
    await actual.rename(source, source + "-saved");
    await actual.symlink(at === "ancestor" ? control.foreignAncestor : at === "final-file" ? path.join(control.foreign, "marker") : control.foreign, source);
  }
  const realpath = async (value: string) => {
    const result = await actual.realpath(value);
    if (value === control.target) { await change("resolved"); await change("ancestor"); }
    return result;
  };
  const open: typeof actual.open = async (file, flags, mode) => {
    const handle = await actual.open(file, flags, mode);
    control.openCount++;
    const close = handle.close.bind(handle);
    handle.close = async () => { try { await close(); } finally { control.openCount--; } };
    if (file === control.root) await change("root-open");
    if (String(file).startsWith("/proc/self/fd/") && String(file).endsWith("/output")) {
      await change("directory-open"); await change("final-file");
    }
    return handle;
  };
  return { ...actual, realpath, open, default: { ...actual, realpath, open } };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Unexpected storage access"); } }));
import { readContainedLocalArtifact } from "@/lib/models/artifact-source";
import { readPinnedLocalFile } from "@/lib/models/local-artifact-file";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["none", "resolved", "ancestor", "root-open", "directory-open", "final-file"])("keeps foreign bytes out during %s replacement", async (phase) => {
  const base = await mkdtemp(path.join(tmpdir(), "openplan-native-race-"));
  const root = path.join(base, "worker", "run-a"), parent = path.join(root, "output"), foreign = path.join(base, "run-b");
  try {
    await mkdir(parent, { recursive: true }); await mkdir(foreign);
    const foreignAncestor = path.join(base, "foreign-root");
    await mkdir(path.join(foreignAncestor, "run-a", "output"), { recursive: true });
    await writeFile(path.join(foreignAncestor, "run-a", "output", "marker"), "FOREIGN");
    const target = path.join(parent, "marker");
    await writeFile(target, "OWN"); await writeFile(path.join(foreign, "marker"), "FOREIGN");
    Object.assign(control, { target, root, parent, foreign, foreignAncestor, phase, changed: false, openCount: 0 });
    vi.stubEnv("OPENPLAN_WORKER_LOCAL_ROOT", base);
    const read = readContainedLocalArtifact(target, root);
    if (phase === "none" || phase === "directory-open") expect(new TextDecoder().decode(await read)).toBe("OWN");
    else await expect(read).rejects.toThrow();
    expect(control.changed).toBe(phase !== "none");
    expect(control.openCount).toBe(0);
  } finally { await rm(base, { recursive: true, force: true }); }
});
it("refuses unsupported local platforms instead of using an unchecked fallback", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  await expect(readPinnedLocalFile("/missing", "/missing/file")).rejects.toThrow("Linux reference host");
});
