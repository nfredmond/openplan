// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcess, ForkOptions } from "node:child_process";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { superviseGtfsParse, type GtfsParseProcessOptions } from "@/lib/gtfs/parse-supervisor";
import { parseGtfsFeed } from "@/lib/gtfs/parse";
import { resolveGtfsLimits } from "@/lib/gtfs/limits";

const launched = vi.hoisted(() => ({ children: [] as ChildProcess[], fixture: undefined as string | undefined }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, fork: (entrypoint: string, args: string[], options: ForkOptions) => {
    const child = actual.fork(launched.fixture ?? entrypoint, args, options);
    launched.children.push(child);
    return child;
  } };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const child of launched.children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  launched.children = []; launched.fixture = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function archive() {
  const zip = new JSZip();
  zip.file("agency.txt", "agency_id,agency_name,agency_url,agency_timezone\nA,Test Transit,https://example.org,America/Los_Angeles\n");
  zip.file("stops.txt", "stop_id,stop_name,stop_lat,stop_lon\nS,Stop,40,-100\n");
  zip.file("routes.txt", "route_id,route_short_name,route_type\nR,1,3\n");
  zip.file("trips.txt", "trip_id,route_id,service_id\nT,R,W\n");
  zip.file("calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nW,1,1,1,1,1,0,0,20260101,20261231\n");
  zip.file("stop_times.txt", "trip_id,stop_id,arrival_time,departure_time,stop_sequence\nT,S,08:00:00,08:00:00,1\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function setup(bytes: Buffer = Buffer.from("not a ZIP")) {
  const directory = await mkdtemp(path.join(tmpdir(), "openplan-gtfs-parse-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "archive.zip"), outputPath = path.join(directory, "parsed.json");
  await writeFile(inputPath, bytes, { mode: 0o600 });
  const input = await open(inputPath, "r"), output = await open(outputPath, "wx+", 0o600);
  cleanups.push(async () => { await input.close(); await output.close(); });
  const options: GtfsParseProcessOptions = {
    archive: input, output, byteSize: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    limits: resolveGtfsLimits({}), maxOutputBytes: 2 * 1024 * 1024, maxOldSpaceMb: 128,
    renewEveryMs: 25, renewTimeoutMs: 250, maxRuntimeMs: 8000, terminationGraceMs: 100,
    signal: new AbortController().signal, renew: async () => true,
  };
  return { options, directory, outputPath };
}

async function cpuFixture(directory: string) {
  const entrypoint = path.join(directory, "cpu.mjs");
  await writeFile(entrypoint, `import {writeSync} from 'node:fs';
process.on('SIGTERM',()=>{});
process.once('message',()=>{writeSync(5,'cpu-active',0);while(true){Math.sqrt(Math.random());}});`);
  launched.fixture = entrypoint;
}

describe("GTFS parsing in an independently supervised process", () => {
  it("retains the production parser's complete result with a verified digest", async () => {
    const bytes = await archive(), { options, outputPath } = await setup(bytes);
    let renewals = 0;
    options.renew = async () => { renewals++; return true; };
    const result = await superviseGtfsParse(options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = await readFile(outputPath);
    expect(result.receipt).toEqual({ parsed: true, byteSize: output.length,
      sha256: createHash("sha256").update(output).digest("hex") });
    const expected = await parseGtfsFeed(bytes, { limits: options.limits });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(JSON.parse(output.toString())).toEqual({ ...expected, feed: { ...expected.feed,
      stats: { ...expected.feed.stats, elapsedMs: expect.any(Number) } } });
    expect(renewals).toBeGreaterThanOrEqual(2);
    expect(launched.children[0].exitCode).toBe(0);
  });

  it("retains a parser refusal without calling the feed ready", async () => {
    const { options, outputPath } = await setup();
    const result = await superviseGtfsParse(options);
    expect(result.ok && result.receipt.parsed).toBe(false);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({ ok: false, code: "not_a_zip" });
  });

  it("refuses changed archive bytes and preserves a preexisting output", async () => {
    const { options, outputPath } = await setup(await archive());
    options.checksumSha256 = "0".repeat(64);
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "child_failed" });
    expect((await readFile(outputPath)).length).toBe(0);
    await options.output.writeFile("retained prior output");
    options.checksumSha256 = createHash("sha256").update(await readFile(path.join(path.dirname(outputPath), "archive.zip"))).digest("hex");
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "child_failed" });
    expect(await readFile(outputPath, "utf8")).toBe("retained prior output");
  });

  it("refuses output beyond its configured byte limit", async () => {
    const { options, outputPath } = await setup(await archive());
    options.maxOutputBytes = 1;
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "child_failed" });
    expect((await readFile(outputPath)).length).toBe(0);
  });

  it("renews during a CPU-blocked child and waits for forced termination after ownership loss", async () => {
    const { options, directory, outputPath } = await setup();
    await cpuFixture(directory);
    let observedCpu = false;
    options.renew = async () => {
      observedCpu = (await readFile(outputPath, "utf8")) === "cpu-active";
      return !observedCpu;
    };
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "ownership_unconfirmed" });
    expect(observedCpu).toBe(true);
    expect(launched.children[0].signalCode).toBe("SIGKILL");
    expect(() => process.kill(launched.children[0].pid!, 0)).toThrow();
  });

  it("bounds an unresponsive renewal without overlapping requests", async () => {
    const { options, directory, outputPath } = await setup();
    await cpuFixture(directory);
    let hungRequests = 0, aborted = false;
    options.renew = async signal => {
      if ((await readFile(outputPath, "utf8")) !== "cpu-active") return true;
      hungRequests++;
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<boolean>(() => {});
    };
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "ownership_unconfirmed" });
    expect(hungRequests).toBe(1);
    expect(aborted).toBe(true);
    expect(launched.children[0].signalCode).toBe("SIGKILL");
  });

  it("requires final ownership confirmation after the child exits successfully", async () => {
    const { options } = await setup();
    options.renewEveryMs = 10_000;
    let calls = 0;
    options.renew = async () => ++calls === 1;
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "ownership_unconfirmed" });
    expect(calls).toBe(2);
    expect(launched.children[0].exitCode).toBe(0);
  });

  it.each(["wrong_digest", "failed_exit"])("refuses a child receipt with %s", async fault => {
    const { options, directory, outputPath } = await setup();
    const entrypoint = path.join(directory, "receipt.mjs");
    await writeFile(entrypoint, `import {writeSync} from 'node:fs';import {createHash} from 'node:crypto';
process.once('message',()=>{const bytes=Buffer.from('{}');writeSync(5,bytes,0,bytes.length,0);
process.send({byteSize:2,sha256:${fault === "wrong_digest" ? "'0'.repeat(64)" : "createHash('sha256').update(bytes).digest('hex')"},parsed:false},()=>process.exit(${fault === "failed_exit" ? 1 : 0}));});`);
    launched.fixture = entrypoint;
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "child_failed" });
    expect(await readFile(outputPath, "utf8")).toBe("{}");
  });

  it("does not start work after cancellation or an unconfirmed initial lease", async () => {
    const { options } = await setup();
    options.signal = AbortSignal.abort();
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "cancelled" });
    options.signal = new AbortController().signal;
    options.renew = async () => false;
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "ownership_unconfirmed" });
    expect(launched.children).toHaveLength(0);
  });

  it("enforces a parent deadline even when the child cannot process timers", async () => {
    const { options, directory, outputPath } = await setup();
    await cpuFixture(directory);
    let observedCpu = false;
    options.renew = async () => {
      observedCpu ||= (await readFile(outputPath, "utf8")) === "cpu-active";
      return true;
    };
    options.maxRuntimeMs = 3000;
    const watchdog = new AbortController();
    options.signal = watchdog.signal;
    const timer = setTimeout(() => watchdog.abort(), 5000);
    try {
      expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "timed_out" });
    } finally { clearTimeout(timer); }
    expect(observedCpu).toBe(true);
    expect(launched.children[0].signalCode).toBe("SIGKILL");
  });

  it("cancels active parsing and retains its partial local output", async () => {
    const { options, directory, outputPath } = await setup();
    await cpuFixture(directory);
    const controller = new AbortController();
    options.signal = controller.signal;
    options.renew = async () => {
      if ((await readFile(outputPath, "utf8")) === "cpu-active") controller.abort();
      return true;
    };
    expect(await superviseGtfsParse(options)).toEqual({ ok: false, reason: "cancelled" });
    expect(launched.children[0].signalCode).toBe("SIGKILL");
    expect(await readFile(outputPath, "utf8")).toBe("cpu-active");
  });
});
