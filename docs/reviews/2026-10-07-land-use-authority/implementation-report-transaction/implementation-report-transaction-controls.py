import hashlib, json, os, pathlib, subprocess, sys, time

app = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(str(pathlib.Path(__file__).with_suffix('')) + ('-' + sys.argv[2] if len(sys.argv)>2 else '')); out.mkdir(exist_ok=True)
sql = app / 'supabase/migrations/20261016000012_land_use_plan_implementation_report_commands.sql'
store = app / 'src/lib/land-use-plans/implementation-report-store.ts'
schema = app / 'src/lib/land-use-plans/implementation-report-command.ts'
originals = {p: p.read_bytes() for p in [sql, store, schema]}
cases = []
def add(name, path, old, new, evidence, harmless=False):
    cases.append((name, path, old, new, evidence, harmless))
add('sql-harmless', sql, 'A lost response must not', 'A missing response must not', '', True)
add('store-harmless', store, 'let snapshotText:', 'let snapshotText:', '', True)
add('schema-harmless', schema, 'A receipt must describe', 'A receipt must identify', '', True)
add('sql-permission',sql,"role IN ('owner','admin','member')", "role IN ('owner','admin','member','viewer')",'viewer denied: accepted')
add('sql-actor-replay',sql,'previous.actor_id IS DISTINCT FROM p_actor_id OR ', '', 'different writer cannot recover another actor command: accepted')
add('sql-exact-retry',sql,'previous.command_text IS DISTINCT FROM p_command_text', 'false', 'changed retry bytes denied: accepted')
add('sql-replay-result',sql,"jsonb_build_object('replayed',true)","jsonb_build_object('replayed',false)",'exact replay after current state changes')
add('sql-current-pointer',sql,' OR plan_row.current_adopted_version_id IS DISTINCT FROM adopted.id','', 'changed current adopted pointer: accepted')
add('sql-version-state',sql," OR adopted.state<>'adopted'",'', 'superseded selected version: accepted')
add('sql-version-hash',sql,"OR adopted.content_hash IS DISTINCT FROM command->>'expectedVersionHash'",'OR false','changed adopted hash: accepted')
add('sql-source-json',sql,'adopted.frozen_snapshot IS DISTINCT FROM adopted_snapshot','false','stored adopted snapshot mismatch: accepted')
add('sql-source-hash',sql,"OR encode(extensions.digest(p_adopted_snapshot_text,'sha256'),'hex') IS DISTINCT FROM adopted.content_hash",'', 'changed adopted snapshot bytes: accepted')
for name, expression in [('plan',"OR adopted_snapshot#>>'{plan,id}' IS DISTINCT FROM p_plan_id::text"),('version',"OR adopted_snapshot#>>'{version,id}' IS DISTINCT FROM adopted.id::text"),('number',"OR adopted_snapshot#>>'{version,versionNumber}' IS DISTINCT FROM adopted.version_number::text")]:
    add('sql-source-'+name,sql,expression,'','retained source identity mismatch: accepted')
add('sql-date-order',sql,'IF end_date<start_date THEN','IF false THEN','invalid command field: unexpected 23514')
add('sql-extra-fields',sql,'AND (SELECT count(*) FROM jsonb_object_keys(command))=8','AND true','invalid command field: accepted')
add('sql-title-length',sql,"length(command->>'title') BETWEEN 1 AND 180","length(command->>'title') BETWEEN 1 AND 181",'invalid command field: accepted')
add('sql-title-trim',sql,"AND btrim(command->>'title',trim_chars)=command->>'title'",'AND true','invalid command field: accepted')
add('sql-summary-length',sql,"length(command->>'summary')<=20000","length(command->>'summary')<=20001",'invalid command field: accepted')
add('sql-command-id',sql,"AND command->>'commandId'=p_command_id::text",'AND true','invalid command field: accepted')
add('sql-action-order',sql,'ORDER BY a.id','ORDER BY a.id DESC','retained bytes and ordered actions')
add('sql-action-status',sql,'due_on,status,project_id','due_on,\'completed\'::text AS status,project_id','Committed status was not captured')
add('sql-private-projection',sql,'SELECT id,title,description,responsible_party','SELECT assignee_user_id,id,title,description,responsible_party','public action projection')
add('sql-artifact-hash',sql,"'contentHash',content_hash,'contentHashEncoding'","'contentHash',repeat('0',64),'contentHashEncoding'",'artifact retains exact snapshot')
add('sql-register-hash',sql,'report_summary,actions,content_hash,report_id','report_summary,actions,repeat(\'0\',64),report_id','register matches artifact')
add('sql-fallback-summary',sql,"Implementation status for %s through %s.","Changed %s through %s.",'report date and fallback summary')
add('sql-no-plan-lock',sql,'WHERE id=p_plan_id AND workspace_id=p_workspace_id FOR UPDATE NOWAIT','WHERE id=p_plan_id AND workspace_id=p_workspace_id','Report accepted while peer held SELECT id FROM public.land_use_plans')
add('sql-no-permission-lock',sql,"role IN ('owner','admin','member') FOR SHARE NOWAIT","role IN ('owner','admin','member')",'Report accepted while peer held SELECT user_id')
add('sql-no-version-lock',sql,'AND workspace_id=p_workspace_id FOR UPDATE NOWAIT;\n  IF NOT FOUND OR adopted.state','AND workspace_id=p_workspace_id;\n  IF NOT FOUND OR adopted.state','Report accepted while peer held SELECT id FROM public.land_use_plan_versions')
add('sql-no-append-only',sql,'FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();','FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();\nALTER TABLE public.land_use_plan_implementation_report_commands DISABLE TRIGGER land_use_plan_implementation_report_commands_append_only;', 'receipt append-only: accepted')
for name, old, new, evidence in [
 ('receipt-read-error','previous.error || ','','refuses unavailable or mismatched receipt discovery'),
 ('receipt-identity','previous.data.command_id !== command.commandId','false','refuses unavailable or mismatched receipt discovery'),
 ('version-read-error','if (retained.error)','if (false)','refuses unavailable version reads'),
 ('version-id',' || version.id !== command.versionId','','refuses missing or altered adopted sources'),
 ('version-plan',' || version.plan_id !== scope.planId','','refuses missing or altered adopted sources'),
 ('version-workspace',' || version.workspace_id !== scope.workspaceId','','refuses missing or altered adopted sources'),
 ('version-state','version.state !== "adopted" || ','','refuses missing or altered adopted sources'),
 ('version-hash','version.content_hash !== command.expectedVersionHash','false','refuses missing or altered adopted sources'),
 ('frozen-identity','!readFrozenPlanIdentity(version.frozen_snapshot, scope.planId, version.id, version.version_number, version.content_hash)','false','refuses missing or altered adopted sources'),
 ('raw-sha','result.data.commandSha256 !== createHash("sha256").update(commandText).digest("hex")','false','refuses incomplete or inconsistent receipts'),
 ('replay-confirmation','(previous.data && !result.data.replayed)','false','requires replay confirmation'),
 ('receipt-projection','.select("command_id")','.select("plan_id")','verifies the selected adopted source'),
 ('version-projection','version_number, state, content_hash','version_number, state, wrong_hash','verifies the selected adopted source'),
 ('scope-filter','.eq("workspace_id", scope.workspaceId).eq("command_id", command.commandId)','.eq("command_id", command.commandId)','verifies the selected adopted source'),
 ('exact-rpc-bytes','p_command_text: commandText','p_command_text: JSON.stringify(command)','verifies the selected adopted source'),
 ('byte-limit','> IMPLEMENTATION_REPORT_COMMAND_LIMIT','> IMPLEMENTATION_REPORT_COMMAND_LIMIT + 100000','refuses invalid command'),
]: add('store-'+name,store,old,new,evidence)
for field, right in [('actorId','scope.actorId'),('workspaceId','scope.workspaceId'),('planId','scope.planId'),('commandId','command.commandId'),('versionId','command.versionId'),('adoptedVersionContentHash','command.expectedVersionHash'),('reportingPeriodStart','command.reportingPeriodStart'),('reportingPeriodEnd','command.reportingPeriodEnd'),('title','command.title'),('summary','command.summary')]:
    add('schema-match-'+field,schema,'result.'+field+' === '+right,'true','refuses substituted receipt' if field in ['actorId','workspaceId','planId','commandId','versionId'] else 'refuses incomplete or inconsistent receipts')
add('schema-title-trim',schema,'value === value.trim() && ','','refuses invalid command')
add('schema-date-order',schema,'.strict().refine(value => value.reportingPeriodEnd >= value.reportingPeriodStart);','.strict();','refuses invalid command')
add('schema-unicode',schema,'!value.includes("\\u0000") && !/[\\uD800-\\uDFFF]/u.test(value)','true','refuses invalid command')
add('schema-title-bound',schema,'[...value].length <= 180','[...value].length <= 181','refuses invalid command')
add('schema-summary-bound',schema,'[...value].length <= 20_000','[...value].length <= 20_001','refuses invalid command')

guard=app / 'src/test/a-column-nothing-reads-is-a-question.test.ts'
originals[guard]=guard.read_bytes()
add('inventory-harmless',guard,'The implementation report transaction compares','The implementation report function compares','',True)
for field in ['command_text','command_sha256']:
    line=next(line for line in originals[guard].decode().splitlines(keepends=True) if 'land_use_plan_implementation_report_commands.'+field+'"' in line)
    add('inventory-'+field,guard,line,'','land_use_plan_implementation_report_commands.'+field)
add('sql-invoker',sql,'RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER','RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER','invoker function')
add('sql-private-rpc',sql,'GRANT EXECUTE ON FUNCTION public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text) TO service_role;','GRANT EXECUTE ON FUNCTION public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text) TO service_role,authenticated;','authenticated RPC denied')
add('sql-rls',sql,'ALTER TABLE public.land_use_plan_implementation_report_commands ENABLE ROW LEVEL SECURITY;','ALTER TABLE public.land_use_plan_implementation_report_commands DISABLE ROW LEVEL SECURITY;','journal RLS')
add('sql-private-table',sql,'GRANT SELECT,INSERT ON public.land_use_plan_implementation_report_commands TO service_role;','GRANT SELECT,INSERT ON public.land_use_plan_implementation_report_commands TO service_role; GRANT SELECT ON public.land_use_plan_implementation_report_commands TO authenticated;','journal private')
add('sql-journal-grant',sql,'GRANT SELECT,INSERT ON public.land_use_plan_implementation_report_commands TO service_role;','GRANT SELECT,INSERT,UPDATE ON public.land_use_plan_implementation_report_commands TO service_role;','journal has no update grant')
add('schema-receipt-shape',schema,'}).strict();\nexport type ImplementationReportResult','}).loose();\nexport type ImplementationReportResult','refuses incomplete or inconsistent receipts')
for code,kind in [('PT400','invalid'),('42501','forbidden'),('PT404','missing'),('PT409','conflict')]:
    add('store-error-'+code,store,'error.code === "'+code+'" ? "'+kind+'"','error.code === "'+code+'" ? "unavailable"','maps native '+code)

env = dict(os.environ, NODE_OPTIONS='--max-old-space-size=6144', OPENPLAN_RLS_LIVE_TEST='1', OPENPLAN_IMPLEMENTATION_REPORT_MIGRATION_PROBE='1', OPENPLAN_SUPABASE_WORKDIR='/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050')
if len(sys.argv)>2:
    cases=cases[next(i for i,c in enumerate(cases) if c[0]==sys.argv[2]):]
results=[]
try:
    for name,path,old,new,evidence,harmless in cases:
        source=originals[path].decode()
        if source.count(old)!=1: raise RuntimeError(f'{name}: expected exactly one mutation target, got {source.count(old)}')
        path.write_text(source.replace(old,new))
        test='src/test/a-column-nothing-reads-is-a-question.test.ts' if path==guard else 'src/test/land-use-implementation-report-transaction-rls.test.ts' if path==sql else 'src/test/land-use-implementation-report-store.test.ts'
        started=time.monotonic()
        try:
            run=subprocess.run(['npm','exec','--','vitest','run',test,'--maxWorkers=1'],cwd=app,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
        finally: path.write_bytes(originals[path])
        (out/(name+'.log')).write_text(run.stdout)
        observed='survived' if run.returncode==0 else 'caught' if evidence and evidence in run.stdout and 'AssertionError' in run.stdout else 'unexpected failure'
        valid=observed==('survived' if harmless else 'caught')
        results.append(dict(name=name,observed=observed,expectedEvidence=evidence,exitCode=run.returncode,valid=valid,seconds=round(time.monotonic()-started,3)))
        print(json.dumps(results[-1]),flush=True)
        (out/'report.json').write_text(json.dumps(dict(results=results,restored={str(p.relative_to(app)):hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}),indent=2)+'\n')
        if not valid: break
finally:
    for path, data in originals.items(): path.write_bytes(data)
if len(results)!=len(cases) or not all(r['valid'] for r in results): sys.exit(1)
