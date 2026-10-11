import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Map packages against the real schema: the runner rule (Claude Fable 5.1 or
 * GPT-6 Astra only), the claim/heartbeat/upload/complete state machine, lease
 * loss, cancellation, revocation, orphaning by user deletion, the hand-upload
 * path, and who can read the rows. Every case runs inside one transaction that
 * rolls back.
 */
const live = LIVE_RLS ? describe : describe.skip;
live("project map packages", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Map package fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const keys = ["owner", "member", "viewer", "outsider", "workspace", "other", "project", "otherProject", "connection", "secondConnection", "request", "secondRequest", "upload"];
    const ids = Object.fromEntries(keys.map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@member','@member@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic map workspace','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@member','member'),('@workspace','@viewer','viewer'),('@other','@outsider','owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic map project'),('@otherProject','@other','Synthetic other project');
      SELECT public.create_assistant_provider_connection_v2('@connection','@member','@workspace','@project','Synthetic computer',repeat('a',64),'claude_subscription','claude');
      CREATE FUNCTION pg_temp.brief(p_request text DEFAULT 'Figures for the application') RETURNS text LANGUAGE sql AS $p$
        SELECT jsonb_build_object('version',1,'kind','openplan.map_package_brief','workspaceId','@workspace',
          'project',jsonb_build_object('id','@project','name','Synthetic map project','summary',NULL,'status',NULL,'planType',NULL,'deliveryPhase',NULL),
          'client','Synthetic Agency','deliverable','grant_application','fundingOpportunity',NULL,'place',NULL,
          'studyArea',jsonb_build_object('type','FeatureCollection','features','[]'::jsonb),'placeBoundary','none_recorded',
          'request',p_request,'practice',true,'skill',jsonb_build_object('name','transportation-gis','treeHash',repeat('c',64)),
          'capturedAt','2026-10-10T00:00:00Z')::text;
      $p$;
      CREATE FUNCTION pg_temp.make(p_request uuid DEFAULT '@request',p_model text DEFAULT 'claude-fable-5-1',p_user uuid DEFAULT '@member',p_brief text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_project_map_package(p_request,p_user,'@workspace','@project','Synthetic figures','agent','grant_application',NULL,
          '@connection','claude','claude_subscription',p_model,'high',coalesce(p_brief,pg_temp.brief()),repeat('c',64),NULL);
      $p$;
      CREATE FUNCTION pg_temp.claim() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.claim_project_map_package('@connection',repeat('a',64),'claude_subscription');
      $p$;
      CREATE FUNCTION pg_temp.receipt(p_models jsonb DEFAULT '["claude-fable-5-1"]') RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_object('schemaVersion',1,'provider','claude','authMode','claude_subscription','model','claude-fable-5-1','effort','high',
          'modelsUsed',p_models,'skillTreeHash',repeat('c',64));
      $p$;
      CREATE FUNCTION pg_temp.files() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_array(
          jsonb_build_object('role','package_zip','name','synthetic_maps_20261010.zip','bytes',2048,'sha256',repeat('d',64)),
          jsonb_build_object('role','figure_preview','name','fig01_study_area.png','bytes',512,'sha256',repeat('e',64)));
      $p$;
      ${body}
      SELECT 'MAP_PACKAGE_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(owner|member|viewer|outsider|workspace|otherProject|other|project|secondConnection|connection|secondRequest|request|upload)/g,
      (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("MAP_PACKAGE_ASSERTIONS_REACHED");
  }

  it("runs one package from request to ready, and every retry returns the retained record", () => exercise(`
    DO $$ DECLARE first jsonb; again jsonb; claimed jsonb; pkg uuid; attempt uuid; beat jsonb; uploading jsonb; ready jsonb; BEGIN
      first:=pg_temp.make(); again:=pg_temp.make();
      IF NOT (first->>'created')::boolean OR (again->>'created')::boolean OR first->'package'->>'id' IS DISTINCT FROM again->'package'->>'id' THEN RAISE EXCEPTION 'Retry did not return the original package'; END IF;
      IF first->'package'->>'state' IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'New agent package is not queued'; END IF;
      BEGIN PERFORM pg_temp.make('@request','claude-fable-5-1','@member',pg_temp.brief('A different request')); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      claimed:=pg_temp.claim(); pkg:=(claimed->'package'->>'id')::uuid; attempt:=(claimed->'package'->>'attempt_id')::uuid;
      IF claimed->>'status' IS DISTINCT FROM 'connected' OR attempt IS NULL OR claimed->'package'->>'brief_canonical' IS DISTINCT FROM pg_temp.brief() THEN RAISE EXCEPTION 'Claim lost the frozen brief'; END IF;
      IF pg_temp.claim()->>'status' IS DISTINCT FROM 'busy' THEN RAISE EXCEPTION 'A second package started on a busy connection'; END IF;
      beat:=public.heartbeat_project_map_package(pkg,attempt,'@connection',repeat('a',64),'{"phase":"working","message":"Rendering","steps":3,"recent":["Rendering"]}');
      IF beat->>'state' IS DISTINCT FROM 'running' OR (SELECT progress->>'message' FROM public.project_map_packages WHERE id=pkg) IS DISTINCT FROM 'Rendering' THEN RAISE EXCEPTION 'Heartbeat did not record progress'; END IF;
      BEGIN PERFORM public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),pg_temp.receipt('["claude-fable-5-1","claude-haiku-5-5"]'),pg_temp.files()); RAISE EXCEPTION 'A second model was accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
      BEGIN PERFORM public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),jsonb_set(pg_temp.receipt(),'{skillTreeHash}',to_jsonb(repeat('f',64))),pg_temp.files()); RAISE EXCEPTION 'A different kit was accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
      uploading:=public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),pg_temp.receipt(),pg_temp.files());
      again:=public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),pg_temp.receipt(),pg_temp.files());
      IF uploading->>'state' IS DISTINCT FROM 'uploading' OR again->>'state' IS DISTINCT FROM 'uploading' OR (SELECT count(*) FROM public.project_map_package_files WHERE package_id=pkg) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Upload did not record the declared files once'; END IF;
      IF (SELECT object_path FROM public.project_map_package_files WHERE package_id=pkg AND role='package_zip') IS DISTINCT FROM '@workspace/@project/'||pkg||'/synthetic_maps_20261010.zip' THEN RAISE EXCEPTION 'Object path is not scoped to the package'; END IF;
      BEGIN PERFORM public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),pg_temp.receipt(),jsonb_build_array(pg_temp.files()->0)); RAISE EXCEPTION 'Changed file list accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM public.complete_project_map_package(pkg,attempt,'@connection',repeat('a',64),jsonb_build_array(jsonb_set(pg_temp.files()->0,'{sha256}',to_jsonb(repeat('0',64))),pg_temp.files()->1)); RAISE EXCEPTION 'A mismatched stored file completed the package'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
      ready:=public.complete_project_map_package(pkg,attempt,'@connection',repeat('a',64),pg_temp.files());
      again:=public.complete_project_map_package(pkg,attempt,'@connection',repeat('a',64),pg_temp.files());
      IF ready->>'state' IS DISTINCT FROM 'ready' OR again->>'state' IS DISTINCT FROM 'ready' OR EXISTS(SELECT 1 FROM public.project_map_package_files WHERE package_id=pkg AND verified_at IS NULL) THEN RAISE EXCEPTION 'Package did not become ready with verified files'; END IF;
    END $$;`));

  it("lets only Claude Fable 5.1 or GPT-6 Astra run the skill", () => exercise(`
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.make('@request','claude-opus-5-5'); RAISE EXCEPTION 'Opus accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN PERFORM pg_temp.make('@secondRequest','claude-haiku-5-5'); RAISE EXCEPTION 'Haiku accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN
        INSERT INTO public.project_map_packages(request_id,workspace_id,project_id,requested_by,title,source,deliverable,connection_id,provider,auth_mode,model_id,effort,brief,brief_canonical,brief_hash,skill_tree_hash,state)
          VALUES(gen_random_uuid(),'@workspace','@project','@member','Synthetic','agent','general','@connection','codex','chatgpt','gpt-6.1-sol','high',
            pg_temp.brief()::jsonb,pg_temp.brief(),encode(extensions.digest(convert_to(pg_temp.brief(),'UTF8'),'sha256'),'hex'),repeat('c',64),'queued');
        RAISE EXCEPTION 'GPT-6.1 Sol accepted';
      EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN
        INSERT INTO public.project_map_packages(request_id,workspace_id,project_id,requested_by,title,source,deliverable,connection_id,provider,auth_mode,model_id,effort,brief,brief_canonical,brief_hash,skill_tree_hash,state)
          VALUES(gen_random_uuid(),'@workspace','@project','@member','Synthetic','agent','general','@connection','claude','claude_subscription','claude-fable-5-1','medium',
            pg_temp.brief()::jsonb,pg_temp.brief(),encode(extensions.digest(convert_to(pg_temp.brief(),'UTF8'),'sha256'),'hex'),repeat('c',64),'queued');
        RAISE EXCEPTION 'Medium effort accepted';
      EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.make();
    END $$;`));

  it("refuses viewers, outsiders, other projects and wrong tokens", () => exercise(`
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.make('@request','claude-fable-5-1','@viewer'); RAISE EXCEPTION 'Viewer created a package'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM pg_temp.make('@request','claude-fable-5-1','@outsider'); RAISE EXCEPTION 'Outsider created a package'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      -- The connection belongs to the member; the owner may not borrow it.
      BEGIN PERFORM pg_temp.make('@request','claude-fable-5-1','@owner'); RAISE EXCEPTION 'Another person used the connection'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.create_project_map_package('@request','@member','@workspace','@otherProject','Synthetic','agent','general',NULL,'@connection','claude','claude_subscription','claude-fable-5-1','high',pg_temp.brief(),repeat('c',64),NULL);
        RAISE EXCEPTION 'Other project accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      PERFORM pg_temp.make();
      BEGIN PERFORM public.claim_project_map_package('@connection',repeat('b',64),'claude_subscription'); RAISE EXCEPTION 'Wrong token claimed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF public.claim_project_map_package('@connection',repeat('a',64),'chatgpt')->>'status' IS DISTINCT FROM 'auth_mode_changed'
        OR (SELECT state FROM public.project_map_packages WHERE request_id='@request') IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'Changed account mode started work'; END IF;
    END $$;`));

  it("never restarts a run whose lease passed, but lets a finished run keep uploading", () => exercise(`
    DO $$ DECLARE claimed jsonb; pkg uuid; attempt uuid; beat jsonb; BEGIN
      PERFORM pg_temp.make(); claimed:=pg_temp.claim(); pkg:=(claimed->'package'->>'id')::uuid; attempt:=(claimed->'package'->>'attempt_id')::uuid;
      UPDATE public.project_map_packages SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=pkg;
      beat:=public.heartbeat_project_map_package(pkg,attempt,'@connection',repeat('a',64),NULL);
      IF beat->>'state' IS DISTINCT FROM 'interrupted' OR (SELECT failure_code FROM public.project_map_packages WHERE id=pkg) IS DISTINCT FROM 'map_package_attempt_expired' THEN RAISE EXCEPTION 'Expired run was not interrupted'; END IF;
      IF pg_temp.claim()->'package' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Interrupted run was claimed again'; END IF;
      PERFORM pg_temp.make('@secondRequest'); claimed:=pg_temp.claim(); pkg:=(claimed->'package'->>'id')::uuid; attempt:=(claimed->'package'->>'attempt_id')::uuid;
      PERFORM public.begin_project_map_package_upload(pkg,attempt,'@connection',repeat('a',64),pg_temp.receipt(),pg_temp.files());
      UPDATE public.project_map_packages SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=pkg;
      beat:=public.heartbeat_project_map_package(pkg,attempt,'@connection',repeat('a',64),NULL);
      IF beat->>'state' IS DISTINCT FROM 'uploading' OR (beat->>'leaseExpiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'An uploading run could not resume'; END IF;
    END $$;`));

  it("stops on cancel, revocation and removal of the person who asked", () => exercise(`
    DO $$ DECLARE claimed jsonb; pkg uuid; attempt uuid; BEGIN
      PERFORM pg_temp.make(); claimed:=pg_temp.claim(); pkg:=(claimed->'package'->>'id')::uuid; attempt:=(claimed->'package'->>'attempt_id')::uuid;
      BEGIN PERFORM public.cancel_project_map_package(pkg,'@viewer'); RAISE EXCEPTION 'Viewer cancelled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF public.cancel_project_map_package(pkg,'@member')->>'state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'Requester could not cancel'; END IF;
      IF public.heartbeat_project_map_package(pkg,attempt,'@connection',repeat('a',64),NULL)->>'state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'Connector was not told to stop'; END IF;
      PERFORM pg_temp.make('@secondRequest');
      PERFORM public.revoke_assistant_provider_connection('@connection','@member');
      IF (SELECT state||':'||failure_code FROM public.project_map_packages WHERE request_id='@secondRequest') IS DISTINCT FROM 'cancelled:connection_revoked' THEN RAISE EXCEPTION 'Revocation left a package waiting'; END IF;
      -- What the foreign keys do when a person is deleted: clear the link. (A test
      -- user owns an auto-created workspace, so deleting the user itself is refused.)
      PERFORM public.create_project_map_package('@upload','@member','@workspace','@project','Hand-built figures','upload','general',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'figures.zip');
      UPDATE public.project_map_packages SET requested_by=NULL WHERE request_id='@upload';
      IF (SELECT state||':'||failure_code FROM public.project_map_packages WHERE request_id='@upload') IS DISTINCT FROM 'cancelled:requester_removed' THEN RAISE EXCEPTION 'Removing the requester left an upload open'; END IF;
      PERFORM public.create_assistant_provider_connection_v2('@secondConnection','@member','@workspace','@project','Second computer',repeat('9',64),'claude_subscription','claude');
      PERFORM public.create_project_map_package(gen_random_uuid(),'@member','@workspace','@project','Synthetic','agent','grant_application',NULL,'@secondConnection','claude','claude_subscription','claude-fable-5-1','high',pg_temp.brief(),repeat('c',64),NULL);
      DELETE FROM public.assistant_provider_connections WHERE id='@secondConnection';
      IF (SELECT state||':'||failure_code FROM public.project_map_packages WHERE connection_id IS NULL AND source='agent') IS DISTINCT FROM 'cancelled:connection_removed' THEN RAISE EXCEPTION 'Deleting a connection left its package waiting'; END IF;
      IF (SELECT count(*) FROM public.project_map_packages WHERE workspace_id='@workspace') IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'Clearing a link deleted workspace packages'; END IF;
    END $$;`));

  it("records a hand-built package from the bytes the server measured", () => exercise(`
    DO $$ DECLARE made jsonb; pkg uuid; ready jsonb; BEGIN
      made:=public.create_project_map_package('@upload','@member','@workspace','@project','Hand-built figures','upload','general',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'figures.zip');
      pkg:=(made->'package'->>'id')::uuid;
      IF made->'package'->>'state' IS DISTINCT FROM 'uploading' OR made->'package'->>'model_id' IS NOT NULL THEN RAISE EXCEPTION 'Upload row is not a plain upload'; END IF;
      BEGIN PERFORM public.complete_uploaded_map_package(pkg,'@owner',4096,repeat('d',64)); RAISE EXCEPTION 'Another person completed the upload'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      ready:=public.complete_uploaded_map_package(pkg,'@member',4096,repeat('d',64));
      IF ready->>'state' IS DISTINCT FROM 'ready' OR NOT EXISTS(SELECT 1 FROM public.project_map_package_files WHERE package_id=pkg AND role='package_zip' AND name='figures.zip' AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Upload did not become ready'; END IF;
      PERFORM public.complete_uploaded_map_package(pkg,'@member',4096,repeat('d',64));
      BEGIN PERFORM public.complete_uploaded_map_package(pkg,'@member',4097,repeat('d',64)); RAISE EXCEPTION 'Changed upload retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    END $$;`));

  it("lets every workspace member read packages and files, and no one write them directly", () => exercise(`
    DO $$ BEGIN PERFORM pg_temp.make(); PERFORM public.claim_project_map_package('@connection',repeat('a',64),'claude_subscription'); END $$;
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.project_map_packages) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Viewer cannot read the package'; END IF;
      BEGIN UPDATE public.project_map_packages SET title='Changed'; RAISE EXCEPTION 'Direct update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN INSERT INTO public.project_map_package_files(package_id,workspace_id,project_id,role,name,object_path,bytes,sha256) SELECT id,workspace_id,project_id,'run_report','x.md',workspace_id||'/'||project_id||'/'||id||'/x.md',1,repeat('a',64) FROM public.project_map_packages; RAISE EXCEPTION 'Direct file insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.project_map_packages) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Outsider read the package'; END IF; END $$;
    RESET ROLE;
    SET LOCAL ROLE anon;
    DO $$ BEGIN
      BEGIN PERFORM 1 FROM public.project_map_packages; RAISE EXCEPTION 'Anon read packages'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;`));
});
