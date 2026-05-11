import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/ops/log-prod-health-evidence.mjs");
const mockFetchPath = path.join(process.cwd(), "src/test/fixtures/prod-health-mock-fetch.mjs");
const tempPaths: string[] = [];
const originalFetch = globalThis.fetch;

const healthyPayload = {
  status: "ok",
  service: "openplan",
  checkedAt: "2026-05-10T12:00:00.000Z",
  checks: {
    app: "ok",
    database: "not_checked",
    billing: "not_checked",
  },
};

async function setupMockHealth() {
  const callsPath = path.join(
    tmpdir(),
    `openplan-prod-health-evidence-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
  );
  tempPaths.push(callsPath);

  vi.stubEnv("OPENPLAN_HEALTH_URL", "https://openplan.example/api/health");
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_CALLS_PATH", callsPath);
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_STATUS", "200");
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_HEAD_STATUS", "200");
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_CACHE_CONTROL", "no-store, max-age=0");
  vi.stubEnv("OPENPLAN_HEALTH_MOCK_PAYLOAD", JSON.stringify(healthyPayload));

  await import(`${pathToFileURL(mockFetchPath).href}?t=${Date.now()}-${Math.random()}`);
}

async function importEvidenceLogger() {
  return (await import(`${pathToFileURL(scriptPath).href}?t=${Date.now()}-${Math.random()}`)) as {
    createEvidenceLog: (argv?: string[]) => Promise<{
      outputPath?: string;
      gateDecision?: string;
      dryRun?: boolean;
      text?: string;
    }>;
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  await Promise.all(tempPaths.splice(0).map((file) => rm(file, { recursive: true, force: true })));
});

describe("production health evidence log script", () => {
  it("writes a local post-main-push evidence log when health passes and Vercel is Ready", async () => {
    await setupMockHealth();
    const outputDir = await mkdtemp(path.join(tmpdir(), "openplan-prod-health-evidence-output-"));
    tempPaths.push(outputDir);
    const { createEvidenceLog } = await importEvidenceLogger();

    const result = await createEvidenceLog([
      "--output-dir",
      outputDir,
      "--commit",
      "abc123def456",
      "--branch",
      "main",
      "--vercel-url",
      "https://openplan.example",
      "--vercel-state",
      "Ready",
    ]);

    expect(result.outputPath).toBeTruthy();
    expect(result.gateDecision).toBe("PASS");

    const markdown = await readFile(result.outputPath!, "utf8");
    expect(markdown).toContain("# OpenPlan production health evidence log");
    expect(markdown).toContain("Git branch: `main`");
    expect(markdown).toContain("Git commit: `abc123def456`");
    expect(markdown).toContain("Observed Vercel state: Ready");
    expect(markdown).toContain("Gate decision: PASS");
    expect(markdown).toContain("Production health check");
    expect(markdown).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(markdown).not.toContain("VERCEL_TOKEN");
  });

  it("holds the evidence gate when Vercel Ready has not been recorded", async () => {
    await setupMockHealth();
    const { createEvidenceLog } = await importEvidenceLogger();

    const result = await createEvidenceLog([
      "--commit",
      "abc123def456",
      "--branch",
      "main",
      "--dry-run",
    ]);

    expect(result.dryRun).toBe(true);
    expect(result.gateDecision).toBe("HOLD");
    expect(result.text).toContain("Observed Vercel state: not recorded");
    expect(result.text).toContain("Gate decision: HOLD");
  });

  it("can resolve Vercel URL/state from saved vercel inspect JSON", async () => {
    await setupMockHealth();
    const inspectPath = path.join(
      tmpdir(),
      `openplan-vercel-inspect-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    tempPaths.push(inspectPath);
    await writeFile(
      inspectPath,
      JSON.stringify({
        deployment: {
          url: "openplan-natford.vercel.app",
          readyState: "READY",
        },
      }),
      "utf8",
    );
    const { createEvidenceLog } = await importEvidenceLogger();

    const result = await createEvidenceLog([
      "--commit",
      "abc123def456",
      "--branch",
      "main",
      "--vercel-inspect-json",
      inspectPath,
      "--require-vercel-ready",
      "--dry-run",
    ]);

    expect(result.dryRun).toBe(true);
    expect(result.gateDecision).toBe("PASS");
    expect(result.text).toContain("Deployment URL inspected: https://openplan-natford.vercel.app");
    expect(result.text).toContain("Observed Vercel state: Ready");
    expect(result.text).toContain("Gate decision: PASS");
  });

  it("can require explicit Vercel Ready verification for strict post-push closure", async () => {
    await setupMockHealth();
    const { createEvidenceLog } = await importEvidenceLogger();

    await expect(
      createEvidenceLog([
        "--commit",
        "abc123def456",
        "--branch",
        "main",
        "--require-vercel-ready",
        "--dry-run",
      ]),
    ).rejects.toThrow("Vercel Ready verification is required");
  });
});
