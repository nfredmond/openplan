// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, chmod, symlink, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareGtfsSourceArchive, processGtfsSourceArchive, gtfsIntakeStorage, type GtfsIntakeOptions } from "@/lib/gtfs/managed-worker-intake";
import { fetchGtfsFeedBytes } from "@/lib/gtfs/fetch";
import { processGtfsRetainedArchive } from "@/lib/gtfs/managed-worker-publication";
import type { GtfsOwnedWork } from "@/lib/gtfs/managed-worker-attempt";

const io = vi.hoisted(() => ({ syncs: [] as string[] }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const file = await actual.open(...args), sync = file.sync.bind(file);
    file.sync = async () => { io.syncs.push(String(args[0])); await sync(); };
    return file;
  } };
});
vi.mock("@/lib/gtfs/fetch", () => ({ fetchGtfsFeedBytes: vi.fn() }));
vi.mock("@/lib/gtfs/managed-worker-publication", () => ({ processGtfsRetainedArchive: vi.fn() }));
const fetchSource = vi.mocked(fetchGtfsFeedBytes), parse = vi.mocked(processGtfsRetainedArchive);
const id = (n: number) => `ed000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const parserOptions = { maxOutputBytes: 65536, maxOldSpaceMb: 128, renewEveryMs: 100, renewTimeoutMs: 1000, maxRuntimeMs: 8000, terminationGraceMs: 100 };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.clearAllMocks(); io.syncs = [];
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-gtfs-intake-")); directories.push(directory);
  const bytes = Buffer.from("synthetic saved archive");
  const archive = { path: `${id(2)}/${id(3)}/${id(1)}.zip`, sha256: sha(bytes), bytes: bytes.length };
  const controller = new AbortController();
  const snapshot: GtfsOwnedWork["snapshot"] = { schemaVersion: 1, versionId: id(1), workspaceId: id(2), feedId: id(3), actorId: id(4), requestId: id(5),
    state: "running", stage: "pending", attempts: 1, claim: { token: id(6), version_id: id(1), attempt: 1,
      claimed_at: "2026-10-10T12:00:00Z", initial_lease_until: "2026-10-10T12:02:00Z" }, active: true, prepared: false,
    source: { kind: "url", provisionalName: "Synthetic feed", sourceUrl: "https://example.invalid/feed.zip", normalizedSourceUrl: "https://example.invalid/feed.zip" },
    archive: null, archiveConfirmed: false, plan: null, tract: null, completion: null };
  const current = structuredClone(snapshot);
  let remote: Uint8Array | null = null;
  const events: string[] = [];
  const saved = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const deliver = vi.fn<GtfsOwnedWork["deliver"]>(async (slot, command) => {
    events.push(slot);
    if (command.operation === "prepare_archive") {
      expect((await saved()).archive).toEqual(archive);
      expect(await readFile(join(directory, "archive.zip"))).toEqual(bytes);
      expect(io.syncs.some(path => path.includes("source-") && path.endsWith(".tmp"))).toBe(true);
      expect(io.syncs).toContain(directory);
      current.archive = structuredClone(command.input);
    }
    if (command.operation === "confirm_archive") current.archiveConfirmed = true;
    if (command.operation === "stage") current.stage = command.input;
    return { commandId: id(7), receipt: { versionId: id(1), stage: "fetching" }, retained: false };
  });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/read_gtfs_ingest_attempt")) {
      events.push("refresh"); expect(JSON.parse(String(init?.body))).toEqual({ p_version: current.versionId, p_token: current.claim.token });
      return Response.json(current);
    }
    expect(url.pathname).toBe(`/storage/v1/object/gtfs-uploads/${archive.path}`);
    if (init?.method === "POST") {
      events.push("upload"); expect(init.headers).toBeDefined();
      expect(new Headers(init.headers).get("x-upsert")).toBe("false");
      expect(init.signal).toBeDefined(); expect(init.signal?.aborted).toBe(false);
      expect(await readFile(join(directory, "archive.zip"))).toEqual(bytes);
      expect((await saved()).archive).toEqual(archive);
      remote = new Uint8Array(init.body as Uint8Array);
      return Response.json({ Id: id(9), Key: `gtfs-uploads/${archive.path}` });
    }
    events.push("download");
    return remote ? new Response(new Uint8Array(remote)) : Response.json({ message: "Not found", statusCode: "404", error: "not_found" }, { status: 404 });
  });
  const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
  const options: GtfsIntakeOptions = { directory, installationId: id(8), target: "http://127.0.0.1:54321", owned: { snapshot, signal: controller.signal, deliver },
    service, serviceKey: "synthetic-key", storageFetch: transport, uploadTimeoutMs: 1000, fetchOptions: { env: {} } };
  fetchSource.mockImplementation(async (_url, request) => {
    request?.signal?.throwIfAborted(); events.push("fetch");
    return { ok: true, bytes, checksumSha256: sha(bytes), finalUrl: "https://example.invalid/mirror.zip", hops: ["https://example.invalid/feed.zip", "https://example.invalid/mirror.zip"],
      httpStatus: 200, contentType: "application/zip", elapsedMs: 1 };
  });
  const run = () => prepareGtfsSourceArchive(options);
  return { directory, bytes, archive, snapshot, current, controller, deliver, transport, options, events, saved, run,
    setRemote: (value: Uint8Array | null) => { remote = value; } };
}

describe("managed GTFS source intake", () => {
  it("saves private synced bytes before preparation/upload and checks actual remote bytes before confirmation", async () => {
    const f = await fixture(), result = await f.run();
    expect(result.ok).toBe(true);
    expect(f.events).toEqual(["fetching", "fetch", "archive-preparation", "download", "upload", "download", "archive-confirmation", "refresh"]);
    expect((await f.saved()).provenance.hops).toHaveLength(2);
    expect((await stat(join(f.directory, "archive.zip"))).mode & 0o777).toBe(0o600);
    if (result.ok) expect(result.owned.snapshot).toEqual(f.current);
    expect(f.snapshot.archive).toBeNull();
  });
  it("recovers saved bytes under a replacement claim without fetching a changed URL", async () => {
    const f = await fixture(); await f.run();
    fetchSource.mockImplementation(async () => { throw new Error("Mutable URL must not be fetched"); });
    const replacement = { ...structuredClone(f.current), attempts: 2, claim: { ...f.snapshot.claim, token: id(99), attempt: 2 } };
    f.options.owned.snapshot = replacement; Object.assign(f.current, replacement); f.setRemote(null); f.events.length = 0;
    expect((await f.run()).ok).toBe(true);
    expect(f.events).toEqual(["archive-preparation", "download", "upload", "download", "archive-confirmation", "refresh"]);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it("recovers a complete linked file when its receipt was interrupted", async () => {
    const f = await fixture(); await f.run(); const saved = await f.saved(); saved.archive = null;
    await writeFile(join(f.directory, "pending.json"), JSON.stringify(saved)); f.events.length = 0;
    expect((await f.run()).ok).toBe(true); expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it("reconciles a lost upload reply using the actual immutable object", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/storage/v1/")) { await normal(input, init); throw new Error("Lost upload reply"); }
      return normal(input, init);
    });
    expect((await f.run()).ok).toBe(true);
    expect(f.events.filter(event => event === "download")).toHaveLength(2);
  });
  it("refuses a path-only upload acknowledgement with no object bytes", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => init?.method === "POST" ? Response.json({ Id: id(9), Key: `gtfs-uploads/${f.archive.path}` }) : normal(input, init));
    await expect(f.run()).rejects.toThrow("uploaded archive is unconfirmed");
    expect(f.events).not.toContain("archive-confirmation"); expect(f.events).not.toContain("refresh");
  });
  it("refuses mismatched existing bytes without overwriting the object", async () => {
    const f = await fixture(); f.setRemote(Buffer.from("altered saved archive!!"));
    await expect(f.run()).rejects.toThrow("immutable archive differs");
    expect(f.events).not.toContain("upload"); expect(f.events).not.toContain("archive-confirmation");
  });
  it("refuses a conflicting object after uncertain upload", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => {
      if (init?.method === "POST") { f.setRemote(Buffer.from("altered saved archive!!")); return Response.json({ message: "Duplicate" }, { status: 409 }); }
      return normal(input, init);
    });
    await expect(f.run()).rejects.toThrow("uploaded archive is unconfirmed"); expect(f.events).not.toContain("archive-confirmation");
  });
  it.each(["actorId", "requestId", "workspaceId", "feedId", "source", "installationId", "target"])("refuses changed %s source binding", async field => {
    const f = await fixture(); await f.run(); const saved = await f.saved();
    saved.binding[field] = field === "source" ? { ...saved.binding.source, provisionalName: "Changed source" } : field === "target" ? "http://other.invalid" : id(98);
    await writeFile(join(f.directory, "pending.json"), JSON.stringify(saved)); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("source binding differs"); expect(f.events).toEqual([]);
  });
  it("refuses changed local bytes without refetching", async () => {
    const f = await fixture(); await f.run(); const changed = Buffer.from(f.bytes); changed[0] ^= 1;
    await writeFile(join(f.directory, "archive.zip"), changed); f.events.length = 0;
    await expect(f.run()).rejects.toThrow("saved source bytes differ"); expect(f.events).toEqual([]); expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it("refuses a missing saved file without refetching", async () => {
    const f = await fixture(); await f.run(); await rm(join(f.directory, "archive.zip")); f.events.length = 0;
    await expect(f.run()).rejects.toMatchObject({ code: "ENOENT" }); expect(f.events).toEqual([]); expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it.each(["public", "symlink"])("refuses %s local source files", async kind => {
    const f = await fixture(); await f.run(); const path = join(f.directory, "archive.zip");
    if (kind === "public") await chmod(path, 0o644); else { await rename(path, `${path}.original`); await symlink(`${path}.original`, path); }
    await expect(f.run()).rejects.toThrow(); expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it("refuses an unbound existing local file", async () => {
    const f = await fixture(); await writeFile(join(f.directory, "archive.zip"), f.bytes, { mode: 0o600 });
    await expect(f.run()).rejects.toThrow("source file has no binding"); expect(fetchSource).not.toHaveBeenCalled();
  });
  it("recovers already prepared remote bytes into a new private directory without URL fetch", async () => {
    const f = await fixture(); f.snapshot.archive = f.archive; f.current.archive = f.archive; f.setRemote(f.bytes);
    f.deliver.mockImplementation(async (slot, command) => { f.events.push(slot); if (command.operation === "confirm_archive") f.current.archiveConfirmed = true;
      return { commandId: id(7), receipt: { versionId: id(1), stage: "fetching" }, retained: false }; });
    expect((await f.run()).ok).toBe(true); expect(fetchSource).not.toHaveBeenCalled();
    expect(await readFile(join(f.directory, "archive.zip"))).toEqual(f.bytes);
  });
  it("refuses a prepared but unavailable archive without fetching its mutable source", async () => {
    const f = await fixture(); f.snapshot.archive = f.archive; f.current.archive = f.archive;
    await expect(f.run()).rejects.toThrow("prepared source cannot be recovered"); expect(fetchSource).not.toHaveBeenCalled();
  });
  it("refuses local bytes when the prepared source differs", async () => {
    const f = await fixture(); await f.run(); f.snapshot.archive = { ...f.archive, sha256: "0".repeat(64) };
    f.events.length = 0;
    await expect(f.run()).rejects.toThrow("prepared source bytes differ"); expect(f.events).toEqual([]);
  });
  it("refuses source bytes over the current installation cap before preparing or uploading", async () => {
    const f = await fixture(); f.options.fetchOptions = { env: { OPENPLAN_GTFS_MAX_ARCHIVE_BYTES: "10" } };
    await expect(f.run()).rejects.toThrow("source size exceeds configured bound");
    expect(f.events).not.toContain("archive-preparation"); expect(f.events).not.toContain("upload");
  });
  it("refuses oversized source metadata before source I/O", async () => {
    const f = await fixture(); f.snapshot.source.sourceUrl = "https://example.invalid/" + "x".repeat(66000);
    await expect(f.run()).rejects.toThrow("source record exceeds configured bound"); expect(f.events).toEqual([]);
  });
  it.each(["inactive", "invalid-target"])("refuses %s intake before I/O", async kind => {
    const f = await fixture();
    if (kind === "inactive") f.snapshot.active = false; else f.options.target = "http://user:password@127.0.0.1:54321";
    await expect(f.run()).rejects.toThrow(kind === "inactive" ? "active attempt" : "target is invalid");
    expect(f.events).toEqual([]);
  });
  it("passes existing public-source limits and cancellation into the fetcher", async () => {
    const f = await fixture(); await f.run(); expect(fetchSource).toHaveBeenCalledWith(f.snapshot.source.sourceUrl,
      expect.objectContaining({ env: {}, signal: expect.any(AbortSignal) }));
  });
  it("returns an explicit source refusal without inventing a terminal command for interruptions", async () => {
    const f = await fixture(); fetchSource.mockResolvedValueOnce({ ok: false, code: "host_not_allowed", detail: "Source refused.", hops: [] });
    expect(await f.run()).toEqual({ ok: false, terminal: { operation: "fail", input: { code: "host_not_allowed", detail: "Source refused." } } });
    expect(f.events).not.toContain("archive-preparation");
  });
  it("stops before source or Storage I/O for cancelled work", async () => {
    const f = await fixture(); f.controller.abort(new Error("Ownership ended"));
    await expect(f.run()).rejects.toThrow("Ownership ended"); expect(f.events).toEqual([]);
  });
  it("carries ownership cancellation to the external upload request and refuses confirmation", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!; let uploadSignal: AbortSignal | null | undefined;
    f.transport.mockImplementation(async (input, init) => {
      if (init?.method === "POST") { uploadSignal = init.signal; f.controller.abort(new Error("Ownership ended")); return new Promise<Response>(() => {}); }
      return normal(input, init);
    });
    await expect(f.run()).rejects.toThrow("Ownership ended"); expect(uploadSignal!.aborted).toBe(true);
    expect(f.events).not.toContain("archive-confirmation");
  });
  it("bounds an ignored upload deadline and recovers saved bytes on retry", async () => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!; let uploadSignal: AbortSignal | null | undefined;
    f.options.uploadTimeoutMs = 15;
    f.transport.mockImplementation(async (input, init) => {
      if (init?.method === "POST") { uploadSignal = init.signal; return new Promise<Response>(() => {}); }
      return normal(input, init);
    });
    await expect(f.run()).rejects.toThrow("uploaded archive is unconfirmed"); expect(uploadSignal!.aborted).toBe(true);
    f.transport.mockImplementation(normal); expect((await f.run()).ok).toBe(true); expect(fetchSource).toHaveBeenCalledTimes(1);
  });
  it.each(["inactive", "actor", "archive", "unconfirmed"])("refuses %s refreshed custody before parsing", async kind => {
    const f = await fixture(), normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => {
      if (String(input).includes("read_gtfs_ingest_attempt")) {
        if (kind === "inactive") f.current.active = false;
        if (kind === "actor") f.current.actorId = id(99);
        if (kind === "archive") f.current.archive = { ...f.archive, sha256: "0".repeat(64) };
        if (kind === "unconfirmed") f.current.archiveConfirmed = false;
      }
      return normal(input, init);
    });
    await expect(f.run()).rejects.toThrow("refreshed intake scope differs");
  });
  it("connects only the refreshed confirmed attempt to retained parsing/publication", async () => {
    const f = await fixture(); parse.mockResolvedValueOnce({ terminal: { operation: "fail", input: { code: "not_a_zip", detail: "Synthetic archive." } }, summary: null });
    const artifact = { directory: join(f.directory, "parser"), parserBuild: "a".repeat(40), parser: parserOptions };
    await processGtfsSourceArchive({ ...f.options, artifact, batchSize: 100 });
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ ...artifact, batchSize: 100, owned: expect.objectContaining({ snapshot: f.current }) }));
  });
  it("refuses sharing parser and source journal directories", async () => {
    const f = await fixture(); await expect(processGtfsSourceArchive({ ...f.options, artifact: { directory: f.directory, parserBuild: "a".repeat(40), parser: parserOptions }, batchSize: 100 }))
      .rejects.toThrow("directories must differ"); expect(fetchSource).not.toHaveBeenCalled();
  });
  it("the dedicated SDK transport honors both inherited cancellation and pre-cancelled ownership", async () => {
    const caller = new AbortController(), inherited = new AbortController(); let observedCancellation = false;
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      inherited.abort(); observedCancellation = init?.signal?.aborted === true; return Response.json({});
    });
    const client = gtfsIntakeStorage("http://127.0.0.1:54321", "synthetic-key", caller.signal, transport);
    await client.storage.from("gtfs-uploads").download("synthetic.zip", {}, { signal: inherited.signal });
    expect(observedCancellation).toBe(true);
    caller.abort(); await client.storage.from("gtfs-uploads").upload("synthetic.zip", Buffer.from("bytes")); expect(transport).toHaveBeenCalledTimes(1);
  });
});
