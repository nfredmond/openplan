import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Migration 20261102110100 adds `sha256` and `appendix_manifest_json` to the
 * application export register. Real roles, policies, grants and constraints in
 * a rolled-back transaction: members of the workspace write and read the new
 * columns through the same append-only surface as before, and nobody else
 * does. This does not run the export route, Storage or PostgREST.
 */
(LIVE_RLS ? describe : describe.skip)("application export custody columns", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir for export custody fixtures.");
    }
    container = resolveLocalDbContainer();
  });

  const HASH = "f4fb7857f274333009098f395252d2e8a6ed2e4281d03f563cd0705cc7cf8dcc";
  const MANIFEST = JSON.stringify([{ key: "hin_map", status: "included", sourceId: "artifact-1", hash: HASH, mapDrawn: true }]);

  function exercise(body: string): void {
    const ids = Object.fromEntries(["owner", "viewer", "outsider", "opportunity", "export", "other"].map((key) => [key, randomUUID()]));
    const sql = `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
      INSERT INTO auth.users(id,email) VALUES
        ('@owner','@owner@example.test'), ('@viewer','@viewer@example.test'), ('@outsider','@outsider@example.test');
      CREATE FUNCTION pg_temp.ws() RETURNS uuid LANGUAGE sql AS $f$
        SELECT workspace_id FROM public.workspace_members WHERE user_id='@owner' AND role='owner' LIMIT 1;
      $f$;
      CREATE FUNCTION pg_temp.check(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $f$
        BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',reason; END IF; END;
      $f$;
      CREATE FUNCTION pg_temp.act_as(uid text) RETURNS void LANGUAGE sql AS $f$
        SELECT set_config('request.jwt.claim.sub',uid,true), set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
      $f$;
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(pg_temp.ws(),'@viewer','viewer');
      INSERT INTO public.funding_opportunities(id,workspace_id,title,created_by) VALUES('@opportunity',pg_temp.ws(),'Synthetic custody opportunity','@owner');
      GRANT EXECUTE ON FUNCTION pg_temp.ws(), pg_temp.check(boolean,text), pg_temp.act_as(text) TO authenticated;
      ${body}
      SELECT 'EXPORT_CUSTODY_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(owner|viewer|outsider|opportunity|export|other)/g, (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
    });
    expect(output).toContain("EXPORT_CUSTODY_ASSERTIONS_REACHED");
  }

  const insertAs = (extra = `'${HASH}', '${MANIFEST}'::jsonb`, id = "@export") => `
    INSERT INTO public.funding_opportunity_application_exports
      (id, workspace_id, opportunity_id, storage_path, pdf_engine, page_count, generated_by, sha256, appendix_manifest_json)
      VALUES ('${id}', pg_temp.ws(), '@opportunity', pg_temp.ws()::text || '/@opportunity/${id}.pdf', 'builtin', 3, '@owner', ${extra})`;

  it("lets a workspace writer record the hash and manifest, and members read them back", () => exercise(`
    SELECT pg_temp.act_as('@owner'); SET LOCAL ROLE authenticated;
    ${insertAs()};
    SELECT pg_temp.check((SELECT sha256='${HASH}' AND appendix_manifest_json->0->>'key'='hin_map'
      FROM public.funding_opportunity_application_exports WHERE id='@export'),'Owner cannot read the recorded custody');
    RESET ROLE;
    SELECT pg_temp.act_as('@viewer'); SET LOCAL ROLE authenticated;
    SELECT pg_temp.check((SELECT sha256='${HASH}' FROM public.funding_opportunity_application_exports WHERE id='@export'),'Viewer cannot read the recorded hash');
    RESET ROLE;
  `));

  it("keeps the register member-only and append-only with the new columns", () => exercise(`
    SELECT pg_temp.act_as('@owner'); SET LOCAL ROLE authenticated;
    ${insertAs()};
    DO $t$ BEGIN
      BEGIN UPDATE public.funding_opportunity_application_exports SET sha256=repeat('0',64) WHERE id='@export';
        RAISE EXCEPTION 'Member UPDATE of the hash accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN DELETE FROM public.funding_opportunity_application_exports WHERE id='@export';
        RAISE EXCEPTION 'Member DELETE accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $t$;
    RESET ROLE;
    SELECT pg_temp.act_as('@viewer'); SET LOCAL ROLE authenticated;
    DO $t$ BEGIN
      BEGIN ${insertAs(`'${HASH}', NULL`, "@other")};
        RAISE EXCEPTION 'Viewer insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $t$;
    RESET ROLE;
    SELECT pg_temp.act_as('@outsider'); SET LOCAL ROLE authenticated;
    SELECT pg_temp.check((SELECT count(*)=0 FROM public.funding_opportunity_application_exports WHERE id='@export'),'Outsider read another workspace''s export');
    DO $t$ BEGIN
      BEGIN ${insertAs(`'${HASH}', NULL`, "@other")};
        RAISE EXCEPTION 'Outsider insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $t$;
    RESET ROLE;
    SET LOCAL ROLE anon;
    DO $t$ BEGIN
      BEGIN PERFORM sha256 FROM public.funding_opportunity_application_exports;
        RAISE EXCEPTION 'Anonymous read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $t$;
    RESET ROLE;
    SELECT pg_temp.check(NOT has_table_privilege('authenticated','public.funding_opportunity_application_exports','UPDATE')
      AND NOT has_table_privilege('authenticated','public.funding_opportunity_application_exports','DELETE')
      AND has_column_privilege('authenticated','public.funding_opportunity_application_exports','sha256','INSERT')
      AND has_column_privilege('authenticated','public.funding_opportunity_application_exports','appendix_manifest_json','SELECT')
      AND NOT has_column_privilege('anon','public.funding_opportunity_application_exports','sha256','SELECT'),'Export register privileges changed');
  `));

  it.each([
    ["an uppercase hash", `'${HASH.toUpperCase()}', NULL`],
    ["a short hash", `'${HASH.slice(0, 63)}', NULL`],
    ["a non-hex hash", `'${"g".repeat(64)}', NULL`],
    ["a manifest that is not an array", `'${HASH}', '{"key":"hin_map"}'::jsonb`],
  ])("refuses %s even from a workspace writer", (_label, values) => exercise(`
    SELECT pg_temp.act_as('@owner'); SET LOCAL ROLE authenticated;
    DO $t$ BEGIN
      BEGIN ${insertAs(values)};
        RAISE EXCEPTION 'Malformed custody accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $t$;
    RESET ROLE;
  `));

  it("keeps both columns optional for exports that recorded neither", () => exercise(`
    SELECT pg_temp.act_as('@owner'); SET LOCAL ROLE authenticated;
    ${insertAs("NULL, NULL")};
    SELECT pg_temp.check((SELECT sha256 IS NULL AND appendix_manifest_json IS NULL FROM public.funding_opportunity_application_exports WHERE id='@export'),'Optional custody not stored as NULL');
    RESET ROLE;
  `));
});
