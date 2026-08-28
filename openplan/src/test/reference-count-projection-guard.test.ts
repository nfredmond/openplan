import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectSupabaseSelectSites, type SupabaseSelectSite } from "./supabase-call-sites";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { MODEL_LINK_TARGETS } from "@/lib/models/link-targets";

/**
 * REGRESSION GUARD — a query may not name a column the table might not have.
 *
 * THE DEFECT. The project-delete precondition counted references with
 * `.select("id", { count: "exact", head: true })` over a DYNAMIC table name.
 * Naming a column there asserts that every table the expression can produce has
 * it, and two of the 33 relations referencing `projects` do not:
 * `data_dataset_project_links` is a pure join table, `aerial_project_posture` is
 * keyed by `project_id`. PostgREST answered 42703, the route's
 * unreadable-relation branch tripped, and EVERY project delete answered 503.
 *
 * Nothing in the suite could see it. Supabase clients here are deliberately
 * untyped, so `.select()` strings are never checked against the schema, and a
 * mocked client returns whatever column it is asked for — the mock agreed with
 * the code, and both were wrong.
 *
 * WHAT REPLACED THE OLD CHECK. `project-delete-preconditions.test.ts` used to
 * assert that one route file CONTAINED the literal string
 * `.select("*", { count: "exact", head: true })`. That broke the moment the
 * projection moved into `src/lib/api/reference-counts.ts` — as it should, since
 * it was testing a substring rather than a property — and it said nothing about
 * any other query in the codebase. This asks the structural question of all
 * 1,100+ of them.
 *
 * NOT ASSERTED: columns inside PostgREST embedded resources
 * (`stages:model_run_stages(id, status)`), and projections built from imported
 * constants. Both are skipped, and both counts are pinned below so the skipped
 * set cannot quietly grow into the whole codebase. Views are skipped too —
 * `schema-inventory` does not parse view column lists, on purpose; the nightly
 * `migration-schema-drift` check covers them against information_schema.
 */

const schema = loadSchemaInventory();
const selectSites = collectSupabaseSelectSites();

/**
 * Sites whose `.from()` takes a variable, with a projection naming columns.
 *
 * A dynamic table means the projection has to hold for EVERY table the
 * expression can produce, and `"*"` is the only projection that always does. The
 * alternative is to say which tables it can produce — so each entry lists them,
 * and the test below checks the schema for the named columns. That converts
 * "safe today because every candidate happens to have an id" into an assertion
 * that fails when a candidate without one is added.
 */
const DYNAMIC_TABLE_PROJECTIONS: Record<string, { tables: string[]; reason: string }> = {
  "src/lib/config/run-cap.ts": {
    tables: ["model_runs", "runs"],
    reason: "checkMonthlyRunCap(tableName) — the two run tables its six call sites pass.",
  },
  "src/app/(app)/models/_components/network-packages-panel.tsx": {
    tables: ["network_zones", "network_corridors", "network_connectors"],
    reason: "countByVersion(table) is called with exactly these three, immediately below it.",
  },
  "src/lib/assistant/chat-tools.ts": {
    tables: [
      "billing_invoice_records",
      "county_runs",
      "funding_awards",
      "funding_opportunities",
      "gtfs_feeds",
      "programs",
      "projects",
      "reports",
      "rtp_cycles",
    ],
    reason: "check.table comes from PROPOSAL_REFERENCE_CHECKS, whose entries are these.",
  },
  "src/lib/api/link-replacement.ts": {
    tables: ["model_links", "plan_links", "program_links"],
    reason:
      "replaceLinkSet({ table }) — the three link tables passed by the models, plans and programs routes.",
  },
  "src/app/api/stage-gates/decisions/route.ts": {
    tables: ["runs", "model_runs", "county_runs"],
    reason:
      "RUN_CITATION_TABLES — a gate decision may cite one run, and OpenPlan has three run tables; " +
      "the route verifies the cited one belongs to the workspace before writing.",
  },
};

/**
 * Column names a projection asks for, ignoring what this guard cannot check.
 *
 * Skipped on purpose: embedded resources (`stages:model_run_stages(id)`), which
 * name columns of a DIFFERENT table; JSON path operators; and `*`.
 */
export function projectionColumns(projection: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of projection) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.includes("(") && part !== "*")
    .map((part) => part.split(":").pop() ?? part)
    .map((part) => part.replace(/!.*$/, "").replace(/->.*$/, "").trim())
    .filter((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
}

function checkableSites(): SupabaseSelectSite[] {
  return selectSites.filter(
    (site) => site.table !== null && site.projection !== null && !schema.isView(site.table)
  );
}

describe("reference count projections", () => {
  it("never names a column on a table it cannot see", () => {
    const missing = checkableSites().flatMap((site) =>
      projectionColumns(site.projection as string)
        .filter((column) => !schema.hasColumn(site.table as string, column))
        .map((column) => `${site.file}:${site.line} → ${site.table}.${column} does not exist`)
    );

    expect(
      missing.sort(),
      "This query names a column the migrations do not declare on that table. PostgREST answers " +
        "42703 / HTTP 400, and because Supabase clients here are untyped nothing catches it at " +
        "build time — `data_datasets.geometry_scope` (the column is geography_scope) made the " +
        "model detail page render '0 linked datasets' over models that had several."
    ).toEqual([]);
  });

  it("never counts over a dynamic table with a projection it cannot guarantee", () => {
    const unregistered = selectSites
      .filter((site) => site.table === null && site.projection !== null && site.projection !== "*")
      .filter((site) => !(site.file in DYNAMIC_TABLE_PROJECTIONS))
      .map((site) => `${site.file}:${site.line} → .select(${JSON.stringify(site.projection)}) over ${site.tableExpression}`);

    expect(
      unregistered.sort(),
      "The table here is a variable, so this projection must hold for EVERY table the expression " +
        'can produce. Either use "*" — with `head: true` it costs nothing — or register the file ' +
        "in DYNAMIC_TABLE_PROJECTIONS with the tables it can produce, which this suite will then " +
        "check against the schema."
    ).toEqual([]);
  });

  it("proves each registered dynamic target really has the columns", () => {
    const broken: string[] = [];

    for (const [file, entry] of Object.entries(DYNAMIC_TABLE_PROJECTIONS)) {
      const projections = selectSites
        .filter((site) => site.file === file && site.table === null && site.projection)
        .map((site) => site.projection as string);

      expect(projections.length, `${file} no longer has a dynamic-table select; remove its entry`).toBeGreaterThan(0);

      for (const projection of projections) {
        for (const column of projectionColumns(projection)) {
          for (const table of entry.tables) {
            if (!schema.hasColumn(table, column)) broken.push(`${file}: ${table} has no ${column}`);
          }
        }
      }
    }

    expect(
      broken.sort(),
      "A table this call site can produce does not have the column the projection names. This is " +
        "the exact shape that made every project delete answer 503."
    ).toEqual([]);
  });

  it("checks the model link-target projections, which no call site spells out", () => {
    // This registry is the one place a projection is chosen for a table that
    // `.select()` only ever receives as `config.detailSelect` — a property of an
    // imported map, which the call-site scanner cannot resolve. It is also
    // exactly where the geometry_scope typo lived, so it is checked directly.
    const wrong: string[] = [];

    for (const [linkType, target] of Object.entries(MODEL_LINK_TARGETS)) {
      for (const [variant, projection] of [
        ["identitySelect", target.identitySelect],
        ["detailSelect", target.detailSelect],
      ] as const) {
        for (const column of projectionColumns(projection)) {
          if (!schema.hasColumn(target.table, column)) {
            wrong.push(`${linkType}.${variant}: ${target.table} has no ${column}`);
          }
        }
      }
    }

    expect(wrong.sort()).toEqual([]);
  });

  it("routes the project-delete precondition through the shared helper", () => {
    const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

    // The delegation chain, followed rather than assumed. Since 2026-08-12 the
    // counting sits behind `readProjectDeleteOutcome`, because TWO surfaces now
    // need the same answer: the DELETE route, and the pre-flight the delete
    // dialog calls so a planner learns what is attached BEFORE reaching for an
    // irreversible action. A second copy of the counting would let the question
    // and the enforcement disagree, which is worse than not asking at all.
    const deleteRoute = read("src/app/api/projects/[projectId]/route.ts");
    const preflightRoute = read("src/app/api/projects/[projectId]/delete-preflight/route.ts");
    const sharedReader = read("src/lib/projects/project-delete-outcome.ts");

    // The CALL, not the import. A guard that matched `import { countReferences }`
    // stayed green with the call replaced — the same failure recorded in
    // CLAUDE.md, reproduced by mutation while writing this.
    expect(deleteRoute).toMatch(/await readProjectDeleteOutcome\(/);
    expect(preflightRoute).toMatch(/await readProjectDeleteOutcome\(/);
    expect(sharedReader).toMatch(/await countReferences\(/);
    expect(sharedReader).toMatch(/await countConstrainedCostedPlacements\(/);

    // Behavioural, not textual: neither route, nor the reader between them, may
    // own a count of its own — that is what keeps the projection decision in
    // one home.
    expect(
      selectSites.filter(
        (site) =>
          site.isCount &&
          (site.file.includes("projects/[projectId]/route.ts") ||
            site.file.includes("projects/[projectId]/delete-preflight/route.ts") ||
            site.file === "src/lib/projects/project-delete-outcome.ts")
      )
    ).toEqual([]);

    // TWO counts in the helper as of 2026-08-10: the dynamic-table reference
    // sweep, and the constrained-and-costed placement filter the delete
    // refusal's severity rule reads. Both keep the `"*"` + head-only shape —
    // the property this guard exists for is that the projection decision has
    // ONE home, and both live in it.
    const helper = selectSites.filter((site) => site.file === "src/lib/api/reference-counts.ts");
    expect(helper).toHaveLength(2);
    for (const site of helper) {
      expect(site).toMatchObject({ projection: "*", isCount: true, headOnly: true });
    }
    expect(helper.map((site) => site.table).sort()).toEqual([null, "project_rtp_cycle_links"]);
  });

  it("guards the guard", () => {
    // A scanner that matched nothing would make all of the above vacuous.
    expect(selectSites.length).toBeGreaterThan(1000);
    expect(checkableSites().length).toBeGreaterThan(600);
    expect(selectSites.filter((site) => site.isCount).length).toBeGreaterThanOrEqual(20);

    // What is deliberately not checked, pinned so the skipped set cannot grow
    // into the whole codebase without someone noticing.
    expect(selectSites.filter((site) => site.projection === null).length).toBeLessThan(250);
    // Reads of a VIEW are not column-checked, because the schema inventory is
    // built from CREATE TABLE. The list is pinned so that exemption cannot grow
    // quietly: a new entry means a new unchecked projection, and it should only
    // ever be added by someone who looked at it. `gtfs_stops_map` was added
    // 2026-08-06 with the transit map layer — the view exists because
    // supabase-js cannot read a PostGIS geometry, and its projection is asserted
    // by name in `transit-map-layer.test.ts` instead of here.
    // `project_decision_package_my_work` is a security-invoker caller queue;
    // its exact projection and workspace isolation are covered by the My Work
    // unit tests and `decision-package-rls-live.test.ts`.
    expect(
      [...new Set(selectSites.filter((site) => site.table && schema.isView(site.table)).map((site) => site.table))].sort()
    ).toEqual([
      "census_tracts_map",
      "gtfs_stops_map",
      "project_bca_screenings_latest",
      "project_decision_package_my_work",
      "scenario_comparison_summary",
    ]);

    // The parser itself.
    expect(projectionColumns("id, workspace_id, name")).toEqual(["id", "workspace_id", "name"]);
    expect(projectionColumns("*")).toEqual([]);
    expect(projectionColumns("id, stages:model_run_stages(id, status)")).toEqual(["id"]);
    expect(projectionColumns("id, engagement_campaigns!inner(id)")).toEqual(["id"]);
    expect(projectionColumns("alias:real_column")).toEqual(["real_column"]);

    // The two defects this guard exists for, as direct schema questions.
    expect(schema.hasColumn("data_dataset_project_links", "id")).toBe(false);
    expect(schema.hasColumn("aerial_project_posture", "id")).toBe(false);
    expect(schema.hasColumn("data_datasets", "geometry_scope")).toBe(false);
    expect(schema.hasColumn("data_datasets", "geography_scope")).toBe(true);
  });
});
