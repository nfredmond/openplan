"""Fresh-process intake recovery on one retained isolated candidate clone."""
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
sys.path.insert(0, str(here.parent / '2026-10-09-gtfs-ingest-recovery'))
sys.path.insert(0, str(here.parent / '2026-10-08-model-custody-metadata/prototype'))
from isolated_storage import storage
from isolated_postgrest import gateway

source = json.loads(Path(sys.argv[1]).read_text())
assert source['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', source['database'])
archive = Path(sys.argv[2]).resolve(strict=True)
out = Path(sys.argv[3]).resolve(); out.mkdir(mode=0o700, parents=True, exist_ok=False)
config = {**source, 'database': 'openplan_attempt_cli_' + uuid.uuid4().hex}
(out / 'database.json').write_text(json.dumps(config) + '\n'); (out / 'database.json').chmod(0o600)

def sql(query, database=None):
    result = subprocess.run(['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres', '-d', database or config['database'],
                             '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query, text=True, capture_output=True, timeout=30)
    if result.returncode: raise RuntimeError(result.stderr[:3000])
    return result.stdout.strip()

assert sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();", source['database']) == '0'
sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};', 'postgres')
assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';") == '1'
workspace, actor = str(uuid.uuid4()), str(uuid.uuid4())
sql(f"""INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic native source intake','proof-{workspace}');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');""")

def snapshot(version):
    version = str(uuid.UUID(version))
    return json.loads(sql(f"""SELECT jsonb_build_object(
      'status',(SELECT status FROM public.gtfs_feed_versions WHERE id='{version}'),
      'current',(SELECT is_current FROM public.gtfs_feed_versions WHERE id='{version}'),
      'routes',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}'),
      'stops',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id='{version}'),
      'batches',(SELECT count(*) FROM openplan_gtfs.batch_receipts WHERE version_id='{version}'),
      'completion',(SELECT count(*) FROM openplan_gtfs.completion_receipts WHERE version_id='{version}'),
      'sha256',(SELECT checksum_sha256 FROM public.gtfs_feed_versions WHERE id='{version}'));"""))

def check(row):
    assert row['status'] == 'ready', 'Native intake is not ready'
    assert row['current'] is False, 'Native completion adopted without review'
    assert row['routes'] == 95 and row['stops'] == 717, 'Native source publication incomplete'
    assert row['batches'] == 9 and row['completion'] == 1, 'Native receipt set differs'
    assert row['sha256'] == hashlib.sha256(archive.read_bytes()).hexdigest(), 'Native source hash differs'

records = []
with storage(config) as native, gateway('public', database=config['database'], subjects=(actor,)) as rest:
    env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=512', 'OPENPLAN_PROOF_HTTP_URL': rest['url'],
           'OPENPLAN_PROOF_HTTP_TOKEN': rest['service_token'], 'OPENPLAN_PROOF_STORAGE_URL': native['url'],
           'OPENPLAN_PROOF_STORAGE_TOKEN': native['token'], 'OPENPLAN_PROOF_WORKSPACE': workspace, 'OPENPLAN_PROOF_ACTOR': actor,
           'OPENPLAN_PROOF_PARSER_BUILD': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()}
    try:
        for boundary in ['local', 'prepare', 'upload', 'confirm']:
            directory = out / boundary
            def run(mode):
                child = subprocess.Popen(['node', '--import', str(root/'openplan/node_modules/tsx/dist/loader.mjs'),
                    str(here/'verify_intake_native.mts'), str(directory), mode, str(archive)], cwd=root/'openplan', env=env,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                try:
                    if mode.startswith('interrupt-'):
                        deadline = time.monotonic() + 40
                        while not (directory/'interrupted.json').exists() and child.poll() is None and time.monotonic() < deadline: time.sleep(.05)
                        assert (directory/'interrupted.json').exists(), 'Native intake did not reach interruption boundary'
                        os.killpg(child.pid, signal.SIGKILL)
                    stdout, stderr = child.communicate(timeout=60)
                    (directory/f'{mode}.log').write_text(stdout + stderr)
                    assert child.returncode == (-signal.SIGKILL if mode.startswith('interrupt-') else 0), (mode, stderr[:3000])
                    return json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else None
                finally:
                    if child.poll() is None: os.killpg(child.pid, signal.SIGKILL); child.communicate(timeout=5)
            run('seed')
            run('interrupt-' + boundary)
            identity = json.loads((directory/'identity.json').read_text())
            interrupted = json.loads((directory/'interrupted.json').read_text())
            assert interrupted['sourceRequests'] == 1, 'Initial source intake did not use actual HTTP'
            assert interrupted['uploads'] == (1 if boundary in ['upload', 'confirm'] else 0), 'Unexpected interruption upload count'
            resumed = run('resume-before-upload' if boundary in ['local', 'prepare'] else 'resume-after-upload')
            ready = snapshot(identity['versionId']); check(ready)
            retained = run('retained'); assert snapshot(identity['versionId']) == ready, 'Retained replay changed publication'
            # Exercise each observation guard with a harmless copy and broken facts.
            check({**ready})
            controls = []
            for field, value in [('status','failed'), ('current',True), ('routes',94), ('stops',716), ('batches',8), ('completion',2), ('sha256','0'*64)]:
                try: check({**ready, field: value})
                except AssertionError as error: controls.append({'field':field,'result':'expected assertion failure','message':str(error)})
                else: raise AssertionError('Observation control survived: ' + field)
            records.append({'boundary':boundary,'interrupted':interrupted,'resumed':resumed,'retained':retained,'database':ready,'controls':controls})
            print(boundary, 'native recovery pass', flush=True)
    finally:
        paths = [json.loads(path.read_text())["archive"]["path"] for path in out.glob("*/identity.json")]
        if paths:
            deleted = requests.delete(native["url"] + "/object/gtfs-uploads", headers={"Authorization":"Bearer " + native["token"]}, json={"prefixes":paths}, timeout=10)
            assert deleted.status_code == 200, "Native proof object cleanup failed"

summary = {'records':records,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
           'sourceSha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in
             [root/'openplan/src/lib/gtfs/managed-worker-intake.ts', here/'verify_intake_native.mts', Path(__file__).resolve()]},
           'boundary':'Actual local HTTP, PostgreSQL, PostgREST, Storage and parser. Controlled public DNS/transport mapping. No public TLS, browser, power-loss, full restore or capacity acceptance.'}
(out/'result.json').write_text(json.dumps(summary, indent=2) + '\n')
