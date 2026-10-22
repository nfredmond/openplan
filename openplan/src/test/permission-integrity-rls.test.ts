import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Migration 20261017000006 against the real schema. Every case runs in one
 * transaction that rolls back.
 *
 * - Contract role oracle: a signed-in person may not ask the two contract
 *   visibility functions about another person's id, while the policies that
 *   now use the caller-only wrappers still show owners their records and hide
 *   them from members and outsiders.
 * - Map packages: a grant application from another project in the same
 *   workspace is refused, and a retry that changes the client name or the
 *   practice marking is refused instead of returning the original.
 * - Census tract loads: viewers and outsiders are refused, each person has 20
 *   counties per rolling hour, a refusal records nothing, and a signed-in
 *   client cannot call the reservation directly.
 *
 * Each case fails on the SQL before this migration.
 */
const live = LIVE_RLS ? describe : describe.skip;

function psql(container: string, sql: string): string {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}

live("permission integrity (20261017000006)", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Permission integrity fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  const contractSetup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
  function contract(body: string) {
    const output = psql(container, `BEGIN;\n${contractSetup.replace("-- TEST_BODY", `${body}\nRAISE NOTICE 'PERMISSION_INTEGRITY_REACHED';`)}\nSELECT 'PERMISSION_INTEGRITY_DONE';\nROLLBACK;`);
    expect(output).toContain("PERMISSION_INTEGRITY_DONE");
  }

  it("refuses another person's id in the contract visibility functions and keeps the policies working", () => contract(`
 report:=gen_random_uuid();
 INSERT INTO public.contract_snapshots(id,engagement_id,workspace_id,title,snapshot,snapshot_hash,created_by)
  VALUES(report,engagement,workspace,'Synthetic finance snapshot','{}'::jsonb,repeat('a',64),owner_id);
 PERFORM public.enqueue_contract_snapshot(report,'pdf',owner_id);
 INSERT INTO public.contract_calculation_jobs(engagement_id,workspace_id,actor_id,request_id,command,kind)
  VALUES(engagement,workspace,owner_id,gen_random_uuid(),'{}'::jsonb,'closeout');
 -- A workspace member and an outsider each try to learn the owner's access.
 FOREACH tab IN ARRAY ARRAY[member_id::text,outsider::text] LOOP
  PERFORM set_config('request.jwt.claim.sub',tab,true);EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.contract_snapshot_can_read(report,owner_id);RAISE EXCEPTION 'Another person''s snapshot access answered';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN PERFORM public.contract_calculation_job_visible(engagement,owner_id,'closeout');RAISE EXCEPTION 'Another person''s calculation access answered';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  IF public.contract_snapshot_caller_can_read(report) OR public.contract_calculation_job_caller_visible(engagement,'closeout') THEN RAISE EXCEPTION 'Caller wrapper granted access it should not';END IF;
  SELECT count(*) INTO n FROM public.contract_snapshots WHERE id=report;IF n<>0 THEN RAISE EXCEPTION 'Private snapshot visible';END IF;
  SELECT count(*) INTO n FROM public.kb_documents WHERE contract_snapshot_id=report;IF n<>0 THEN RAISE EXCEPTION 'Private snapshot document visible';END IF;
  SELECT count(id) INTO n FROM public.contract_calculation_jobs;IF n<>0 THEN RAISE EXCEPTION 'Private calculation visible';END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 -- The owner still reads through the rewired policies.
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT public.contract_snapshot_caller_can_read(report) OR NOT public.contract_calculation_job_caller_visible(engagement,'closeout') THEN RAISE EXCEPTION 'Owner lost access through the wrapper';END IF;
 SELECT count(*) INTO n FROM public.contract_snapshots WHERE id=report;IF n<>1 THEN RAISE EXCEPTION 'Owner cannot read the snapshot';END IF;
 SELECT count(*) INTO n FROM public.kb_documents WHERE contract_snapshot_id=report;IF n<>1 THEN RAISE EXCEPTION 'Owner cannot read the snapshot document';END IF;
 SELECT count(id) INTO n FROM public.contract_calculation_jobs WHERE engagement_id=engagement;IF n<>1 THEN RAISE EXCEPTION 'Owner cannot read the calculation';END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.contract_snapshot_caller_can_read(report);RAISE EXCEPTION 'Anonymous wrapper call allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 `));

  function workspace(body: string) {
    const keys = ["owner", "member", "viewer", "outsider", "workspace", "other", "project", "sibling", "otherProject", "connection", "request", "upload", "ownOpportunity", "siblingOpportunity"];
    const ids = Object.fromEntries(keys.map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@member','@member@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic integrity workspace','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@member','member'),('@workspace','@viewer','viewer'),('@other','@outsider','owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic map project'),('@sibling','@workspace','Synthetic sibling project'),('@otherProject','@other','Synthetic other project');
      INSERT INTO public.funding_opportunities(id,workspace_id,project_id,title) VALUES('@ownOpportunity','@workspace','@project','Synthetic own application'),('@siblingOpportunity','@workspace','@sibling','Synthetic sibling application');
      SELECT public.create_assistant_provider_connection_v2('@connection','@member','@workspace','@project','Synthetic computer',repeat('a',64),'claude_subscription','claude');
      CREATE FUNCTION pg_temp.brief(p_client text DEFAULT 'Synthetic Agency',p_practice boolean DEFAULT true) RETURNS text LANGUAGE sql AS $p$
        SELECT jsonb_build_object('version',1,'kind','openplan.map_package_brief','workspaceId','@workspace',
          'project',jsonb_build_object('id','@project','name','Synthetic map project','summary',NULL,'status',NULL,'planType',NULL,'deliveryPhase',NULL),
          'client',p_client,'deliverable','grant_application','fundingOpportunity',NULL,'place',NULL,
          'studyArea',jsonb_build_object('type','FeatureCollection','features','[]'::jsonb),'placeBoundary','none_recorded',
          'request','Figures for the application','practice',p_practice,'skill',jsonb_build_object('name','transportation-gis','treeHash',repeat('c',64)),
          'capturedAt','2026-10-10T00:00:00Z')::text;
      $p$;
      CREATE FUNCTION pg_temp.make(p_brief text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_project_map_package('@request','@member','@workspace','@project','Synthetic figures','agent','grant_application',NULL,
          '@connection','claude','claude_subscription','claude-fable-5-1','high',coalesce(p_brief,pg_temp.brief()),repeat('c',64),NULL);
      $p$;
      CREATE FUNCTION pg_temp.upload(p_request uuid,p_opportunity uuid) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_project_map_package(p_request,'@member','@workspace','@project','Hand-built figures','upload','grant_application',p_opportunity,
          NULL,NULL,NULL,NULL,NULL,NULL,NULL,'figures.zip');
      $p$;
      ${body}
      SELECT 'PERMISSION_INTEGRITY_DONE'; ROLLBACK;`.replace(
      /@(owner|member|viewer|outsider|workspace|otherProject|other|project|siblingOpportunity|sibling|connection|request|upload|ownOpportunity)/g,
      (_, key: string) => ids[key],
    );
    expect(psql(container, sql)).toContain("PERMISSION_INTEGRITY_DONE");
  }

  it("links a map package only to a grant application of its own project", () => workspace(`
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.upload(gen_random_uuid(),'@siblingOpportunity'); RAISE EXCEPTION 'Another project''s application accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF NOT (pg_temp.upload('@upload','@ownOpportunity')->>'created')::boolean THEN RAISE EXCEPTION 'Own project''s application refused'; END IF;
      IF (pg_temp.upload('@upload','@ownOpportunity')->>'created')::boolean THEN RAISE EXCEPTION 'Unchanged retry made a second package'; END IF;
      IF (SELECT count(*) FROM public.project_map_packages WHERE workspace_id='@workspace') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Refused link left a package'; END IF;
    END $$;`));

  it("refuses a retry that changes the client name or the practice marking", () => workspace(`
    DO $$ DECLARE first jsonb; BEGIN
      first:=pg_temp.make();
      IF NOT (first->>'created')::boolean THEN RAISE EXCEPTION 'First request was not created'; END IF;
      IF (pg_temp.make()->>'created')::boolean THEN RAISE EXCEPTION 'Unchanged retry made a second package'; END IF;
      BEGIN PERFORM pg_temp.make(pg_temp.brief('Another Agency',true)); RAISE EXCEPTION 'Changed client accepted as a retry'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.make(pg_temp.brief('Synthetic Agency',false)); RAISE EXCEPTION 'Changed practice marking accepted as a retry'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    END $$;`));

  it("meters census tract loads per person and refuses viewers, outsiders and signed-in clients", () => workspace(`
    CREATE FUNCTION pg_temp.reserve(p_user uuid,p_workspace uuid,p_count integer) RETURNS jsonb LANGUAGE sql AS $p$
      SELECT public.reserve_census_tract_ingest(p_user,p_workspace,
        ARRAY(SELECT '39'||lpad(i::text,3,'0') FROM generate_series(1,p_count) i),'/api/geographies/census-tracts/ingest');
    $p$;
    DO $$ DECLARE reply jsonb; BEGIN
      BEGIN PERFORM pg_temp.reserve('@viewer','@workspace',1); RAISE EXCEPTION 'Viewer reserved a load'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM pg_temp.reserve('@outsider','@workspace',1); RAISE EXCEPTION 'Outsider reserved a load'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.reserve_census_tract_ingest('@member','@workspace',ARRAY['3904'],'/x'); RAISE EXCEPTION 'Malformed county accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      reply:=pg_temp.reserve('@member','@workspace',8);
      IF NOT (reply->>'allowed')::boolean OR (reply->>'recent')::int<>8 OR (reply->>'limit')::int<>20 THEN RAISE EXCEPTION 'First load refused: %',reply; END IF;
      PERFORM pg_temp.reserve('@member','@workspace',8);
      reply:=pg_temp.reserve('@member','@workspace',8);
      IF (reply->>'allowed')::boolean OR (reply->>'recent')::int<>16 OR (reply->>'retryAfterSeconds')::int NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'Load over the allowance accepted: %',reply; END IF;
      IF (SELECT count(*) FROM public.usage_events WHERE event_key='census_tract_ingest:@member') IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'A refusal recorded usage'; END IF;
      IF NOT (pg_temp.reserve('@member','@workspace',4)->>'allowed')::boolean THEN RAISE EXCEPTION 'Last four counties refused'; END IF;
      IF (pg_temp.reserve('@member','@workspace',1)->>'allowed')::boolean THEN RAISE EXCEPTION 'Twenty-first county accepted'; END IF;
      -- Another person in the same workspace has their own allowance.
      IF NOT (pg_temp.reserve('@owner','@workspace',8)->>'allowed')::boolean THEN RAISE EXCEPTION 'Another person was charged for the member'; END IF;
      -- Loads older than an hour no longer count.
      UPDATE public.usage_events SET occurred_at=clock_timestamp()-interval '61 minutes' WHERE event_key='census_tract_ingest:@member';
      IF NOT (pg_temp.reserve('@member','@workspace',8)->>'allowed')::boolean THEN RAISE EXCEPTION 'Expired loads still counted'; END IF;
    END $$;
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@member',true);
    DO $$ BEGIN
      BEGIN PERFORM public.reserve_census_tract_ingest('@member','@workspace',ARRAY['39049'],'/api/geographies/census-tracts/ingest'); RAISE EXCEPTION 'A signed-in client reserved directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;`));
});
