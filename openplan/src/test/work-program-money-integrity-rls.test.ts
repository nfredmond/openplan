import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

/**
 * Live custody for the 2026-10-17 money-integrity corrections to OWP labor,
 * report issue and amendments (KI-2026-10-12-002, -003, -004).
 *
 * Each defect has a refusal case, a legitimate write that must still succeed,
 * and a harness case. The harness installs the function as it stood before
 * the correction (the refusal must then fail) and the corrected function with a
 * harmless message edit (the refusal must still pass), all inside the same
 * rolled-back transaction. Without the second, a harness that silently failed
 * to install anything would look like a passing guard.
 */
const migration = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8");
function functionText(file: string, start: string) {
  const sql = migration(file);
  const from = sql.indexOf(start);
  if (from < 0) throw new Error(`Missing ${start} in ${file}`);
  return sql.slice(from, sql.indexOf("END $$;", from) + 7).replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION");
}
const CORRECTED = "20261017000005_money_integrity_corrections.sql";
const oldActual = functionText("20260910000001_work_program_actuals.sql", "CREATE FUNCTION public.record_work_program_actual(");
const newActual = functionText(CORRECTED, "CREATE OR REPLACE FUNCTION public.record_work_program_actual(");
const oldManagement = functionText("20261003000001_work_program_reimbursement.sql", "CREATE OR REPLACE FUNCTION public.work_program_management_command(");
const newManagement = functionText(CORRECTED, "CREATE OR REPLACE FUNCTION public.work_program_management_command(");
const oldEvent = functionText("20260909000001_work_program_review.sql", "CREATE FUNCTION public.record_work_program_event(");
const newEvent = functionText(CORRECTED, "CREATE OR REPLACE FUNCTION public.record_work_program_event(");

function harmless(text: string, from: string, to: string) {
  if (!text.includes(from)) throw new Error(`Harmless edit target missing: ${from}`);
  return text.replace(from, to);
}

function run(sql: string) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const injected = process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL, "utf8") : "";
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input: `BEGIN; SET LOCAL lock_timeout='5s';\n${injected}\n${sql}\nSELECT 'OWP_MONEY_ASSERTIONS_REACHED'; ROLLBACK;`,
  });
}

/** OWP actuals and management reporting, with a synthetic contract for unmapped time. */
function actuals(body: string, replacement = "") {
  return run(`${replacement}
  DO $test$ DECLARE
   o uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid();
   element uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); engagement uuid:=gen_random_uuid();
   unmapped uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); period_key uuid:=gen_random_uuid(); adoption uuid:=gen_random_uuid();
   r public.program_work_program_revisions; c jsonb; approved jsonb; result jsonb;
  BEGIN
   INSERT INTO auth.users(id,email) VALUES(o,o||'@example.test'),(m,m||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Synthetic OWP money integrity',w::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,o,'owner'),(w,m,'member');
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,w,'Synthetic program, no real agency costs','other','Test');
   INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(staff,w,'Synthetic staff',m);
   INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client,w,'Synthetic client');
   INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,title) VALUES(engagement,w,client,'Synthetic contract');
   SELECT * INTO r FROM public.save_program_work_program_revision(p,o,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'agency','Synthetic agency','periodStart','2026-07-01','periodEnd','2027-06-30','elements',jsonb_build_array(jsonb_build_object('id',element,'projectId',NULL,'tasks',jsonb_build_array(jsonb_build_object('id',task))))));
   c:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'revisionId',r.id,'kind','labor','status','draft','entryDate','2026-08-01','sourceKey','synthetic-labor','sourceReference','Synthetic timesheet','description','Synthetic time, not agency spending','staffId',staff,'projectId',NULL,'contractId',NULL,'hours','1.00','amount',NULL,'basis','unvalued','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'share',10000)));
   approved:=c||jsonb_build_object('status','approved','basis','recorded','amount','12.35');
   ${body}
  END $test$;`);
}

const unmappedTime = `INSERT INTO public.invoicing_time_entries(id,workspace_id,staff_id,engagement_id,entry_date,hours) VALUES(unmapped,w,staff,engagement,'2026-08-01',2);`;
const overlapRefused = `${unmappedTime}
 BEGIN PERFORM public.record_work_program_actual(p,o,approved); RAISE EXCEPTION 'Unmapped time counted twice';
 EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Other time or payroll exists%' THEN RAISE; END IF; END;`;

const reviewed = `PERFORM public.record_work_program_actual(p,m,c);
 PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','basis','recorded','amount','12.35','correctionNote','Synthetic approval'));
 INSERT INTO public.program_work_program_events(id,program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(adoption,p,w,1,r.id,r.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',period_key,'expectedVersion',0,'name','Synthetic August','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',r.id,'sourceCutoff',now(),'progress','[]'::jsonb));
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_key,'expectedVersion',1,'note','Synthetic review'));`;
const withdrawn = `INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(p,w,2,r.id,r.content_sha256,'withdraw_authority',o,jsonb_build_object('targetEventId',adoption),'[]',gen_random_uuid());`;
const issue = `result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_key,'expectedVersion',2,'note','Synthetic issue'));`;
const issueRefused = `${reviewed}${withdrawn}
 BEGIN ${issue} RAISE EXCEPTION 'Withdrawn adoption issued as adopted reporting';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'The baseline adoption was withdrawn%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.work_program_period_reports x WHERE x.period_id=period_key) THEN RAISE EXCEPTION 'Refused issue left a report'; END IF;`;

/** OWP review workflow, as in work-program-workflow-rls. */
function workflow(body: string, replacement = "") {
  return run(`${replacement}
  CREATE FUNCTION pg_temp.command(k text, p uuid, r uuid) RETURNS jsonb LANGUAGE sql AS $c$
   SELECT jsonb_build_object('requestId',gen_random_uuid(),'expectedSequence',coalesce((SELECT sequence FROM public.program_work_program_workflow WHERE program_id=p),0),'expectedRevision',(SELECT max(revision) FROM public.program_work_program_revisions WHERE program_id=p),'revisionId',r,'revisionHash',(SELECT content_sha256 FROM public.program_work_program_revisions WHERE id=r),'kind',k,'note','Synthetic engineering exercise, no agency decision','visibility','internal','reviewerIds','[]'::jsonb,'documentIds','[]'::jsonb,'dueOn',NULL,'evidenceDate',NULL,'authority','','scope','','targetEventId',NULL)
  $c$;
  DO $test$ DECLARE
   owner_id uuid:=gen_random_uuid(); reviewer_id uuid:=gen_random_uuid(); workspace_id uuid:=gen_random_uuid(); program_id uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid();
   r public.program_work_program_revisions; amendment public.program_work_program_revisions; latest public.program_work_program_revisions;
  BEGIN
   INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(reviewer_id,reviewer_id||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_id,'Synthetic amendment test',workspace_id::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace_id,owner_id,'owner'),(workspace_id,reviewer_id,'member');
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(program_id,workspace_id,'Synthetic OWP amendment','other','Exercise');
   INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,page_count,status,storage_ref,byte_size) VALUES(doc,workspace_id,'Synthetic decision fixture, not a signature','uploaded_pdf',repeat('a',64),1,'stored','storage://kb-documents/synthetic',100);
   SELECT * INTO r FROM public.save_program_work_program_revision(program_id,owner_id,0,gen_random_uuid(),'{"schemaVersion":1,"elements":[],"agency":"Synthetic amendment"}');
   PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('submit',program_id,r.id)||jsonb_build_object('reviewerIds',jsonb_build_array(reviewer_id)));
   PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('approve',program_id,r.id));
   PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('adoption',program_id,r.id)||jsonb_build_object('authority','Synthetic board','scope','Engineering exercise only','evidenceDate',current_date,'documentIds',jsonb_build_array(doc)));
   ${body}
  END $test$;`);
}

const amendmentStarted = `PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('start_amendment',program_id,r.id));
 SELECT * INTO amendment FROM public.program_work_program_revisions x WHERE x.program_id=r.program_id ORDER BY revision DESC LIMIT 1;
 IF amendment.id=r.id OR amendment.content_json<>r.content_json OR amendment.amendment_baseline_id<>r.id THEN RAISE EXCEPTION 'Amendment did not start from the adopted baseline'; END IF;
 SELECT * INTO amendment FROM public.save_program_work_program_revision(program_id,owner_id,amendment.revision,gen_random_uuid(),amendment.content_json||'{"agency":"Amendment work in progress"}');`;
const restartRefused = `${amendmentStarted}
 BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('start_amendment',program_id,r.id)); RAISE EXCEPTION 'Amendment in progress overwritten';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN IF SQLERRM NOT LIKE 'An amendment is already in progress%' THEN RAISE; END IF; END;
 SELECT * INTO latest FROM public.program_work_program_revisions x WHERE x.program_id=r.program_id ORDER BY revision DESC LIMIT 1;
 IF latest.id<>amendment.id OR latest.content_json->>'agency'<>'Amendment work in progress' THEN RAISE EXCEPTION 'Amendment work displaced'; END IF;`;

(LIVE_RLS ? describe : describe.skip)("OWP money-integrity corrections", () => {
  const reached = (output: string) => expect(output).toContain("OWP_MONEY_ASSERTIONS_REACHED");

  it("refuses to approve labor over unmapped time for the same staff date without a reconciliation note", () => reached(actuals(overlapRefused)));

  it("still approves labor once the overlap is reconciled, and maps the unmapped entry itself without a note", () => reached(actuals(`${unmappedTime}
   result:=public.record_work_program_actual(p,o,approved||jsonb_build_object('requestId',gen_random_uuid(),'reconciliationNote','Synthetic: separate contract hours, reviewed'));
   IF (SELECT count(*) FROM public.work_program_actual_versions WHERE entry_id=entry AND status='approved')<>1 THEN RAISE EXCEPTION 'Reconciled labor not recorded'; END IF;
   UPDATE public.invoicing_time_entries SET entry_date='2026-08-03' WHERE id=unmapped;
   result:=public.record_work_program_actual(p,o,approved||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','synthetic-map-unmapped','entryDate','2026-08-03','hours','2.00','amount','24.70','contractId',engagement,'timeEntryId',unmapped));
   IF (SELECT work_program_id FROM public.invoicing_time_entries WHERE id=unmapped) IS DISTINCT FROM p THEN RAISE EXCEPTION 'Unmapped entry was not mapped'; END IF;
  `)));

  it("harness: the pre-correction function approves the overlap, and a harmless edit of the corrected one still refuses it", () => {
    expect(() => actuals(overlapRefused, oldActual)).toThrow(/Unmapped time counted twice/);
    reached(actuals(overlapRefused, harmless(newActual, "Members may correct only their own draft time", "Members may correct only their own draft time entries")));
  });

  it("refuses to issue a reviewed report whose baseline adoption was withdrawn after review", () => reached(actuals(issueRefused)));

  it("still issues a reviewed report while its adoption stands", () => reached(actuals(`${reviewed}${issue}
   IF NOT EXISTS(SELECT 1 FROM public.work_program_period_reports x WHERE x.id=(result->>'reportId')::uuid AND x.snapshot->'baselineAdoption'->>'id'=adoption::text) THEN RAISE EXCEPTION 'Adopted report not issued'; END IF;
  `)));

  it("harness: the pre-correction function issues over a withdrawal, and a harmless edit of the corrected one still refuses it", () => {
    expect(() => actuals(issueRefused, oldManagement)).toThrow(/Withdrawn adoption issued as adopted reporting/);
    reached(actuals(issueRefused, harmless(newManagement, "Unknown management command", "Unknown management reporting command")));
  });

  it("refuses to restart an amendment over one already in progress", () => reached(workflow(restartRefused)));

  it("still starts an amendment from the adopted baseline when none is in progress", () => reached(workflow(amendmentStarted)));

  it("harness: the pre-correction function overwrites the amendment, and a harmless edit of the corrected one still refuses it", () => {
    expect(() => workflow(restartRefused, oldEvent)).toThrow(/Amendment in progress overwritten/);
    reached(workflow(restartRefused, harmless(newEvent, "Select the current adopted baseline", "Select the currently adopted baseline")));
  });
});
