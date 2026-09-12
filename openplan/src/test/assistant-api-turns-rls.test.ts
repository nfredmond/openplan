import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("retained saved-API attempts", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) throw new Error("API turn fixtures require an explicitly named isolated stack.");
    container = resolveLocalDbContainer();
  });
  function exercise(body: string) {
    const ids = Object.fromEntries(["owner", "custodian", "viewer", "outsider", "workspace", "otherWorkspace", "project", "connection", "revision", "nextRevision", "request", "nextRequest"].map(key => [key, randomUUID()]));
    const mutationFile = process.env.OPENPLAN_API_TURN_MUTATION_SQL;
    if (mutationFile && !isAbsolute(mutationFile)) throw new Error("Mutation SQL requires an absolute path.");
    const mutation = mutationFile ? readFileSync(mutationFile, "utf8") : "";
    const sql = `BEGIN;
      ${mutation}
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@custodian','@custodian@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic API turns','@workspace'),('@otherWorkspace','Synthetic foreign workspace','@otherWorkspace');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@custodian','owner'),('@workspace','@viewer','viewer'),('@otherWorkspace','@outsider','owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic frozen project');
      CREATE FUNCTION pg_temp.config() RETURNS text LANGUAGE sql AS $p$
        SELECT '{"label":"Synthetic API","protocol":"openai_chat_completions","endpoint":"https://model.fixture.invalid/v1/","modelIds":["synthetic-model"],"structuredOutput":true,"authMode":"api_key","timeoutSeconds":120}'::text;
      $p$;
      SELECT public.save_workspace_provider_api_revision('@owner','@workspace','@connection','@revision',NULL,pg_temp.config(),'v2:SYNTHETIC-CIPHERTEXT');
      CREATE FUNCTION pg_temp.packet() RETURNS text LANGUAGE sql AS $p$
        SELECT jsonb_build_object('version',1,'workspaceId','@workspace','capturedAt','2026-09-12T00:00:00Z',
          'project',jsonb_build_object('id','@project','name','Synthetic frozen project','summary',NULL,'status','active','planType','other','deliveryPhase','planning','updatedAt','2026-09-12T00:00:00Z'),
          'source',jsonb_build_object('id','project:@project','href','/projects/@project','label','Synthetic frozen project'))::text;
      $p$;
      CREATE FUNCTION pg_temp.make_turn(p_request uuid DEFAULT '@request',p_user uuid DEFAULT '@owner',p_revision uuid DEFAULT '@revision',
        p_question text DEFAULT 'Synthetic question',p_packet text DEFAULT pg_temp.packet(),p_model text DEFAULT 'synthetic-model',
        p_mode text DEFAULT 'connection_api_key',p_ack boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_assistant_api_turn(p_request,p_user,'@workspace','@project','@connection',p_revision,
          (SELECT configuration_hash FROM public.workspace_provider_api_revisions WHERE id=p_revision),p_model,p_mode,p_ack,p_question,p_packet);
      $p$;
      CREATE FUNCTION pg_temp.answer() RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_object('answer','Synthetic answer; costs unknown.','citations',jsonb_build_array(pg_temp.packet()::jsonb->'source'),'proposal',NULL);
      $p$;
      CREATE FUNCTION pg_temp.receipt(job jsonb) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT jsonb_build_object('schemaVersion',1,'provider','api_connection','model',job->>'model_id','authMode',job->>'auth_mode',
          'turnId',job->>'id','attemptId',job->>'attempt_id','connectionId',job->>'api_connection_id','revisionId',job->>'api_revision_id',
          'configurationHash',job->>'api_configuration_hash','packetHash',job->>'packet_hash','endpoint',pg_temp.config()::jsonb->>'endpoint','protocol','openai_chat_completions');
      $p$;
      CREATE FUNCTION pg_temp.finish(job jsonb,p_result jsonb DEFAULT pg_temp.answer(),p_receipt jsonb DEFAULT NULL,p_failure text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.finish_assistant_provider_turn((job->>'id')::uuid,(job->>'attempt_id')::uuid,(job->>'user_id')::uuid,NULL,NULL,
          p_result,CASE WHEN p_failure IS NULL THEN coalesce(p_receipt,pg_temp.receipt(job)) ELSE p_receipt END,p_failure);
      $p$;
      ${body}
      SELECT 'API_TURN_ASSERTIONS_REACHED'; ROLLBACK;`.replace(/@(otherWorkspace|nextRevision|nextRequest|custodian|connection|workspace|revision|outsider|project|request|viewer|owner)/g, (_, key) => ids[key]);
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("API_TURN_ASSERTIONS_REACHED");
  }

  it("retains the original baseline and one attempt across request and completion retries", () => exercise(`
    DO $$ DECLARE first jsonb; again jsonb; job jsonb; done jsonb; BEGIN
      first:=pg_temp.make_turn(); again:=pg_temp.make_turn(p_packet=>replace(pg_temp.packet(),'Synthetic frozen project','Synthetic later project'));
      IF first->>'created' IS DISTINCT FROM 'true' OR again->>'created' IS DISTINCT FROM 'false' OR first->'turn' IS DISTINCT FROM again->'turn' THEN RAISE EXCEPTION 'Request retry replaced the original baseline'; END IF;
      job:=public.claim_assistant_api_turn();
      IF job->>'state' IS DISTINCT FROM 'running' OR job->>'attempt_id' IS NULL OR job->>'api_revision_id' IS DISTINCT FROM '@revision' OR job->>'api_configuration_canonical' IS DISTINCT FROM pg_temp.config()
        OR (job->>'lease_expires_at')::timestamptz NOT BETWEEN clock_timestamp()+interval '170 seconds' AND clock_timestamp()+interval '181 seconds' THEN RAISE EXCEPTION 'Claim lost saved configuration or lease'; END IF;
      IF public.claim_assistant_api_turn() IS NOT NULL THEN RAISE EXCEPTION 'Running attempt was claimed again'; END IF;
      done:=pg_temp.finish(job);
      IF done->>'state' IS DISTINCT FROM 'succeeded' OR done->'result' IS DISTINCT FROM pg_temp.answer() OR pg_temp.finish(job) IS DISTINCT FROM done THEN RAISE EXCEPTION 'Completion retry changed the retained answer'; END IF;
      IF (SELECT count(*) FROM public.usage_events WHERE workspace_id='@workspace' AND idempotency_key='assistant_api_dispatch:'||(job->>'id')) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Dispatch reservation missing or repeated'; END IF;
      BEGIN PERFORM pg_temp.make_turn(p_question=>'Changed question'); RAISE EXCEPTION 'Changed request accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.finish(job,jsonb_set(pg_temp.answer(),'{answer}','"Changed answer"')); RAISE EXCEPTION 'Changed completion accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    END $$;`));

  it("allows a viewer read/draft request but keeps turns private to their author", () => exercise(`
    SELECT pg_temp.make_turn(); SELECT pg_temp.make_turn('@nextRequest','@viewer');
    SELECT public.claim_assistant_api_turn(); SELECT public.claim_assistant_api_turn();
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.assistant_provider_turns WHERE workspace_id='@workspace') IS DISTINCT FROM 1 OR EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE request_id='@request') THEN RAISE EXCEPTION 'Viewer cannot read own turn or read another author'; END IF;
      BEGIN PERFORM public.claim_assistant_api_turn(); RAISE EXCEPTION 'Member claimed service work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.read_assistant_api_turn_status((SELECT id FROM public.assistant_provider_turns WHERE request_id='@nextRequest'),(SELECT attempt_id FROM public.assistant_provider_turns WHERE request_id='@nextRequest')); RAISE EXCEPTION 'Member used worker status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM pg_temp.make_turn(gen_random_uuid(),'@owner'); RAISE EXCEPTION 'Member impersonated an author'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN UPDATE public.assistant_provider_turns SET state='cancelled',finished_at=now() WHERE request_id='@nextRequest'; RAISE EXCEPTION 'Member wrote directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM * FROM public.workspace_provider_api_credentials; RAISE EXCEPTION 'Member read private credential'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE workspace_id='@workspace') THEN RAISE EXCEPTION 'Foreign workspace read'; END IF; END $$;
    RESET ROLE;
    DO $$ BEGIN BEGIN PERFORM pg_temp.make_turn(p_user=>'@outsider'); RAISE EXCEPTION 'Foreign author created work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;`));

  it("rejects changed model, mode, acknowledgement and revision selection", () => exercise(`
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.make_turn(p_model=>'different-model'); RAISE EXCEPTION 'Different model accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM pg_temp.make_turn(p_mode=>'connection_no_key'); RAISE EXCEPTION 'Different credential mode accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM pg_temp.make_turn(p_ack=>false); RAISE EXCEPTION 'Missing acknowledgement accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM pg_temp.make_turn(p_ack=>NULL); RAISE EXCEPTION 'Null acknowledgement accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM pg_temp.make_turn(p_revision=>'@nextRevision'); RAISE EXCEPTION 'Unrelated revision accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END $$;`));

  it("interrupts queued and running old revisions while exact old saves leave new work intact", () => exercise(`
    DO $$ DECLARE first jsonb; job jsonb; newer jsonb; BEGIN
      first:=pg_temp.make_turn(); job:=public.claim_assistant_api_turn(); PERFORM pg_temp.make_turn('@nextRequest');
      PERFORM public.save_workspace_provider_api_revision('@owner','@workspace','@connection','@nextRevision','@revision',replace(pg_temp.config(),'Synthetic API','Synthetic correction'),'v2:CORRECTION');
      IF EXISTS(SELECT 1 FROM public.assistant_provider_turns WHERE workspace_id='@workspace' AND state IS DISTINCT FROM 'interrupted') THEN RAISE EXCEPTION 'Old active attempts survived correction'; END IF;
      IF pg_temp.make_turn()->'turn'->>'id' IS DISTINCT FROM first->'turn'->>'id' THEN RAISE EXCEPTION 'Old request retry lost history'; END IF;
      BEGIN PERFORM pg_temp.make_turn(gen_random_uuid()); RAISE EXCEPTION 'New request used stale revision'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      newer:=pg_temp.make_turn(gen_random_uuid(),'@owner','@nextRevision');
      PERFORM public.save_workspace_provider_api_revision('@owner','@workspace','@connection','@revision',NULL,pg_temp.config(),'v2:SYNTHETIC-CIPHERTEXT');
      IF (SELECT state FROM public.assistant_provider_turns WHERE id=(newer->'turn'->>'id')::uuid) IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'Old save retry interrupted new work'; END IF;
      IF pg_temp.finish(job)->>'state' IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Late completion revived interrupted work'; END IF;
    END $$;`));

  it("revokes active work, preserves completed history and refuses new dispatch", () => exercise(`
    DO $$ DECLARE done jsonb; job jsonb; pending jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn(); done:=pg_temp.finish(job);
      pending:=pg_temp.make_turn('@nextRequest');
      PERFORM public.revoke_workspace_provider_api_connection('@owner','@workspace','@connection','@revision');
      IF pg_temp.finish(job) IS DISTINCT FROM done THEN RAISE EXCEPTION 'Revocation rewrote completed history'; END IF;
      IF (SELECT state FROM public.assistant_provider_turns WHERE id=(pending->'turn'->>'id')::uuid) IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Revoked queued work survived'; END IF;
      BEGIN PERFORM pg_temp.make_turn(gen_random_uuid()); RAISE EXCEPTION 'Revoked connection dispatched'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      IF public.claim_assistant_api_turn() IS NOT NULL THEN RAISE EXCEPTION 'Revoked work reclaimed'; END IF;
    END $$;`));

  it("keeps saved request routing and packet identities immutable", () => exercise(`
    SELECT pg_temp.make_turn();
    DO $$ BEGIN
      BEGIN UPDATE public.assistant_provider_turns SET question='Changed question' WHERE request_id='@request'; RAISE EXCEPTION 'Question rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.assistant_provider_turns SET api_charge_ack=false WHERE request_id='@request'; RAISE EXCEPTION 'Consent rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.assistant_provider_turns SET user_id='@viewer' WHERE request_id='@request'; RAISE EXCEPTION 'Authorship rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));

  it("enforces the revision workspace and canonical hash on direct service inserts", () => exercise(`
    SELECT pg_temp.make_turn();
    DO $$ DECLARE original jsonb; changed jsonb; packet text; BEGIN
      SELECT to_jsonb(t) INTO original FROM public.assistant_provider_turns t WHERE request_id='@request';
      packet:=jsonb_set(pg_temp.packet()::jsonb,'{workspaceId}','"@otherWorkspace"')::text;
      changed:=original||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'workspace_id','@otherWorkspace',
        'packet',packet::jsonb,'packet_canonical',packet,'packet_hash',encode(extensions.digest(convert_to(packet,'UTF8'),'sha256'),'hex'));
      BEGIN INSERT INTO public.assistant_provider_turns SELECT (jsonb_populate_record(NULL::public.assistant_provider_turns,changed)).*;
        RAISE EXCEPTION 'Cross-workspace revision reference accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      changed:=original||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'api_configuration_canonical',replace(pg_temp.config(),'Synthetic API','Different label'));
      BEGIN INSERT INTO public.assistant_provider_turns SELECT (jsonb_populate_record(NULL::public.assistant_provider_turns,changed)).*;
        RAISE EXCEPTION 'Canonical snapshot hash mismatch accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));

  it("retains failed delivery exactly without another attempt", () => exercise(`
    DO $$ DECLARE job jsonb; failed jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      failed:=pg_temp.finish(job,NULL,NULL,'api_answer_invalid');
      IF failed->>'state' IS DISTINCT FROM 'failed' OR failed->>'failure_code' IS DISTINCT FROM 'api_answer_invalid' OR
        pg_temp.finish(job,NULL,NULL,'api_answer_invalid') IS DISTINCT FROM failed THEN RAISE EXCEPTION 'Failed delivery changed on retry'; END IF;
      BEGIN PERFORM pg_temp.finish(job,NULL,NULL,'api_auth_refused'); RAISE EXCEPTION 'Changed failure receipt accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      IF public.claim_assistant_api_turn() IS NOT NULL THEN RAISE EXCEPTION 'Failed attempt requeued'; END IF;
    END $$;`));

  it("retires an expired claim and allows the new queued request to proceed once", () => exercise(`
    DO $$ DECLARE original jsonb; first_claim jsonb; second_claim jsonb; next_job jsonb; BEGIN
      PERFORM pg_temp.make_turn(); original:=public.claim_assistant_api_turn();
      UPDATE public.assistant_provider_turns SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=(original->>'id')::uuid;
      PERFORM pg_temp.make_turn('@nextRequest');
      first_claim:=public.claim_assistant_api_turn(); second_claim:=public.claim_assistant_api_turn();
      IF (first_claim IS NOT NULL AND second_claim IS NOT NULL) OR (SELECT state FROM public.assistant_provider_turns WHERE request_id='@request') IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Lost process was reclaimed'; END IF;
      next_job:=coalesce(first_claim,second_claim);
      IF next_job->>'request_id' IS DISTINCT FROM '@nextRequest' OR next_job->>'state' IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'Later work could not proceed'; END IF;
      IF (SELECT attempt_id::text FROM public.assistant_provider_turns WHERE request_id='@request') IS DISTINCT FROM original->>'attempt_id' THEN RAISE EXCEPTION 'Expired attempt identity replaced'; END IF;
    END $$;`));

  it("expires process loss through status and never requeues or reserves twice", () => exercise(`
    DO $$ DECLARE job jsonb; current jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      UPDATE public.assistant_provider_turns SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=(job->>'id')::uuid;
      current:=public.read_assistant_api_turn_status((job->>'id')::uuid,(job->>'attempt_id')::uuid);
      IF current->>'state' IS DISTINCT FROM 'interrupted' OR (SELECT state FROM public.assistant_provider_turns WHERE id=(job->>'id')::uuid) IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Expiry was not durable'; END IF;
      IF public.claim_assistant_api_turn() IS NOT NULL OR pg_temp.finish(job)->>'state' IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Expired work regenerated or finished'; END IF;
      IF (SELECT count(*) FROM public.usage_events WHERE workspace_id='@workspace') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Recovery reserved another dispatch'; END IF;
    END $$;`));

  it("cancels through the existing browser RPC without accepting a late answer", () => exercise(`
    DO $$ DECLARE job jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      PERFORM public.cancel_assistant_provider_turn((job->>'id')::uuid,'@owner');
      IF pg_temp.finish(job)->>'state' IS DISTINCT FROM 'cancelled' OR public.read_assistant_provider_turn_for_user((job->>'id')::uuid,'@owner')->>'state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'Cancelled answer was saved'; END IF;
      BEGIN PERFORM public.read_assistant_provider_turn_for_user((job->>'id')::uuid,'@viewer'); RAISE EXCEPTION 'Another author read the turn'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));

  it("denies removed membership and returns only worker status for journal retirement", () => exercise(`
    DO $$ DECLARE job jsonb; current jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';
      BEGIN PERFORM pg_temp.finish(job); RAISE EXCEPTION 'Removed author received an answer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.read_assistant_provider_turn_for_user((job->>'id')::uuid,'@owner'); RAISE EXCEPTION 'Removed author read history'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      current:=public.read_assistant_api_turn_status((job->>'id')::uuid,(job->>'attempt_id')::uuid);
      IF current->>'state' IS DISTINCT FROM 'access_lost' OR (SELECT count(*) FROM jsonb_object_keys(current)) IS DISTINCT FROM 4 OR current ? 'result' OR current ? 'packet' THEN RAISE EXCEPTION 'Worker retirement leaked private content'; END IF;
      IF (SELECT state FROM public.assistant_provider_turns WHERE id=(job->>'id')::uuid) IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Lost access was not durable'; END IF;
    END $$;`));

  it("moves an inaccessible queued request out of the queue", () => exercise(`
    SELECT pg_temp.make_turn(); DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';
    DO $$ DECLARE claimed jsonb; BEGIN
      claimed:=public.claim_assistant_api_turn();
      IF claimed IS NOT NULL OR (SELECT state FROM public.assistant_provider_turns WHERE request_id='@request') IS DISTINCT FROM 'interrupted' THEN RAISE EXCEPTION 'Inaccessible queued work remained claimable'; END IF;
    END $$;`));

  it("checks every API receipt binding and the common citation/proposal boundary", () => exercise(`
    DO $$ DECLARE job jsonb; bad jsonb; field text; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      FOREACH field IN ARRAY ARRAY['turnId','attemptId','connectionId','revisionId','configurationHash','packetHash','endpoint','protocol','provider','model','authMode'] LOOP
        bad:=jsonb_set(pg_temp.receipt(job),ARRAY[field],'"wrong"');
        BEGIN PERFORM pg_temp.finish(job,pg_temp.answer(),bad); RAISE EXCEPTION 'Mismatched receipt accepted: %',field; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      END LOOP;
      BEGIN PERFORM pg_temp.finish(job,jsonb_set(pg_temp.answer(),'{citations}','[]')); RAISE EXCEPTION 'Uncited result accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      bad:=jsonb_set(pg_temp.answer(),'{proposal}',jsonb_build_object('status','proposed','kind','create_project_record','payload',jsonb_build_object('kind','create_project_record','recordType','submittal','projectId','@otherWorkspace','title','Synthetic foreign proposal')));
      BEGIN PERFORM pg_temp.finish(job,bad); RAISE EXCEPTION 'Foreign proposal accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM public.read_assistant_api_turn_status((job->>'id')::uuid,gen_random_uuid()); RAISE EXCEPTION 'Foreign attempt obtained status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF pg_temp.finish(job)->>'state' IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Valid receipt no longer accepted'; END IF;
    END $$;`));

  it("reserves against staff use, keeps public use separate and refuses dispatch at the cap", () => exercise(`
    INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight) SELECT '@workspace',n::text,'assistant_chat',1 FROM generate_series(1,19) n;
    INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight) SELECT '@workspace',n::text,'engagement_public_translation',1 FROM generate_series(1,40) n;
    DO $$ DECLARE job jsonb; BEGIN
      PERFORM pg_temp.make_turn(); job:=public.claim_assistant_api_turn();
      IF job->>'state' IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'Public traffic consumed staff allowance'; END IF;
      PERFORM pg_temp.make_turn('@nextRequest');
      job:=public.claim_assistant_api_turn();
      IF job IS NOT NULL OR (SELECT failure_code FROM public.assistant_provider_turns WHERE request_id='@nextRequest') IS DISTINCT FROM 'api_rate_limited' THEN RAISE EXCEPTION 'Dispatch cap allowed excess work'; END IF;
      IF (SELECT count(*) FROM public.usage_events WHERE workspace_id='@workspace' AND idempotency_key IS NOT NULL) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Denied work reserved a dispatch'; END IF;
    END $$;`));

  it("rolls back the claim when dispatch accounting fails", () => exercise(`
    SELECT pg_temp.make_turn();
    CREATE FUNCTION pg_temp.refuse_usage() RETURNS trigger LANGUAGE plpgsql AS $p$ BEGIN RAISE EXCEPTION 'Synthetic usage store failure'; END $p$;
    CREATE TRIGGER synthetic_usage_failure BEFORE INSERT ON public.usage_events FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_usage();
    DO $$ BEGIN
      BEGIN PERFORM public.claim_assistant_api_turn(); RAISE EXCEPTION 'Expected accounting failure'; EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'Synthetic usage store failure' THEN RAISE; END IF;
      END;
      IF (SELECT state FROM public.assistant_provider_turns WHERE request_id='@request') IS DISTINCT FROM 'queued' OR
        (SELECT attempt_id FROM public.assistant_provider_turns WHERE request_id='@request') IS NOT NULL THEN RAISE EXCEPTION 'Unmetered attempt escaped rollback'; END IF;
    END $$;`));
});
