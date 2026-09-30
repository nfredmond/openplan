import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import signatures from "./fixtures/application-trusted-search-paths.json";

const fixture = readFileSync("src/test/fixtures/engagement/temporary-membership-shadow.sql", "utf8");
const paths = signatures.map(value => `'public.${value.replaceAll("'", "''")}'`).join(",");
const guard = `CREATE FUNCTION pg_temp.assert_trusted_paths() RETURNS void LANGUAGE plpgsql AS $guard$
DECLARE signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[${paths}] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=signature::regprocedure
    AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
   RAISE EXCEPTION 'Untrusted table lookup: %',signature;
  END IF;
 END LOOP;
END $guard$;`;

/** Probe installed routines in the named test stack. All mutations roll back. */
function run(sql: string) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${sql}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
  });
}

describe.skipIf(!LIVE_RLS)("installed application table lookup", () => {
  it.each(["", "-- Harmless lookup control."])("keeps temporary relations after trusted tables %s", comment => {
    expect(run(`${comment}\n${guard}\nSELECT pg_temp.assert_trusted_paths(); SELECT 'trusted-paths-verified';`)).toContain("trusted-paths-verified");
  });
  it("catches every individually weakened function setting", () => {
    const result = run(`${guard}
DO $faults$ DECLARE signature text; caught text; tested integer := 0; BEGIN
 FOREACH signature IN ARRAY ARRAY[${paths}] LOOP
  EXECUTE 'ALTER FUNCTION ' || signature || ' SET search_path=pg_catalog,public';
  caught := NULL;
  BEGIN PERFORM pg_temp.assert_trusted_paths(); EXCEPTION WHEN OTHERS THEN caught := SQLERRM; END;
  IF caught IS DISTINCT FROM 'Untrusted table lookup: ' || signature THEN
   RAISE EXCEPTION 'Lookup guard missed or misattributed mutation: %',signature;
  END IF;
  EXECUTE 'ALTER FUNCTION ' || signature || ' SET search_path=pg_catalog,public,pg_temp';
  tested := tested + 1;
 END LOOP;
 IF tested <> ${signatures.length} THEN RAISE EXCEPTION 'Incomplete mutation inventory'; END IF;
END $faults$;
SELECT pg_temp.assert_trusted_paths(); SELECT 'all-lookup-faults-caught';`);
    expect(result).toContain("all-lookup-faults-caught");
  });
  it.each(["", "-- Harmless membership control."])("preserves authorized reads and refuses temporary membership %s", comment => {
    expect(run(comment + "\n" + fixture)).toContain("temporary-membership-refused");
  });
  it("detects the native campaign bypass when temporary ordering is removed", () => {
    let failure: unknown;
    try {
      run("ALTER FUNCTION public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text) SET search_path=pg_catalog,public;\n" + fixture);
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain("Temporary membership bypassed campaign access");
  });
});
