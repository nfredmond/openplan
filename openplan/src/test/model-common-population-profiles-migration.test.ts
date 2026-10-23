import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { populationSourceRegistry, POPULATION_PROFILE_PURPOSES, type PopulationSourceRegistration } from "@/lib/geographies/population-source-registry";

const name = "20261022010004_model_common_population_profiles.sql";
const current = readFileSync(`supabase/migrations/${name}`, "utf8");
const admission = readFileSync("supabase/migrations/20261022010003_model_common_population_admission.sql", "utf8");
const ordinarySource = readFileSync("supabase/migrations/20261022010000_model_common_population_comparisons.sql", "utf8");
const replacement = readFileSync("supabase/migrations/20261022010001_model_population_replacement.sql", "utf8");
const catalog = JSON.parse(readFileSync("../scripts/modeling/population_source_profiles.v1.json", "utf8")) as { profiles: PopulationSourceRegistration[] };
const comparisonStart = "CREATE OR REPLACE FUNCTION public.validate_common_population_comparison()";
const comparisonEnd = "REVOKE ALL ON FUNCTION public.validate_common_population_comparison() FROM PUBLIC, anon, authenticated, service_role;";
function bounded(source: string, start: string, end: string) {
  const a = source.indexOf(start); const b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeGreaterThan(a);
  return source.slice(a, b + end.length);
}
function expectedComparison() {
  const old = bounded(admission, comparisonStart, comparisonEnd);
  const a = old.indexOf("  -- This adapter profile mirrors");
  const b = old.indexOf("  IF pg_catalog.jsonb_typeof(v_basis->'realized_zone_counts')", a);
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  return old.slice(0, a) +
    "  -- Retained technical validation uses the frozen catalog without rewriting the basis.\n" +
    "  v_profile := v_basis->'source_profile';\n" +
    "  IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN\n" +
    "    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';\n  END IF;\n" + old.slice(b);
}
function expectedOrdinary() {
  const old = bounded(ordinarySource, "CREATE FUNCTION public.read_common_population_stage_custody(",
    "REVOKE ALL ON FUNCTION public.read_common_population_stage_custody(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;");
  const a = old.indexOf("    v_profile := v_request->'sourceProfile';");
  const b = old.indexOf("  ELSIF v_request->>'mode' = 'reuse' THEN", a);
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  return (old.slice(0, a) +
    "    v_profile := v_request->'sourceProfile';\n" +
    "    IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN\n" +
    "      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';\n    END IF;\n" + old.slice(b))
    .replace("CREATE FUNCTION public.read_common_population_stage_custody(", "CREATE OR REPLACE FUNCTION public.read_common_population_stage_custody_before_replacement(")
    .replace("REVOKE ALL ON FUNCTION public.read_common_population_stage_custody(", "REVOKE ALL ON FUNCTION public.read_common_population_stage_custody_before_replacement(");
}
function requireCurrentCallers(source: string) {
  expect(bounded(source, comparisonStart, comparisonEnd)).toBe(expectedComparison());
  expect(bounded(source, "CREATE OR REPLACE FUNCTION public.read_common_population_stage_custody_before_replacement(",
    "REVOKE ALL ON FUNCTION public.read_common_population_stage_custody_before_replacement(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;"))
    .toBe(expectedOrdinary());
}

// These are literal file comparisons, not SQL parsing, installed call reachability,
// effective privileges, source authentication or native custody/receipt acceptance.
describe("latest population profile DDL source and frozen projection", () => {
  it("replaces only the two exact profile blocks in complete current function bodies", () => {
    requireCurrentCallers(current);
    requireCurrentCallers(`-- harmless survivor\n${current}`);
    expect(replacement).toContain("ALTER FUNCTION public.read_common_population_stage_custody(uuid,uuid,uuid,uuid) RENAME TO read_common_population_stage_custody_before_replacement;");
    expect(current).not.toContain("CREATE OR REPLACE FUNCTION public.read_common_population_stage_custody(");
    expect(current).not.toContain("CREATE OR REPLACE FUNCTION public.read_model_population_origin(");
  });
  it("retains the accepted P1 tail at its exact semicolon boundary", () => {
    const tail = bounded(admission, "  -- Resolve the actual parent and authorize before reading protected source rows.", comparisonEnd);
    expect(Buffer.byteLength(tail)).toBe(22893);
    expect(createHash("sha256").update(tail).digest("hex")).toBe("9d7b3efc19a3ae5afcfcb4e069718e109fa3b08dcaf620336ec5efabba5a9f6b");
  });
  it("pins catalog/TS/SQL membership independently for all technical purposes", () => {
    const projection = catalog.profiles.map((entry) => ({ profile: entry.profile,
      purposes: POPULATION_PROFILE_PURPOSES.filter((purpose) => entry.capabilities?.[purpose] === "supported") }));
    const frozen = sortedCompactJson(projection);
    expect(current).toContain(`$population_catalog$${frozen}$population_catalog$::pg_catalog.jsonb`);
    expect(current).toContain(`Frozen catalog projection SHA-256 (compact sorted JSON, no newline): ${createHash("sha256").update(frozen).digest("hex")}`);
    for (const entry of catalog.profiles) for (const purpose of POPULATION_PROFILE_PURPOSES) {
      expect(populationSourceRegistry.profileAllowed(entry.profile, purpose)).toBe(entry.capabilities?.[purpose] === "supported");
    }
  });
  it("keeps private pure helper declarations and all caller permissions without schema changes", () => {
    expect(current).toContain("RETURNS pg_catalog.bool\nLANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''");
    expect(current).not.toContain("pg_catalog.boolean");
    expect(current).toContain("pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object'");
    expect(current).toContain("OR p_purpose IS NULL OR p_purpose NOT IN (");
    expect(current).toContain("THEN false ELSE EXISTS (");
    expect(current).toContain("REVOKE ALL ON FUNCTION public.model_common_population_profile_allowed(pg_catalog.jsonb,pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;");
    expect(current).not.toMatch(/\bGRANT\b|CREATE TABLE|CREATE POLICY|CREATE TRIGGER|ALTER TABLE|ALTER OWNER|EXECUTE format|DISABLE TRIGGER/i);
    expect(readdirSync("supabase/migrations").filter((path) => path.startsWith("20261022010004_"))).toEqual([name]);
  });
  it.each(["comparison", "ordinary"])("detects removing the actual %s helper call in the complete source", (caller) => {
    const anchor = caller === "comparison" ? "  IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN"
      : "    IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN";
    const start = current.indexOf(caller === "comparison" ? comparisonStart : "CREATE OR REPLACE FUNCTION public.read_common_population_stage_custody_before_replacement(");
    const at = current.indexOf(anchor, start); expect(at).toBeGreaterThan(start);
    const broken = current.slice(0, at) + current.slice(at).replace(anchor, "  IF false THEN");
    expect(() => requireCurrentCallers(broken)).toThrow();
    requireCurrentCallers(current);
  });
});
