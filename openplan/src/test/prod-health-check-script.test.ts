import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/ops/check-prod-health.mjs");
const mockFetchPath = path.join(process.cwd(), "src/test/fixtures/prod-health-mock-fetch.mjs");
const callFiles: string[] = [];

type HealthServerOptions = {
  status?: number;
  headStatus?: number;
  cacheControl?: string;
  payload?: unknown;
};

const healthyPayload = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-04-24T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
    billing: "not_checked",
  },
};

async function readCalls(callsPath: string) {
  const text = await readFile(callsPath, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[0]);
}

async function runHealthCheck(options: HealthServerOptions = {}) {
  const callsPath = path.join(
    tmpdir(),
    `openplan-prod-health-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
  );
  const url = "https://openplan.example/api/health";
  callFiles.push(callsPath);

  const env = {
    ...process.env,
    OPENPLAN_HEALTH_URL: url,
    OPENPLAN_HEALTH_MOCK_CALLS_PATH: callsPath,
    OPENPLAN_HEALTH_MOCK_STATUS: String(options.status ?? 200),
    OPENPLAN_HEALTH_MOCK_HEAD_STATUS: String(options.headStatus ?? options.status ?? 200),
    OPENPLAN_HEALTH_MOCK_CACHE_CONTROL: options.cacheControl ?? "no-store, max-age=0",
    OPENPLAN_HEALTH_MOCK_PAYLOAD: JSON.stringify(options.payload ?? healthyPayload),
  };

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      [
        `await import(${JSON.stringify(pathToFileURL(mockFetchPath).href)});`,
        `await import(${JSON.stringify(pathToFileURL(scriptPath).href)});`,
      ].join(" "),
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  const output = {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    calls: await readCalls(callsPath),
    url,
  };

  if (!output.stdout && !output.stderr && output.calls.length === 0) {
    throw Object.assign(new Error("Health check child process produced no observable output"), {
      ...output,
      status: result.status,
      signal: result.signal,
      spawnError: result.error?.message,
    });
  }

  if (result.status !== 0) {
    const error = new Error(`Command failed: ${process.execPath} scripts/ops/check-prod-health.mjs`);
    Object.assign(error, output);
    throw error;
  }

  return output;
}

afterEach(async () => {
  await Promise.all(callFiles.splice(0).map((file) => rm(file, { force: true })));
});

describe("production health check script", () => {
  it("passes against the expected public health contract", async () => {
    const result = await runHealthCheck();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OpenPlan health check passed");
    expect(result.stdout).toContain(result.url);
    expect(result.stderr).toBe("");
    expect(result.calls).toEqual(["GET", "HEAD"]);
  });

  it("fails when the endpoint returns a non-200 response", async () => {
    await expect(runHealthCheck({ status: 503 })).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("GET /api/health returned non-200 status"),
      calls: ["GET"],
    });
  });

  it("fails when required payload fields are missing or invalid", async () => {
    await expect(
      runHealthCheck({
        payload: {
          status: "ok",
          service: "wrong-service",
          checks: { app: "ok", database: "not_checked" },
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("GET /api/health returned an unexpected payload"),
      calls: ["GET"],
    });
  });

  it("fails if the shallow health endpoint starts claiming dependency readiness", async () => {
    await expect(
      runHealthCheck({
        payload: {
          ...healthyPayload,
          checks: {
            app: "ok",
            database: "ok",
            billing: "not_checked",
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining('checks.database must stay "not_checked"'),
      calls: ["GET"],
    });
  });
});
