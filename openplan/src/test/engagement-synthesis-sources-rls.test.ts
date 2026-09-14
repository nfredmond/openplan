import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const fixture = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261014000025_engagement_synthesis_sources.sql", "utf8");
const signature = "public.capture_engagement_synthesis_sources(uuid,uuid,jsonb)";
function changeCapture(old: string, replacement: string) {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${signature}'::regprocedure); IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing source capture mutation seam'; END IF; EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}

/** Native fixtures and faults roll back. Explicit candidate mode also rolls back the unapplied migration. */
function run(before = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const candidate = process.env.OPENPLAN_SYNTHESIS_SOURCE_CANDIDATE === "1" ? migration : "";
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${before}\n${fixture}\nROLLBACK;`,
  }).trim().split("\n").at(-1);
}
describe.skipIf(!LIVE_RLS)("native synthesis source custody", () => {
  it.each(["", "-- Harmless native source comment."])("preserves complete sources and scoped exact retries %s", before => {
    expect(run(before)).toBe("synthesis-source-custody-verified");
  });
  it.each([
    ["lost last concern", changeCapture("AND (before_date IS NULL OR i.created_at<before_date)\n ),", "AND (before_date IS NULL OR i.created_at<before_date) LIMIT 300\n ),"), "Complete source capture lost the 301st concern"],
    ["source text truncation", changeCapture("to_jsonb(i)-ARRAY", "(to_jsonb(i)||jsonb_build_object('body',left(i.body,600)))-ARRAY"), "Source text was truncated"],
    ["changed request actor", changeCapture("OR saved.actor_id IS DISTINCT FROM actor", ""), "Another actor reused the source request"],
    ["relative dates", changeCapture("AND e.value !~", "AND false AND e.value !~"), "Relative source date was accepted"],
    ["raw private read", "GRANT SELECT ON engagement_synthesis_sources TO authenticated; CREATE POLICY synthetic_allow ON engagement_synthesis_sources FOR SELECT TO authenticated USING (true);", "Direct private source table read was allowed"],
    ["anonymous read", "GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_sources(uuid,uuid) TO anon;", "Anonymous source read was allowed"],
    ["mutable sources", "ALTER TABLE engagement_synthesis_sources DISABLE TRIGGER engagement_synthesis_sources_immutable;", "Retained source mutation was allowed"],
  ])("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { run(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
