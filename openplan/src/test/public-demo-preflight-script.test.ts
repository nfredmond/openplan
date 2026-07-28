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

/** A minimal HTML document containing exactly the given strings. */
function htmlPageOf(markers: string[]) {
  return ["<!doctype html><html><body>", ...markers.map((marker) => `<p>${marker}</p>`), "</body></html>"].join("");
}

async function makeTempPath(prefix: string) {
  const file = path.join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempFiles.push(file);
  return file;
}

type MockFetchModule = {
  renderedExamplesPageApproximation: () => string;
};

async function importMockFetch(): Promise<MockFetchModule> {
  return (await import(
    `${pathToFileURL(mockFetchPath).href}?t=${Date.now()}-${Math.random()}`
  )) as MockFetchModule;
}

type PreflightModule = {
  EXAMPLES_REQUIRED_MARKERS: string[];
  EXAMPLES_FORBIDDEN_MARKERS: string[];
};

async function importPreflight(): Promise<PreflightModule> {
  return (await import(pathToFileURL(scriptPath).href)) as unknown as PreflightModule;
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

  await importMockFetch();
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
  /**
   * THE CHECK MUST BE ABLE TO FAIL WHEN THE PAGE MOVES.
   *
   * This suite previously proved nothing about /examples: the script demanded
   * nine markers, four of which had not existed in `src/` for months, and the
   * mock fixture hand-wrote precisely those nine strings back. Every run was
   * green; every run against a real deployment would have failed.
   *
   * These two assertions are the fix. The fixture now serves the page's own
   * source, and this test reads the same source directly — so a marker the page
   * stops rendering, or forbidden copy the page starts rendering, fails here
   * with the marker named, rather than silently passing forever.
   */
  it("demands only markers the real /examples page still renders", async () => {
    const { EXAMPLES_REQUIRED_MARKERS } = await importPreflight();
    const { renderedExamplesPageApproximation } = await importMockFetch();
    const page = renderedExamplesPageApproximation();

    expect(EXAMPLES_REQUIRED_MARKERS.length).toBeGreaterThanOrEqual(6);
    expect(EXAMPLES_REQUIRED_MARKERS.filter((marker) => !page.includes(marker))).toEqual([]);
  });

  it("forbids only copy the real /examples page does not render", async () => {
    const { EXAMPLES_FORBIDDEN_MARKERS } = await importPreflight();
    const { renderedExamplesPageApproximation } = await importMockFetch();
    const page = renderedExamplesPageApproximation();

    expect(EXAMPLES_FORBIDDEN_MARKERS.length).toBeGreaterThanOrEqual(3);
    expect(EXAMPLES_FORBIDDEN_MARKERS.filter((marker) => page.includes(marker))).toEqual([]);
  });

  it("passes the no-secret public demo checks without printing token values", async () => {
    const result = await runPreflight();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("OpenPlan public demo preflight passed");
    expect(result.stdout).toContain("GET/HEAD /api/health");
    expect(result.stdout).toContain("GET /examples");
    expect(result.stdout).toContain("verbatim caveats intact");
    expect(result.stdout).toContain("CSP includes Mapbox");
    expect(result.stdout).not.toContain("pk.test-public-token");
    expect(result.calls).toEqual([
      "GET /api/health",
      "HEAD /api/health",
      "GET /examples",
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

  it("fails if the examples page loses evidence-catalog caveat markers", async () => {
    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_HTML: "<!doctype html><html><body>Examples</body></html>",
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("expected examples evidence-catalog markers"),
      calls: expect.arrayContaining(["GET /examples"]),
    });
  });

  it("fails if the examples page drops any single required marker", async () => {
    // Built FROM the contract rather than restating it, so this stays a real
    // test of the check instead of a second copy of its expectations.
    const { EXAMPLES_REQUIRED_MARKERS } = await importPreflight();
    const dropped = EXAMPLES_REQUIRED_MARKERS[EXAMPLES_REQUIRED_MARKERS.length - 1];

    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_HTML: htmlPageOf(
            EXAMPLES_REQUIRED_MARKERS.filter((marker) => marker !== dropped),
          ),
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining(dropped),
      calls: expect.arrayContaining(["GET /examples"]),
    });
  });

  it("fails if the examples page regresses to stale live-run or overclaim copy", async () => {
    const { EXAMPLES_REQUIRED_MARKERS, EXAMPLES_FORBIDDEN_MARKERS } = await importPreflight();

    await expect(
      runPreflight({
        env: {
          OPENPLAN_PUBLIC_DEMO_MOCK_EXAMPLES_HTML: htmlPageOf([
            ...EXAMPLES_REQUIRED_MARKERS,
            EXAMPLES_FORBIDDEN_MARKERS[0],
          ]),
        },
      }),
    ).rejects.toMatchObject({
      status: 1,
      stderr: expect.stringContaining("forbidden examples evidence-catalog copy"),
      calls: expect.arrayContaining(["GET /examples"]),
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
