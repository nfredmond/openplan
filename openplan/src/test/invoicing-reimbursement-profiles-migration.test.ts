import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for the reimbursement-profile columns
 * (20260727000009).
 *
 * billing_invoice_records gains three jurisdiction-neutral columns — which
 * profile a draw is logged under, a posture from THAT profile's vocabulary,
 * and how the profile was selected — plus a backfill that puts every
 * pre-profile row honestly on the interim default. The guard pins what the
 * migration must and must not do: additive columns only, a guarded selection
 * CHECK and coherence CHECK, NO posture-vocabulary CHECK (the vocabulary
 * belongs to the profile registry, not the schema), and no destructive
 * statement — caltrans_posture stays, inert.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000009_invoicing_reimbursement_profiles.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("invoicing reimbursement-profile migration", () => {
  it("adds the three profile columns additively and nullable", () => {
    for (const column of [
      "reimbursement_profile_id",
      "reimbursement_posture",
      "reimbursement_profile_selection",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE billing_invoice_records\\s+ADD COLUMN IF NOT EXISTS ${column} TEXT`,
        ),
      );
    }
    expect(sqlWithoutComments).not.toMatch(/TEXT NOT NULL/);
  });

  it("constrains selection provenance to the resolver's vocabulary, NULL allowed", () => {
    expect(sqlWithoutComments).toMatch(/reimbursement_profile_selection IS NULL/);
    for (const selection of [
      "explicitly_requested",
      "jurisdiction_matched",
      "interim_unconfigured_default",
    ]) {
      expect(sqlWithoutComments).toContain(`'${selection}'`);
    }
  });

  it("enforces posture-requires-profile coherence", () => {
    expect(sqlWithoutComments).toMatch(
      /reimbursement_posture IS NULL OR reimbursement_profile_id IS NOT NULL/,
    );
  });

  it("guards both constraint adds so re-running the migration is safe", () => {
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length).toBe(2);
  });

  it("puts NO jurisdiction vocabulary CHECK on the posture column", () => {
    // The valid posture set belongs to the resolved profile; validation lives
    // in the API against the registry, so a new jurisdiction is a descriptor,
    // never a constraint edit.
    expect(sqlWithoutComments).not.toMatch(/reimbursement_posture\s+IN\s*\(/i);
    expect(sqlWithoutComments).not.toMatch(/local_agency_consulting|federal_aid_candidate|deferred_exact_forms/);
  });

  it("backfills every pre-profile row onto the disclosed interim default", () => {
    expect(sqlWithoutComments).toMatch(/UPDATE billing_invoice_records/);
    expect(sqlWithoutComments).toMatch(/reimbursement_profile_id = 'us_ca_lapm_reimbursement_v1'/);
    expect(sqlWithoutComments).toMatch(/reimbursement_posture = caltrans_posture/);
    expect(sqlWithoutComments).toMatch(/reimbursement_profile_selection = 'interim_unconfigured_default'/);
    // Idempotent: only rows that have not been assigned a profile yet.
    expect(sqlWithoutComments).toMatch(/WHERE reimbursement_profile_id IS NULL/);
  });

  it("destroys nothing — caltrans_posture stays", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
  });
});
