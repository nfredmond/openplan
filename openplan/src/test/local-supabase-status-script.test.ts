import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStatus, classifyLocalUrl, parseEnv } from "../../scripts/ops/check-local-supabase-status.mjs";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "openplan-supabase-status-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local Supabase status script", () => {
  it("parses dotenv-style local env files without retaining quotes", () => {
    const parsed = parseEnv("# comment\nexport NEXT_PUBLIC_SUPABASE_URL=\"http://127.0.0.1:54321\"\nSUPABASE_SERVICE_ROLE_KEY='local-service-role'\n");

    expect(parsed.get("NEXT_PUBLIC_SUPABASE_URL")).toBe("http://127.0.0.1:54321");
    expect(parsed.get("SUPABASE_SERVICE_ROLE_KEY")).toBe("local-service-role");
  });

  it("reports redacted env-key presence and migration inventory", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      path.join(dir, ".env.local"),
      [
        "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon",
        "SUPABASE_SERVICE_ROLE_KEY=service",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "select 1;\n", "utf8");
    await writeFile(path.join(migrationsDir, "20260508000079_modeling_caveat_kpi_sql_gate.sql"), "select 1;\n", "utf8");

    const status = await buildStatus({ envFile: path.join(dir, ".env.local"), migrationsDir });

    expect(status.status).toBe("ok");
    expect(status.env.required).toEqual([
      { key: "NEXT_PUBLIC_SUPABASE_URL", status: "set-redacted", localUrl: "local" },
      { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", status: "set-redacted" },
      { key: "SUPABASE_SERVICE_ROLE_KEY", status: "set-redacted" },
    ]);
    expect(status.migrations).toMatchObject({
      count: 2,
      first: "20260219000001_gtfs_schema.sql",
      latest: "20260508000079_modeling_caveat_kpi_sql_gate.sql",
      duplicateTimestamps: [],
    });
  });

  it("flags missing required keys without live Supabase writes", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(path.join(dir, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n", "utf8");
    await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "select 1;\n", "utf8");

    const status = await buildStatus({ envFile: path.join(dir, ".env.local"), migrationsDir });

    expect(status.status).toBe("attention");
    expect(status.issues).toContain("missing required local Supabase env keys: NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  });

  it("classifies common local and non-local Supabase URLs without printing values", () => {
    expect(classifyLocalUrl("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")).toBe("local");
    expect(classifyLocalUrl("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321")).toBe("local");
    expect(
      classifyLocalUrl("SUPABASE_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
    ).toBe("local");
    expect(classifyLocalUrl("NEXT_PUBLIC_SUPABASE_URL", "https://aggphdqkanxsfzzoxlbk.supabase.co")).toBe(
      "non-local",
    );
    expect(classifyLocalUrl("NEXT_PUBLIC_SUPABASE_URL", "")).toBe("unset");
    expect(classifyLocalUrl("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")).toBeNull();
  });

  it("flags non-local Supabase URL as an attention issue without revealing the URL", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      path.join(dir, ".env.local"),
      [
        "NEXT_PUBLIC_SUPABASE_URL=https://aggphdqkanxsfzzoxlbk.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon",
        "SUPABASE_SERVICE_ROLE_KEY=service",
        "SUPABASE_DB_URL=postgresql://postgres:postgres@db.example.supabase.co:5432/postgres",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "select 1;\n", "utf8");

    const status = await buildStatus({ envFile: path.join(dir, ".env.local"), migrationsDir });

    expect(status.status).toBe("attention");
    const nonLocalIssue = status.issues.find((issue) => issue.includes("do not point at 127.0.0.1"));
    expect(nonLocalIssue).toBeDefined();
    expect(nonLocalIssue).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(nonLocalIssue).toContain("SUPABASE_DB_URL");
    for (const issue of status.issues) {
      expect(issue).not.toContain("aggphdqkanxsfzzoxlbk");
      expect(issue).not.toContain("postgres:postgres");
    }
    const supabaseUrlItem = status.env.required.find((item) => item.key === "NEXT_PUBLIC_SUPABASE_URL");
    expect(supabaseUrlItem).toMatchObject({ status: "set-redacted", localUrl: "non-local" });
  });
});
