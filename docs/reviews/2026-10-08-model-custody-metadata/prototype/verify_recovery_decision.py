"""Exercise explicit abandonment in an isolated installed-schema database clone."""
import hashlib,json,os,re,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}',source['database']):raise ValueError('Owned template required')
output=Path(os.environ['OPENPLAN_RECOVERY_DECISION_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
def sql(database,statement,check=True):
    r=subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=30)
    if check and r.returncode:raise RuntimeError(r.stderr)
    return r
if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';").stdout.strip()!='0':raise RuntimeError('Template has active sessions')
database='openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
(output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database}))
fixed=(ROOT/'recovery-decision.sql').read_text()
migration=ROOT.parents[3]/'openplan/supabase/migrations/20261016000023_model_recovery_decisions.sql'
assert migration.read_text()==fixed,'Installed recovery migration differs from proof source'
def existing_execution_digest():
    return sql(database,"SELECT md5(jsonb_build_object('runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.model_runs r),'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a),'kpis',(SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM public.model_run_kpis k),'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a),'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x))::text);").stdout.strip()
existing=existing_execution_digest()
predecessor=migration.with_name('20261016000022_model_reaper_recovery_boundary.sql')
sql(database,predecessor.read_text())
sql(database,migration.read_text())
assert existing_execution_digest()==existing,'Recovery upgrade changed existing execution records'
function=fixed[fixed.index('CREATE OR REPLACE FUNCTION public.abandon_model_run_execution'):].removesuffix('COMMIT;\n')
cases=(ROOT/'recovery-decision-cases.sql').read_text().replace('FIXTURE',str(uuid.UUID(source['fixture_run'])))
authority="IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT) THEN"
controls=[('baseline',function,None),('harmless',function+'\n-- Harmless command comment.\n',None),
 ('omit-authority',function.replace(authority,'IF false THEN'),'Unauthorized recovery accepted'),
 ('omit-state-check',function.replace('IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN','IF false THEN'),'Stale recovery accepted'),
 ('omit-receipt',re.sub(r' INSERT INTO public.model_run_recovery_receipts\(request_id.*?;\n',' PERFORM 1;\n',function,flags=re.S),'Receipt failure was not exercised'),
 ('omit-revocation',re.sub(r' UPDATE public.model_stage_attempts a SET.*?;\n',' PERFORM 1;\n',function,flags=re.S),'Recovery failed to revoke execution'),
 ('restored',function,None)]
records=[]
for name,definition,error in controls:
    assert name in ('baseline','harmless','restored') or definition!=function
    sql(database,definition);r=sql(database,cases,check=False)
    (output/(name+'.log')).write_text(r.stdout+r.stderr)
    if error:assert r.returncode!=0 and error in r.stderr,name+': '+r.stderr
    else:assert r.returncode==0,name+': '+r.stderr
    records.append({'control':name,'returncode':r.returncode,'detected':error})
# Separate transactions exercise a real progress update after the review read.
r,stage,request=[str(uuid.uuid4()) for _ in range(3)]
fixture=str(uuid.UUID(source['fixture_run']))
actor_scope=json.loads(sql(database,f"SELECT json_build_object('workspace',m.workspace_id,'actor',m.user_id) FROM public.workspace_members m JOIN public.model_runs f ON f.workspace_id=m.workspace_id WHERE f.id='{fixture}' AND m.role IN('owner','admin') ORDER BY m.user_id LIMIT 1;").stdout)
workspace=str(uuid.UUID(actor_scope['workspace']));actor=str(uuid.UUID(actor_scope['actor']))
sql(database,f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{r}',workspace_id,model_id,'aequilibrae','queued','Synthetic inter-transaction recovery',created_by FROM public.model_runs WHERE id='{fixture}'; INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{r}','Synthetic interrupted stage','queued',1);")
claim=json.loads(sql(database,f"SET ROLE service_role; SELECT public.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','synthetic-recovery-transaction');").stdout)
attempt=str(uuid.UUID(claim['attempt_id']))
observed=json.loads(sql(database,f"SET ROLE service_role; SELECT public.inspect_model_run_recovery('{workspace}','{r}','{actor}');").stdout)
sql(database,f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{attempt}','running','Real progress after recovery inspection',NULL);")
fresh=json.loads(sql(database,f"SET ROLE service_role; SELECT public.inspect_model_run_recovery('{workspace}','{r}','{actor}');").stdout)
assert fresh['expected_state']!=observed['expected_state'],'Progress did not change the actual reviewed version'
# Values are generated UUIDs and SQL-produced JSON; still quote JSON as SQL data.
review=json.dumps(observed['expected_state']).replace("'","''")
stale=sql(database,f"SET ROLE service_role; SELECT public.abandon_model_run_execution('{request}','{workspace}','{r}','{actor}','{review}'::jsonb,'Synthetic stale operator decision','{{}}');",check=False)
assert stale.returncode!=0 and 'Model recovery state changed' in stale.stderr
assert json.loads(sql(database,f"SET ROLE service_role; SELECT public.inspect_model_run_recovery('{workspace}','{r}','{actor}');").stdout)==fresh
assert sql(database,f"SELECT count(*) FROM public.model_run_recovery_receipts WHERE request_id='{request}';").stdout.strip()=='0'
(output/'inter-transaction-stale.log').write_text(stale.stderr)
report={'database':database,'controls':records,'actual_progress_after_inspection_refused':True,'existing_execution_rows_unchanged_on_upgrade':True,'predecessor_sha256':hashlib.sha256(predecessor.read_bytes()).hexdigest(),'migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'source_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('recovery-decision.sql','recovery-decision-cases.sql','verify_recovery_decision.py')},'evidence_directory':str(output),'limits':'Migration SQL installed in an isolated clone. Synthetic operator decisions, exact replay and revoked database writes do not prove process termination, HTTP reply recovery, API actor derivation, agent approval, restart, browser acceptance or scientific validity. No normal dispatcher activation.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/'recovery-decision-controls.json').write_text(content);print(content)
