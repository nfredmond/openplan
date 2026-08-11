import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPublicSlugCandidate,
  PUBLIC_SLUG_MAX_LENGTH,
  PUBLIC_SLUG_MIN_LENGTH,
} from "@/lib/engagement/public-portal-data";
import { mintPublicShareToken } from "@/lib/engagement/public-portal";

/**
 * Migration-content guard for the printable campaign address (20260810000002).
 *
 * What has to be true in the DATABASE rather than only in the resolver:
 *
 *   - the column is ADDITIVE and NULLABLE — no existing campaign gains an
 *     address it never chose, and nothing breaks on rows that predate this;
 *   - the slug is globally UNIQUE, because /engage/{slug} carries no workspace
 *     context to disambiguate two holders of the same word;
 *   - the format CHECK pins lowercase kebab within length bounds, and the
 *     resolver's own candidate test agrees with it — a slug the database will
 *     store but the resolver will never look up is an address that silently
 *     does not work, and the mirror image invites lookups that can never match;
 *   - nothing in the DDL names a place, an agency or a jurisdiction;
 *   - no destructive statement, no new table, no new policy — the counts the
 *     migration inventory asserts stay as they were.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260810000002_engagement_campaign_slugs.sql"
);

const sql = readFileSync(migrationPath, "utf8");

// Executable statements only — the header prose legitimately names things the
// migration must not do while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("the campaign public-slug migration", () => {
  it("adds the column additively and nullable, on the campaigns table", () => {
    expect(sqlWithoutComments).toMatch(/ALTER TABLE engagement_campaigns/);
    expect(sqlWithoutComments).toMatch(/ADD COLUMN IF NOT EXISTS public_slug TEXT NULL/i);
    // NOT NULL would demand an address from every campaign that never chose one.
    expect(sqlWithoutComments).not.toMatch(/public_slug TEXT NOT NULL/i);
  });

  it("makes the slug globally unique", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_public_slug_unique/);
    expect(sqlWithoutComments).toMatch(/UNIQUE \(public_slug\)/i);
    // Re-runnable: the constraint is added behind a pg_constraint existence check.
    expect(sqlWithoutComments).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s*WHERE conname = 'engagement_campaigns_public_slug_unique'/
    );
  });

  it("pins the format: lowercase kebab, bounded length, guarded re-runnably", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_public_slug_format_check/);
    expect(sqlWithoutComments).toMatch(
      /char_length\(public_slug\) BETWEEN 3 AND 64/i
    );
    expect(sqlWithoutComments).toMatch(/\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/);
    expect(sqlWithoutComments).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s*WHERE conname = 'engagement_campaigns_public_slug_format_check'/
    );
  });

  it("agrees with the resolver's candidate test about the bounds", () => {
    // The migration and the resolver each state 3 and 64. If either moves
    // without the other, an address becomes storable-but-unreachable or
    // lookup-able-but-unstorable — both silent.
    expect(sqlWithoutComments).toContain(
      `BETWEEN ${PUBLIC_SLUG_MIN_LENGTH} AND ${PUBLIC_SLUG_MAX_LENGTH}`
    );
  });

  it("keeps every share token a valid slug, so token-first lookup is the only disambiguation needed", () => {
    // The namespaces overlap BY DESIGN (see the migration header): a minted
    // token must satisfy the slug CHECK's shape, because the resolver decides
    // between them by lookup order, not by charset. If the CHECK ever excluded
    // token-shaped values, this documents that the disambiguation argument
    // changed and the resolver comment is now wrong.
    const token = mintPublicShareToken();
    expect(isPublicSlugCandidate(token)).toBe(true);
  });

  it("adds no table, no policy, and destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/CREATE TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/CREATE POLICY/i);
    expect(sqlWithoutComments).not.toMatch(/\bDROP\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("hardcodes no place, agency, or jurisdiction", () => {
    // The recurring product violation, checked in the executable text.
    expect(sqlWithoutComments).not.toMatch(/county|california|caltrans|nevada|nctc|fips/i);
  });
});
