import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { readSafetyArtifactSnapshot, readSafetyComparisonRecord } from "@/lib/reports/safety-comparison-snapshot";

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
    const ids = Object.fromEntries(["ACTOR", "VIEWER", "OUTSIDER", "PROJECT", "REPORT", "ARTIFACT", "INGEST", "OPPORTUNITY", "OLD_DRAFT", "DOCUMENT"].map(key => [key, randomUUID()]));
    const fixture = readFileSync("src/test/fixtures/grants/safety-seed-native.sql", "utf8");
    const input = `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
      ${fixture}\n${body}\nSELECT 'SS4A_NATIVE_ASSERTIONS_REACHED'; ROLLBACK;`
      .replace(/__(ACTOR|VIEWER|OUTSIDER|PROJECT|REPORT|ARTIFACT|INGEST|OPPORTUNITY|OLD_DRAFT|DOCUMENT)__/g, (_, key: string) => ids[key]);
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("SS4A_NATIVE_ASSERTIONS_REACHED");
    return result.stdout;
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
  // These v2 cases are authored only. They use the same isolated CI home and
  // transaction wrapper, without a new runner, provisioner or native campaign.
  it("derives exact spatial/year/involvement membership and retains consumed values with unknown flags", () => exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    UPDATE public.safety_crash_ingests SET source_id='ccrs-ca',years_requested=ARRAY[2020,2021],severity_completeness='kabco_full',
      dimension_coverage='{"party_role":{"support":"supplied"}}',involvement_basis='crash_flags' WHERE id='__INGEST__';
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,collision_date,collision_year,severity,pedestrian_involved,longitude,latitude) VALUES
      (pg_temp.safety_workspace(),'__INGEST__','ccrs-ca','SYNTHETIC-match','2020-01-01',2020,'fatal',true,0.5,0.5),
      (pg_temp.safety_workspace(),'__INGEST__','ccrs-ca','SYNTHETIC-other-year','2021-01-01',2021,'fatal',true,0.5,0.5),
      (pg_temp.safety_workspace(),'__INGEST__','ccrs-ca','SYNTHETIC-unknown-flag','2020-01-01',2020,'fatal',false,0.5,0.5),
      (pg_temp.safety_workspace(),'__INGEST__','ccrs-ca','SYNTHETIC-conflicting-date','2021-01-01',2020,'fatal',true,0.5,0.5),
      (pg_temp.safety_workspace(),'__INGEST__','ccrs-ca','SYNTHETIC-outside-area','2020-01-01',2020,'fatal',true,2,2);
    SET LOCAL ROLE service_role;
    DO $$ DECLARE saved jsonb; payload jsonb; manifest jsonb; BEGIN
      saved:=public.save_safety_comparison('__ACTOR__','__REPORT__',jsonb_set(pg_temp.comparison_command(),'{inputs,involvement}','"pedestrian"')::text);
      SELECT v.payload INTO STRICT payload FROM public.report_safety_comparison_revisions v WHERE id=(saved->>'revisionId')::uuid;
      SELECT members INTO STRICT manifest FROM public.report_safety_comparison_members WHERE revision_id=(saved->>'revisionId')::uuid;
      PERFORM pg_temp.assert_safety(payload->'capture'->>'included'='1' AND payload->'capture'->>'excluded'='2' AND payload->'capture'->>'indeterminate'='2','Wrong scoped membership');
      PERFORM pg_temp.assert_safety(payload->'capture'->'reasonCounts'='{"included":1,"excluded_year":1,"excluded_spatial":1,"indeterminate_year":1,"indeterminate_involvement":1}'::jsonb,'Unknown flags, year or spatial exclusion changed');
      PERFORM pg_temp.assert_safety(jsonb_array_length(manifest)=5 AND (SELECT count(DISTINCT value->'row'->>'id')=5 FROM jsonb_array_elements(manifest)),'Incomplete or duplicate retained manifest');
      PERFORM pg_temp.assert_safety((SELECT bool_and(value->'row' ?& ARRAY['workspace_id','ingest_id','source_id','external_id','collision_date','collision_year','longitude','latitude','severity','pedestrian_involved','bicyclist_involved','motorcyclist_involved','collision_type','lighting','weather']) FROM jsonb_array_elements(manifest)),'Consumed projection missing');
      PERFORM pg_temp.assert_safety(payload->'capture'->>'populationCoverage'='unassessed' AND payload->'capture'->>'unit'='crash' AND payload->>'effect'='unassessed','Population, units or effect promoted');
    END $$; RESET ROLE;`));

  it("retains zero/unknown capture and replays an old request without repointing its successor", () => exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SET LOCAL ROLE service_role;
    DO $$ DECLARE c jsonb:=pg_temp.comparison_command(); first jsonb; second jsonb; again jsonb; BEGIN
      first:=public.save_safety_comparison('__ACTOR__','__REPORT__',c::text);
      PERFORM pg_temp.assert_safety((SELECT payload->'capture'->>'included'='0' AND payload->'capture'->>'populationCoverage'='unassessed' FROM public.report_safety_comparison_revisions WHERE id=(first->>'revisionId')::uuid),'Zero lost its unknown coverage');
      PERFORM pg_temp.assert_safety((SELECT members='[]'::jsonb FROM public.report_safety_comparison_members WHERE revision_id=(first->>'revisionId')::uuid),'Member manifest missing');
      second:=public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_command()::text);
      again:=public.save_safety_comparison('__ACTOR__','__REPORT__',c::text);
      PERFORM pg_temp.assert_safety(again=first,'Receipt replay changed');
      PERFORM pg_temp.assert_safety((SELECT metadata_json->'safetyComparisonV2'->>'revisionId'=second->>'revisionId' FROM public.reports WHERE id='__REPORT__'),'Old replay repointed a successor');
      BEGIN PERFORM public.save_safety_comparison('__ACTOR__','__REPORT__',jsonb_set(c,'{inputs,title}','"Changed request"')::text); RAISE EXCEPTION 'Changed request accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$; RESET ROLE;`));

  it("refuses legacy report/render-child/source writes after v2 admission and preserves immutable history", () => exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SET LOCAL ROLE service_role; SELECT public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_command()::text);
    DO $$ BEGIN
      BEGIN UPDATE public.reports SET metadata_json='{}' WHERE id='__REPORT__'; RAISE EXCEPTION 'Legacy pointer deletion accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN INSERT INTO public.report_sections(report_id,section_key,title) VALUES('__REPORT__','synthetic','Legacy child'); RAISE EXCEPTION 'Legacy render child accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.safety_crash_ingests SET truncated=true WHERE id='__INGEST__'; RAISE EXCEPTION 'Captured source mutation accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN DELETE FROM public.report_safety_comparison_revisions WHERE report_id='__REPORT__'; RAISE EXCEPTION 'History deletion accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.report_safety_comparison_revisions WHERE report_id='__REPORT__'),'Protected revision changed');
    END $$; RESET ROLE;`));

  it("rechecks viewer/outsider actors and rolls back the full save when the receipt insert fails", () => exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    CREATE FUNCTION pg_temp.reject_comparison_receipt() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'Synthetic receipt failure' USING ERRCODE='23514'; END; $f$;
    CREATE TRIGGER synthetic_comparison_receipt BEFORE INSERT ON public.report_safety_comparison_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_comparison_receipt();
    SET LOCAL ROLE service_role;
    DO $$ DECLARE c text:=pg_temp.comparison_command()::text; BEGIN
      BEGIN PERFORM public.save_safety_comparison('__VIEWER__','__REPORT__',c); RAISE EXCEPTION 'Viewer admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_safety_comparison('__OUTSIDER__','__REPORT__',c); RAISE EXCEPTION 'Outsider admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_safety_comparison('__ACTOR__','__REPORT__',c); RAISE EXCEPTION 'Failed receipt did not abort save'; EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE report_id='__REPORT__'),'Failed receipt left a revision');
      PERFORM pg_temp.assert_safety((SELECT metadata_json->'safetyComparisonV2' IS NULL FROM public.reports WHERE id='__REPORT__'),'Failed receipt left pointer');
    END $$; RESET ROLE;`));

  // R11 SOURCE proposal. All outcomes and mutation controls remain UNEXECUTED.
  function retainedRecord(output: string, prefix: string): unknown {
    const rows = output.split("\n").filter(line => line.startsWith(prefix));
    expect(rows, `Expected one ${prefix} projection`).toHaveLength(1);
    return JSON.parse(rows[0].slice(prefix.length)) as unknown;
  }

  it.each([
    ["stored", "owner"], ["ready", "owner"], ["stored", "admin"],
    ["ready", "admin"], ["stored", "member"], ["ready", "member"],
  ] as const)("saves and generates an ordinary %s exact-project estimate as %s", (state, actorRole) => {
    const output = exercise(`
      ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
      SELECT pg_temp.comparison_estimate_source('${state}');
      SELECT pg_temp.comparison_actor_role('${actorRole}');
      SET LOCAL ROLE service_role;
      DO $$ DECLARE saved jsonb; c jsonb; artifact jsonb; receipt jsonb; before_source jsonb; BEGIN
        saved:=public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text);
        SELECT payload->'costs'->0->'sourceDocument' INTO STRICT before_source FROM public.report_safety_comparison_revisions WHERE id=(saved->>'revisionId')::uuid;
        PERFORM pg_temp.assert_safety(before_source=jsonb_build_object('id','__DOCUMENT__','title','SYNTHETIC retained estimate.xlsx',
          'checksum',repeat('e',64),'updatedAt','2026-10-18T12:00:00.123456+00:00','status','${state}'),'Source projection or microsecond revision changed');
        c:=pg_temp.comparison_generation_command(); artifact:=pg_temp.comparison_artifact(c);
        receipt:=public.persist_safety_comparison_generation('__ACTOR__','__REPORT__',c::text,artifact);
        PERFORM pg_temp.assert_safety((receipt->>'sourceProjectRevision')::timestamptz=(c->>'expectedProjectRevision')::timestamptz
          AND (receipt->>'projectRevision')::timestamptz=(SELECT updated_at FROM public.projects WHERE id='__PROJECT__')
          AND (receipt->>'projectRevision')::timestamptz>(receipt->>'sourceProjectRevision')::timestamptz,'Inherited generation project revision not recorded');
        PERFORM pg_temp.assert_safety((SELECT metadata_json->'safetyPlanSnapshotV2'->'comparison'->'payload'->'costs'->0->'sourceDocument'=before_source
          FROM public.report_artifacts WHERE id=(c->>'requestId')::uuid),'Generation changed retained source');
        PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.report_safety_comparison_generations WHERE report_id='__REPORT__'),'Generation receipt missing');
      END $$;
      SELECT 'R11_RECORD|'||pg_temp.comparison_record()::text;
      SELECT 'R11_SNAPSHOT|'||(metadata_json->'safetyPlanSnapshotV2')::text FROM public.report_artifacts WHERE report_id='__REPORT__';
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub','__VIEWER__',true); SET LOCAL ROLE authenticated;
      DO $$ BEGIN PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.kb_documents WHERE id='__DOCUMENT__'),'Ordinary source not caller-readable'); END $$;
      RESET ROLE;
    `);
    const record = readSafetyComparisonRecord(retainedRecord(output, "R11_RECORD|"));
    expect(record, "Actual immutable comparison reader rejected native output").not.toBeNull();
    if (!record) throw new Error("Native comparison unreadable");
    expect(record.payload.costs).toHaveLength(1);
    expect(record.payload.costs[0]).toMatchObject({ amount: "999999999999999.99", priceYear: null,
      sourceDocument: { status: state, checksum: "e".repeat(64), updatedAt: "2026-10-18T12:00:00.123456+00:00" } });
    const snapshot = readSafetyArtifactSnapshot({ safetyPlanSnapshotV2: retainedRecord(output, "R11_SNAPSHOT|") });
    expect(snapshot.kind, "Actual snapshot reader rejected native artifact metadata").toBe("v2");
    if (snapshot.kind !== "v2") throw new Error("Native snapshot unreadable");
    expect(snapshot.snapshot.comparison).toEqual(record);
  });

  it("keeps an absent estimate document null through native save and generation", () => {
    const output = exercise(`
      ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
      SELECT pg_temp.comparison_estimate_source();
      UPDATE public.projects SET estimated_cost_source_document_id=NULL WHERE id='__PROJECT__';
      SET LOCAL ROLE service_role;
      SELECT public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text);
      DO $$ DECLARE c jsonb:=pg_temp.comparison_generation_command(); BEGIN
        PERFORM public.persist_safety_comparison_generation('__ACTOR__','__REPORT__',c::text,pg_temp.comparison_artifact(c));
      END $$;
      SELECT 'R11_RECORD|'||pg_temp.comparison_record()::text; RESET ROLE;
    `);
    const record = readSafetyComparisonRecord(retainedRecord(output, "R11_RECORD|"));
    expect(record).not.toBeNull();
    if (!record) throw new Error("Native comparison unreadable");
    expect(record.payload.costs).toHaveLength(1);
    expect(record.payload.costs[0].sourceDocument).toBeNull();
    expect(record.payload.costs[0].amount).toBe("999999999999999.99");
  });

  it.each([
    ["stored", "unassociated"], ["ready", "wrong_project"], ["stored", "wrong_workspace"],
    ["pending", "exact"], ["failed", "exact"],
  ] as const)("refuses %s / %s estimate admission with no comparison writes", (state, association) => {
    exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SELECT pg_temp.comparison_estimate_source('${state}','${association}');
    SET LOCAL ROLE service_role;
    DO $$ DECLARE p0 timestamptz; r0 timestamptz; detail text; BEGIN
      SELECT updated_at INTO STRICT p0 FROM public.projects WHERE id='__PROJECT__';
      SELECT updated_at INTO STRICT r0 FROM public.reports WHERE id='__REPORT__';
      BEGIN PERFORM public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text);
        RAISE EXCEPTION 'Forbidden source admitted';
      EXCEPTION WHEN no_data_found THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_CONTEXT;
        PERFORM pg_temp.assert_safety(position('save_safety_comparison' IN detail)>0,'P0002 outside save source read'); END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE report_id='__REPORT__')
        AND NOT EXISTS(SELECT FROM public.report_safety_comparison_requests WHERE report_id='__REPORT__'),'Refused source left history');
      PERFORM pg_temp.assert_safety((SELECT updated_at=r0 AND metadata_json->'safetyComparisonV2' IS NULL FROM public.reports WHERE id='__REPORT__')
        AND (SELECT updated_at=p0 FROM public.projects WHERE id='__PROJECT__'),'Refused source changed owner revision');
    END $$; RESET ROLE;
  `);
  });

  it.each(["management", "contract"] as const)("excludes a %s source even when the owner can read it", family => {
    exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SELECT pg_temp.comparison_estimate_source(); SELECT pg_temp.comparison_restrict_source('${family}');
    SELECT set_config('request.jwt.claim.sub','__ACTOR__',true); SET LOCAL ROLE authenticated;
    DO $$ BEGIN PERFORM pg_temp.assert_safety((SELECT count(*)=1 FROM public.kb_documents WHERE id='__DOCUMENT__'),'Owner cannot read owned private source'); END $$;
    RESET ROLE; SELECT set_config('request.jwt.claim.sub','__VIEWER__',true); SET LOCAL ROLE authenticated;
    DO $$ BEGIN PERFORM pg_temp.assert_safety((SELECT count(*)=0 FROM public.kb_documents WHERE id='__DOCUMENT__'),'Viewer reads private source'); END $$;
    RESET ROLE; SET LOCAL ROLE service_role;
    DO $$ DECLARE detail text; BEGIN
      BEGIN PERFORM public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text);
        RAISE EXCEPTION 'Owner private source admitted';
      EXCEPTION WHEN no_data_found THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_CONTEXT;
        PERFORM pg_temp.assert_safety(position('save_safety_comparison' IN detail)>0,'Private refusal outside save'); END;
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE report_id='__REPORT__')
        AND NOT EXISTS(SELECT FROM public.report_safety_comparison_requests WHERE report_id='__REPORT__'),'Private metadata entered shared history');
    END $$; RESET ROLE;
  `);
  });

  // These are compound freshness checks. The real KB parent touch reaches P0
  // before the later retained-document predicates. No claim isolates those lines.
  it.each(["status", "revision", "checksum", "management", "contract"] as const)("refuses generation after retained source %s changes", change => {
    exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SELECT pg_temp.comparison_estimate_source(); SET LOCAL ROLE service_role;
    SELECT public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text); RESET ROLE;
    DO $$ DECLARE c jsonb:=pg_temp.comparison_generation_command(); artifact jsonb:=pg_temp.comparison_artifact(c);
      before_record jsonb:=pg_temp.comparison_record(); p1 timestamptz; r1 timestamptz; message text; BEGIN
      ${change === "status" ? "UPDATE public.kb_documents SET status='ready' WHERE id='__DOCUMENT__';" :
        change === "revision" ? "UPDATE public.kb_documents SET updated_at=updated_at WHERE id='__DOCUMENT__';" :
        change === "checksum" ? "UPDATE public.kb_documents SET checksum=repeat('f',64) WHERE id='__DOCUMENT__';" :
        `PERFORM pg_temp.comparison_restrict_source('${change}');`}
      SELECT updated_at INTO STRICT p1 FROM public.projects WHERE id='__PROJECT__';
      SELECT updated_at INTO STRICT r1 FROM public.reports WHERE id='__REPORT__';
      PERFORM pg_temp.assert_safety(p1>(c->>'expectedProjectRevision')::timestamptz,'Real source edit did not touch project');
      PERFORM pg_temp.assert_safety((SELECT updated_at<>'2026-10-18T12:00:00.123456Z'::timestamptz FROM public.kb_documents WHERE id='__DOCUMENT__'),'Source revision did not change');
      SET LOCAL ROLE service_role;
      BEGIN PERFORM public.persist_safety_comparison_generation('__ACTOR__','__REPORT__',c::text,artifact);
        RAISE EXCEPTION 'Changed retained source generated';
      EXCEPTION WHEN serialization_failure THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
        PERFORM pg_temp.assert_safety(message='Comparison generation source changed','Refused at unexpected boundary: '||message); END;
      PERFORM pg_temp.assert_safety(pg_temp.comparison_record()=before_record,'Refusal altered immutable source');
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM public.report_artifacts WHERE report_id='__REPORT__')
        AND NOT EXISTS(SELECT FROM public.report_safety_comparison_generations WHERE report_id='__REPORT__'),'Refusal left generation writes');
      PERFORM pg_temp.assert_safety((SELECT updated_at=p1 FROM public.projects WHERE id='__PROJECT__')
        AND (SELECT updated_at=r1 AND status='draft' FROM public.reports WHERE id='__REPORT__'),'Refusal changed owner revisions');
      RESET ROLE;
    END $$;
  `);
  });

  it("checks v2 caller privileges, current attributed generation roles and all immutable history tables", () => exercise(`
    ${readFileSync("src/test/fixtures/grants/safety-comparison-native.sql", "utf8")}
    SELECT pg_temp.comparison_estimate_source(); SET LOCAL ROLE service_role;
    SELECT public.save_safety_comparison('__ACTOR__','__REPORT__',pg_temp.comparison_cost_command()::text);
    DO $$ DECLARE c jsonb:=pg_temp.comparison_generation_command(); artifact jsonb:=pg_temp.comparison_artifact(c); actor text; message text; BEGIN
      FOREACH actor IN ARRAY ARRAY['__VIEWER__','__OUTSIDER__'] LOOP
        BEGIN PERFORM public.persist_safety_comparison_generation(actor::uuid,'__REPORT__',c::text,artifact); RAISE EXCEPTION 'Nonwriter generation accepted';
        EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
          PERFORM pg_temp.assert_safety(message='Current reports writer required','Generation refused before actor check'); END;
      END LOOP;
      PERFORM public.persist_safety_comparison_generation('__ACTOR__','__REPORT__',c::text,artifact);
    END $$; RESET ROLE;
    DO $$ DECLARE role_name text; actor text; ledger text; fn oid; n integer; before_rows jsonb; after_rows jsonb; message text;
      workspace uuid:=pg_temp.safety_workspace(); BEGIN
      PERFORM pg_temp.assert_safety(workspace IS NOT NULL,'Missing owned workspace before caller switch');
      PERFORM pg_temp.assert_safety((SELECT array_agg(p.proname::text ORDER BY p.proname::text) =
        ARRAY['artifact_versions','immutable','report_fence','report_revision','source_fence']::text[]
        FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='safety_comparison_private'),'Private helper inventory differs');
      PERFORM pg_temp.assert_safety(NOT EXISTS(SELECT FROM safety_comparison_private.entries WHERE report_id='__REPORT__'),'Private transaction entry leaked');
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        PERFORM pg_temp.assert_safety(NOT has_schema_privilege(role_name,'safety_comparison_private','USAGE'),'Private helper schema exposed to '||role_name);
        FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='safety_comparison_private' LOOP
          PERFORM pg_temp.assert_safety(NOT has_function_privilege(role_name,fn,'EXECUTE'),'Private helper executable by '||role_name);
        END LOOP;
        PERFORM pg_temp.assert_safety(has_function_privilege(role_name,'public.save_safety_comparison(uuid,uuid,text)','EXECUTE')=(role_name='service_role'),'Save entry privilege wrong');
        PERFORM pg_temp.assert_safety(has_function_privilege(role_name,'public.persist_safety_comparison_generation(uuid,uuid,text,jsonb)','EXECUTE')=(role_name='service_role'),'Generation entry privilege wrong');
        FOREACH ledger IN ARRAY ARRAY['report_safety_comparison_revisions','report_safety_comparison_members','report_safety_comparison_requests','report_safety_comparison_generations'] LOOP
          PERFORM pg_temp.assert_safety(NOT has_any_column_privilege(role_name,'public.'||ledger,'INSERT')
            AND NOT has_any_column_privilege(role_name,'public.'||ledger,'UPDATE')
            AND NOT has_table_privilege(role_name,'public.'||ledger,'DELETE')
            AND NOT has_table_privilege(role_name,'public.'||ledger,'TRUNCATE'),'Broad history writer: '||role_name||' / '||ledger);
        END LOOP;
      END LOOP;
      FOREACH actor IN ARRAY ARRAY['__ACTOR__','__VIEWER__','__OUTSIDER__',''] LOOP
        PERFORM set_config('request.jwt.claim.sub',actor,true);
        IF actor='' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
        BEGIN PERFORM public.save_safety_comparison('__ACTOR__','__REPORT__','{}'); RAISE EXCEPTION 'Client save accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN PERFORM public.persist_safety_comparison_generation('__ACTOR__','__REPORT__','{}','{}'); RAISE EXCEPTION 'Client generation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN PERFORM 1 FROM safety_comparison_private.entries; RAISE EXCEPTION 'Client private entry read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        FOREACH ledger IN ARRAY ARRAY['report_safety_comparison_revisions','report_safety_comparison_members','report_safety_comparison_requests','report_safety_comparison_generations'] LOOP
          IF actor='' THEN
            BEGIN EXECUTE format('SELECT 1 FROM public.%I',ledger); RAISE EXCEPTION 'Anonymous history read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          ELSE
            EXECUTE format('SELECT count(*) FROM public.%I WHERE workspace_id=$1',ledger) INTO n USING workspace;
            PERFORM pg_temp.assert_safety(n=CASE WHEN actor='__OUTSIDER__' OR (actor='__VIEWER__' AND ledger='report_safety_comparison_requests') THEN 0 ELSE 1 END,'Wrong v2 caller read: '||ledger);
          END IF;
        END LOOP;
        RESET ROLE;
      END LOOP;
      FOREACH ledger IN ARRAY ARRAY['report_safety_comparison_revisions','report_safety_comparison_members','report_safety_comparison_requests','report_safety_comparison_generations'] LOOP
        EXECUTE format('SELECT jsonb_agg(to_jsonb(t)) FROM public.%I t WHERE workspace_id=$1',ledger) INTO before_rows USING pg_temp.safety_workspace();
        PERFORM pg_temp.assert_safety(jsonb_array_length(before_rows)=1,'Missing owned immutable fixture: '||ledger);
        BEGIN EXECUTE format('UPDATE public.%I SET workspace_id=workspace_id WHERE workspace_id=$1',ledger) USING pg_temp.safety_workspace(); RAISE EXCEPTION 'History update accepted';
        EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
          PERFORM pg_temp.assert_safety(message='Safety comparison history and receipts are immutable','Wrong history update guard'); END;
        BEGIN EXECUTE format('DELETE FROM public.%I WHERE workspace_id=$1',ledger) USING pg_temp.safety_workspace(); RAISE EXCEPTION 'History delete accepted';
        EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
          PERFORM pg_temp.assert_safety(message='Safety comparison history and receipts are immutable','Wrong history delete guard'); END;
        EXECUTE format('SELECT jsonb_agg(to_jsonb(t)) FROM public.%I t WHERE workspace_id=$1',ledger) INTO after_rows USING pg_temp.safety_workspace();
        PERFORM pg_temp.assert_safety(after_rows=before_rows,'Immutable history changed: '||ledger);
      END LOOP;
    END $$;
  `));
});
