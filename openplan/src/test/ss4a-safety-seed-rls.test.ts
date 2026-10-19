import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// Real database roles, triggers and transactions. This does not run the report
// builder, HTTP route, browser, concurrent sessions or a scientific calculation.
(LIVE_RLS ? describe : describe.skip)("SS4A Safety persistence and seed transaction boundaries", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir for Safety fixtures.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const ids = Object.fromEntries(["ACTOR", "VIEWER", "OUTSIDER", "PROJECT", "REPORT", "ARTIFACT", "INGEST", "OPPORTUNITY", "OLD_DRAFT"].map(key => [key, randomUUID()]));
    const fixture = readFileSync("src/test/fixtures/grants/safety-seed-native.sql", "utf8");
    const input = `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
      ${fixture}\n${body}\nSELECT 'SS4A_NATIVE_ASSERTIONS_REACHED'; ROLLBACK;`
      .replace(/__(ACTOR|VIEWER|OUTSIDER|PROJECT|REPORT|ARTIFACT|INGEST|OPPORTUNITY|OLD_DRAFT)__/g, (_, key: string) => ids[key]);
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("SS4A_NATIVE_ASSERTIONS_REACHED");
  }

  it("persists under service role with inherited revision triggers and immutable lockable custody", () => exercise(`
    SET LOCAL ROLE service_role;
    SELECT pg_temp.persist_safety();
    DO $$ DECLARE c public.report_safety_snapshot_persistence; BEGIN
      SELECT * INTO STRICT c FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__' FOR SHARE;
      PERFORM pg_temp.assert_safety(c.source_project_updated_at=(SELECT project_before FROM safety_input),'Snapshot source P0 changed');
      PERFORM pg_temp.assert_safety(c.persisted_project_updated_at>c.source_project_updated_at,'Own writes did not advance P0');
      PERFORM pg_temp.assert_safety(c.persisted_project_updated_at=(SELECT updated_at FROM public.projects WHERE id='__PROJECT__'),'Resulting project revision not recorded');
      PERFORM pg_temp.assert_safety((SELECT (metadata_json->'safetyPlanSnapshotV1'->>'projectUpdatedAt')::timestamptz=c.source_project_updated_at
        AND (metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz=c.report_updated_at
        FROM public.report_artifacts WHERE id='__ARTIFACT__'),'Frozen source or report receipt changed');
      BEGIN UPDATE public.report_safety_snapshot_persistence SET artifact_id=artifact_id WHERE artifact_id='__ARTIFACT__';
        RAISE EXCEPTION 'Custody update accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.assert_safety(NOT has_table_privilege(current_user,'public.report_safety_snapshot_persistence','UPDATE'),'Broad custody UPDATE granted');
    END $$; RESET ROLE;`));

  it("refuses a source edit before persistence without leaving partial writes", () => exercise(`
    UPDATE public.projects SET summary='A genuine edit after P0' WHERE id='__PROJECT__';
    SET LOCAL ROLE service_role;
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.persist_safety(); RAISE EXCEPTION 'Stale source accepted';
        EXCEPTION WHEN serialization_failure THEN NULL; END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_artifacts WHERE id='__ARTIFACT__'),'Stale persistence left artifact');
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__'),'Stale persistence left custody');
      PERFORM pg_temp.assert_safety((SELECT status='draft' FROM public.reports WHERE id='__REPORT__'),'Stale persistence wrote report');
    END $$; RESET ROLE;`));

  it("rolls back all own writes when recording the resulting revision fails", () => exercise(`
    CREATE FUNCTION pg_temp.reject_safety_custody() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'Synthetic custody failure' USING ERRCODE='23514'; END; $f$;
    CREATE TRIGGER synthetic_reject_safety_custody BEFORE INSERT ON public.report_safety_snapshot_persistence
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_safety_custody();
    SET LOCAL ROLE service_role;
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.persist_safety(); RAISE EXCEPTION 'Custody failure did not abort generation';
        EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_artifacts WHERE id='__ARTIFACT__'),'Failed custody left artifact');
      PERFORM pg_temp.assert_safety((SELECT status='draft' AND updated_at=(SELECT report_before FROM safety_input) FROM public.reports WHERE id='__REPORT__'),'Failed custody changed report');
      PERFORM pg_temp.assert_safety((SELECT updated_at=(SELECT project_before FROM safety_input) FROM public.projects WHERE id='__PROJECT__'),'Failed custody advanced project');
    END $$; RESET ROLE;`));

  it("limits both ledgers to tenant reads, denies client writes and requires a current attributed service writer", () => exercise(`
    DO $$ DECLARE u text; ledger text; n integer; rows jsonb;
      artifact jsonb:=(SELECT i.artifact FROM safety_input i); report_update jsonb:=(SELECT i.report_update FROM safety_input i);
      sections jsonb:=pg_temp.safety_sections(); c public.report_safety_snapshot_persistence;
      s public.funding_opportunity_safety_seeds; BEGIN
      SET LOCAL ROLE service_role;
      FOREACH u IN ARRAY ARRAY['__VIEWER__','__OUTSIDER__'] LOOP
        BEGIN PERFORM public.persist_safety_plan_generation(u::uuid,
          jsonb_set(artifact,'{generated_by}',to_jsonb(u)),report_update);
          RAISE EXCEPTION 'Nonwriter attributed persistence accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      END LOOP;
      PERFORM pg_temp.persist_safety();
      rows:=pg_temp.safety_rows();
      FOREACH u IN ARRAY ARRAY['__VIEWER__','__OUTSIDER__'] LOOP
        BEGIN PERFORM public.apply_ss4a_safety_seed(u::uuid,rows,repeat('b',64),sections);
          RAISE EXCEPTION 'Nonwriter attributed seed accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      END LOOP;
      PERFORM public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
      SELECT * INTO STRICT c FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__';
      SELECT * INTO STRICT s FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__';
      RESET ROLE;
      PERFORM pg_temp.assert_safety(c.workspace_id=s.workspace_id,'Ledger fixture tenants differ');
      PERFORM pg_temp.assert_safety(EXISTS(SELECT FROM public.workspace_members
        WHERE user_id='__OUTSIDER__' AND role='owner' AND workspace_id<>c.workspace_id)
        AND NOT EXISTS(SELECT FROM public.workspace_members WHERE user_id='__OUTSIDER__' AND workspace_id=c.workspace_id),
        'Outsider is not a separate tenant owner');
      FOREACH u IN ARRAY ARRAY['__ACTOR__','__VIEWER__','__OUTSIDER__',''] LOOP
        PERFORM set_config('request.jwt.claim.sub',u,true);
        IF u='' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
        IF u='' THEN
          BEGIN PERFORM 1 FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__';
            RAISE EXCEPTION 'Anonymous custody read granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN PERFORM 1 FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__';
            RAISE EXCEPTION 'Anonymous seed read granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        ELSE
          SELECT count(*) INTO n FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__';
          PERFORM pg_temp.assert_safety(n=CASE WHEN u='__OUTSIDER__' THEN 0 ELSE 1 END,'Custody tenant read wrong');
          SELECT count(*) INTO n FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__';
          PERFORM pg_temp.assert_safety(n=CASE WHEN u='__OUTSIDER__' THEN 0 ELSE 1 END,'Seed tenant read wrong');
        END IF;
        PERFORM pg_temp.assert_safety(NOT has_function_privilege(current_user,'public.persist_safety_plan_generation(uuid,jsonb,jsonb)','EXECUTE'),'Persistence function exposed');
        PERFORM pg_temp.assert_safety(NOT has_function_privilege(current_user,'public.apply_ss4a_safety_seed(uuid,jsonb,text,jsonb)','EXECUTE'),'Seed function exposed');
        BEGIN PERFORM public.persist_safety_plan_generation('__ACTOR__',artifact,report_update);
          RAISE EXCEPTION 'Client persistence execution accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN PERFORM public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
          RAISE EXCEPTION 'Client seed execution accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        FOREACH ledger IN ARRAY ARRAY['public.report_safety_snapshot_persistence','public.funding_opportunity_safety_seeds'] LOOP
          PERFORM pg_temp.assert_safety(NOT has_any_column_privilege(current_user,ledger,'INSERT'),'Client ledger INSERT granted: '||ledger);
          PERFORM pg_temp.assert_safety(NOT has_any_column_privilege(current_user,ledger,'UPDATE'),'Client ledger UPDATE granted: '||ledger);
          PERFORM pg_temp.assert_safety(NOT has_table_privilege(current_user,ledger,'DELETE'),'Client ledger DELETE granted: '||ledger);
        END LOOP;
        BEGIN INSERT INTO public.report_safety_snapshot_persistence SELECT (c).*;
          RAISE EXCEPTION 'Client custody insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN UPDATE public.report_safety_snapshot_persistence SET artifact_id=artifact_id WHERE artifact_id=c.artifact_id;
          RAISE EXCEPTION 'Client custody update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN DELETE FROM public.report_safety_snapshot_persistence WHERE artifact_id=c.artifact_id;
          RAISE EXCEPTION 'Client custody delete accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN INSERT INTO public.funding_opportunity_safety_seeds SELECT (s).*;
          RAISE EXCEPTION 'Client seed insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN UPDATE public.funding_opportunity_safety_seeds SET preview_hash=preview_hash WHERE id=s.id;
          RAISE EXCEPTION 'Client seed update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN DELETE FROM public.funding_opportunity_safety_seeds WHERE id=s.id;
          RAISE EXCEPTION 'Client seed delete accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        RESET ROLE;
      END LOOP;
    END $$;`));

  it("appends six drafts, preserves earlier history and returns the same receipt after a lost response", () => exercise(`
    SET LOCAL ROLE service_role; SELECT pg_temp.persist_safety();
    DO $$ DECLARE rows jsonb:=pg_temp.safety_rows(); sections jsonb:=pg_temp.safety_sections(); receipt jsonb; replay jsonb; BEGIN
      receipt:=public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
      replay:=public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
      PERFORM pg_temp.assert_safety(receipt=replay,'Replay receipt changed');
      PERFORM pg_temp.assert_safety((SELECT count(*)=7 FROM public.funding_opportunity_section_drafts WHERE opportunity_id='__OPPORTUNITY__'),'Six-draft append or replay count wrong');
      PERFORM pg_temp.assert_safety((SELECT draft_markdown='Retain this prior draft.' FROM public.funding_opportunity_section_drafts WHERE id='__OLD_DRAFT__'),'Prior draft rewritten');
      PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__'),'Replay duplicated seed');
    END $$; RESET ROLE;`));

  it("refuses a new seed after an unrelated source edit beyond the recorded generation revision", () => exercise(`
    SET LOCAL ROLE service_role; SELECT pg_temp.persist_safety();
    DO $$ DECLARE rows jsonb:=pg_temp.safety_rows(); sections jsonb:=pg_temp.safety_sections(); BEGIN
      UPDATE public.projects SET summary='A genuine edit after P3' WHERE id='__PROJECT__';
      BEGIN PERFORM public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
        RAISE EXCEPTION 'Post-generation source edit accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__'),'Stale apply left seed receipt');
      PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.funding_opportunity_section_drafts WHERE opportunity_id='__OPPORTUNITY__'),'Stale apply appended drafts');
    END $$; RESET ROLE;`));

  it("rolls back every new draft and receipt when a later draft insert fails", () => exercise(`
    CREATE FUNCTION pg_temp.reject_safety_draft() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.origin='safety_plan_seed' AND EXISTS(SELECT FROM public.funding_opportunity_section_drafts WHERE safety_seed_id=NEW.safety_seed_id)
        THEN RAISE EXCEPTION 'Synthetic later draft failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $f$;
    CREATE TRIGGER synthetic_reject_safety_draft BEFORE INSERT ON public.funding_opportunity_section_drafts
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_safety_draft();
    SET LOCAL ROLE service_role; SELECT pg_temp.persist_safety();
    DO $$ DECLARE rows jsonb:=pg_temp.safety_rows(); sections jsonb:=pg_temp.safety_sections(); BEGIN
      BEGIN PERFORM public.apply_ss4a_safety_seed('__ACTOR__',rows,repeat('b',64),sections);
        RAISE EXCEPTION 'Draft failure did not abort seed'; EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.funding_opportunity_section_drafts WHERE opportunity_id='__OPPORTUNITY__'),'Partial drafts committed');
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.funding_opportunity_safety_seeds WHERE opportunity_id='__OPPORTUNITY__'),'Partial receipt committed');
      PERFORM pg_temp.assert_safety((SELECT bool_and(status='not_started' AND final_markdown IS NULL) FROM public.funding_opportunity_application_sections WHERE opportunity_id='__OPPORTUNITY__'),'Failed seed changed section state');
    END $$; RESET ROLE;`));
});
