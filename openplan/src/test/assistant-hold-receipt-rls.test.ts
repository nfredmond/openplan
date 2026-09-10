import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("transactional approved HOLD receipts", () => {
  let container: string;
  beforeAll(() => { container = resolveLocalDbContainer(); });
  function exercise(body: string) {
    const ids = Object.fromEntries(["owner", "custodian", "viewer", "outsider", "workspace", "other", "project", "approval"].map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES ('@owner','@owner@example.test'),('@custodian','@custodian@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES ('@workspace','Synthetic receipt test','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@custodian','owner'),('@workspace','@viewer','viewer');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('@project','@workspace','Synthetic HOLD project');
      CREATE TEMP TABLE receipt_probe(action text,binding jsonb);
      INSERT INTO receipt_probe VALUES ('{"gateId":"SYNTHETIC_GATE","kind":"record_stage_gate_hold","projectId":"@project","rationale":"Synthetic missing evidence","workspaceId":"@workspace"}',
        '{"templateId":"synthetic_template","templateVersion":"1","templateSelection":"explicitly_requested","gateId":"SYNTHETIC_GATE","gateName":"Synthetic gate","gateSequence":1}');
      INSERT INTO public.assistant_action_approvals(id,workspace_id,user_id,action_kind,input_hash,expires_at,execution_context)
      SELECT '@approval','@workspace','@owner','record_stage_gate_hold',encode(extensions.digest(action,'sha256'),'hex'),now()+interval '5 minutes',
        jsonb_build_object('version',1,'binding',binding,'priorDecisionId',null,'workspace',jsonb_build_object(
          'id',w.id,'stage_gate_template_id',w.stage_gate_template_id,'stage_gate_template_selection',w.stage_gate_template_selection,
          'home_geography_source',w.home_geography_source,'home_geography_kind',w.home_geography_kind,'home_geography_ref',w.home_geography_ref,
          'home_country_code',w.home_country_code,'home_subdivision_code',w.home_subdivision_code))
      FROM receipt_probe,public.workspaces w WHERE w.id='@workspace';
      CREATE FUNCTION pg_temp.execute_hold() RETURNS jsonb LANGUAGE sql AS $fn$
        SELECT public.record_assistant_stage_gate_hold('@approval','@owner','@workspace',action,binding) FROM receipt_probe;
      $fn$;
      ${body}
      SELECT 'HOLD_RECEIPT_ASSERTIONS_REACHED'; ROLLBACK;`.replace(/@(owner|custodian|viewer|outsider|workspace|other|project|approval)/g, (_, key) => ids[key]);
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("HOLD_RECEIPT_ASSERTIONS_REACHED");
  }

  it("commits the exact HOLD, agent identity, receipt and approval together; replay survives expiry and changed context", () => exercise(`
    DO $$ DECLARE first jsonb; again jsonb; saved public.stage_gate_decisions; ledger public.assistant_action_executions; BEGIN
      first:=pg_temp.execute_hold();
      SELECT * INTO saved FROM public.stage_gate_decisions WHERE project_id='@project';
      SELECT * INTO ledger FROM public.assistant_action_executions WHERE approval_id='@approval';
      IF saved.id IS NULL OR ledger.id IS NULL OR saved.rationale<>'Synthetic missing evidence' OR saved.decision<>'HOLD' OR saved.decided_by<>'@owner' OR saved.metadata->'authorship'->>'actorKind'<>'planner_agent' OR saved.metadata->'authorship'->>'approvalId'<>'@approval' THEN RAISE EXCEPTION 'Exact decision or authorship lost'; END IF;
      IF ledger.result_receipt IS DISTINCT FROM first->'receipt' OR ledger.result_receipt->'decision' IS DISTINCT FROM to_jsonb(saved) OR ledger.actor_kind<>'planner_agent' OR ledger.approved_by_user_id<>'@owner' OR ledger.approved_at IS NULL OR ledger.input_hash IS DISTINCT FROM (SELECT input_hash FROM public.assistant_action_approvals WHERE id='@approval') THEN RAISE EXCEPTION 'Receipt or verified audit identity missing'; END IF;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NULL THEN RAISE EXCEPTION 'Approval not consumed'; END IF;
      UPDATE public.assistant_action_approvals SET expires_at=now()-interval '1 day' WHERE id='@approval';
      UPDATE public.workspaces SET stage_gate_template_id='synthetic_changed' WHERE id='@workspace';
      UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='@workspace' AND user_id='@owner';
      again:=pg_temp.execute_hold();
      IF NOT (again->>'replayed')::boolean OR again->'receipt' IS DISTINCT FROM first->'receipt' OR (SELECT count(*) FROM public.stage_gate_decisions WHERE project_id='@project')<>1 OR (SELECT count(*) FROM public.assistant_action_executions WHERE approval_id='@approval')<>1 THEN RAISE EXCEPTION 'Retry duplicated or lost the old result'; END IF;
    END $$;`));

  it("refuses a changed action, user and workspace without consuming consent", () => exercise(`
    DO $$ DECLARE a text; b jsonb; BEGIN
      SELECT action,binding INTO a,b FROM receipt_probe;
      BEGIN PERFORM public.record_assistant_stage_gate_hold('@approval','@owner','@workspace',replace(a,'missing evidence','changed rationale'),b); RAISE EXCEPTION 'Changed payload accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.record_assistant_stage_gate_hold('@approval','@viewer','@workspace',a,b); RAISE EXCEPTION 'Changed user accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.record_assistant_stage_gate_hold('@approval','@owner','@other',a,b); RAISE EXCEPTION 'Changed workspace accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL OR EXISTS(SELECT 1 FROM public.stage_gate_decisions WHERE project_id='@project') THEN RAISE EXCEPTION 'Rejected request spent approval or wrote a decision'; END IF;
    END $$;`));

  it.each(["expired", "legacy"])("refuses an unused %s approval without fabricating recovery", (state) => exercise(`
    ${state === "expired" ? "UPDATE public.assistant_action_approvals SET expires_at=now()-interval '1 day' WHERE id='@approval';" : "UPDATE public.assistant_action_approvals SET execution_context=null WHERE id='@approval';"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_hold(); RAISE EXCEPTION 'Unusable approval executed'; EXCEPTION WHEN SQLSTATE '${state === "expired" ? "42501" : "PT409"}' THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL OR EXISTS(SELECT 1 FROM public.stage_gate_decisions WHERE project_id='@project') THEN RAISE EXCEPTION 'Unusable approval changed saved work'; END IF;
    END $$;`));

  it("keeps receipt readback bound to the original user and workspace and isolates its ledger row", () => exercise(`
    SELECT pg_temp.execute_hold();
    DO $$ BEGIN
      IF public.read_assistant_hold_receipt('@approval','@viewer','@workspace',(SELECT input_hash FROM public.assistant_action_approvals WHERE id='@approval')) IS NOT NULL THEN RAISE EXCEPTION 'Different caller received receipt'; END IF;
      BEGIN PERFORM public.read_assistant_hold_receipt('@approval','@owner','@other',(SELECT input_hash FROM public.assistant_action_approvals WHERE id='@approval')); RAISE EXCEPTION 'Wrong workspace received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.assistant_action_executions WHERE approval_id='@approval' AND result_receipt IS NOT NULL)<>1 THEN RAISE EXCEPTION 'Authorized workspace reader lost receipt evidence'; END IF; END $$;
    SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE approval_id='@approval') THEN RAISE EXCEPTION 'Receipt crossed workspace RLS'; END IF; END $$;
    RESET ROLE;`));

  it.each(["workspace", "decision", "registry"])("refuses a changed %s context before the effect", (kind) => exercise(`
    ${kind === "workspace" ? "UPDATE public.workspaces SET stage_gate_template_id='synthetic_context_changed' WHERE id='@workspace';" : kind === "decision" ? "INSERT INTO public.stage_gate_decisions(workspace_id,project_id,gate_id,template_id,decision,rationale,decided_by) VALUES('@workspace','@project','SYNTHETIC_GATE','synthetic_template','PASS','Synthetic newer decision','@owner');" : "UPDATE receipt_probe SET binding=jsonb_set(binding,'{templateVersion}','\"2\"');"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_hold(); RAISE EXCEPTION 'Stale context executed'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL OR EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE approval_id='@approval') THEN RAISE EXCEPTION 'Stale context spent approval'; END IF;
    END $$;`));

  it.each(["viewer", "outsider"])("revoked write access through %s state cannot execute", (role) => exercise(`
    ${role === "viewer" ? "UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='@workspace' AND user_id='@owner';" : "DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';"}
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_hold(); RAISE EXCEPTION 'Revoked writer executed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL THEN RAISE EXCEPTION 'Revoked writer spent approval'; END IF;
    END $$;`));

  it.each(["stage_gate_decisions", "assistant_action_executions", "assistant_action_approvals"])("a suppressed %s write rolls the whole effect back", (table) => exercise(`
    CREATE FUNCTION pg_temp.suppress_receipt_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id='@workspace' THEN RETURN NULL; END IF; RETURN NEW; END $$;
    CREATE TRIGGER receipt_test_suppression BEFORE ${table === "assistant_action_approvals" ? "UPDATE" : "INSERT"} ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.suppress_receipt_write();
    DO $$ BEGIN
      BEGIN PERFORM pg_temp.execute_hold(); RAISE EXCEPTION 'Suppressed write was reported as success' USING ERRCODE='PT999'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
      IF EXISTS(SELECT 1 FROM public.stage_gate_decisions WHERE project_id='@project') OR EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE approval_id='@approval') OR (SELECT consumed_at FROM public.assistant_action_approvals WHERE id='@approval') IS NOT NULL THEN RAISE EXCEPTION 'Partial transaction survived'; END IF;
    END $$;`));

  it("direct anonymous/authenticated execution is denied and a revoked reader cannot recover", () => exercise(`
    DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF has_function_privilege(role_name,'public.record_assistant_stage_gate_hold(uuid,uuid,uuid,text,jsonb)','EXECUTE') OR has_function_privilege(role_name,'public.read_assistant_hold_receipt(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Client role can impersonate a receipt caller'; END IF;
      END LOOP;
      IF NOT has_function_privilege('service_role','public.record_assistant_stage_gate_hold(uuid,uuid,uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Service executor cannot call transaction'; END IF;
      PERFORM pg_temp.execute_hold();
      DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@owner';
      BEGIN PERFORM public.read_assistant_hold_receipt('@approval','@owner','@workspace',(SELECT input_hash FROM public.assistant_action_approvals WHERE id='@approval')); RAISE EXCEPTION 'Revoked reader received receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));
});
