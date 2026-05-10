import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPilotPreflight,
  formatPreflight,
  inspectVercelDeployment,
  parseArgs,
} from "../../scripts/ops/check-pilot-preflight.mjs";

const tempDirs: string[] = [];

async function makeFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "openplan-pilot-preflight-"));
  tempDirs.push(dir);
  const migrationsDir = path.join(dir, "supabase", "migrations");
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(
    path.join(dir, ".env.local"),
    [
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-secret",
      "SUPABASE_SERVICE_ROLE_KEY=fixture-service-role-secret",
      "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "select 1;\n", "utf8");
  await writeFile(path.join(migrationsDir, "20260508000079_modeling_caveat_kpi_sql_gate.sql"), "select 1;\n", "utf8");
  return { dir, envFile: path.join(dir, ".env.local"), migrationsDir };
}

async function runNpmPreflightJson(args: string[]) {
  return await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    execFile(
      "npm",
      ["run", "--silent", "ops:check-pilot-preflight", "--", ...args],
      { cwd: process.cwd(), timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error: ExecFileException | null, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pilot preflight script", () => {
  it("parses combined preflight arguments", () => {
    expect(
      parseArgs([
        "--env-file",
        "custom.env",
        "--migrations-dir",
        "db/migrations",
        "--health-url",
        "https://example.gov/api/health",
        "--deployment-target",
        "https://example.gov",
        "--vercel-command",
        "/usr/local/bin/vercel",
        "--json",
      ]),
    ).toMatchObject({
      envFile: "custom.env",
      migrationsDir: "db/migrations",
      healthUrl: "https://example.gov/api/health",
      deploymentTarget: "https://example.gov",
      vercelCommand: "/usr/local/bin/vercel",
      json: true,
    });
  });

  it("builds a read-only local Supabase, migration, production-health, and deployment readiness bundle", async () => {
    const fixture = await makeFixture();
    const healthCheck = async (url: string) => ({
      status: "ok",
      url,
      checkedAt: "2026-05-10T22:00:00.000Z",
      issues: [],
    });
    const vercelInspect = async ({ target }: { target: string }) => ({
      status: "ok",
      target,
      deploymentUrl: "https://openplan-natford.vercel.app",
      deploymentId: "dpl_fixture",
      readyState: "READY",
      environment: "production",
      createdAt: 1770000000000,
      commitSha: "bd2959c",
      inspectedAt: "2026-05-10T22:00:01.000Z",
      issues: [],
    });

    const summary = await buildPilotPreflight(
      {
        envFile: fixture.envFile,
        migrationsDir: fixture.migrationsDir,
        healthUrl: "https://openplan-natford.vercel.app/api/health",
        deploymentTarget: "https://openplan-natford.vercel.app",
      },
      { healthCheck, vercelInspect },
    );

    expect(summary.schemaVersion).toBe("pilot-preflight.v1");
    expect(summary.command).toBe("ops:check-pilot-preflight");
    expect(summary.status).toBe("ok");
    expect(summary.readOnly).toBe(true);
    expect(summary.secretSafe).toBe(true);
    expect(summary.safety).toMatchObject({
      readOnly: true,
      secretSafe: true,
      noProductionWrites: true,
      noSchemaApply: true,
      noSecretValues: true,
      noEvidenceFileWrites: true,
      stdoutOnly: true,
      externalReads: { productionHealth: true, vercelInspect: true },
    });
    expect(summary.safety.caveats.join(" ")).toContain("No schema apply");
    expect(summary.sections.localSupabase.env.required).toEqual([
      { key: "NEXT_PUBLIC_SUPABASE_URL", status: "set-redacted", localUrl: "local" },
      { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", status: "set-redacted" },
      { key: "SUPABASE_SERVICE_ROLE_KEY", status: "set-redacted" },
    ]);
    expect(summary.sections.migrationInventory.count).toBe(2);
    expect(summary.sections.productionHealth.status).toBe("ok");
    expect(summary.sections.deploymentReadiness.readyState).toBe("READY");

    const rendered = formatPreflight(summary);
    const serialized = JSON.stringify(summary) + rendered;
    expect(rendered).toContain("OpenPlan pilot-readiness preflight bundle (read-only)");
    expect(rendered).toContain("Safety: read-only");
    expect(serialized).not.toContain("fixture-anon-secret");
    expect(serialized).not.toContain("fixture-service-role-secret");
    expect(serialized).not.toContain("postgres:postgres");
  });

  it("aggregates attention items without exposing non-local Supabase URLs or CLI stderr", async () => {
    const fixture = await makeFixture();
    await writeFile(
      fixture.envFile,
      [
        "NEXT_PUBLIC_SUPABASE_URL=https://aggphdqkanxsfzzoxlbk.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=remote-anon-secret",
        "SUPABASE_SERVICE_ROLE_KEY=remote-service-role-secret",
      ].join("\n"),
      "utf8",
    );
    const healthCheck = async (url: string) => ({
      status: "attention",
      url,
      checkedAt: "2026-05-10T22:00:00.000Z",
      issues: ["GET /api/health returned non-200 status"],
    });
    const vercelInspect = async ({ target }: { target: string }) => ({
      status: "attention",
      target,
      deploymentUrl: null,
      deploymentId: null,
      readyState: "BUILDING",
      environment: "production",
      createdAt: null,
      commitSha: null,
      inspectedAt: "2026-05-10T22:00:01.000Z",
      issues: ["Vercel deployment is not READY (readyState=BUILDING)"],
    });

    const summary = await buildPilotPreflight(
      { envFile: fixture.envFile, migrationsDir: fixture.migrationsDir },
      { healthCheck, vercelInspect },
    );

    expect(summary.status).toBe("attention");
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("local Supabase URL keys do not point at 127.0.0.1"),
        "production health: GET /api/health returned non-200 status",
        "deployment readiness: Vercel deployment is not READY (readyState=BUILDING)",
      ]),
    );
    const rendered = formatPreflight(summary);
    expect(rendered).toContain("Attention items:");
    const serialized = JSON.stringify(summary) + rendered;
    expect(serialized).not.toContain("aggphdqkanxsfzzoxlbk");
    expect(serialized).not.toContain("remote-service-role-secret");
  });

  it("emits a pure JSON npm-run contract for automation without secrets or write claims", async () => {
    const fixture = await makeFixture();

    const result = await runNpmPreflightJson([
      "--env-file",
      fixture.envFile,
      "--migrations-dir",
      fixture.migrationsDir,
      "--skip-health",
      "--skip-vercel",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(result.stdout).not.toContain("openplan@0.1.0");
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      schemaVersion: "pilot-preflight.v1",
      command: "ops:check-pilot-preflight",
      status: "attention",
      readOnly: true,
      secretSafe: true,
      safety: {
        readOnly: true,
        secretSafe: true,
        noProductionWrites: true,
        noSchemaApply: true,
        noSecretValues: true,
        noEvidenceFileWrites: true,
        stdoutOnly: true,
        externalReads: { productionHealth: false, vercelInspect: false },
      },
      sections: {
        localSupabase: { status: "ok" },
        migrationInventory: { status: "ok" },
        productionHealth: { status: "skipped", skipped: true },
        deploymentReadiness: { status: "skipped", skipped: true },
      },
    });
    expect(parsed.safety.caveats).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Read-only preflight only"),
        expect.stringContaining("No production writes"),
        expect.stringContaining("No schema apply"),
        expect.stringContaining("No secret values"),
        expect.stringContaining("No evidence-file writes"),
      ]),
    );
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("fixture-anon-secret");
    expect(serialized).not.toContain("fixture-service-role-secret");
    expect(serialized).not.toContain("postgres:postgres");
  });

  it("normalizes Vercel inspect JSON through a mocked read-only CLI call", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const execFile = async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify({
          id: "dpl_mocked",
          url: "openplan-natford.vercel.app",
          readyState: "READY",
          target: "production",
          meta: { githubCommitSha: "bd2959c" },
        }),
      };
    };

    const result = await inspectVercelDeployment(
      { target: "https://openplan-natford.vercel.app", command: "mock-vercel" },
      { execFile },
    );

    expect(calls).toEqual([
      {
        command: "mock-vercel",
        args: ["inspect", "https://openplan-natford.vercel.app/", "--json"],
      },
    ]);
    expect(result).toMatchObject({
      status: "ok",
      deploymentUrl: "https://openplan-natford.vercel.app",
      deploymentId: "dpl_mocked",
      readyState: "READY",
      environment: "production",
      commitSha: "bd2959c",
    });
  });
});
