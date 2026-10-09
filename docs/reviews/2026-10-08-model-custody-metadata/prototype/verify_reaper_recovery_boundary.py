"""Install the reaper boundary in an owned clone and test actual transactional effects."""
import hashlib,json,os,re,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}',source['database']):raise ValueError('Owned template required')
output=Path(os.environ['OPENPLAN_REAPER_RECOVERY_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
def sql(database,statement,check=True):
    result=subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=30)
    if check and result.returncode:raise RuntimeError(result.stderr)
    return result
if sql('postgres',f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';").stdout.strip()!='0':raise RuntimeError('Template has active sessions')
database='openplan_attempt_cli_'+uuid.uuid4().hex
sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
(output/'candidate.json').write_text(json.dumps({'container':source['container'],'database':database}))
migration=REPO/'openplan/supabase/migrations/20261016000022_model_reaper_recovery_boundary.sql'
fixed=migration.read_text();old=(ROOT/'reap.sql').read_text()
fixture=str(uuid.UUID(source['fixture_run']))
# Each transaction rolls back its synthetic records. The installed function is
# changed only inside this owned clone, then restored before leaving the proof.
cases="""
BEGIN;
DO $test$
DECLARE r uuid; s uuid; a jsonb; before_state jsonb; after_state jsonb; mode text; answer boolean;
BEGIN
 FOREACH mode IN ARRAY ARRAY['managed','running','queued-started','queued'] LOOP
  r:=gen_random_uuid();s:=gen_random_uuid();
  INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
   SELECT r,workspace_id,model_id,'aequilibrae',CASE WHEN mode='running' THEN 'running' ELSE 'queued' END,'Synthetic reaper recovery boundary',created_by
   FROM public.model_runs WHERE id='FIXTURE';
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
   VALUES(s,r,'Synthetic stage',CASE WHEN mode IN('running','queued-started') THEN 'running' ELSE 'queued' END,1);
  IF mode='managed' THEN a:=public.claim_model_stage_attempt(gen_random_uuid(),s,'synthetic-reaper-proof'); END IF;
  SELECT jsonb_build_object('run',to_jsonb(m),'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.model_run_stages x WHERE run_id=r),
    'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.model_stage_attempts x WHERE run_id=r),
    'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x WHERE run_id=r)) INTO before_state FROM public.model_runs m WHERE id=r;
  -- A future cutoff reproduces the timestamp predicate without claiming that a
  -- real 45-minute computation ran or rewriting managed timestamps by hand.
  SET LOCAL ROLE service_role;
  answer:=public.reap_model_run_if_stale(r,clock_timestamp()+interval '1 hour','Synthetic timeout');
  RESET ROLE;
  IF mode='queued' THEN
   IF answer IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.model_runs WHERE id=r AND status='failed') THEN RAISE EXCEPTION 'Unstarted queue timeout stopped working'; END IF;
  ELSE
   IF answer IS DISTINCT FROM false THEN RAISE EXCEPTION 'Started work was reaped from timestamps alone: %',mode; END IF;
   SELECT jsonb_build_object('run',to_jsonb(m),'stages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.model_run_stages x WHERE run_id=r),
    'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.model_stage_attempts x WHERE run_id=r),
    'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x WHERE run_id=r)) INTO after_state FROM public.model_runs m WHERE id=r;
   IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'Protected execution changed during reaper'; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.model_stage_write_context) OR EXISTS(SELECT 1 FROM public.model_run_write_context) THEN RAISE EXCEPTION 'Reaper leaked write context'; END IF;
 IF has_function_privilege('authenticated','public.reap_model_run_if_stale(uuid,timestamptz,text)','EXECUTE') OR has_function_privilege('anon','public.reap_model_run_if_stale(uuid,timestamptz,text)','EXECUTE') THEN RAISE EXCEPTION 'Reaper exposed to public role'; END IF;
END;
$test$;
ROLLBACK;
""".replace('FIXTURE',fixture)
def retained_snapshot():
    return sql(database,f"SELECT md5(jsonb_build_object('run',(SELECT to_jsonb(r) FROM public.model_runs r WHERE id='{fixture}'),'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id='{fixture}'),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a WHERE run_id='{fixture}'),'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x WHERE run_id='{fixture}'))::text);").stdout.strip()
existing=retained_snapshot()
records=[]
for name,definition in [('baseline',fixed),('harmless',fixed+'\n-- Harmless recovery-boundary comment.\n'),('unsafe-original',old),('restored',fixed)]:
    sql(database,definition)
    assert retained_snapshot()==existing,'Migration changed existing execution rows'
    result=sql(database,cases,check=False)
    (output/(name+'.log')).write_text(result.stdout+result.stderr)
    if name=='unsafe-original':
        assert result.returncode!=0 and 'Started work was reaped from timestamps alone: managed' in result.stderr,'Unsafe reaper was not detected'
    else:assert result.returncode==0,result.stderr
    records.append({'control':name,'returncode':result.returncode,'fault_detected':name=='unsafe-original'})
report={'database':database,'controls':records,'existing_execution_rows_unchanged':True,'proof_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'cases':['managed attempt','unmanaged running','queued parent with started stage','unstarted queued timeout'],'evidence_directory':str(output),'limits':'Installed SQL state and role checks, with a synthetic future cutoff. No real 45-minute computation, process health, recovery decision, restart, browser journey or scientific acceptance is established.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/'reaper-recovery-boundary.json').write_text(content);print(content)
