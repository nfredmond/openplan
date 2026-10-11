// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, chmod, symlink, rename, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admitGtfsSubmission, gtfsAdmissionCommand, type GtfsAdmissionOptions } from "@/lib/gtfs/managed-admission";

const io = vi.hoisted(() => ({ syncs: [] as string[] }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, link: async (...args: Parameters<typeof actual.link>) => { await actual.link(...args); io.syncs.push(`linked:${args[1]}`); }, open: async (...args: Parameters<typeof actual.open>) => {
    const file = await actual.open(...args), sync = file.sync.bind(file);
    file.sync = async () => { io.syncs.push(String(args[0])); await sync(); }; return file;
  } };
});
const id = (n: number) => `ee000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); vi.clearAllMocks(); io.syncs = []; });
async function fixture(upload = true) {
  const directory = await mkdtemp(join(tmpdir(), "openplan-gtfs-admission-")); directories.push(directory);
  const bytes = Buffer.from("synthetic admission zip"), controller = new AbortController(), events: string[] = [];
  const registration = { requestId: id(1), feedId: id(4), versionId: id(5), createdFeed: true };
  const status = { schemaVersion: 1, requestId: id(1), versionId: id(5), feedId: id(4), workspaceId: id(2),
    state: upload ? "awaiting_archive" : "queued", stage: "pending", attempts: 0, leaseUntil: null, archiveConfirmed: false,
    submittedAt: "2026-10-10T12:00:00Z", isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false };
  let remote: Uint8Array | null = null;
  const saved = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1)!; events.push(name);
      const args = JSON.parse(String(init?.body));
      if (name === "admit_gtfs_ingest") {
        expect(args.p_actor).toBe(id(3)); expect(args.p_workspace).toBe(id(2)); expect(args.p_request).toBe(id(1));
        expect((await saved()).resolved).toEqual({ feedId: args.p_feed, source: args.p_source });
        if (upload) {
          expect((await saved()).archive).toEqual({ sha256: sha(bytes), bytes: bytes.length });
          expect(await readFile(join(directory, "archive.zip"))).toEqual(bytes);
          expect(io.syncs.some(path => path.includes("upload-") && path.endsWith(".tmp"))).toBe(true);
          expect(io.syncs.lastIndexOf(directory)).toBeGreaterThan(io.syncs.indexOf(`linked:${join(directory, "archive.zip")}`));
        }
        return Response.json(registration);
      }
      if (name === "read_gtfs_ingest_status") {
        expect(args).toEqual({ p_workspace: id(2), p_actor: id(3), p_version: id(5) }); return Response.json(status);
      }
      expect(name).toBe("confirm_gtfs_archive"); expect(args.p_token).toBeNull(); expect(args.p_version).toBe(id(5));
      expect(args.p_archive).toEqual({ path: `${id(2)}/${id(4)}/${id(5)}.zip`, sha256: sha(bytes), bytes: bytes.length });
      status.state = "queued"; status.archiveConfirmed = true;
      return Response.json({ versionId: id(5), archive: args.p_archive, confirmedAt: "2026-10-10T12:00:01Z" });
    }
    expect(url.pathname).toBe(`/storage/v1/object/gtfs-uploads/${id(2)}/${id(4)}/${id(5)}.zip`);
    if (init?.method === "POST") {
      events.push("upload"); expect(new Headers(init.headers).get("x-upsert")).toBe("false"); expect(init.signal).toBeDefined();
      remote = new Uint8Array(init.body as Uint8Array); return Response.json({ Id: id(9), Key: "synthetic" });
    }
    events.push("download"); return remote ? new Response(new Uint8Array(remote)) : Response.json({ message: "Not found", statusCode: "404" }, { status: 404 });
  });
  const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
  const resolve = vi.fn<GtfsAdmissionOptions["resolve"]>(async archive => ({ feedId: null, source: upload
    ? { kind: "upload", provisionalName: "Synthetic upload", uploadSha256: archive!.sha256, uploadBytes: archive!.bytes }
    : { kind: "url", provisionalName: "Synthetic URL", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" } }));
  const options: GtfsAdmissionOptions = { directory, target: "http://127.0.0.1:54321", installationId: id(6), workspaceId: id(2), actorId: id(3), requestId: id(1),
    intent: { kind: upload ? "upload" : "url", label: "Synthetic" }, signal: controller.signal, service, serviceKey: "synthetic-key", storageFetch: transport,
    uploadTimeoutMs: 50, upload: upload ? bytes : undefined, env: {}, resolve };
  return { directory, bytes, controller, events, registration, status, transport, service, resolve, options, saved, run: () => admitGtfsSubmission(options),
    setRemote: (value: Uint8Array | null) => { remote = value; } };
}

describe("managed GTFS admission", () => {
  it("retains private synced upload bytes before admission and verifies custody before queuing", async () => {
    const f = await fixture(); const result = await f.run();
    expect(result).toEqual({ registration: f.registration, status: f.status });
    expect(f.events).toEqual(["admit_gtfs_ingest", "read_gtfs_ingest_status", "download", "upload", "download", "confirm_gtfs_archive", "read_gtfs_ingest_status"]);
    expect((await stat(join(f.directory, "archive.zip"))).mode & 0o777).toBe(0o600); expect(result.status.state).toBe("queued");
  });
  it("recovers saved upload bytes without a second client upload or mutable resolution", async () => {
    const f = await fixture(); await f.run(); f.options.upload = undefined; f.setRemote(null); f.status.state = "awaiting_archive"; f.status.archiveConfirmed = false; f.events.length = 0;
    f.resolve.mockRejectedValue(new Error("Must use saved metadata")); expect((await f.run()).status.state).toBe("queued");
    expect(f.resolve).toHaveBeenCalledTimes(1); expect(f.events).toContain("upload");
  });
  it("retains resolved URL and original new-feed intent across a lost admission reply", async () => {
    const f = await fixture(false), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => { if (String(input).endsWith("/admit_gtfs_ingest")) { await normal(input, init); throw new Error("lost"); } return normal(input, init); });
    await expect(f.run()).rejects.toThrow("acknowledgement unavailable"); f.transport.mockImplementation(normal);
    f.resolve.mockResolvedValue({ feedId: id(4), source: { kind: "url", provisionalName: "Changed", sourceUrl: "https://other.invalid/", normalizedSourceUrl: "https://other.invalid/" } });
    expect((await f.run()).registration.createdFeed).toBe(true); expect(f.resolve).toHaveBeenCalledTimes(1);
  });
  it("rechecks SQL authorization instead of accepting only the local admission receipt", async () => {
    const f = await fixture(false); await f.run(); const normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => String(input).endsWith("/admit_gtfs_ingest") ? Response.json({ message: "Denied" }, { status: 403 }) : normal(input, init));
    await expect(f.run()).rejects.toThrow("acknowledgement unavailable");
  });
  it("reconciles an uncertain upload response against actual object bytes", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => { if (init?.method === "POST" && String(input).includes("/storage/")) { await normal(input, init); throw new Error("lost"); } return normal(input, init); });
    expect((await f.run()).status.archiveConfirmed).toBe(true); expect(f.events.filter(event => event === "download")).toHaveLength(2);
  });
  it("refuses path-only upload success without actual bytes", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => init?.method === "POST" && String(input).includes("/storage/") ? Response.json({ Key: "synthetic" }) : normal(input, init));
    await expect(f.run()).rejects.toThrow("upload is unconfirmed"); expect(f.events).not.toContain("confirm_gtfs_archive");
  });
  it("refuses mismatched remote bytes without attempting an overwrite", async () => {
    const f = await fixture(); f.setRemote(Buffer.from("conflicting zip bytes!"));
    await expect(f.run()).rejects.toThrow("immutable archive differs"); expect(f.events).not.toContain("upload"); expect(f.events).not.toContain("confirm_gtfs_archive");
  });
  it("recovers a lost archive confirmation reply without uploading again", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => { if (String(input).endsWith("/confirm_gtfs_archive")) { await normal(input, init); throw new Error("lost"); } return normal(input, init); });
    await expect(f.run()).rejects.toThrow("acknowledgement unavailable"); f.transport.mockImplementation(normal); f.events.length = 0;
    expect((await f.run()).status.state).toBe("queued"); expect(f.events).toEqual(["admit_gtfs_ingest", "read_gtfs_ingest_status"]);
  });
  it.each(["workspaceId", "actorId", "requestId", "installationId", "target", "intent"])("refuses changed %s binding before SQL", async field => {
    const f = await fixture(false); await f.run(); const saved = await f.saved(); saved.binding[field] = field === "intent" ? { changed: true } : field === "target" ? "http://other.invalid" : id(99);
    await writeFile(join(f.directory, "pending.json"), JSON.stringify(saved)); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("binding differs"); expect(f.events).toEqual([]);
  });
  it("refuses different upload bytes under the retained request before SQL", async () => {
    const f = await fixture(); await f.run(); f.options.upload = Buffer.from(f.bytes); f.options.upload[0] ^= 1; f.events.length = 0;
    await expect(f.run()).rejects.toThrow("uploaded bytes differ"); expect(f.events).toEqual([]);
  });
  it("refuses altered local bytes before SQL even after admission", async () => {
    const f = await fixture(); await f.run(); const changed = Buffer.from(f.bytes); changed[0] ^= 1; await writeFile(join(f.directory, "archive.zip"), changed); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("archive content differs"); expect(f.events).toEqual([]);
  });
  it("refuses changed local archive size before SQL", async () => {
    const f = await fixture(); await f.run(); await writeFile(join(f.directory, "archive.zip"), f.bytes.subarray(1)); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("archive size differs"); expect(f.events).toEqual([]);
  });
  it("refuses resolved ZIP identity that differs from saved bytes", async () => {
    const f = await fixture(); f.resolve.mockResolvedValue({ feedId: null, source: { kind: "upload", provisionalName: "ZIP", uploadSha256: "0".repeat(64), uploadBytes: f.bytes.length } });
    await expect(f.run()).rejects.toThrow("upload differs from resolved source"); expect(f.events).toEqual([]);
  });
  it("refuses a missing saved archive when the client does not supply exact bytes", async () => {
    const f = await fixture(); await f.run(); await rm(join(f.directory, "archive.zip")); f.options.upload = undefined; f.events.length = 0;
    await expect(f.run()).rejects.toThrow("saved archive is unavailable"); expect(f.events).toEqual([]);
  });
  it.each(["public", "symlink"])("refuses %s local archive files", async kind => {
    const f = await fixture(); await f.run(); const path = join(f.directory, "archive.zip");
    if (kind === "public") await chmod(path, 0o644); else { await rename(path, `${path}.original`); await symlink(`${path}.original`, path); }
    await expect(f.run()).rejects.toThrow();
  });
  it("refuses an existing archive without a private request binding", async () => {
    const f = await fixture(); await writeFile(join(f.directory, "archive.zip"), f.bytes, { mode: 0o600 });
    await expect(f.run()).rejects.toThrow("file has no binding"); expect(f.events).toEqual([]);
  });
  it.each(["provided", "retained"])("checks the %s upload against the current size cap before SQL", async kind => {
    const f = await fixture(); if (kind === "retained") { await f.run(); f.options.upload = undefined; f.events.length = 0; }
    f.options.env = { OPENPLAN_GTFS_MAX_ARCHIVE_BYTES: "10" }; await expect(f.run()).rejects.toThrow("exceeds configured bound"); expect(f.events).toEqual([]);
  });
  it("refuses oversized intent before resolving source or sending SQL", async () => {
    const f = await fixture(false); f.options.intent = { text: "x".repeat(66000) };
    await expect(f.run()).rejects.toThrow("record exceeds configured bound"); expect(f.resolve).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });
  it.each(["workspaceId", "feedId", "requestId"])("refuses a changed %s status before archive I/O", async field => {
    const f = await fixture(); Object.assign(f.status, { [field]: id(99) });
    await expect(f.run()).rejects.toThrow("status scope differs"); expect(f.events).not.toContain("download");
  });
  it("refuses a changed retained admission receipt", async () => {
    const f = await fixture(false); await f.run(); f.registration.versionId = id(99); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("retained admission response differs"); expect(f.events).not.toContain("read_gtfs_ingest_status");
  });
  it.each(["receipt", "status"])("refuses changed archive confirmation %s", async kind => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => {
      const result = await normal(input, init);
      if (String(input).endsWith("/confirm_gtfs_archive")) {
        if (kind === "status") f.status.archiveConfirmed = false;
        else return Response.json({ ...(await result.json()), versionId: id(99) });
      }
      return result;
    });
    await expect(f.run()).rejects.toThrow(kind === "receipt" ? "confirmation differs" : "confirmed admission status differs");
  });
  it("passes cancellation through the upload transport and refuses confirmation", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!; let observed: AbortSignal | null | undefined;
    f.transport.mockImplementation(async (input, init) => {
      if (String(input).includes("/storage/") && init?.method === "POST") { observed = init.signal; f.controller.abort(new Error("shutdown")); return new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ Key: "late" })), 300)); }
      return normal(input, init);
    });
    const started = performance.now();
    await expect(f.run()).rejects.toThrow("shutdown"); expect(performance.now() - started).toBeLessThan(180);
    expect(observed?.aborted).toBe(true); expect(f.events).not.toContain("confirm_gtfs_archive");
  });
  it("bounds a stalled upload acknowledgement and leaves custody unconfirmed", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!; let observed: AbortSignal | null | undefined;
    f.transport.mockImplementation(async (input, init) => {
      if (String(input).includes("/storage/") && init?.method === "POST") { observed = init.signal; return new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ Key: "late" })), 300)); }
      return normal(input, init);
    });
    const started = performance.now();
    await expect(f.run()).rejects.toThrow("upload is unconfirmed"); expect(performance.now() - started).toBeLessThan(180);
    expect(observed?.aborted).toBe(true); expect(f.events).not.toContain("confirm_gtfs_archive");
  });
  it.each(["target", "relative", "cancelled"])("refuses %s admission before source work", async kind => {
    const f = await fixture(false);
    if (kind === "target") f.options.target = "http://user:password@127.0.0.1:54321";
    if (kind === "relative") f.options.directory = relative(process.cwd(), join(f.directory, "relative"));
    if (kind === "cancelled") f.controller.abort(new Error("shutdown"));
    await expect(f.run()).rejects.toThrow(); expect(f.resolve).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
    if (kind === "cancelled") expect(await readdir(f.directory)).toEqual([]);
  });
  it("refuses a second admission process while the same request is resolving", async () => {
    const f = await fixture(false); let finish!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; }), normal = f.resolve.getMockImplementation()!;
    f.resolve.mockImplementation(async archive => {
      if (f.resolve.mock.calls.length > 1) return normal(archive);
      started(); await new Promise<void>(resolve => { finish = resolve; }); return normal(archive);
    });
    const first = f.run(); await waiting;
    try { await expect(f.run()).rejects.toThrow("connector_already_running"); } finally { finish(); await first; }
  });
});

describe("admission command scope", () => {
  const scope = { workspaceId: id(2), actorId: id(3), requestId: id(1) };
  const source = { kind: "url" as const, provisionalName: "URL feed", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" };
  it("verifies original request and existing feed receipts", () => {
    const command = gtfsAdmissionCommand(scope, { feedId: id(4), source });
    const receipt = { requestId: id(1), feedId: id(4), versionId: id(5), createdFeed: false };
    expect(command.verify(receipt)).toEqual(receipt);
    for (const changed of [{ requestId: id(99) }, { feedId: id(99) }, { createdFeed: true }]) expect(() => command.verify({ ...receipt, ...changed })).toThrow("receipt scope differs");
  });
  it.each([
    { normalizedSourceUrl: "https://other.invalid/" }, { uploadSha256: "0".repeat(64) },
    { kind: "catalog", catalogSourceId: " " }, { kind: "upload", uploadSha256: "0".repeat(64), uploadBytes: 1 },
  ])("refuses inconsistent source metadata %j", changed => {
    expect(() => gtfsAdmissionCommand(scope, { feedId: null, source: { ...source, ...changed } as Parameters<typeof gtfsAdmissionCommand>[1]["source"] })).toThrow();
  });
});
