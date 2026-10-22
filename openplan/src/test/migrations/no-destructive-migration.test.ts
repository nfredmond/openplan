import { describe, expect, it } from "vitest";
import { blankComments, migrationFiles, readMigration, splitTopLevel } from "./read-migrations";

/**
 * No migration may destroy data without a reviewed, by-name allowlist entry.
 *
 * The repo's 1.0 criterion is "an agency can be told their data is safe
 * across upgrades indefinitely", and self-hosted databases can never be
 * inspected or rolled back by the maintainer. The 163-migration history is
 * exemplary — zero DROP TABLE ever, one DROP COLUMN that backfills first,
 * every migration-time UPDATE a guarded repair — but until 2026-08-04 that
 * discipline was pure convention, and conventions do not survive model
 * handoffs. This ratchet makes the discipline structural: a new destructive
 * statement fails the build unless a human adds an allowlist entry that
 * names the file and documents the backfill/guard.
 *
 * What counts as destructive: top-level DROP TABLE / DROP SCHEMA /
 * ALTER TABLE … DROP COLUMN / DELETE FROM / TRUNCATE / UPDATE. Statements
 * inside dollar-quoted bodies (trigger functions, DO blocks) are runtime
 * SQL, not migration-time data changes, and are blanked before scanning —
 * a DELETE inside a cleanup trigger runs per-row later, not on upgrade.
 * REVOKE TRUNCATE and other privilege statements never match (statement-
 * start anchoring).
 */

type DestructiveKind =
  | "drop_table"
  | "drop_schema"
  | "drop_column"
  | "delete_from"
  | "truncate"
  | "update";

/**
 * Every allowlisted destructive statement, verified by reading at entry
 * time. The staleness check fails when an entry's file no longer contains a
 * statement of that kind, so the list can only shrink — and a NEW
 * destructive statement in an already-listed file for a DIFFERENT kind
 * still fails.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; kind: DestructiveKind; reason: string }> = [
  {
    file: "20261021215752_assistant_chat_turns.sql",
    kind: "update",
    reason:
      "Technical lead authorizes this ordinary release change: source_policy_pins belongs to the private schema/table " +
      "newly created in the same BEGIN migration. Eight rows inserted earlier capture policy sets; only their fresh " +
      "fingerprints are recomputed after seven cloned policies and five explicit policies. No preexisting tenant or " +
      "history data changes. An existing schema fails creation rather than replaying. The scoped assertion below " +
      "pins the single exact UPDATE, fresh schema/table and creation/seed/policy order.",
  },
  { file: "20260908000005_engagement_report_delivery.sql", kind: "update", reason: "Adds XLSX and ZIP to the existing private report-artifacts bucket MIME list, preserving every existing type and unrestricted null settings. Changes no user files." },
  { file: "20260907000004_work_program_export_custody.sql", kind: "update", reason: "Adds text/html to the existing private Documents bucket MIME list; preserves all existing types and unrestricted null configuration. Does not modify user files." },
  { file: "20260907000005_work_program_recovery_forward_repair.sql", kind: "update", reason: "Idempotent forward repair of the same additive private-bucket MIME extension; no content or financial rows changed." },
  {
    file: "20260722000006_aerial_project_posture_table.sql",
    kind: "drop_column",
    reason:
      "drops projects.aerial_posture AFTER backfilling every row into aerial_project_posture " +
      "(ON CONFLICT DO NOTHING); content pinned by aerial-project-posture-migration.test.ts",
  },
  {
    file: "20260226000006_workspace_billing_skeleton.sql",
    kind: "update",
    reason: "COALESCE backfill of new columns on existing rows; writes only NULLs forward",
  },
  {
    file: "20260519000080_county_run_worker_dispatch.sql",
    kind: "update",
    reason:
      "status-vocabulary rewrite executed BEFORE the narrowed CHECK that admits the new value; " +
      "maps old values onto new, loses nothing",
  },
  {
    file: "20260718000086_run_artifacts_bucket.sql",
    kind: "update",
    reason: "LIKE-guarded URL repair; touches only rows carrying the malformed prefix",
  },
  {
    file: "20260723000001_knowledge_base.sql",
    kind: "update",
    reason:
      "forces the kb-documents storage bucket private when provisioned public out-of-band; " +
      "WHERE-guarded, idempotent, a security repair not a data change",
  },
  {
    file: "20260727000009_invoicing_reimbursement_profiles.sql",
    kind: "update",
    reason:
      "provenance backfill marking pre-schema reimbursement selections interim_unconfigured_default — " +
      "the honest label for rows the old schema imposed",
  },
  {
    file: "20260729000001_funding_award_closure_provenance.sql",
    kind: "update",
    reason: "NULL-tested idempotent backfill, self-documented in the migration",
  },
  {
    file: "20260730000004_aerial_artifact_custody.sql",
    kind: "update",
    reason:
      "forces the aerial-artifacts storage bucket private when provisioned public out-of-band; " +
      "WHERE-guarded, idempotent, a security repair",
  },
  {
    file: "20260811000002_aerial_imagery.sql",
    kind: "update",
    reason:
      "forces the aerial-imagery storage bucket private when provisioned public out-of-band; " +
      "WHERE-guarded, idempotent, a security repair — the 20260730000004 precedent verbatim",
  },
  {
    file: "20260811000005_document_library_stored_kinds.sql",
    kind: "update",
    reason:
      "widens the kb-documents bucket's allowed_mime_types for the stored kinds and clears its " +
      "file_size_limit (the ceiling moved to OPENPLAN_KB_DOCUMENT_MAX_BYTES, enforced by the " +
      "route); WHERE-guarded to the one bucket row, touches no tenant data",
  },
  {
    file: "20260820000001_run_artifacts_markdown.sql",
    kind: "update",
    reason:
      "widens only the run-artifacts bucket MIME allowlist with text/markdown; preserves every " +
      "existing type, is idempotent, and touches no tenant data",
  },
  {
    file: "20260823000001_report_artifact_aerial_preview_mime.sql",
    kind: "update",
    reason:
      "widens only the report-artifacts bucket MIME allowlist with image/png; preserves every " +
      "existing type, is idempotent, and touches no tenant data",
  },
  {
    file: "20260823000007_land_use_plan_review_reporting.sql",
    kind: "update",
    reason:
      "backfills a deterministic feature hash only on already-finalized GIS versions whose new " +
      "feature_hash column is still NULL; geometry and source attributes are unchanged",
  },
  {
    file: "20260824000005_county_run_worker_lifecycle.sql",
    kind: "update",
    reason:
      "renames the pre-existing submitted lifecycle value to queued before narrowing the CHECK; " +
      "the job identity, payload, timestamps, and every other run field are preserved",
  },
  {
    file: "20260825000002_direct_workbook_portfolio_import.sql",
    kind: "update",
    reason:
      "backfills every existing v0.33 CSV batch with the equivalent worksheet 0/header row 1 " +
      "configuration before making that new provenance field required; no existing value is replaced",
  },
  {
    file: "20260827000002_governed_decision_enforcement.sql",
    kind: "update",
    reason:
      "controlled append-only receipt backfill: copies each immutable legacy receipt_json value " +
      "into receipt_canonical_json before the exact-text hash and NOT NULL constraints; no " +
      "historical receipt field is replaced",
  },
];

/**
 * Blank every dollar-quoted body ($$ … $$ or $tag$ … $tag$), preserving
 * length. `$1` positional params never match (no closing `$`).
 */
export function blankDollarQuoted(sql: string): string {
  const out = sql.split("");
  const tagPattern = /\$[A-Za-z_]*\$/g;
  let match = tagPattern.exec(sql);
  while (match) {
    const tag = match[0];
    const bodyStart = match.index + tag.length;
    const close = sql.indexOf(tag, bodyStart);
    if (close === -1) break;
    for (let i = bodyStart; i < close; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
    tagPattern.lastIndex = close + tag.length;
    match = tagPattern.exec(sql);
  }
  return out.join("");
}

export function classifyDestructive(statement: string): DestructiveKind | null {
  const normalized = statement.trim().replace(/\s+/g, " ");
  if (/^DROP TABLE/i.test(normalized)) return "drop_table";
  if (/^DROP SCHEMA/i.test(normalized)) return "drop_schema";
  if (/^ALTER TABLE .*DROP COLUMN/i.test(normalized)) return "drop_column";
  if (/^DELETE FROM/i.test(normalized)) return "delete_from";
  if (/^TRUNCATE/i.test(normalized)) return "truncate";
  if (/^UPDATE /i.test(normalized)) return "update";
  return null;
}

function destructiveStatementsIn(file: string): DestructiveKind[] {
  const scannable = blankDollarQuoted(blankComments(readMigration(file)));
  return splitTopLevel(scannable, ";")
    .map((statement) => classifyDestructive(statement))
    .filter((kind): kind is DestructiveKind => kind !== null);
}

describe("no migration destroys data without a reviewed allowlist entry", () => {
  const files = migrationFiles();

  it("limits the chat UPDATE allowance to one exact refresh of freshly created private policy pins", () => {
    const sql = blankComments(readMigration("20261021215752_assistant_chat_turns.sql"));
    const normalize = (statement: string) => statement.trim().replace(/\s+/g, " ");
    const topLevel = blankDollarQuoted(sql);
    const parts = splitTopLevel(topLevel, ";");
    const statements = parts.map(normalize).filter(Boolean);
    const offsetOf = (statement: string) => {
      const part = parts.find(candidate => normalize(candidate) === statement);
      expect(part, "The ordered statement must exist at top level").toBeDefined();
      return topLevel.indexOf(part!) + part!.search(/\S/);
    };
    const refresh = "UPDATE assistant_chat_private.source_policy_pins SET fingerprint=assistant_chat_private.policy_fingerprint(table_oid)";
    expect(statements.filter(statement => classifyDestructive(statement) === "update"),
      "The chat allowance admits only the single reviewed private fingerprint UPDATE").toEqual([refresh]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.filter(statement => /^(?:BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i.test(statement)))
      .toEqual(["BEGIN", "COMMIT"]);
    const schema = "CREATE SCHEMA assistant_chat_private";
    const table = "CREATE TABLE assistant_chat_private.source_policy_pins(table_oid oid PRIMARY KEY, fingerprint text NOT NULL)";
    expect(statements.filter(statement => /^CREATE SCHEMA\b/i.test(statement))).toEqual([schema]);
    expect(statements.filter(statement => /^CREATE TABLE assistant_chat_private\.source_policy_pins\b/i.test(statement))).toEqual([table]);
    expect(statements.indexOf(schema)).toBeLessThan(statements.indexOf(table));
    expect(statements.indexOf(table)).toBeLessThan(statements.indexOf(refresh));

    // Inspect the seed block without changing the shared SQL parser. Runtime
    // bodies elsewhere remain outside this migration-time UPDATE guard.
    const seeds = [...sql.matchAll(/DO \$body\$([\s\S]*?)END \$body\$/g)]
      .filter(match => match[1].includes("INSERT INTO assistant_chat_private.source_policy_pins"));
    expect(seeds).toHaveLength(1);
    const seed = seeds[0];
    expect(seed.index).toBeGreaterThan(offsetOf(table));
    const relations = seed[1].match(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\] LOOP/);
    expect(relations).not.toBeNull();
    expect(relations![1].replace(/\s+/g, "")).toBe([
      "public.workspaces", "public.workspace_members", "public.projects",
      "public.workspace_provider_api_connections", "public.workspace_provider_api_revisions",
      "public.usage_events", "public.assistant_action_approvals", "public.assistant_action_executions",
    ].map(name => "'" + name + "'::regclass").join(","));
    expect(normalize(seed[1])).toContain("INSERT INTO assistant_chat_private.source_policy_pins VALUES(t,assistant_chat_private.policy_fingerprint(t));");
    const seedEnd = seed.index! + seed[0].length;
    const policyNames = ["assistant_chat_approval_insert", "assistant_chat_usage_insert", "assistant_chat_usage_read",
      "assistant_chat_approval_read", "assistant_chat_execution_read"];
    for (const name of policyNames) {
      const declarations = statements.filter(statement => statement.startsWith("CREATE POLICY " + name + " "));
      expect(declarations, name + " is one top-level policy").toHaveLength(1);
      const policy = offsetOf(declarations[0]);
      expect(policy, name + " follows the fresh seed").toBeGreaterThan(seedEnd);
      expect(policy, name + " precedes the fingerprint refresh").toBeLessThan(offsetOf(refresh));
    }
  });

  it("scans a real migration set (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("classification trips on what it must and spares what it must (positive controls)", () => {
    expect(classifyDestructive("DROP TABLE projects")).toBe("drop_table");
    expect(classifyDestructive("alter table projects drop column aerial_posture")).toBe("drop_column");
    expect(classifyDestructive("DELETE FROM plans WHERE true")).toBe("delete_from");
    expect(classifyDestructive("TRUNCATE plans")).toBe("truncate");
    expect(classifyDestructive("UPDATE plans SET x = 1")).toBe("update");
    // Privilege statements name TRUNCATE without being it.
    expect(classifyDestructive("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stops FROM anon")).toBeNull();
    expect(classifyDestructive("CREATE TABLE plans (id uuid)")).toBeNull();
    // Runtime SQL inside a function body is blanked before classification.
    const trigger = `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN DELETE FROM plans; RETURN NULL; END $$ LANGUAGE plpgsql;`;
    const kinds = splitTopLevel(blankDollarQuoted(trigger), ";").map(classifyDestructive).filter(Boolean);
    expect(kinds).toEqual([]);
  });

  it("every destructive statement is allowlisted by file AND kind", () => {
    const allowed = new Set(ALLOWLIST.map((entry) => `${entry.file}#${entry.kind}`));
    const violations: string[] = [];
    for (const file of files) {
      for (const kind of destructiveStatementsIn(file)) {
        if (!allowed.has(`${file}#${kind}`)) violations.push(`${file}: ${kind}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("every allowlist entry is still real (ratchet: the list only shrinks)", () => {
    const stale = ALLOWLIST.filter(
      (entry) => !destructiveStatementsIn(entry.file).includes(entry.kind)
    ).map((entry) => `${entry.file}#${entry.kind}`);
    expect(stale).toEqual([]);
  });
});
