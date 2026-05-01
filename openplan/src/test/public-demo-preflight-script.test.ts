import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/ops/check-public-demo-preflight.mjs");
const mockFetchPath = path.join(process.cwd(), "src/test/fixtures/public-demo-preflight-mock-fetch.mjs");
const tempFiles: string[] = [];
const originalFetch = globalThis.fetch;

type PublicDemoPreflightOptions = {
  args?: string[];
  env?: Record<string, string>;
};

async function readCalls(callsPath: string) {
  const text = await readFile(callsPath, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function makeTempPath(prefix: string) {
  const file = path.join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempFiles.push(file);
  return file;
}

async function runPreflight(options: PublicDemoPreflightOptions = {}) {
  const callsPath = await makeTempPath("openplan-public-demo-preflight-calls");
  vi.stubEnv("OPENPLAN_PUBLIC_DEMO_ORIGIN", "https://openplan.example");
  vi.stubEnv("OPENPLAN_PUBLIC_DEMO_MOCK_CALLS_PATH", callsPath);
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-public-token");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  for (const [key, value] of Object.entries(options.env ?? {})) {
    vi.stubEnv(key, value);
  }

  await import(`${pathToFileURL(mockFetchPath).href}?t=${Date.now()}-${Math.random()}`);
  const importedPreflight = await import(pathToFileURL(scriptPath).href);
  const runPreflightModule = importedPreflight as {
    runPreflight: (argv?: string[]) => Promise<{ help?: boolean; text?: string; origin?: string; checks?: string[]; warnings?: string[] }>;
    formatResult: (result: { help?: boolean; text?: string; origin?: string; checks?: string[]; warnings?: string[] }) => string;
  };

  try {
    const result = await runPreflightModule.runPreflight(options.args ?? []);
    return {
      stdout: runPreflightModule.formatResult(result),
      stderr: "",
      status: 0,
      calls: await readCalls(callsPath),
    };
  } catch (caught) {
    const stderr = `OpenPlan public demo preflight failed: ${caught instanceof Error ? caught.message : String(caught)}`;
    const error = new Error("Command failed: scripts/ops/check-public-demo-preflight.mjs");
    Object.assign(error, {
      stdout: "",
      stderr,
      status: 1,
      calls: await readCalls(callsPath),
    });
    throw error;
  }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  await Promise.all(tempFiles.splice(0).map((file) => rm(file, { force: true })));
});

describe("public demo preflight script", () => {
  it("passes the no-secret public demo checks without printing token values", async () => {
    const result = await runPreflight();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("OpenPlan public demo preflight passed");
    expect(result.stdout).toContain("GET/HEAD /api/health");
    expect(result.stdout).toContain("GET /request-access");
    expect(result.stdout).toContain("GET /api/billing/readiness is not publicly readable");
    expect(result.stdout).toContain("CSP includes Mapbox");
    expect(result.stdout).not.toContain("pk.test-public-token");
    expect(result.calls).toEqual([
      "GET /api/health",
      "HEAD /api/health",
      "GET /request-access",
      "GET /api/billing/readiness",
      "HEAD /",
    ]);
  });

  it("passes with an explicit warning when no local Mapbox token value is visible", async () => {
    const result = await runPreflight({
      env: {
        NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "",
        NEXT_PUBLIC_MAPBOX_TOKEN: "",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("passed with warnings");
    expect(result.stdout).toContain("No NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN value was visible locally");
  });

  it("fails if billing readiness becomes publicly readable", async () => {
    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_BILLING_READINESS_STATUS: "200",
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("GET /api/billing/readiness must not be publicly readable"),
      calls: expect.arrayContaining(["GET /api/billing/readiness"]),
    });
  });

  it("fails if the request-access page loses services intake markers", async () => {
    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_REQUEST_ACCESS_HTML: "<!doctype html><html><body>Request access</body></html>",
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("expected services-intake markers"),
      calls: expect.arrayContaining(["GET /request-access"]),
    });
  });

  it("fails without printing a secret-like public Mapbox token", async () => {
    await expect(
      runPreflight({
        args: ["--skip-network"],
        env: {
          NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "sk.secret-token-should-not-print",
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("is not a public pk.* token"),
    });

    try {
      await runPreflight({
        args: ["--skip-network"],
        env: {
          NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "sk.secret-token-should-not-print",
        },
      });
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      expect(output.stderr ?? "").not.toContain("sk.secret-token-should-not-print");
      expect(output.stdout ?? "").not.toContain("sk.secret-token-should-not-print");
    }
  });

  it("fails when the public CSP drops Mapbox allowances", async () => {
    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_CSP: "default-src 'self'; connect-src 'self'; img-src 'self'",
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("missing Mapbox allowances"),
      calls: expect.arrayContaining(["HEAD /"]),
    });
  });

  it("can inspect a selected env file without printing the Mapbox token value", async () => {
    const envFile = await makeTempPath("openplan-public-demo-preflight-env");
    await writeFile(envFile, "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.file-public-token\n", "utf8");

    const result = await runPreflight({
      args: ["--skip-network", "--mapbox-env-file", envFile],
      env: {
        NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "",
        NEXT_PUBLIC_MAPBOX_TOKEN: "",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Mapbox public token format is pk.*");
    expect(result.stdout).not.toContain("pk.file-public-token");
  });
});
