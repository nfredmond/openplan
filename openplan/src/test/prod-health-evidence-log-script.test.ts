import { mkdtemp, readFile, rm } from "node:fs/promises";
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
