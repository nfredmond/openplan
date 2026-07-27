import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The polymorphic link tables (plan_links / program_links / model_links) store
// linked_id as a bare UUID with a link_type CHECK — no FK. The cleanup migration
// registers an AFTER DELETE trigger on every link TARGET table so deleting a
// target cannot leave dangling link rows. This guard parses the CHECK
// constraints so that ADDING a link_type without a trigger fails the build.

const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

const LINK_TABLE_MIGRATIONS = [
  "20260315000021_plans_module.sql",
  "20260315000022_programs_module.sql",
  "20260315000023_models_module.sql",
] as const;

// Every link_type must map to the table its linked_id resolves against
// (confirmed in src/app/api/{plans,programs,models}/**/route.ts). A new
// link_type must be added here AND given a trigger in a migration.
const LINK_TYPE_TARGET_TABLES: Record<string, string> = {
  scenario_set: "scenario_sets",
  engagement_campaign: "engagement_campaigns",
  report: "reports",
  project_record: "projects",
  plan: "plans",
  data_dataset: "data_datasets",
  run: "runs",
};

const cleanupSql = readFileSync(
  path.join(migrationsDir, "20260727000007_module_link_cleanup_triggers.sql"),
  "utf8"
);

function linkTypesOf(file: string): string[] {
  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  const match = /link_type TEXT NOT NULL CHECK \(link_type IN \(([^)]*)\)\)/.exec(sql);
  if (!match) {
    throw new Error(`${file}: link_type CHECK constraint not found`);
  }
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

function allLinkTypes(): string[] {
  return Array.from(new Set(LINK_TABLE_MIGRATIONS.flatMap((file) => linkTypesOf(file)))).sort();
}

describe("module link cleanup triggers migration", () => {
  it("registers an AFTER DELETE FOR EACH ROW trigger for every link_type the CHECK constraints allow", () => {
    for (const linkType of allLinkTypes()) {
      const targetTable = LINK_TYPE_TARGET_TABLES[linkType];
      expect(
        targetTable,
        `link_type '${linkType}' has no target table mapped — resolve it against the API routes, ` +
          `add it to LINK_TYPE_TARGET_TABLES, and register a cleanup trigger in a migration`
      ).toBeTruthy();

      const registration = new RegExp(
        `DROP TRIGGER IF EXISTS (\\S+) ON ${targetTable};\\s*` +
          `CREATE TRIGGER \\1\\s+` +
          `AFTER DELETE ON ${targetTable}\\s+` +
          `FOR EACH ROW\\s+` +
          `EXECUTE FUNCTION cleanup_module_links_for_target\\('${linkType}'\\);`
      );
      expect(
        registration.test(cleanupSql),
        `link_type '${linkType}' has no idempotent AFTER DELETE trigger registration on ${targetTable}`
      ).toBe(true);
    }
  });

  it("shares one trigger function keyed by TG_ARGV that clears all three link tables", () => {
    expect(cleanupSql).toContain("TG_ARGV[0]");
    for (const linkTable of ["plan_links", "program_links", "model_links"]) {
      expect(cleanupSql).toMatch(
        new RegExp(
          `DELETE FROM ${linkTable} WHERE link_type = TG_ARGV\\[0\\] AND linked_id = OLD\\.id;`
        )
      );
    }
  });

  it("only deletes inside the trigger function — pre-existing dangling rows are left inert", () => {
    const body = /AS \$\$([\s\S]*?)\$\$;/.exec(cleanupSql);
    expect(body, "trigger function body not found").toBeTruthy();
    const outsideFunction = cleanupSql.replace(body?.[1] ?? "", "");
    expect(outsideFunction).not.toMatch(/DELETE FROM/i);
  });

  it("stays additive: no DROP TABLE or DROP COLUMN", () => {
    expect(cleanupSql).not.toMatch(/DROP TABLE/i);
    expect(cleanupSql).not.toMatch(/DROP COLUMN/i);
  });
});
