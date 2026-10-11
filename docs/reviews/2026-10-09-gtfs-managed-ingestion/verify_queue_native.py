"""Native polling restart and replacement after an actual server-clock expiry."""
from pathlib import Path
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import requests

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent/'2026-10-09-gtfs-ingest-recovery'))
sys.path.insert(0, str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_storage import storage
from isolated_postgrest import gateway
source = json.loads(Path(sys.argv[1]).read_text())
assert source['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
archive = Path(sys.argv[2]).resolve(strict=True)
out = Path(sys.argv[3]).resolve(); out.mkdir(mode=0o700,parents=True,exist_ok=False)
config = {**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex}
(out/'database.json').write_text(json.dumps(config)+'\n'); (out/'database.json').chmod(0o600)

def sql(query,database=None):
    result = subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=30)
    if result.returncode: raise RuntimeError(result.stderr[:3000])
    return result.stdout.strip()

assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();',source['database']) == '0'
sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};','postgres')
migration=root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
scan=migration.read_text().split('-- UUID pagination rotates eligible discovery')[1].split('-- Retained tokens can inspect')[0]
sql('-- UUID pagination rotates eligible discovery'+scan)
workspace,actor = str(uuid.uuid4()),str(uuid.uuid4())
sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic queue recovery','proof-{workspace}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');")
records=[]
with storage(config) as native,gateway('public',database=config['database'],subjects=(actor,)) as rest:
    env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=512','OPENPLAN_PROOF_HTTP_URL':rest['url'],'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token'],
         'OPENPLAN_PROOF_STORAGE_URL':native['url'],'OPENPLAN_PROOF_STORAGE_TOKEN':native['token'],'OPENPLAN_PROOF_WORKSPACE':workspace,'OPENPLAN_PROOF_ACTOR':actor,
         'OPENPLAN_PROOF_PARSER_BUILD':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}
    try:
        for case in ['live','expired']:
            directory=out/case
            def run(mode):
                child=subprocess.Popen(['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(here/'verify_queue_native.mts'),str(directory),mode,str(archive)],cwd=root/'openplan',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
                try:
                    if mode=='interrupt':
                        deadline=time.monotonic()+40
                        while not (directory/'interrupted.json').exists() and child.poll() is None and time.monotonic()<deadline: time.sleep(.05)
                        assert (directory/'interrupted.json').exists(),'Queue did not reach committed preparation'
                        os.killpg(child.pid,signal.SIGKILL)
                    stdout,stderr=child.communicate(timeout=60)
                    (directory/f'{mode}.log').write_text(stdout+stderr)
                    assert child.returncode == (-signal.SIGKILL if mode=='interrupt' else 0),(mode,stderr[:3000])
                    return json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else None
                finally:
                    if child.poll() is None: os.killpg(child.pid,signal.SIGKILL); child.communicate(timeout=5)
            run('seed');run('interrupt')
            identity=json.loads((directory/'identity.json').read_text());version=identity['versionId']
            job_directory=directory/'queue'/f'version-{version}'
            job=json.loads((job_directory/'pending.json').read_text())
            original=json.loads((job_directory/f'attempt-{job["attempt"]}'/'commands/pending.json').read_text())
            (directory/'original-attempt.json').write_text(json.dumps({**original,'attemptDirectory':job['attempt']})+'\n')
            interrupted=json.loads((directory/'interrupted.json').read_text());assert interrupted['sourceRequests']==1 and interrupted['uploads']==0
            initial_remaining=float(sql(f"SELECT extract(epoch FROM lease_until-clock_timestamp()) FROM openplan_gtfs.executions WHERE version_id='{version}';"))
            assert initial_remaining>0,'Lease expired before the live-state observation'
            waited=0
            if case=='expired':
                started=time.monotonic();deadline=started+140
                if os.environ.get('OPENPLAN_GTFS_PROOF_DEBUG_EXPIRY')=='1':
                    print('DEBUG ONLY: advancing this isolated fixture expiry. This does not establish real-clock acceptance.',flush=True)
                    sql(f"UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id='{version}';")
                else:
                    print('Waiting for actual server-clock lease expiry. No fixture timestamp is changed.',flush=True)
                while sql(f"SELECT lease_until<=clock_timestamp() FROM openplan_gtfs.executions WHERE version_id='{version}';")!='t':
                    assert time.monotonic()<deadline,'Native lease did not expire'
                    time.sleep(1)
                waited=time.monotonic()-started
            resumed=run('resume-'+case)
            state=json.loads(sql(f"SELECT jsonb_build_object('status',(SELECT status FROM public.gtfs_feed_versions WHERE id='{version}'),'current',(SELECT is_current FROM public.gtfs_feed_versions WHERE id='{version}'),'attempt',(SELECT attempt FROM openplan_gtfs.executions WHERE version_id='{version}'),'routes',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}'),'stops',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id='{version}'),'batches',(SELECT count(*) FROM openplan_gtfs.batch_receipts WHERE version_id='{version}'),'completion',(SELECT count(*) FROM openplan_gtfs.completion_receipts WHERE version_id='{version}'));"))
            assert state=={'status':'ready','current':False,'attempt':1 if case=='live' else 2,'routes':95,'stops':717,'batches':9,'completion':1},'Native queue publication differs'
            retained=run('retained')
            records.append({'case':case,'initialLeaseSecondsRemaining':initial_remaining,'actualWaitSeconds':waited,'resumed':resumed,'retained':retained,'database':state})
            print(case,'native queue recovery pass',flush=True)
    finally:
        paths=[json.loads(path.read_text())['archive']['path'] for path in out.glob('*/identity.json')]
        if paths:
            deleted=requests.delete(native['url']+'/object/gtfs-uploads',headers={'Authorization':'Bearer '+native['token']},json={'prefixes':paths},timeout=10)
            assert deleted.status_code==200,'Native queue object cleanup failed'
summary={'records':records,'syntheticDebugExpiry':os.environ.get('OPENPLAN_GTFS_PROOF_DEBUG_EXPIRY')=='1','sourceSha256':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in
 [root/'openplan/src/lib/gtfs/managed-worker-queue.ts',root/'openplan/src/lib/gtfs/managed-worker-intake.ts',root/'openplan/src/lib/gtfs/managed-worker-service.ts',migration,here/'verify_queue_native.mts',Path(__file__).resolve()]},
 'boundary':('Synthetic debug expiry, not real-clock acceptance. ' if os.environ.get('OPENPLAN_GTFS_PROOF_DEBUG_EXPIRY')=='1' else 'Actual server-clock expiry. ') + 'Actual database queue, process loss, live ownership recovery/replacement, local HTTP, Storage and parser. No application routes, full restore, capacity or browser acceptance.'}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
