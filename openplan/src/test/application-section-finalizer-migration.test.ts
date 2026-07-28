import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_FINALIZER_MIGRATION,
  looksLikePendingFinalizerSchema,
} from "@/lib/grants/application";

/**
 * Migration-content guard for section finalizer tracking (20260727000016).
 *
 * updated_by/updated_at are touch-latest — the reorder PATCH stamps them on
 * every row — so they cannot name who finalized a section; a stored export
 * PDF could credit whoever last reordered the packet. finalized_by /
 * finalized_at record the finalization EVENT instead. The guard pins: both
 * columns additive (IF NOT EXISTS), the auth.users FK degrading to NULL on
 * user deletion, explanatory column comments, NO backfill (updated_by is
 * exactly the value that cannot be trusted), and nothing destructive.
 */

const migrationPath = path.join(
  process.cwd(),
  `supabase/migrations/${APPLICATION_FINALIZER_MIGRATION}.sql`,
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("application section finalizer migration", () => {
  it("adds both finalizer columns additively to the sections table", () => {
    expect(sql).toMatch(
      /ALTER TABLE funding_opportunity_application_sections\s+ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL;/,
    );
    expect(sql).toMatch(
      /ALTER TABLE funding_opportunity_application_sections\s+ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;/,
    );
  });

  it("explains the event-vs-touch distinction in the header and column comments", () => {
    // The header must record WHY updated_* cannot carry the finalizer.
    expect(sql).toMatch(/updated_by/);
    expect(sql).toMatch(/reorder/i);
    expect(sql).toMatch(/EVENT/);
    expect(sql).toMatch(
      /COMMENT ON COLUMN funding_opportunity_application_sections\.finalized_by IS/,
    );
    expect(sql).toMatch(
      /COMMENT ON COLUMN funding_opportunity_application_sections\.finalized_at IS/,
    );
  });

  it("does NOT backfill from updated_by — pre-tracking rows stay honestly NULL", () => {
    // Backfilling would launder the exact value this migration exists to
    // distrust. The export discloses the gap instead.
    expect(sqlWithoutComments).not.toMatch(/UPDATE\s+funding_opportunity_application_sections/i);
    expect(sqlWithoutComments).not.toMatch(/SET\s+finalized_by\s*=/i);
    expect(sql).toContain("finalized before finalizer tracking; not recorded");
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/TRUNCATE/i);
  });
});

describe("looksLikePendingFinalizerSchema", () => {
  it("recognises both PostgREST shapes for the missing columns", () => {
    // SELECT against a pre-migration database (Postgres 42703).
    expect(
      looksLikePendingFinalizerSchema(
        "column funding_opportunity_application_sections.finalized_by does not exist",
      ),
    ).toBe(true);
    // UPDATE against a pre-migration database (PostgREST PGRST204).
    expect(
      looksLikePendingFinalizerSchema(
        "Could not find the 'finalized_at' column of 'funding_opportunity_application_sections' in the schema cache",
      ),
    ).toBe(true);
  });

  it("does not false-positive on unrelated failures", () => {
    expect(looksLikePendingFinalizerSchema(null)).toBe(false);
    expect(looksLikePendingFinalizerSchema("permission denied for table")).toBe(false);
    expect(
      looksLikePendingFinalizerSchema(
        "Could not find the table 'public.funding_opportunity_application_sections' in the schema cache",
      ),
    ).toBe(false);
    expect(looksLikePendingFinalizerSchema("finalized_by must be reviewed")).toBe(false);
  });
});
