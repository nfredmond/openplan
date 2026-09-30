// @vitest-environment node
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesisWorkerFixture } from "./fixtures/engagement/synthesis-worker";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });

// This bridge speaks real HTTP to the CLI's Supabase client. It deliberately
// simulates database commands; native RLS and PostgreSQL are separate evidence.
async function fixture() {
  const f = await synthesisWorkerFixture(); cleanup.push(() => f.close());
  const requests: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const deliveryReached = Promise.withResolvers<void>(), releaseDelivery = Promise.withResolvers<void>();
  const options = { holdDelivery: false };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://127.0.0.1").pathname;
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString(), body: Record<string, unknown> | null = text ? JSON.parse(text) : null;
    requests.push({ path, body }); res.setHeader("content-type", "application/json");
    if (path.startsWith("/rest/v1/rpc/") && req.method === "POST") {
      const name = path.slice("/rest/v1/rpc/".length), result = await f.rpc(name, body ?? {});
      if (name === "retain_engagement_synthesis_generation_output" && options.holdDelivery) {
        deliveryReached.resolve(); await releaseDelivery.promise;
      }
      if (result.error) { res.statusCode = 503; res.end(JSON.stringify({ ...result.error, message: "SYNTHETIC interrupted acknowledgement" })); }
      else res.end(JSON.stringify(result.data));
    } else if (path.startsWith("/rest/v1/") && req.method === "GET") {
      const data = f.rows[path.slice("/rest/v1/".length)];
      if (!data) { res.statusCode = 404; res.end('{"message":"SYNTHETIC unavailable row"}'); }
      else res.end(JSON.stringify(data));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    releaseDelivery.resolve(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const target = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const directory = join(f.args.directory, createHash("sha256").update(target).digest("hex"), f.args.authorizationId, "0");
  function start(argv = ["--authorization", f.args.authorizationId, "--task-index", "0"]) {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/workers/synthesis-generation.ts", ...argv], {
      cwd: process.cwd(), env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: target,
        SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC-SERVICE-KEY", OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR: f.args.directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
    return { child, ended };
  }
  async function kill(child: ChildProcess) { child.kill("SIGKILL"); }
  return { f, requests, options, start, kill, directory,
    deliveryReached: deliveryReached.promise, releaseDelivery: () => releaseDelivery.resolve(),
    journal: async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8")) };
}

describe("synthesis CLI process recovery over HTTP", () => {
  it("recovers a lost output acknowledgement in a new process without another call", async () => {
    const t = await fixture(); t.f.options.loseOutput = true;
    const first = await t.start().ended;
    expect(first.code, first.stderr).toBe(1); expect((await t.journal()).phase).toBe("observed");
    const original = t.requests.find(row => row.path.endsWith("/retain_engagement_synthesis_generation_output"))!.body;
    const second = await t.start().ended;
    expect(second.code, second.stderr).toBe(0); expect(second.stdout).toContain("delivered");
    const outputs = t.requests.filter(row => row.path.endsWith("/retain_engagement_synthesis_generation_output"));
    expect(outputs).toHaveLength(2); expect(outputs[1].body).toEqual(original);
    expect(t.f.providerCalls).toHaveLength(1); expect((await t.journal()).phase).toBe("delivered");
  });
  it("leaves a killed running attempt unobserved and makes no replacement call", async () => {
    const t = await fixture(); t.f.options.holdResponse = true;
    const running = t.start();
    await Promise.race([t.f.arrived, running.ended.then(result => { throw new Error(`Worker ended before provider: ${result.stderr}`); })]);
    expect((await t.journal()).phase).toBe("running"); await t.kill(running.child); expect((await running.ended).signal).toBe("SIGKILL");
    const resumed = await t.start().ended;
    expect(resumed.code, resumed.stderr).toBe(2); expect(resumed.stdout).toContain("unobserved");
    expect((await t.journal()).phase).toBe("unobserved"); expect(t.f.providerCalls).toHaveLength(1);
    expect(t.requests.some(row => row.path.endsWith("/retain_engagement_synthesis_generation_output"))).toBe(false);
  });
  it("redelivers an observed original after the worker is killed during database delivery", async () => {
    const t = await fixture(); t.options.holdDelivery = true;
    const running = t.start();
    await Promise.race([t.deliveryReached, running.ended.then(result => { throw new Error(`Worker ended before delivery: ${result.stderr}`); })]);
    const original = await t.journal(); expect(original.phase).toBe("observed");
    await t.kill(running.child); expect((await running.ended).signal).toBe("SIGKILL");
    t.options.holdDelivery = false; t.releaseDelivery();
    const resumed = await t.start().ended;
    expect(resumed.code, resumed.stderr).toBe(0); expect((await t.journal()).observation).toEqual(original.observation);
    const outputs = t.requests.filter(row => row.path.endsWith("/retain_engagement_synthesis_generation_output"));
    expect(outputs).toHaveLength(2); expect(outputs[1].body).toEqual(outputs[0].body); expect(t.f.providerCalls).toHaveLength(1);
  });
  it.each([[], ["--authorization", "invalid", "--task-index", "0"],
    ["--authorization", "a0000000-0000-4000-8000-000000000001", "--task-index", "-1"],
    ["--authorization", "a0000000-0000-4000-8000-000000000001", "--task-index", "1.5"],
    ["--authorization", "a0000000-0000-4000-8000-000000000001", "--task-index", "01"],
    ["--authorization", "a0000000-0000-4000-8000-000000000001", "--task-index", "9007199254740992"],
  ].map(argv => ({ argv })))("rejects invalid CLI options before any HTTP request: $argv", async ({ argv }) => {
    const t = await fixture(), result = await t.start(argv).ended;
    expect(result.code).toBe(1); expect(t.requests).toHaveLength(0); expect(t.f.providerCalls).toHaveLength(0);
  });
});
