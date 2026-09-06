import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OBSERVED_CRASH_SOURCE_IDS } from "@/lib/safety/sources/registry";
import {
  CRASH_AGE_BANDS,
  CRASH_COLLISION_TYPES,
  CRASH_LIGHTING_CONDITIONS,
  CRASH_PARTY_ROLES,
  CRASH_PERSON_INJURIES,
  CRASH_SEVERITIES,
  CRASH_WEATHER_CONDITIONS,
} from "@/lib/safety/vocabulary";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260723000004_safety_crashes.sql"),
  "utf8"
);

/** The HEAD source-domain constraint after national FARS persistence. */
const sourceDomainSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260904000001_persist_fars_crashes.sql"),
  "utf8"
);

/** The migration that widened the severity band and added the neutral dimensions. */
const dimensionsSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260812000001_safety_crash_neutral_dimensions.sql"),
  "utf8"
);

/** The person-level table. */
const partiesSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260812000002_safety_crash_parties.sql"),
  "utf8"
);

/** Pull the value list out of a `CHECK (col IN ('a','b'))` clause. */
function checkValues(source: string, pattern: RegExp): string[] {
  const match = pattern.exec(source);
  expect(match, `CHECK constraint not found for ${pattern}`).toBeTruthy();
  return (match?.[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
}

describe("safety_crashes migration", () => {
  it("stores numeric lat/lng with a GENERATED PostGIS point, not a written geometry", () => {
    // supabase-js cannot send PostGIS values; the generated column is what lets
    // the client write plain numbers and still get an indexed geometry.
    expect(sql).toMatch(/latitude\s+double precision NOT NULL/);
    expect(sql).toMatch(/longitude\s+double precision NOT NULL/);
    expect(sql).toMatch(/geom\s+geometry\(Point, 4326\) GENERATED ALWAYS AS/);
    expect(sql).toContain("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)");
    expect(sql).toMatch(/STORED/);
  });

  it("indexes the geometry with GiST, which is the reason the column exists", () => {
    expect(sql).toMatch(/USING GIST \(geom\)/i);
  });

  it("restricts source_id to registered OBSERVED adapters so no estimate can land", () => {
    const match = /ADD CONSTRAINT safety_crashes_source_id_check\s+CHECK \(source_id IN \(([^)]*)\)\)/.exec(sourceDomainSql);
    expect(match, "source_id CHECK constraint missing").toBeTruthy();

    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    // The DB allowlist and the TS registry must not drift apart.
    expect(allowed.sort()).toEqual([...OBSERVED_CRASH_SOURCE_IDS].sort());
    expect(allowed.some((id) => /estimate/i.test(id))).toBe(false);
    expect(sourceDomainSql).toMatch(/safety_crash_parties intentionally remains CCRS-only/i);
  });

  it("keeps the severity domain aligned with the TypeScript buckets, at HEAD", () => {
    // The domain is now declared across two migrations: the original four bands
    // and the later widening that added `unknown`. What must match the TypeScript
    // vocabulary is the constraint in force at HEAD — the LAST one declared —
    // not the first. Asserting against the original file alone would have gone
    // red the moment the band was added and told a future reader to shrink the
    // vocabulary back.
    expect(checkValues(dimensionsSql, /ADD CONSTRAINT safety_crashes_severity_check\s*\n?\s*CHECK \(severity IN \(([^)]*)\)\)/)).toEqual(
      [...CRASH_SEVERITIES].sort()
    );
    // …and the original still declares the four it shipped with, so an installer
    // replaying the corpus from empty passes through a valid state.
    expect(checkValues(sql, /severity\s+text NOT NULL CHECK \(severity IN \(([^)]*)\)\)/)).toEqual(
      [...CRASH_SEVERITIES].filter((value) => value !== "unknown").sort()
    );
  });

  it("admits an UNSUPPLIED casualty count instead of storing it as zero", () => {
    // The defect: a missing count parsed to 0, and zero killed plus zero injured
    // is the definition of property-damage-only, so a collision whose outcome the
    // source never recorded was stored as one where nobody was hurt. Roughly 4.7%
    // of one state's 2025 records; 9.5% in one rural county. Three things have to
    // be true together — the band exists, the columns admit NULL, and the DEFAULT
    // is gone, because a default 0 re-fabricates the zero on any insert that omits
    // the column.
    expect(CRASH_SEVERITIES).toContain("unknown");
    expect(dimensionsSql).toMatch(/ALTER COLUMN killed_count DROP NOT NULL/);
    expect(dimensionsSql).toMatch(/ALTER COLUMN injured_count DROP NOT NULL/);
    expect(dimensionsSql).toMatch(/ALTER COLUMN killed_count DROP DEFAULT/);
    expect(dimensionsSql).toMatch(/ALTER COLUMN injured_count DROP DEFAULT/);
  });

  it("stores every neutral dimension as a NULLABLE column with its own closed CHECK", () => {
    // Nullable is load-bearing: NULL means the SOURCE does not record the
    // dimension, which is a different statement from 'unknown' (the source
    // records it and had nothing here). A NOT NULL column would force the two
    // together and a filter panel could never tell them apart.
    for (const [column, values] of [
      ["collision_type", CRASH_COLLISION_TYPES],
      ["lighting", CRASH_LIGHTING_CONDITIONS],
      ["weather", CRASH_WEATHER_CONDITIONS],
    ] as const) {
      expect(dimensionsSql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column} text`));
      expect(
        checkValues(
          dimensionsSql,
          new RegExp(`CHECK \\(\\s*${column} IS NULL OR ${column} IN \\(([^)]*)\\)`)
        )
      ).toEqual([...values].sort());
    }
  });

  it("records per-dimension coverage so an absent facet cannot read as a finding", () => {
    expect(dimensionsSql).toMatch(/ADD COLUMN IF NOT EXISTS dimension_coverage jsonb NOT NULL DEFAULT/);
    // party_count must be NULLABLE — a run that could not retrieve people has no
    // count, and 0 would claim the collisions involved nobody.
    expect(dimensionsSql).toMatch(/ADD COLUMN IF NOT EXISTS party_count integer(?!\s+NOT NULL)/);
    expect(checkValues(dimensionsSql, /party_completeness IN \(([^)]*)\)/)).toEqual([
      "not_retrieved",
      "not_supported",
      "retrieved",
    ]);
    expect(checkValues(dimensionsSql, /involvement_basis IS NULL OR involvement_basis IN \(([^)]*)\)/)).toEqual([
      "crash_flags",
      "party_rows",
    ]);
  });

  it("keeps the person table's vocabularies aligned with the TypeScript ones", () => {
    expect(checkValues(partiesSql, /party_role IN \(([\s\S]*?)\)\s*\)/)).toEqual([...CRASH_PARTY_ROLES].sort());
    expect(checkValues(partiesSql, /age_band IN \(([\s\S]*?)\)\s*\)/)).toEqual([...CRASH_AGE_BANDS].sort());
    expect(checkValues(partiesSql, /person_injury IN \(([\s\S]*?)\)\s*\)/)).toEqual(
      [...CRASH_PERSON_INJURIES].sort()
    );
    // A person the source coded no outcome for is `unknown`, never
    // `no_apparent_injury` — that would turn an unanswered question into a finding.
    expect(partiesSql).toMatch(/person_injury\s+text NOT NULL DEFAULT 'unknown'/);
  });

  it("gives the person table a GRANT block, and gives anon nothing", () => {
    // A permissive policy with no matching GRANT is a door with no handle:
    // PostgREST answers `permission denied` before RLS is consulted. The revoke
    // runs FIRST because Postgres drops column privileges along with table-level
    // ones, so a revoke after a grant destroys it.
    const revokeAt = partiesSql.indexOf("REVOKE ALL ON TABLE public.safety_crash_parties");
    const grantAt = partiesSql.indexOf("GRANT SELECT ON TABLE public.safety_crash_parties TO authenticated");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(partiesSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.safety_crash_parties TO service_role/
    );
    // No client write privilege at all, and nothing for anon, ever: a role, an
    // age band and an injury outcome beside a precise coordinate and date is
    // quasi-identifying, and anon is what every public surface runs as.
    expect(partiesSql).not.toMatch(/GRANT[^;]*ON TABLE public\.safety_crash_parties[^;]*TO[^;]*anon/);
    expect(partiesSql).not.toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.safety_crash_parties TO authenticated/
    );
  });

  it("closes the grant residue the two original safety tables were left with", () => {
    // Both were created 2026-07-23, BEFORE default privileges were flipped to
    // deny, and no migration had ever named either in a GRANT or a REVOKE — so
    // they carried the platform's bootstrap privileges, held harmless only by the
    // absence of a permissive write policy. That is a convention; this is a
    // mechanism, and it registers a denial the composition guard can police.
    for (const table of ["safety_crashes", "safety_crash_ingests"]) {
      expect(dimensionsSql).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`)
      );
      expect(dimensionsSql).toMatch(new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO authenticated`));
      expect(dimensionsSql).not.toMatch(
        new RegExp(`GRANT[^;]*ON TABLE public\\.${table}[^;]*TO[^;]*\\banon\\b`)
      );
    }
  });

  it("makes re-ingest idempotent via a source-scoped natural key", () => {
    expect(sql).toMatch(/UNIQUE \(workspace_id, source_id, external_id\)/);
  });

  it("records reported AND mappable counts so ungeocoded crashes stay visible", () => {
    expect(sql).toMatch(/crash_count\s+integer NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/geocoded_count\s+integer NOT NULL DEFAULT 0/);
  });

  it("treats no_coverage and source_unavailable as first-class recorded outcomes", () => {
    expect(sql).toContain("'no_coverage'");
    expect(sql).toContain("'out_of_coverage'");
    expect(sql).toContain("'source_unavailable'");
  });

  it("declares severity completeness so a missing KSI cannot read as zero", () => {
    expect(sql).toMatch(/severity_completeness text NOT NULL/);
    expect(sql).toContain("'kabco_full','fatal_injury_only','fatal_only'");
  });

  it("enables RLS with member-scoped SELECT policies on both tables", () => {
    expect(sql).toMatch(/ALTER TABLE public\.safety_crash_ingests ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.safety_crashes ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY safety_crashes_read ON public\.safety_crashes FOR SELECT/);
    expect(sql).toMatch(/CREATE POLICY safety_crash_ingests_read ON public\.safety_crash_ingests FOR SELECT/);
    // Reads are scoped by workspace membership, not left open.
    expect(sql).toMatch(/workspace_members wm[\s\S]{0,160}wm\.user_id = auth\.uid\(\)/);
  });

  it("pins search_path on the updated_at trigger function", () => {
    expect(sql).toMatch(/SET search_path = public, pg_catalog/);
  });
});
