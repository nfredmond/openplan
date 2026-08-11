import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Confinement guard for the Document Library reader (memo §8 risks 4, 6).
 *
 * The library is a LIVE UNION that names other modules' tables, which makes it
 * exactly the kind of file that could quietly grow a read of something it must
 * never touch. Three invariants, each checked against the module's SOURCE TEXT
 * because the untyped Supabase client checks none of them at build time:
 *
 * 1. NO CONFINED TABLE, EVEN INSIDE AN EMBED STRING. The reader-inventory
 *    guards confine participant PII (engagement_subscriptions,
 *    engagement_email_outbox), survey responses, and the KPI chain to single
 *    reader modules. The forbidden list here is EXTRACTED from those guards'
 *    own SENSITIVE_TABLES declarations — not hand-copied — so a table added to
 *    a reader-inventory guard is forbidden to the library automatically.
 * 2. RLS CLIENT ONLY. Two sources (report_artifacts, model_run_artifacts)
 *    have no workspace_id column; a service-role read of them is a
 *    cross-tenant leak. The library modules may not even import the
 *    service-role factory.
 * 3. ROUTES, NOT STORAGE. No signed-URL construction and no storage URL
 *    literals: `downloadHref` is always an app route and the owning module's
 *    route re-verifies scope on dereference.
 */

const LIBRARY_FILES = [
  "src/lib/document-library/types.ts",
  "src/lib/document-library/sources.ts",
  "src/lib/document-library/query.ts",
] as const;

const READER_INVENTORY_GUARDS = [
  "src/test/engagement-notifications-reader-inventory.test.ts",
  "src/test/engagement-survey-reader-inventory.test.ts",
] as const;

/** The KPI chain's table is scope-guarded rather than single-reader-confined; forbid it here explicitly. */
const EXTRA_FORBIDDEN_TABLES = ["model_run_kpis"] as const;

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

/** Pull the SENSITIVE_TABLES declaration out of a reader-inventory guard's source. */
function extractSensitiveTables(guardSource: string): string[] {
  const match = guardSource.match(/SENSITIVE_TABLES\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
}

function forbiddenTables(): string[] {
  const extracted = READER_INVENTORY_GUARDS.flatMap((guard) => extractSensitiveTables(read(guard)));
  return [...new Set([...extracted, ...EXTRA_FORBIDDEN_TABLES])];
}

/** Same detection the reader-inventory guards use: `.from("t")` or an embed `t(...)`. */
function namesTable(content: string, table: string): boolean {
  if (new RegExp(`\\.from\\(["']${table}["']\\)`).test(content)) return true;
  const withoutFrom = content.replace(new RegExp(`\\.from\\(["']${table}["']\\)`, "g"), "");
  return new RegExp(`\\b${table}\\s*(?:![a-z]+\\s*)?\\(`).test(withoutFrom);
}

describe("document library confinement", () => {
  it("derives a non-empty forbidden list from the reader-inventory guards (negative control for the extractor)", () => {
    const tables = forbiddenTables();
    // Two PII tables + two survey tables + the KPI chain, at minimum. An empty
    // extraction would make every assertion below pass by finding nothing.
    expect(tables.length).toBeGreaterThanOrEqual(5);
    expect(tables).toContain("engagement_subscriptions");
    expect(tables).toContain("engagement_email_outbox");
    expect(tables).toContain("model_run_kpis");
  });

  it("the table detector catches both access forms (guard is not vacuous)", () => {
    expect(namesTable(`supabase.from("engagement_subscriptions").select("email")`, "engagement_subscriptions")).toBe(true);
    expect(namesTable(`.select("id, engagement_subscriptions!inner(email)")`, "engagement_subscriptions")).toBe(true);
    expect(namesTable(`.select("id, engagement_subscriptions(email)")`, "engagement_subscriptions")).toBe(true);
    expect(namesTable(`.from("kb_documents").select("id")`, "engagement_subscriptions")).toBe(false);
  });

  it("no library module names a confined table — not via .from and not inside an embed string", () => {
    const tables = forbiddenTables();
    const offenders: Array<{ file: string; table: string }> = [];
    for (const file of LIBRARY_FILES) {
      const content = read(file);
      for (const table of tables) {
        if (namesTable(content, table)) offenders.push({ file, table });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no library module can reach the service-role client — the caller's RLS client is the only read path", () => {
    for (const file of LIBRARY_FILES) {
      const content = read(file);
      expect(content, `${file} must not use the service-role client`).not.toMatch(
        /createServiceRoleClient|SUPABASE_SERVICE_ROLE/
      );
    }
  });

  it("no library module constructs a storage URL or signs one — download links are app routes only", () => {
    for (const file of LIBRARY_FILES) {
      const content = read(file);
      expect(content, `${file} must not sign or construct storage URLs`).not.toMatch(
        /createSignedUrl|getPublicUrl|\/storage\/v1\//
      );
      // `storage://` may appear in comments explaining the risk, but never as a
      // template building an href.
      expect(content).not.toMatch(/`storage:\/\//);
    }
  });

  it("every phase-1 source the memo names is present, and only those (scope is a decision, not a drift)", () => {
    const sourcesContent = read("src/lib/document-library/sources.ts");
    const expectedTables = [
      "kb_documents",
      "report_artifacts",
      "funding_opportunity_application_exports",
      "client_invoices",
      "aerial_imagery",
      "aerial_artifact_custody",
      "model_run_artifacts",
    ];
    for (const table of expectedTables) {
      expect(sourcesContent).toContain(`"${table}"`);
    }
    // Deferred/excluded sources must NOT appear: datasets (files-only
    // decision), network packages + GTFS feeds (deferred — no download route
    // yet; listing unopenable rows is its own honesty debt). Each name is
    // verified to EXIST in the migrations first, so a rename cannot turn this
    // into an assertion about nothing (the vacuous-guard defect class).
    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationText = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");
    for (const excluded of ["data_datasets", "network_packages", "gtfs_feeds"]) {
      expect(migrationText).toMatch(new RegExp(`CREATE TABLE[^;]*\\b${excluded}\\b`));
      expect(namesTable(sourcesContent, excluded)).toBe(false);
    }
    // Engagement photos (privacy exclusion) are a COLUMN, not a table:
    // moderation status lives on the item row, and a naive listing would show
    // pending/rejected resident photos with no moderation context.
    expect(migrationText).toContain("photo_path");
    expect(sourcesContent).not.toContain("photo_path");
  });
});
