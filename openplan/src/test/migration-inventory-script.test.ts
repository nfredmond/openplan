import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMigrationInventory, inspectMigrationSql, parseArgs } from "../../scripts/ops/check-migration-inventory.mjs";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "openplan-migration-inventory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("migration inventory script", () => {
  it("parses operator arguments without requiring Supabase access", () => {
    expect(parseArgs(["--migrations-dir", "custom/migrations", "--json", "--max-review", "3"])).toMatchObject({
      migrationsDir: "custom/migrations",
      json: true,
      maxReview: 3,
      failOnReview: false,
    });
  });

  it("builds a read-only migration inventory and flags review patterns", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "create table gtfs_feeds (id uuid);\n", "utf8");
    await writeFile(
      path.join(migrationsDir, "20260420000061_pin_function_search_paths.sql"),
      "create or replace function public.example() returns void language sql security definer as $$ select 1; $$;\n",
      "utf8",
    );
    await writeFile(path.join(migrationsDir, "README.sql"), "select 1;\n", "utf8");

    const inventory = await buildMigrationInventory({ migrationsDir });

    expect(inventory.status).toBe("attention");
    expect(inventory.count).toBe(2);
    expect(inventory.first).toBe("20260219000001_gtfs_schema.sql");
    expect(inventory.latest).toBe("20260420000061_pin_function_search_paths.sql");
    expect(inventory.invalidSqlFiles).toEqual(["README.sql"]);
    expect(inventory.reviewFlags).toEqual([
      {
        name: "20260420000061_pin_function_search_paths.sql",
        flags: ["security-definer"],
      },
    ]);
  });

  it("treats operator-review patterns as informational unless fail-on-review is requested", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(path.join(migrationsDir, "20260219000001_gtfs_schema.sql"), "create policy p on public.t for select using (true);\n", "utf8");

    const informational = await buildMigrationInventory({ migrationsDir });
    const guarded = await buildMigrationInventory({ migrationsDir, failOnReview: true });

    expect(informational.status).toBe("ok");
    expect(informational.reviewFlags).toEqual([{ name: "20260219000001_gtfs_schema.sql", flags: ["rls-policy"] }]);
    expect(guarded.status).toBe("attention");
    expect(guarded.issues).toContain("operator-review migration patterns present in 1 migration file(s)");
  });

  it("detects duplicate timestamps, duplicate slugs, and empty migration files", async () => {
    const dir = await makeTempDir();
    const migrationsDir = path.join(dir, "supabase", "migrations");
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(path.join(migrationsDir, "20260219000001_shared.sql"), "select 1;\n", "utf8");
    await writeFile(path.join(migrationsDir, "20260219000001_other.sql"), "select 2;\n", "utf8");
    await writeFile(path.join(migrationsDir, "20260219000002_shared.sql"), "", "utf8");

    const inventory = await buildMigrationInventory({ migrationsDir });

    expect(inventory.status).toBe("attention");
    expect(inventory.duplicateTimestamps).toEqual(["20260219000001"]);
    expect(inventory.duplicateSlugs).toEqual(["shared"]);
    expect(inventory.emptyMigrations).toEqual(["20260219000002_shared.sql"]);
  });

  it("ignores SQL review markers inside comments", () => {
    expect(inspectMigrationSql("-- drop table public.projects;\nselect 1;\n/* security definer */")).toEqual([]);
  });

  it("ignores SQL review markers inside string literals", () => {
    expect(
      inspectMigrationSql("insert into audit_log(message) values ('operator note: drop table public.projects; security definer');\nselect 1;"),
    ).toEqual([]);
  });
});
