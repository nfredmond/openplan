"""Join native interruption custody to an exact retained abandonment command.

The synthetic operator uses a service gateway, not application authentication.
Each run creates its own native database. No existing database is reset or reused.
"""
import hashlib,json,os,re,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker';sys.path.insert(0,str(WORKER))
from model_engine_recovery import inspect_engine
output=Path(os.environ['OPENPLAN_NATIVE_OPERATOR_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_NATIVE_OPERATOR_CONTROL','baseline')
if control not in ('baseline','harmless','omit-disconnect'):raise ValueError('Unknown native operator control')
metadata=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
if metadata['container']!='supabase_db_openplan-restore-target-2026091050':raise ValueError('Owned restore target required')
result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_guard_parent_loss.py')],
    env=dict(os.environ,OPENPLAN_NATIVE_PARENT_OUTPUT=str(output/'native'),OPENPLAN_NATIVE_PARENT_CONTROL='parent-loss'),
    capture_output=True,text=True,timeout=180)
(output/'native.log').write_text(result.stdout+result.stderr)
assert result.returncode==0,'Native fixture failed; inspect private native.log'
native_report=json.loads((output/'native/result.json').read_text())['native_http']
database=native_report['database']
if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',database):raise ValueError('Owned native database required')
run=str(uuid.UUID(native_report['run_id']));stage=str(uuid.UUID(native_report['stage_id']))
ready=json.loads((output/'native/supervisor/parent-ready.json').read_text())
config=json.loads((output/'native/supervisor-config.json').read_text())
inspection=inspect_engine(Path(ready['root']),Path(ready['journal']),base_url=config['base_url'],deployment_id=config['deployment_id'],request_id=ready['claim_request_id'])
assert inspection['run_id']==run and inspection['stage_id']==stage
assert inspection['scope_has_live_processes'] is False and inspection['owner_guard']['guard_has_live_processes'] is False
assert not inspection['continuation_authorized'] and not inspection['database_status_changed']

def sql(database,statement,check=True):
    result=subprocess.run(['docker','exec','-i',metadata['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True,timeout=30)
    if check and result.returncode:raise RuntimeError(result.stderr)
    return result


def execution_digest():
    return sql(database,"SELECT md5(jsonb_build_object('runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.model_runs r),'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_stage_attempts a),'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.model_run_artifacts a),'starts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stage_id) FROM public.model_stage_execution_starts x))::text);").stdout.strip()

before=execution_digest();migrations={}
for name in ('20261016000022_model_reaper_recovery_boundary.sql','20261016000023_model_recovery_decisions.sql'):
    path=ROOT.parents[3]/'openplan/supabase/migrations'/name
    sql(database,path.read_text());migrations[name]=hashlib.sha256(path.read_bytes()).hexdigest()
assert before==execution_digest(),'Recovery upgrade changed native execution'
authority=json.loads(sql(database,f"SELECT json_build_object('workspace',m.workspace_id,'actor',m.user_id) FROM public.workspace_members m JOIN public.model_runs r ON r.workspace_id=m.workspace_id WHERE r.id='{run}' AND m.role IN('owner','admin') ORDER BY m.user_id LIMIT 1;").stdout)
workspace=str(uuid.UUID(authority['workspace']));actor=str(uuid.UUID(authority['actor']))
current_attempt=sql(database,f"SELECT active_attempt_id FROM public.model_run_stages WHERE id='{stage}';").stdout.strip()
assert current_attempt==inspection['attempt_id'],'Native custody differs from active installed attempt'
files=list((Path(ready['work_directory'])/'engine_process').glob('*.json'))+list(Path(ready['journal']).glob('model-commands.sqlite3*'))
def custody():return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
retained_before=custody()
source=(ROOT/'verify_recovery_decision_http.py').read_text()
old="fixture=runpy.run_path(str(ROOT/'verify_recovery_decision.py'),run_name='__main__')"
assert source.count(old)==1
source=source.replace(old,'fixture=native_fixture')
old="'evidence':{'scope':'unconfirmed','fixture':True}"
assert source.count(old)==1
source=source.replace(old,"'evidence':{'fixture':True,'worker_inspection':native_inspection}")
os.environ['OPENPLAN_RECOVERY_HTTP_OUTPUT']=str(output/'http')
os.environ['OPENPLAN_RECOVERY_HTTP_CONTROL']=control
namespace={'__file__':str(ROOT/'verify_recovery_decision_http.py'),'__name__':'__main__',
    'native_fixture':{'database':database,'sql':sql,'r':run,'workspace':workspace,'actor':actor},'native_inspection':inspection}
exec(compile(source,str(ROOT/'verify_recovery_decision_http.py'),'exec'),namespace)
receipt=namespace['retained'][0]['response']
for field in ('process_termination_verified','reported_evidence_verified','continuation_authorized','model_resumed'):
    assert receipt[field] is False,'Reported local evidence acquired server authority'
assert receipt['request_payload']['reported_evidence']['worker_inspection']==inspection
assert custody()==retained_before,'Operator decision changed native custody or journal'
committed=execution_digest()
late=sql(database,f"SET ROLE service_role; SELECT public.write_model_stage_attempt('{uuid.uuid4()}','{current_attempt}','running','Synthetic late write after native abandonment',NULL);",check=False)
assert late.returncode!=0 and 'Model stage attempt no longer owns work' in late.stderr
assert execution_digest()==committed,'Refused late write changed execution records'
http_report=json.loads((output/'http/result.json').read_text())
report={'control':control,'database':database,'run_id':run,'stage_id':stage,'attempt_id':current_attempt,
    'native_interruption':native_report['parent_loss']['scope_observation'],'guard_observation':inspection['owner_guard'],
    'upgraded_native_rows_unchanged':True,'migration_sha256':migrations,'http_recovery':http_report,
    'reported_inspection_retained_exactly':True,'reported_evidence_remains_unverified':True,'native_custody_and_journal_unchanged':True,
    'late_attempt_write_refused':True,'limits':['Synthetic operator with service-role gateway','No authenticated browser or practitioner acceptance','No restart, final publication, graceful-close or scientific claim']}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);print(content)
