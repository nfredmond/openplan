import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * COLUMNS NOTHING IN THE APPLICATION EVER NAMES — counted, categorised, and
 * ratcheted.
 *
 * CLAUDE.md ranks a reachability sweep first in the audit order, and names three
 * kinds: routes nothing calls, exports nothing imports, and COLUMNS NOTHING
 * SELECTS. The first has `every-api-route-has-a-caller.test.ts`. The second is
 * knip, which runs in `qa:gate`. The third had nothing, and it is the one that
 * hides the repository's signature defect: a capability that looks shipped
 * because the schema is there.
 *
 * A column the application never names is one of three things, and the
 * difference is the whole point of this file:
 *
 *   INERT      Deliberately-dead schema. The Stripe and request-access tables
 *              were emptied of code in 2026-07-24 and their columns left in
 *              place on purpose — CLAUDE.md: "dead schema no code reads is
 *              inert, and dropping it is irreversible against a hosted
 *              database". These must stay unread.
 *   WRITE_ONLY Something records it and nothing surfaces it. Usually a
 *              provenance or vintage stamp, which is exactly the sort of thing
 *              an agency needs and nobody misses until they are asked to defend
 *              a number.
 *   READ_IN_SQL Read by a view, an RPC or a policy rather than by TypeScript.
 *              Not a gap at all — but invisible to a scan of `src/`, so it has
 *              to be named or it looks like one.
 *   UNBUILT    Neither written nor read. The schema implies a capability that
 *              does not exist. `network_package_versions.file_hash` carries the
 *              comment "SHA-256 hash of the primary network bundle for
 *              integrity verification" — there is no such verification, and no
 *              hash. A reviewer reading the schema would conclude otherwise.
 *
 * WHAT THIS DOES NOT PROVE. A column read through `select("*")` is invisible to
 * it (nine files do that), and a name shared with an unrelated identifier counts
 * as used. So it UNDER-reports: everything it finds is real, and it finds less
 * than everything. That direction is deliberate — a noisy guard gets an
 * allowlist entry instead of a fix.
 *
 * MEASURED 2026-08-07 against the live catalog: 1,794 columns in public base
 * tables, 45 named nowhere in `src/`. TWO have already left the list:
 * `network_package_versions.file_hash` is written at ingest as a digest of the
 * nodes and links a version was built from — and investigating it CORRECTED the
 * entry that described it, because there is no "primary network bundle" to
 * checksum: content arrives as parsed GeoJSON in a request body, so the
 * column's original premise never matched the design. And
 * `equity_tract_designations.retrieved_at` was WRITE_ONLY until the sweep found
 * it, and now reaches the analysis payload as the capture date of a Justice40
 * designation — which is the point of counting these rather than shrugging at
 * them.
 */

const APP_ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(APP_ROOT, "src");

type Category = "INERT" | "WRITE_ONLY" | "UNBUILT" | "READ_IN_SQL";

/**
 * Every column the application never names, with what it is and why.
 *
 * A RATCHET: entries may be removed — by reading the column, or by deleting it
 * in a migration — and the staleness assertion below fails if one stops being
 * unread. Adding a line means arguing that a new column should exist without a
 * reader.
 */
const UNREAD_COLUMNS: ReadonlyArray<{
  column: string;
  category: Category;
  reason: string;
}> = [
  // ---- INERT: the commercial-era schema, deliberately left in place --------
  ...[
    "access_requests.data_sensitivity",
    "access_requests.deployment_posture",
    "access_requests.desired_first_workflow",
    "access_requests.expected_workspace_name",
    "access_requests.onboarding_needs",
    "access_requests.organization_type",
    "access_requests.provisioned_workspace_id",
    "access_requests.reviewed_by_user_id",
    "access_requests.role_title",
    "access_requests.service_lane",
    "access_requests.use_case",
    "access_request_review_events.access_request_id",
    "access_request_review_events.previous_status",
    "access_request_review_events.reviewer_user_id",
    "billing_webhook_receipts.payload_hash",
    "billing_webhook_receipts.processed_at",
    "subscriptions.current_period_start",
    "subscriptions.quota_buckets",
    "subscriptions.stripe_subscription_id",
    "usage_events.idempotency_key",
    "usage_events.stripe_report_event_id",
    "usage_events.stripe_reported_at",
    "workspaces.stripe_customer_id",
    "workspaces.stripe_subscription_id",
    "workspaces.subscription_current_period_end",
    "workspaces.subscription_plan",
    "workspaces.subscription_status",
  ].map((column) => ({
    column,
    category: "INERT" as const,
    reason:
      "Request-access or Stripe schema. The code was deleted 2026-07-24 and these columns were left " +
      "deliberately: dropping them is irreversible against a hosted database, and unread schema is " +
      "inert. They must STAY unread — a reader here would be reintroducing a paid tier.",
  })),

  // ---- WRITE_ONLY: recorded by something, surfaced by nothing --------------
  // (2026-08-11) engagement_item_demographics.captured_at left this list when
  // aerial_imagery.captured_at shipped: the detector is identifier-based on
  // purpose, and `captured_at` is now genuinely read and rendered (the aerial
  // imagery panel). The engagement column's own question — a representativeness
  // claim rests on data of some age and does not say which — remains open and
  // is out of this detector's sight now; whoever surfaces demographics next
  // should still answer it.
  {
    column: "analyses.sql_executed",
    category: "WRITE_ONLY",
    reason:
      "The SQL an analysis actually ran — provenance for a result, stored and never shown. The one " +
      "thing that would let a reviewer reproduce a number by hand.",
  },
  ...[
    "project_portfolio_import_batches.defaults_json",
    "project_portfolio_import_batches.imported_by",
    "project_portfolio_import_batches.mapping_json",
    "project_portfolio_import_batches.preview_sha256",
    "project_portfolio_import_rows.actor_id",
    "project_portfolio_import_rows.errors_json",
    "project_portfolio_import_rows.mapped_source_id",
    "project_portfolio_import_rows.resolved_delivery_phase",
    "project_portfolio_import_rows.resolved_plan_type",
    "project_portfolio_import_rows.resolved_status",
    "project_portfolio_import_rows.source_location_text",
    "project_portfolio_import_rows.warnings_json",
  ].map((column) => ({
    column,
    category: "WRITE_ONLY" as const,
    reason:
      "Immutable reviewed-import provenance. The Projects page surfaces the batch counts and source hash; " +
      "these row-level approval details remain preserved for a later audit without exposing source cells on the summary surface.",
  })),

  // ---- UNBUILT: the schema implies a capability that does not exist --------
  {
    column: "census_tracts.pop_black",
    category: "UNBUILT",
    reason:
      "Ingested by nothing — `seed_public_census_tract` has no parameter for it, so it is always NULL. The " +
      "equity lane derives minority share from pop_white against the race universe instead. Present " +
      "in the schema as though a per-group breakdown existed.",
  },
  {
    column: "census_tracts.pop_hispanic",
    category: "UNBUILT",
    reason:
      "Same as pop_black: no parameter on the seed function, no reader, always NULL. Two columns that " +
      "look like a per-group demographic breakdown the product does not have.",
  },

  // ---- READ_IN_SQL: the database reads these; TypeScript never names them --
  ...[
    ["census_tracts.households_zero_vehicle", "The numerator of `pct_zero_vehicle` in the census_tracts_computed view. TypeScript reads the computed percentage, never the raw count."],
    ["census_tracts.median_household_income", "Selected by the census_tracts_computed view and surfaced through it; also the column an anonymous write rewrote in the 20260730000009 incident."],
    ["lodes_od.h_geocode", "Grouped by the lodes_by_tract view to derive home-tract totals."],
    ["kb_document_chunks.content_tsv", "The full-text index the kb_search_chunks RPC searches. Maintained by a trigger, queried in SQL, never named in TypeScript."],
    ["analyses.is_public", "Read by the analyses row-level-security policy and by the share-token index, both in SQL. The application sets sharing through the token, not this flag."],
    ["project_portfolio_import_rows.batch_id", "Read by the immutable-provenance trigger during a batch cascade and enforced by the row foreign key and batch-row index; TypeScript reads only batch summaries."],
  ].map(([column, reason]) => ({ column, category: "READ_IN_SQL" as const, reason })),

  // ---- More inert commercial-era schema -----------------------------------
  ...[
    "access_request_review_events.event_type",
    "billing_events.event_type",
    "billing_webhook_receipts.event_id",
    "billing_webhook_receipts.event_type",
    "subscriptions.current_period_end",
    "subscriptions.stripe_customer_id",
    "workspaces.billing_updated_at",
  ].map((column) => ({
    column,
    category: "INERT" as const,
    reason:
      "Request-access or Stripe schema, left in place when the code was deleted 2026-07-24 for the " +
      "reason CLAUDE.md gives: dropping it is irreversible against a hosted database. Must stay unread.",
  })),

  // ---- UNBUILT and WRITE_ONLY, continued ----------------------------------
  {
    column: "workspaces.is_demo",
    category: "UNBUILT",
    reason:
      "A demo-workspace flag nothing sets and nothing checks. The product has no demo mode; the column " +
      "implies one, which is the sort of thing a reviewer reads the schema and believes.",
  },
  ...[
    ["routes.short_name", "GTFS route short name"],
    ["routes.long_name", "GTFS route long name"],
    ["routes.text_color", "GTFS route text colour"],
    ["shapes.shape_id", "GTFS shape identifier"],
    ["trips.shape_id", "GTFS trip-to-shape link"],
  ].map(([column, what]) => ({
    column,
    category: "UNBUILT" as const,
    reason:
      `${what}: the raw GTFS table carries it and the ingest never populates it. OpenPlan stores ` +
      "SERVICE LEVELS, not a timetable — the deliberate decision guarded by " +
      "the-timetable-is-not-persisted.test.ts — so these columns are the shape of a timetable the " +
      "product does not keep. Present in the schema as though it did.",
  })),
];

/**
 * Columns whose name is too generic to attribute to one table by grep.
 *
 * (2026-08-11) `reviewed_at` and `failure_reason` joined this list, and the
 * reason is worth recording because they arrived by tripping the INERT alarm
 * below rather than by anyone noticing. This scan collects bare snake_case
 * identifiers out of the source and asks whether a column NAME appears; it has
 * no idea which table an appearance belongs to. So when the document-
 * transcription lane shipped `rtp_extraction_candidates.reviewed_at` and
 * `rtp_extraction_runs.failure_reason`, the guard reported that
 * `access_requests.reviewed_at` and `billing_webhook_receipts.failure_reason`
 * had "gained a reader — the paid tier is coming back". Neither had; two
 * unrelated tables had grown columns with the same ordinary names.
 *
 * Excusing the NAME rather than the two columns is the honest response: a name
 * this guard cannot attribute proves nothing about either table, and leaving it
 * in would make the next collision look like a finding too. What still guards
 * the commercial schema for real is `no-paid-tier-guard.test.ts`, which
 * forbids the imports, the routes and the live surfaces rather than grepping
 * for a word.
 */
const TOO_GENERIC = new Set([
  "id",
  "name",
  "title",
  "status",
  "notes",
  "metadata",
  "created_at",
  "updated_at",
  "workspace_id",
  "user_id",
  "project_id",
  "reviewed_at",
  "failure_reason",
]);

/** Tables Postgres or an extension owns; not ours to explain. */
const EXTENSION_OWNED = new Set(["spatial_ref_sys", "geography_columns", "geometry_columns"]);

function sourceIdentifiers(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `src/test` is excluded on purpose: a column named ONLY by a test
        // fixture is still a column the product never reads.
        if (entry !== "test") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(full)) continue;
      for (const match of readFileSync(full, "utf8").matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
        found.add(match[0]);
      }
    }
  };
  walk(SRC);
  return found;
}

function unreadColumns(): string[] {
  const schema = loadSchemaInventory();
  const identifiers = sourceIdentifiers();
  const unread: string[] = [];

  for (const table of schema.tables()) {
    if (EXTENSION_OWNED.has(table)) continue;
    for (const column of schema.columns(table) ?? []) {
      if (TOO_GENERIC.has(column)) continue;
      // A single-word column name collides with too much ordinary prose to
      // attribute; this guard only speaks about snake_case names.
      if (!column.includes("_")) continue;
      if (!identifiers.has(column)) unread.push(`${table}.${column}`);
    }
  }
  return unread.sort();
}

describe("a column the application never reads has to say why", () => {
  it("scans a schema big enough to be worth scanning", () => {
    // Without this the assertions below could pass by parsing nothing — the
    // failure that makes a guard worse than none.
    const schema = loadSchemaInventory();
    expect(schema.tables().length).toBeGreaterThan(110);
    expect(sourceIdentifiers().size).toBeGreaterThan(2000);
  });

  it("finds no unread column that is not accounted for", () => {
    const documented = new Set(UNREAD_COLUMNS.map((entry) => entry.column));
    const undocumented = unreadColumns().filter((column) => !documented.has(column));

    expect(
      undocumented,
      "these columns exist and nothing in the application ever names them. Each is either dead " +
        "schema, something written and never surfaced, or a capability the schema implies and the " +
        "code never built. Read it, delete it, or add it to UNREAD_COLUMNS with which of the three " +
        "it is."
    ).toEqual([]);
  });

  it("keeps the ratchet honest — a column that gained a reader loses its entry", () => {
    const unread = new Set(unreadColumns());
    const stale = UNREAD_COLUMNS.filter((entry) => !unread.has(entry.column)).map(
      (entry) => entry.column
    );

    expect(
      stale,
      "these columns are now read (or no longer exist) — remove them from UNREAD_COLUMNS so the " +
        "count keeps meaning something"
    ).toEqual([]);
  });

  it("makes every entry state which kind it is, and argue it", () => {
    for (const entry of UNREAD_COLUMNS) {
      expect(["INERT", "WRITE_ONLY", "UNBUILT", "READ_IN_SQL"], entry.column).toContain(
        entry.category
      );
      expect(entry.reason.length, `${entry.column}: an entry needs a real reason`).toBeGreaterThan(60);
    }
  });

  it("does not let the commercial-era schema grow a reader", () => {
    // The INERT entries are the one category that must NEVER shrink by being
    // read. `no-paid-tier-guard.test.ts` forbids the imports and the routes;
    // this forbids the quieter version — a column read putting a subscription
    // field back into the product one `.select()` at a time.
    const inert = UNREAD_COLUMNS.filter((entry) => entry.category === "INERT");
    const unread = new Set(unreadColumns());

    expect(inert.length, "the inert commercial schema list emptied — that is suspicious, not good").
      toBeGreaterThan(20);
    for (const entry of inert) {
      expect(unread.has(entry.column), `${entry.column} gained a reader — the paid tier is coming back`).
        toBe(true);
    }
  });
});
