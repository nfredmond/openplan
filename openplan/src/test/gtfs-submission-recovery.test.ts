// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, rename, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admitGtfsSubmission } from "@/lib/gtfs/managed-admission";
import { runGtfsSubmissionRecoveryPass, type GtfsSubmissionRecoveryOptions } from "@/lib/gtfs/managed-submission-recovery";
vi.mock("@/lib/gtfs/managed-admission", async original => ({ ...await original<typeof import("@/lib/gtfs/managed-admission")>(), admitGtfsSubmission: vi.fn() }));
const id = (n: number) => `ec000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const directories: string[] = [], admit = vi.mocked(admitGtfsSubmission);
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); vi.clearAllMocks(); });
beforeEach(() => { admit.mockImplementation(async options => {
  const file = join(options.directory, "pending.json"), saved = JSON.parse(await readFile(file, "utf8"));
  if (saved.resolved === null) saved.resolved = await options.resolve(saved.archive);
  saved.response = { requestId: options.requestId, feedId: id(20), versionId: id(21), createdFeed: true };
  await writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  return { registration: saved.response, status: { schemaVersion: 1, requestId: options.requestId, feedId: id(20), versionId: id(21), workspaceId: options.workspaceId,
    state: "queued", stage: "pending", attempts: 0, leaseUntil: null, archiveConfirmed: true, submittedAt: "2026-10-10T12:00:00Z", isCurrent: false,
    failureCode: null, failureDetail: null, submitterAccessUnavailable: false } };
}); });
async function fixture(count = 1) {
  const directory = await mkdtemp(join(tmpdir(), "openplan-submission-recovery-")); directories.push(directory);
  const target = "http://127.0.0.1:54321", controller = new AbortController();
  const service = createClient(target, "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const authorize = vi.fn<GtfsSubmissionRecoveryOptions["authorize"]>(async () => {});
  const resolve = vi.fn<GtfsSubmissionRecoveryOptions["resolve"]>(async () => {
    expect(authorize).toHaveBeenCalled();
    return { feedId: null, source: { kind: "url", provisionalName: "Retained source", sourceUrl: "https://example.invalid/original.zip", normalizedSourceUrl: "https://example.invalid/original.zip" } };
  });
  const options: GtfsSubmissionRecoveryOptions = { directory, target, installationId: id(9), service, serviceKey: "synthetic-key", signal: controller.signal,
    authorize, resolve, maxJobs: 1, maxRecords: 10 };
  for (let n = 1; n <= count; n++) {
    const path = join(directory, id(n)); await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, "pending.json"), JSON.stringify({ binding: { schemaVersion: 1, target, installationId: id(9), workspaceId: id(10), actorId: id(11), requestId: id(n),
      intent: { source: "url", workspaceId: id(10), url: "https://example.invalid/original.zip" } }, resolved: null, archive: null, response: null }), { mode: 0o600 });
  }
  const edit = async (n: number, change: (value: Record<string, unknown>) => void) => {
    const path = join(directory, id(n), "pending.json"), value = JSON.parse(await readFile(path, "utf8")); change(value); await writeFile(path, JSON.stringify(value));
  };
  return { directory, target, controller, options, authorize, resolve, edit, run: () => runGtfsSubmissionRecoveryPass(options),
    marker: (n = 1) => readFile(join(directory, id(n), "handoff/pending.json"), "utf8").then(JSON.parse) };
}
describe("retained transit submission polling", () => {
  it("authorizes the original actor and hands off exact retained intent without resupplying bytes", async () => {
    const f = await fixture(), result = await f.run(); expect(result).toEqual({ outcomes: [{ requestId: id(1), state: "handed_off" }], pendingCount: 0 });
    expect(f.authorize.mock.calls[0][0].binding).toMatchObject({ actorId: id(11), workspaceId: id(10), requestId: id(1) });
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ target: f.target, installationId: id(9), actorId: id(11), workspaceId: id(10), requestId: id(1),
      directory: join(f.directory, id(1)), intent: { source: "url", workspaceId: id(10), url: "https://example.invalid/original.zip" } }));
    expect(admit.mock.calls[0][0].upload).toBeUndefined(); expect((await f.marker()).response.requestId).toBe(id(1));
  });
  it("skips proven handoff history and keeps a queued handoff distinct from processing completion", async () => {
    const f = await fixture(); await f.run(); admit.mockClear(); f.authorize.mockClear(); expect(await f.run()).toEqual({ outcomes: [], pendingCount: 0 });
    expect(admit).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled(); expect(await f.marker()).not.toHaveProperty("completion");
  });
  it("rotates persistent refusals so later requests are recovered in bounded passes", async () => {
    const f = await fixture(3); f.authorize.mockImplementation(async saved => { if (saved.binding.requestId === id(1)) throw new Error("revoked"); });
    expect((await f.run()).pendingCount).toBe(3); expect(admit).not.toHaveBeenCalled();
    expect((await f.run()).outcomes).toEqual([{ requestId: id(2), state: "handed_off" }]);
    expect((await f.run()).outcomes).toEqual([{ requestId: id(3), state: "handed_off" }]);
    expect(admit).toHaveBeenCalledTimes(2); expect((await f.run()).outcomes).toEqual([{ requestId: id(1), state: "unconfirmed" }]);
  });
  it("does not resolve or admit when original authorization is unavailable", async () => {
    const f = await fixture(); f.authorize.mockRejectedValue(new Error("lookup unavailable")); expect((await f.run()).pendingCount).toBe(1);
    expect(f.resolve).not.toHaveBeenCalled(); expect(admit).not.toHaveBeenCalled(); await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains an unavailable admission without writing a handoff marker", async () => {
    const f = await fixture(); admit.mockRejectedValue(new Error("lost commit reply")); expect((await f.run()).outcomes[0].state).toBe("unconfirmed");
    await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not hand off an archive that remains unconfirmed", async () => {
    const f = await fixture(), normal = admit.getMockImplementation()!;
    admit.mockImplementation(async options => { const result = await normal(options); result.status.state = "awaiting_archive"; result.status.archiveConfirmed = false; return result; });
    expect((await f.run()).pendingCount).toBe(1); await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["requestId", "workspaceId", "feedId", "versionId"] as const)("refuses a recovered response with changed %s", async field => {
    const f = await fixture(), normal = admit.getMockImplementation()!;
    admit.mockImplementation(async options => { const result = await normal(options); result.status[field] = id(90); return result; });
    expect((await f.run()).outcomes[0].state).toBe("unconfirmed"); await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses an admission whose saved receipt does not match its reply", async () => {
    const f = await fixture(), normal = admit.getMockImplementation()!;
    admit.mockImplementation(async options => { const result = await normal(options); await f.edit(1, value => { (value.response as { versionId: string }).versionId = id(90); }); return result; });
    expect((await f.run()).pendingCount).toBe(1); await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses an admission whose saved actor changes during recovery", async () => {
    const f = await fixture(), normal = admit.getMockImplementation()!;
    admit.mockImplementation(async options => { const result = await normal(options); await f.edit(1, value => { (value.binding as { actorId: string }).actorId = id(90); }); return result; });
    expect((await f.run()).pendingCount).toBe(1); await expect(f.marker()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["installationId", "target", "requestId"])("refuses retained %s scope before authorization or admission", async field => {
    const f = await fixture(); await f.edit(1, value => { (value.binding as Record<string, unknown>)[field] = field === "target" ? "http://other.invalid" : id(90); });
    expect((await f.run()).pendingCount).toBe(1); expect(f.authorize).not.toHaveBeenCalled(); expect(admit).not.toHaveBeenCalled();
  });
  it("refuses a mismatched existing handoff without declaring it settled", async () => {
    const f = await fixture(); await f.run(); const path = join(f.directory, id(1), "handoff/pending.json"), marker = await f.marker(); marker.response.versionId = id(90);
    await writeFile(path, JSON.stringify(marker)); admit.mockClear(); expect((await f.run()).pendingCount).toBe(1); expect(admit).not.toHaveBeenCalled();
  });
  it("refuses private installation rebinding", async () => {
    const f = await fixture(); await f.run(); f.options.installationId = id(90); admit.mockClear(); await expect(f.run()).rejects.toThrow("installation differs"); expect(admit).not.toHaveBeenCalled();
  });
  it("refuses a public request directory before authorization", async () => {
    const f = await fixture(); await chmod(join(f.directory, id(1)), 0o755); expect((await f.run()).pendingCount).toBe(1); expect(f.authorize).not.toHaveBeenCalled();
  });
  it("refuses request symlinks before reading their private record", async () => {
    const f = await fixture(), destination = await mkdtemp(join(tmpdir(), "openplan-submission-other-")); directories.push(destination);
    await rename(join(f.directory, id(1)), join(destination, "retained")); await symlink(join(destination, "retained"), join(f.directory, id(1))); expect((await f.run()).pendingCount).toBe(1); expect(f.authorize).not.toHaveBeenCalled();
  });
  it("refuses public retained records before authorization", async () => {
    const f = await fixture(); await chmod(join(f.directory, id(1), "pending.json"), 0o644); expect((await f.run()).pendingCount).toBe(1); expect(f.authorize).not.toHaveBeenCalled();
  });
  it("refuses oversized inventory before any request processing", async () => {
    const f = await fixture(4); f.options.maxRecords = 1; await expect(f.run()).rejects.toThrow("inventory exceeds"); expect(admit).not.toHaveBeenCalled();
  });
  it.each([0, 101, 1.5])("refuses invalid per-pass limit %s", async maxJobs => {
    const f = await fixture(); f.options.maxJobs = maxJobs; await expect(f.run()).rejects.toThrow(); expect(admit).not.toHaveBeenCalled();
  });
  it("refuses relative directories before reading", async () => {
    const f = await fixture(); f.options.directory = relative(process.cwd(), f.directory); await expect(f.run()).rejects.toThrow(); expect(admit).not.toHaveBeenCalled();
  });
  it.each(["file:///tmp/other", "http://user:secret@other.invalid", "http://other.invalid/?x=1"])("refuses invalid targets %s", async target => {
    const f = await fixture(); f.options.target = target; await expect(f.run()).rejects.toThrow("target is invalid"); expect(admit).not.toHaveBeenCalled();
  });
  it("stops before processing a pre-cancelled request", async () => {
    const f = await fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow(); expect(admit).not.toHaveBeenCalled(); expect(await readdir(f.directory)).toEqual([id(1)]);
  });
  it("stops after authorization loses ownership and releases its lock", async () => {
    const f = await fixture(); f.authorize.mockImplementationOnce(async () => { f.controller.abort(); }); await expect(f.run()).rejects.toThrow(); expect(admit).not.toHaveBeenCalled();
    f.options.signal = new AbortController().signal; expect((await f.run()).outcomes[0].state).toBe("handed_off");
  });
  it("serializes concurrent recovery passes and propagates a live combined signal", async () => {
    const f = await fixture(); let enter = () => {}, release = () => {}; const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    f.authorize.mockImplementationOnce(async (_saved, signal) => { expect(signal.aborted).toBe(false); enter(); await held; });
    const first = f.run(); await entered; try { await expect(f.run()).rejects.toThrow("connector_already_running"); } finally { release(); await first; }
  });
});
