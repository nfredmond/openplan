import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/ops/check-prod-health.mjs");
const mockFetchPath = path.join(process.cwd(), "src/test/fixtures/prod-health-mock-fetch.mjs");
const callFiles: string[] = [];
const originalFetch = globalThis.fetch;

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

  vi.stubEnv("OPENPLAN_HEALTH_URL", url);
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_CALLS_PATH", callsPath);
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_STATUS", String(options.status ?? 200));
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_HEAD_STATUS", String(options.headStatus ?? options.status ?? 200));
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_CACHE_CONTROL", options.cacheControl ?? "no-store, max-age=0");
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_PAYLOAD", JSON.stringify(options.payload ?? healthyPayload));

  await import(`${pathToFileURL(mockFetchPath).href}?t=${Date.now()}-${Math.random()}`);
  const importedHealthCheck = await import(pathToFileURL(scriptPath).href);
  const healthCheckModule = importedHealthCheck as {
    runHealthCheck: (argv?: string[]) => Promise<{ help?: boolean; text?: string; url?: string; checkedAt?: string }>;
    formatResult: (result: { help?: boolean; text?: string; url?: string; checkedAt?: string }) => string;
  };

  try {
    const result = await healthCheckModule.runHealthCheck();
    return {
      stdout: healthCheckModule.formatResult(result),
      stderr: "",
      status: 0,
      calls: await readCalls(callsPath),
      url,
    };
  } catch (caught) {
    const error = new Error("Command failed: scripts/ops/check-prod-health.mjs");
    Object.assign(error, {
      stdout: "",
      stderr: `OpenPlan health check failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      status: 1,
      calls: await readCalls(callsPath),
      url,
    });
    throw error;
  }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
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
