import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("transactional approved project submittals", () => {
  let container: string;
  beforeAll(() => { container = resolveLocalDbContainer(); });
  function exercise(body: string) {
    const ids = Object.fromEntries(["owner", "custodian", "viewer", "outsider", "workspace", "other", "project", "approval"].map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES ('@owner','@owner@example.test'),('@custodian','@custodian@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES ('@workspace','Synthetic receipt test','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@custodian','owner'),('@workspace','@viewer','viewer');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic original project');
      CREATE TEMP TABLE receipt_probe(action text);
      INSERT INTO receipt_probe VALUES ('{"kind":"create_project_record","projectId":"@project","recordType":"submittal","title":"Synthetic invoice backup"}');
      INSERT INTO public.assistant_action_approvals(id,workspace_id,user_id,action_kind,input_hash,expires_at,execution_context)
      SELECT '@approval','@workspace','@owner','create_project_record',encode(extensions.digest(action,'sha256'),'hex'),now()+interval '5 minutes',
        jsonb_build_object('version',1,'action',action::jsonb,'project',jsonb_build_object('id','@project','workspaceId','@workspace','name','Synthetic original project')) FROM receipt_probe;
      CREATE FUNCTION pg_temp.execute_submittal() RETURNS jsonb LANGUAGE sql AS $fn$
        SELECT public.record_assistant_project_submittal('@approval','@owner','@workspace',action) FROM receipt_probe;
      $fn$;
      ${body}
      SELECT 'SUBMITTAL_RECEIPT_ASSERTIONS_REACHED'; ROLLBACK;`.replace(/@(owner|custodian|viewer|outsider|workspace|other|project|approval)/g, (_, key) => ids[key]);
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("SUBMITTAL_RECEIPT_ASSERTIONS_REACHED");
  }

  it("commits the original row, receipt and consumption; later edits, move, expiry and viewer downgrade do not relabel or duplicate it",()=>exercise(`
    DO $$ DECLARE first jsonb; again jsonb; saved public.project_submittals; ledger public.assistant_action_executions; BEGIN
      UPDATE public.projects SET name='Synthetic renamed before execution' WHERE id='@project';
      first:=pg_temp.execute_submittal();
      SELECT * INTO saved FROM public.project_submittals WHERE project_id='@project';
      SELECT * INTO ledger FROM public.assistant_action_executions WHERE approval_id='@approval';
      IF saved.id IS NULL OR ledger.id IS NULL OR saved.title<>'Synthetic invoice backup' OR saved.status<>'draft' OR saved.submittal_type<>'other' OR saved.created_by<>'@owner' OR saved.assignee_user_id IS NOT NULL THEN RAISE EXCEPTION 'Exact submittal or authorship lost'; END IF;
      IF ledger.result_receipt IS DISTINCT FROM first->'receipt' OR ledger.result_receipt->'record' IS DISTINCT FROM to_jsonb(saved) OR ledger.actor_kind<>'planner_agent' OR ledger.approved_by_user_id<>'@owner' OR ledger.approved_at IS NULL OR ledger.input_hash IS DISTINCT FROM (SELECT input_hash FROM public.assistant_action_approvals WHERE id='@approval') THEN RAISE EXCEPTION 'Original result or audit identity missing'; END IF;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NULL THEN RAISE EXCEPTION 'Approval not consumed'; END IF;
      UPDATE public.project_submittals SET title='Synthetic later edit',status='accepted' WHERE id=saved.id;
      UPDATE public.projects SET workspace_id='@other',name='Synthetic moved project' WHERE id='@project';
      UPDATE public.assistant_action_approvals SET expires_at=now()-interval '1 day' WHERE id='@approval';
      UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='@workspace' AND user_id='@owner';
      again:=pg_temp.execute_submittal();
      IF NOT (again->>'replayed')::boolean OR again->>'workspaceId'<>'@workspace' OR again->'receipt' IS DISTINCT FROM first->'receipt' OR (SELECT count(*) FROM public.project_submittals WHERE project_id='@project')<>1 OR (SELECT count(*) FROM public.assistant_action_executions WHERE approval_id='@approval')<>1 THEN RAISE EXCEPTION 'Retry duplicated or relabeled the old result'; END IF;
      IF (SELECT execution_context->'project'->>'name' FROM public.assistant_action_approvals WHERE id='@approval')<>'Synthetic original project' THEN RAISE EXCEPTION 'Original project name lost'; END IF;
    END $$;`));

  it("refuses changed payload, original user or expected workspace without consuming consent",()=>exercise(`
    DO $$ DECLARE a text; BEGIN SELECT action INTO a FROM receipt_probe;
      BEGIN PERFORM public.record_assistant_project_submittal('@approval','@owner','@workspace',replace(a,'invoice backup','changed')); RAISE EXCEPTION 'Changed action accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.record_assistant_project_submittal('@approval','@viewer','@workspace',a); RAISE EXCEPTION 'Changed caller accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.record_assistant_project_submittal('@approval','@owner','@other',a); RAISE EXCEPTION 'Changed workspace accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL OR EXISTS(SELECT 1 FROM public.project_submittals WHERE project_id='@project') THEN RAISE EXCEPTION 'Refused request changed work'; END IF;
    END $$;`));

  it.each(["expired","legacy","context","moved","viewer","revoked"])("refuses an unused %s approval",state=>exercise(`
    ${state==="expired" ? "UPDATE public.assistant_action_approvals SET expires_at=now()-interval '1 day' WHERE id='@approval';" : state==="legacy" ? "UPDATE public.assistant_action_approvals SET execution_context=null WHERE id='@approval';" : state==="context" ? "UPDATE public.assistant_action_approvals SET execution_context=jsonb_set(execution_context,'{action,title}','\"Unapproved title\"') WHERE id='@approval';" : state==="moved" ? "UPDATE public.projects SET workspace_id='@other' WHERE id='@project';" : state==="viewer" ? "UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='@workspace' AND user_id='@owner';" : "DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_submittal(); RAISE EXCEPTION 'Unusable approval executed'; EXCEPTION WHEN SQLSTATE '${["legacy","context"].includes(state)?"PT409":"42501"}' THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL OR EXISTS(SELECT 1 FROM public.project_submittals WHERE project_id='@project') OR EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE approval_id='@approval') THEN RAISE EXCEPTION 'Unusable approval changed saved work'; END IF;
    END $$;`));

  it.each(["project_submittals","assistant_action_executions","assistant_action_approvals"])("a suppressed %s write rolls everything back",table=>exercise(`
    CREATE FUNCTION pg_temp.suppress_submittal_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${table==="project_submittals"?"NEW.project_id='@project'":"NEW.workspace_id='@workspace'"} THEN RETURN NULL; END IF; RETURN NEW; END $$;
    CREATE TRIGGER submittal_test_suppression BEFORE ${table==="assistant_action_approvals"?"UPDATE":"INSERT"} ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.suppress_submittal_write();
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_submittal(); RAISE EXCEPTION 'Suppressed write reported success' USING ERRCODE='PT999'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      IF EXISTS(SELECT 1 FROM public.project_submittals WHERE project_id='@project') OR EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE approval_id='@approval') OR (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL THEN RAISE EXCEPTION 'Partial transaction survived'; END IF;
    END $$;`));

  it.each(["assignment","record type","status","null status"])("refuses an unregistered %s payload even with matching retained hash",shape=>exercise(`
    UPDATE receipt_probe SET action=(action::jsonb || '${shape==="assignment"?'{"assigneeUserId":"@viewer"}':shape==="record type"?'{"recordType":"milestone"}':shape==="status"?'{"status":"complete"}':'{"status":null}'}'::jsonb)::text;
    UPDATE public.assistant_action_approvals SET input_hash=(SELECT encode(extensions.digest(action,'sha256'),'hex') FROM receipt_probe),execution_context=jsonb_set(execution_context,'{action}',(SELECT action::jsonb FROM receipt_probe)) WHERE id='@approval';
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_submittal(); RAISE EXCEPTION 'Unregistered payload executed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
      IF EXISTS(SELECT 1 FROM public.project_submittals WHERE project_id='@project') OR (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL THEN RAISE EXCEPTION 'Refused payload changed saved work'; END IF;
    END $$;`));

  it("the shared receipt identity check preserves historical rows and refuses wrong kind or shape",()=>exercise(`
    SELECT pg_temp.execute_submittal();
    DO $$ BEGIN
      UPDATE public.assistant_action_executions SET input_summary=input_summary || '{"syntheticHarmlessNote":"control"}'::jsonb WHERE approval_id='@approval';
      BEGIN UPDATE public.assistant_action_executions SET action_kind='record_stage_gate_hold' WHERE approval_id='@approval'; RAISE EXCEPTION 'Wrong receipt kind accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.assistant_action_executions SET result_receipt='{"schemaVersion":1,"recordType":"submittal"}'::jsonb WHERE approval_id='@approval'; RAISE EXCEPTION 'Missing receipt record accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.assistant_action_executions SET actor_kind='human' WHERE approval_id='@approval'; RAISE EXCEPTION 'Wrong receipt authorship accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));

  it("requires service execution, binds reads to consent identity and denies a revoked reader",()=>exercise(`
    DO $$ DECLARE role_name text; h text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF has_function_privilege(role_name,'public.record_assistant_project_submittal(uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege(role_name,'public.read_assistant_action_receipt(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Client role can impersonate receipt caller'; END IF;
      END LOOP;
      IF NOT has_function_privilege('service_role','public.record_assistant_project_submittal(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Service executor denied'; END IF;
      SELECT input_hash INTO h FROM public.assistant_action_approvals WHERE id='@approval';
      IF public.read_assistant_action_receipt('@approval','@owner',h,'create_project_record')->'receipt'<>'null'::jsonb THEN RAISE EXCEPTION 'Pending approval invented receipt'; END IF;
      PERFORM pg_temp.execute_submittal();
      BEGIN PERFORM public.read_assistant_action_receipt('@approval','@viewer',h,'create_project_record'); RAISE EXCEPTION 'Different caller received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.read_assistant_action_receipt('@approval','@owner','bad','create_project_record'); RAISE EXCEPTION 'Changed hash received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.read_assistant_action_receipt('@approval','@owner',h,'record_stage_gate_hold'); RAISE EXCEPTION 'Changed action kind received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';
      BEGIN PERFORM public.read_assistant_action_receipt('@approval','@owner',h,'create_project_record'); RAISE EXCEPTION 'Revoked reader received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));
});
