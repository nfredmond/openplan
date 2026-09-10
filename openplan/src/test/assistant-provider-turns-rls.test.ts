import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live.each(["codex", "claude", "opencode"] as const)("scoped %s connections and retained turns", provider => {
  const authMode = provider === "opencode" ? "opencode_api" : provider === "claude" ? "claude_subscription" : "chatgpt";
  const model = provider === "opencode" ? "gpt-6-astra" : provider === "claude" ? "claude-sonnet-4-6" : "fixture-model";
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Provider fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });
  function exercise(body: string) {
    const ids = Object.fromEntries(["owner", "custodian", "viewer", "outsider", "workspace", "other", "project", "otherProject", "connection", "request", "secondRequest"].map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@custodian','@custodian@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic provider workspace','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@custodian','owner'),('@workspace','@viewer','viewer'),('@other','@outsider','owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic provider project'),('@otherProject','@other','Synthetic other project');
      CREATE FUNCTION pg_temp.packet() RETURNS text LANGUAGE sql AS $p$
        SELECT jsonb_build_object('version',1,'workspaceId','@workspace','capturedAt','2026-09-10T00:00:00Z',
          'project',jsonb_build_object('id','@project','name','Synthetic provider project','summary',NULL,'status','active','planType','corridor','deliveryPhase','planning','updatedAt','2026-09-10T00:00:00Z'),
          'source',jsonb_build_object('id','project:@project','href','/projects/@project','label','Synthetic provider project'))::text;
      $p$;
      SELECT public.create_assistant_provider_connection${provider !== 'codex' ? '_v2' : ''}('@connection','@owner','@workspace','@project','Synthetic device',repeat('a',64),'${authMode}'${provider !== 'codex' ? `,'${provider}'` : ''});
      CREATE FUNCTION pg_temp.make_turn(p_request uuid DEFAULT '@request',p_question text DEFAULT 'What is known?') RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_assistant_provider_turn(p_request,'@owner','@workspace','@project','@connection','${provider}','${model}','${authMode}',p_question,pg_temp.packet());
      $p$;
      CREATE FUNCTION pg_temp.claim() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.claim_assistant_provider_turn('@connection',repeat('a',64),'${authMode}','connected');
      $p$;
      CREATE FUNCTION pg_temp.answer() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_object('answer','Synthetic project; cost not supplied.','citations',jsonb_build_array(pg_temp.packet()::jsonb->'source'),'proposal',NULL);
      $p$;
      CREATE FUNCTION pg_temp.receipt() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_object('schemaVersion',1,'provider','${provider}','model','${model}','authMode','${authMode}','threadId','synthetic-thread','turnId','synthetic-turn');
      $p$;
      ${body}
      SELECT 'PROVIDER_ASSERTIONS_REACHED'; ROLLBACK;`.replace(/@(owner|custodian|viewer|outsider|workspace|otherProject|other|project|connection|secondRequest|request)/g, (_, key) => ids[key]);
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("PROVIDER_ASSERTIONS_REACHED");
  }

  it("retains the original packet and result; duplicate delivery does not launch or rewrite work", () => exercise(`
    DO $$ DECLARE first jsonb; again jsonb; claimed jsonb; finished jsonb; job_id uuid; attempt uuid; BEGIN
      first:=pg_temp.make_turn(); again:=pg_temp.make_turn();
      IF NOT (first->>'created')::boolean OR (again->>'created')::boolean OR first->'turn' IS DISTINCT FROM again->'turn' THEN RAISE EXCEPTION 'Request retry did not retain original job'; END IF;
      again:=public.create_assistant_provider_turn('@request','@owner','@workspace','@project','@connection','${provider}','${model}','${authMode}','What is known?',replace(pg_temp.packet(),'Synthetic provider project','Synthetic later name'));
      IF first->'turn'->'packet' IS DISTINCT FROM again->'turn'->'packet' THEN RAISE EXCEPTION 'Retry replaced the original packet'; END IF;
      BEGIN PERFORM pg_temp.make_turn('@request','Changed question'); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      claimed:=pg_temp.claim(); job_id:=(claimed->'turn'->>'id')::uuid; attempt:=(claimed->'turn'->>'attempt_id')::uuid;
      IF job_id IS NULL OR attempt IS NULL OR claimed->'turn'->>'packet_canonical' IS DISTINCT FROM pg_temp.packet() THEN RAISE EXCEPTION 'Claim lost exact original packet'; END IF;
      IF pg_temp.claim()->'turn'<>'null'::jsonb THEN RAISE EXCEPTION 'Running request claimed twice'; END IF;
      finished:=public.finish_assistant_provider_turn(job_id,attempt,NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL);
      again:=public.finish_assistant_provider_turn(job_id,attempt,NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL);
      IF finished->>'state'<>'succeeded' OR finished IS DISTINCT FROM again OR finished->'result' IS DISTINCT FROM pg_temp.answer() THEN RAISE EXCEPTION 'Completion retry changed saved answer'; END IF;
      BEGIN PERFORM public.finish_assistant_provider_turn(job_id,attempt,NULL,'@connection',repeat('a',64),jsonb_set(pg_temp.answer(),'{answer}','"Changed answer"'),pg_temp.receipt(),NULL); RAISE EXCEPTION 'Changed final answer accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      IF (SELECT count(*) FROM public.assistant_provider_turns WHERE connection_id='@connection')<>1 OR EXISTS(SELECT 1 FROM public.project_submittals WHERE project_id='@project') THEN RAISE EXCEPTION 'Provider request duplicated or executed business work'; END IF;
    END $$;`));

  it("isolates tokens, projects and native account modes before claim", () => exercise(`
    DO $$ DECLARE answer jsonb; BEGIN
      PERFORM pg_temp.make_turn();
      BEGIN PERFORM public.claim_assistant_provider_turn('@connection',repeat('b',64),'${authMode}','connected'); RAISE EXCEPTION 'Wrong token accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.create_assistant_provider_turn('@secondRequest','@owner','@workspace','@otherProject','@connection','${provider}','${model}','${authMode}','Question',pg_temp.packet()); RAISE EXCEPTION 'Wrong project accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      answer:=public.claim_assistant_provider_turn('@connection',repeat('a',64),'apiKey','connected');
      IF answer->>'status'<>'auth_mode_changed' OR answer->'turn'<>'null'::jsonb OR (SELECT state FROM public.assistant_provider_turns WHERE request_id='@request')<>'queued' THEN RAISE EXCEPTION 'Changed auth mode started work'; END IF;
      answer:=public.claim_assistant_provider_turn('@connection',repeat('a',64),NULL,'needs_login');
      IF answer->>'status'<>'needs_login' OR answer->'turn'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing login started work'; END IF;
    END $$;`));

  it("revocation cancels waiting and running requests and denies late delivery", () => exercise(`
    DO $$ DECLARE claimed jsonb; BEGIN
      PERFORM pg_temp.make_turn(); claimed:=pg_temp.claim(); PERFORM pg_temp.make_turn('@secondRequest');
      PERFORM public.revoke_assistant_provider_connection('@connection','@owner');
      IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE connection_id='@connection' AND state<>'cancelled') THEN RAISE EXCEPTION 'Revocation left active work'; END IF;
      BEGIN PERFORM pg_temp.claim(); RAISE EXCEPTION 'Revoked connection read work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.finish_assistant_provider_turn((claimed->'turn'->>'id')::uuid,(claimed->'turn'->>'attempt_id')::uuid,NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL); RAISE EXCEPTION 'Revoked connection completed work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));

  it.each(["membership", "project", "expiry"])("denies a previously valid connection after %s changes", (change) => exercise(`
    SELECT pg_temp.make_turn();
    ${change === "membership" ? "DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';" : change === "project" ? "UPDATE public.projects SET workspace_id='@other' WHERE id='@project';" : "UPDATE public.assistant_provider_connections SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id='@connection';"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.claim(); RAISE EXCEPTION 'Stale project connection disclosed work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      PERFORM public.revoke_assistant_provider_connection('@connection','@owner');
    END $$;`));

  it("expired attempts become interrupted without automatic re-execution", () => exercise(`
    DO $$ DECLARE claimed jsonb; saved jsonb; BEGIN
      PERFORM pg_temp.make_turn(); claimed:=pg_temp.claim();
      UPDATE public.assistant_provider_turns SET lease_expires_at=now()-interval '1 second' WHERE connection_id='@connection';
      saved:=public.finish_assistant_provider_turn((claimed->'turn'->>'id')::uuid,(claimed->'turn'->>'attempt_id')::uuid,NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL);
      IF saved->>'state'<>'interrupted' OR saved->'result'<>'null'::jsonb THEN RAISE EXCEPTION 'Expired attempt published an answer'; END IF;
      IF pg_temp.claim()->'turn'<>'null'::jsonb OR (SELECT count(*) FROM public.assistant_provider_turns WHERE connection_id='@connection')<>1 THEN RAISE EXCEPTION 'Expired attempt restarted automatically'; END IF;
    END $$;`));

  it("browser recovery persists expiry without exposing another user's saved request", () => exercise(`
    DO $$ DECLARE claimed jsonb; saved jsonb; job_id uuid; BEGIN
      PERFORM pg_temp.make_turn(); claimed:=pg_temp.claim(); job_id:=(claimed->'turn'->>'id')::uuid;
      BEGIN PERFORM public.read_assistant_provider_turn_for_user(job_id,'@viewer'); RAISE EXCEPTION 'Another user recovered private request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      saved:=public.read_assistant_provider_turn_for_user(job_id,'@owner');
      IF saved->>'state'<>'running' OR saved->>'packet_canonical' IS DISTINCT FROM pg_temp.packet() THEN RAISE EXCEPTION 'Recovery lost original running request'; END IF;
      UPDATE public.assistant_provider_turns SET lease_expires_at=now()-interval '1 second' WHERE id=job_id;
      saved:=public.read_assistant_provider_turn_for_user(job_id,'@owner');
      IF saved->>'state'<>'interrupted' OR (SELECT state FROM public.assistant_provider_turns WHERE id=job_id)<>'interrupted' THEN RAISE EXCEPTION 'Browser recovery failed to persist expiry'; END IF;
      UPDATE public.projects SET workspace_id='@other' WHERE id='@project';
      BEGIN PERFORM public.read_assistant_provider_turn_for_user(job_id,'@owner'); RAISE EXCEPTION 'Moved project recovered private request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));

  it("refuses forged attempt, source and provider receipt identities", () => exercise(`
    DO $$ DECLARE claimed jsonb; job_id uuid; attempt uuid; BEGIN
      PERFORM pg_temp.make_turn(); claimed:=pg_temp.claim(); job_id:=(claimed->'turn'->>'id')::uuid; attempt:=(claimed->'turn'->>'attempt_id')::uuid;
      BEGIN PERFORM public.finish_assistant_provider_turn(job_id,'@request',NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL); RAISE EXCEPTION 'Forged attempt accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.finish_assistant_provider_turn(job_id,attempt,NULL,'@connection',repeat('a',64),jsonb_set(pg_temp.answer(),'{citations,0,id}','"wrong-source"'),pg_temp.receipt(),NULL); RAISE EXCEPTION 'Forged source accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM public.finish_assistant_provider_turn(job_id,attempt,NULL,'@connection',repeat('a',64),pg_temp.answer(),jsonb_set(pg_temp.receipt(),'{model}','"wrong-model"'),NULL); RAISE EXCEPTION 'Forged provider receipt accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      IF (SELECT state FROM public.assistant_provider_turns WHERE id=job_id)<>'running' THEN RAISE EXCEPTION 'Refused result changed job'; END IF;
    END $$;`));

  it("authenticated clients can read only their permitted turns and cannot issue or consume native credentials directly", () => exercise(`
    SELECT pg_temp.make_turn();
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.assistant_provider_connections) OR EXISTS(SELECT 1 FROM public.assistant_provider_turns) THEN RAISE EXCEPTION 'Other user saw provider records'; END IF;
      BEGIN PERFORM public.claim_assistant_provider_turn('@connection',repeat('a',64),'${authMode}','connected'); RAISE EXCEPTION 'Authenticated client invoked service claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN INSERT INTO public.assistant_provider_connections(user_id,workspace_id,project_id,device_label,token_hash,expected_auth_mode) VALUES('@outsider','@workspace','@project','Bad device',repeat('c',64),'${authMode}'); RAISE EXCEPTION 'Authenticated client minted a connection'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.assistant_provider_connections) OR EXISTS(SELECT 1 FROM public.assistant_provider_turns) THEN RAISE EXCEPTION 'Another member read personal provider records'; END IF; END $$;
    SELECT set_config('request.jwt.claim.sub','@owner',true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.assistant_provider_turns WHERE project_id='@project')<>1 THEN RAISE EXCEPTION 'Owner could not read permitted turn'; END IF; END $$;
    RESET ROLE;
    DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';
    SET LOCAL ROLE authenticated;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE project_id='@project') THEN RAISE EXCEPTION 'Former member read project packet'; END IF;
      IF (SELECT count(*) FROM public.assistant_provider_connections WHERE id='@connection')<>1 THEN RAISE EXCEPTION 'Former member lost own revocation metadata'; END IF;
    END $$;
    RESET ROLE;`));

  it("project movement also removes direct user access to the retained packet", () => exercise(`
    SELECT pg_temp.make_turn();
    UPDATE public.projects SET workspace_id='@other' WHERE id='@project';
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@owner',true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE project_id='@project') THEN RAISE EXCEPTION 'Moved project packet remained readable'; END IF; END $$;
    RESET ROLE;
    SET LOCAL ROLE anon;
    DO $$ BEGIN
      BEGIN PERFORM 1 FROM public.assistant_provider_connections; RAISE EXCEPTION 'Anonymous caller read connection data'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.claim_assistant_provider_turn('@connection',repeat('a',64),'${authMode}','connected'); RAISE EXCEPTION 'Anonymous caller invoked claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;`));

  it("API requests use their own attempt identity and cannot be claimed by a native connection", () => exercise(`
    DO $$ DECLARE created jsonb; job jsonb; BEGIN
      created:=public.create_assistant_provider_turn('@request','@owner','@workspace','@project',NULL,'anthropic','fixture-api-model','workspace_api_key','Question',pg_temp.packet()); job:=created->'turn';
      IF job->>'state'<>'running' OR job->>'attempt_id' IS NULL THEN RAISE EXCEPTION 'API attempt identity missing'; END IF;
      IF pg_temp.claim()->'turn'<>'null'::jsonb THEN RAISE EXCEPTION 'Native connection claimed API work'; END IF;
      BEGIN PERFORM public.finish_assistant_provider_turn((job->>'id')::uuid,(job->>'attempt_id')::uuid,NULL,'@connection',repeat('a',64),pg_temp.answer(),pg_temp.receipt(),NULL); RAISE EXCEPTION 'Native connection completed API work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      job:=public.finish_assistant_provider_turn((job->>'id')::uuid,(job->>'attempt_id')::uuid,'@owner',NULL,NULL,NULL,NULL,'api_interrupted');
      IF job->>'state'<>'failed' OR job->'result'<>'null'::jsonb THEN RAISE EXCEPTION 'API failure reported success'; END IF;
    END $$;`));
  it("reveals only private retention counts to project writers and blocks project deletion", () => exercise(`
    SELECT pg_temp.make_turn();
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','@custodian',true);
    DO $$ DECLARE counts jsonb; BEGIN
      IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE project_id='@project')
        OR EXISTS(SELECT 1 FROM public.assistant_provider_connections WHERE project_id='@project') THEN RAISE EXCEPTION 'Other owner read private provider contents'; END IF;
      counts:=public.read_project_provider_retention_counts('@project');
      IF counts<>jsonb_build_object('assistant_provider_connections',1,'assistant_provider_turns',1) THEN RAISE EXCEPTION 'Private history count missing or disclosing extra fields'; END IF;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN
      BEGIN PERFORM public.read_project_provider_retention_counts('@project'); RAISE EXCEPTION 'Viewer read administrative counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN
      BEGIN PERFORM public.read_project_provider_retention_counts('@project'); RAISE EXCEPTION 'Outsider read private history counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;
    DELETE FROM public.projects WHERE id='@otherProject';
    DO $$ BEGIN
      BEGIN DELETE FROM public.projects WHERE id='@project'; RAISE EXCEPTION 'Project deletion destroyed private history'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      IF (SELECT count(*) FROM public.assistant_provider_turns WHERE project_id='@project')<>1 THEN RAISE EXCEPTION 'Private history was lost'; END IF;
    END $$;
  `));

  it("binds retained turns to their connection provider and account even for direct service writes", () => exercise(`
    SELECT pg_temp.make_turn();
    DO $$ DECLARE constraint_name text; BEGIN
      BEGIN
        UPDATE public.assistant_provider_connections SET provider='${provider === "claude" ? "codex" : "claude"}',
          expected_auth_mode='${provider === "claude" ? "chatgpt" : "claude_subscription"}' WHERE id='@connection';
        RAISE EXCEPTION 'Existing history was rebound to another provider';
      EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
        IF constraint_name<>'assistant_provider_turn_connection_identity' THEN RAISE EXCEPTION 'Wrong identity guard failed'; END IF;
      END;
      IF (SELECT provider FROM public.assistant_provider_connections WHERE id='@connection')<>'${provider}' THEN RAISE EXCEPTION 'Refused update changed connection'; END IF;
    END $$;`));

  it("refuses cross-provider creation and wrong receipt provider while preserving the original request", () => exercise(`
    DO $$ DECLARE claimed jsonb; BEGIN
      BEGIN
        PERFORM public.create_assistant_provider_turn('@secondRequest','@owner','@workspace','@project','@connection',
          '${provider === "claude" ? "codex" : "claude"}','${provider === "claude" ? "fixture-model" : "claude-sonnet-4-6"}',
          '${provider === "claude" ? "chatgpt" : "claude_subscription"}','Bad provider',pg_temp.packet());
        RAISE EXCEPTION 'Cross-provider request accepted';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      PERFORM pg_temp.make_turn(); claimed:=pg_temp.claim();
      BEGIN
        PERFORM public.finish_assistant_provider_turn((claimed->'turn'->>'id')::uuid,(claimed->'turn'->>'attempt_id')::uuid,NULL,'@connection',repeat('a',64),pg_temp.answer(),
          jsonb_set(pg_temp.receipt(),'{provider}','"${provider === "claude" ? "codex" : "claude"}"'),NULL);
        RAISE EXCEPTION 'Another provider receipt accepted';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      IF (SELECT state FROM public.assistant_provider_turns WHERE request_id='@request')<>'running'
        OR (SELECT count(*) FROM public.assistant_provider_turns WHERE connection_id='@connection')<>1 THEN RAISE EXCEPTION 'Refusal changed retained request'; END IF;
    END $$;`));

  it("v2 creation requires a valid provider account pair and service authority", () => exercise(`
    DO $$ DECLARE constraint_name text; BEGIN
      BEGIN
        PERFORM public.create_assistant_provider_connection_v2('@secondRequest','@outsider','@workspace','@project','Wrong membership',repeat('b',64),'claude_subscription','claude');
        RAISE EXCEPTION 'Service issued a connection outside user membership';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        PERFORM public.create_assistant_provider_connection_v2('@secondRequest','@owner','@workspace','@project','Bad pair',repeat('b',64),'chatgpt','claude');
        RAISE EXCEPTION 'Wrong account pair accepted';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
        IF constraint_name<>'assistant_provider_connection_mode' THEN RAISE EXCEPTION 'Wrong account-pair guard failed'; END IF;
      END;
    END $$;
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@owner',true);
    DO $$ BEGIN
      BEGIN
        PERFORM public.create_assistant_provider_connection_v2('@secondRequest','@owner','@workspace','@project','Unapproved native credential',repeat('b',64),'claude_subscription','claude');
        RAISE EXCEPTION 'Browser minted v2 connection directly';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;`));

  it.each(["revoked", "expired"])("refuses a new request on a %s connection before inserting work", state => exercise(`
    ${state === "revoked" ? "SELECT public.revoke_assistant_provider_connection('@connection','@owner');" : "UPDATE public.assistant_provider_connections SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id='@connection';"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.make_turn(); RAISE EXCEPTION 'Inactive connection queued a new request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE connection_id='@connection') THEN RAISE EXCEPTION 'Inactive connection retained new work'; END IF;
    END $$;`));

  if (provider === "opencode") {
    it.each(["openai/gpt-6-astra", "gpt model", "-bad", "x".repeat(141)])("refuses malformed OpenCode model %s at the database", invalidModel => exercise(`
      DO $$ DECLARE constraint_name text; BEGIN
        BEGIN
          PERFORM public.create_assistant_provider_turn('@request','@owner','@workspace','@project','@connection','opencode','${invalidModel}','opencode_api','Model check',pg_temp.packet());
          RAISE EXCEPTION 'Invalid OpenCode model accepted';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
          IF constraint_name<>'assistant_provider_opencode_model' THEN RAISE EXCEPTION 'Wrong OpenCode model guard failed'; END IF;
        END;
        PERFORM pg_temp.make_turn();
      END $$;`));
    it.each(["chatgpt", "apiKey", "claude_subscription"])("refuses OpenCode account pair %s at the database", wrongMode => exercise(`
      DO $$ DECLARE constraint_name text; BEGIN
        BEGIN
          PERFORM public.create_assistant_provider_connection_v2('@secondRequest','@owner','@workspace','@project','Bad OpenCode pair',repeat('b',64),'${wrongMode}','opencode');
          RAISE EXCEPTION 'Wrong OpenCode account pair accepted';
        EXCEPTION WHEN check_violation THEN
          GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
          IF constraint_name<>'assistant_provider_connection_mode' THEN RAISE EXCEPTION 'Wrong OpenCode account guard failed'; END IF;
        END;
        PERFORM pg_temp.make_turn();
      END $$;`));
  }

  it("enforces exact Claude model identifiers without changing other native model names", () => exercise(`
    DO $$ DECLARE constraint_name text; saved jsonb; BEGIN
      ${provider === "claude" ? "BEGIN" : ""}
        saved:=public.create_assistant_provider_turn('@request','@owner','@workspace','@project','@connection','${provider}','sonnet','${authMode}','Model check',pg_temp.packet());
        ${provider === "claude" ? "RAISE EXCEPTION 'Claude model alias accepted'; EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME; IF constraint_name<>'assistant_provider_claude_model' THEN RAISE EXCEPTION 'Wrong model guard failed'; END IF; END;" : "IF saved->'turn'->>'model_id'<>'sonnet' THEN RAISE EXCEPTION 'Other native model name was changed'; END IF;"}
    END $$;`));

});
