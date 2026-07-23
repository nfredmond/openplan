import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OBSERVED_CRASH_SOURCE_IDS } from "@/lib/safety/sources/registry";
import { CRASH_SEVERITIES } from "@/lib/safety/sources/types";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260723000004_safety_crashes.sql"),
  "utf8"
);

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
    const match = /source_id\s+text NOT NULL CHECK \(source_id IN \(([^)]*)\)\)/.exec(sql);
    expect(match, "source_id CHECK constraint missing").toBeTruthy();

    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    // The DB allowlist and the TS registry must not drift apart.
    expect(allowed.sort()).toEqual([...OBSERVED_CRASH_SOURCE_IDS].sort());
    expect(allowed.some((id) => /estimate/i.test(id))).toBe(false);
  });

  it("keeps the severity domain aligned with the TypeScript buckets", () => {
    const match = /severity\s+text NOT NULL CHECK \(severity IN \(([^)]*)\)\)/.exec(sql);
    expect(match, "severity CHECK constraint missing").toBeTruthy();

    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    expect(allowed.sort()).toEqual([...CRASH_SEVERITIES].sort());
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
