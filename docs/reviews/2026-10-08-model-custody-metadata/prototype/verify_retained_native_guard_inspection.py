"""Inspect existing native loss records twice without launching a model or writing."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/aequilibrae_worker';sys.path.insert(0,str(WORKER))
from test_engine_scope_recovery import AUDIT
source=Path(os.environ['OPENPLAN_RETAINED_NATIVE_GUARD_SOURCE'])
ready=json.loads((source/'supervisor/parent-ready.json').read_text())
config=json.loads((source/'supervisor-config.json').read_text())
engine=Path(ready['work_directory'])/'engine_process'
files=list(engine.glob('*.json'))+list(Path(ready['journal']).glob('model-commands.sqlite3*'))
def digests():return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
before=digests();results=[]
for index in range(2):
    result=subprocess.run([sys.executable,'-B','-c',AUDIT,'--root',ready['root'],'--journal',ready['journal'],
        '--base-url',config['base_url'],'--deployment-id',config['deployment_id'],'--request-id',ready['claim_request_id']],
        env=dict(os.environ,PYTHONPATH=str(WORKER)),capture_output=True,text=True,timeout=15)
    assert result.returncode==0,result.stderr+result.stdout
    record=json.loads(result.stdout)
    assert record['scope_has_live_processes'] is False
    assert record['owner_guard']['guard_has_live_processes'] is False
    assert 'owner-guard-started.json' in record['record_sha256']
    for key in ('signal_sent','model_resumed','continuation_authorized','database_status_changed'):assert record[key] is False
    results.append(record)
assert results[0]==results[1] and before==digests()
print(json.dumps({'source':str(source),'fresh_inspections':results,'custody_and_journal_unchanged':True,
    'limits':['Retained native case only','No live database ownership check','No signal, restart or publication authority']},indent=2))
