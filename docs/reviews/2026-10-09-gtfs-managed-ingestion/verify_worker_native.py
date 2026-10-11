"""Read actual candidate SQL responses under service_role, roll back, then verify with TypeScript."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
config = json.loads(Path(sys.argv[1]).read_text())
assert config['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}', config['database'])
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
source = (root / 'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_text()
checks = '\n'.join((Path(__file__).parent / f'{name}-checks.sql').read_text() for name in ['admission','batch','completion','adoption','terminal','read'])
probe = '''
CREATE TEMP TABLE worker_snapshots(payload jsonb);
DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); receipt jsonb; version uuid; token uuid;
 attempt jsonb; claimed jsonb; status jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic worker response','worker-response-'||workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 FOR mode IN 1..3 LOOP
  SET LOCAL ROLE service_role;
  receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,2,2,mode=2);
  version:=(receipt->>'versionId')::uuid;
  RESET ROLE;
  SELECT c.token INTO token FROM openplan_gtfs.claims c WHERE version_id=version;
  SET LOCAL ROLE service_role;
  IF mode=3 THEN PERFORM public.cancel_gtfs_ingest(workspace,version,gen_random_uuid(),actor,'Synthetic bridge cancellation'); END IF;
  claimed:=public.claim_gtfs_ingest(version,token);
  attempt:=public.read_gtfs_ingest_attempt(version,token);
  status:=public.read_gtfs_ingest_status(workspace,version,actor);
  RESET ROLE;
  INSERT INTO worker_snapshots VALUES(jsonb_build_object('scope',jsonb_build_object('versionId',version,'token',token,'workspaceId',workspace),
   'claim',claimed,'attempt',attempt,'status',status));
 END LOOP;
END $proof$;
SELECT jsonb_agg(payload) FROM worker_snapshots;
ROLLBACK;
'''
command = ['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
result = subprocess.run(command,input=source.replace('BEGIN;', "BEGIN;\nSET LOCAL statement_timeout='15s';",1).replace('COMMIT;',checks+'\n'+probe),text=True,capture_output=True,timeout=30)
assert result.returncode == 0,result.stderr
payload = json.loads(result.stdout)
assert len(payload) == 3
(out/'snapshots.json').write_text(json.dumps(payload,indent=2)+'\n')
cleanup = subprocess.run(command,input="SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';",text=True,capture_output=True,timeout=10)
assert cleanup.returncode == 0 and cleanup.stdout.strip() == '0'
verified = subprocess.run(['node','--import',str(root/'openplan/node_modules/tsx/dist/loader.mjs'),str(Path(__file__).with_suffix('.mts')),str(out/'snapshots.json')],cwd=root/'openplan',text=True,capture_output=True,timeout=20)
(out/'verification.log').write_text(verified.stdout+verified.stderr)
assert verified.returncode == 0,verified.stderr
record = {'migrationSha256':hashlib.sha256(source.encode()).hexdigest(),
 'serviceSha256':hashlib.sha256((root/'openplan/src/lib/gtfs/managed-worker-service.ts').read_bytes()).hexdigest(),
 'checksSha256':hashlib.sha256(checks.encode()).hexdigest(),
 'snapshotsSha256':hashlib.sha256((out/'snapshots.json').read_bytes()).hexdigest(),
 'schemaAbsentAfterRollback':True,'result':json.loads(verified.stdout)}
(out/'native.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record['result']))
