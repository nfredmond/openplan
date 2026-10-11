"""Measure upload completion after managed cancellation on an owned Storage clone.

This is a counterexample, not a production upload policy or cleanup solution.
Only the owned clone receives the temporary anonymous policy and synthetic rows.
"""
from pathlib import Path
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json
import requests

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent/'2026-10-09-gtfs-ingest-recovery'))
from isolated_storage import storage

config = json.loads(Path(sys.argv[1]).read_text())
assert config['container'] == 'supabase_db_openplan-restore-target-2026091050'
assert os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER') == config['container']
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}', config['database'])
archive = Path(sys.argv[2]).read_bytes()
assert 64_000 < len(archive) < 2_000_000, 'Use the bounded public publisher fixture'
out = Path(sys.argv[3]).resolve()
out.mkdir(mode=0o700, parents=True, exist_ok=False)
state = json.loads(subprocess.check_output(['docker','inspect',config['container']], text=True))[0]
settings = dict(value.split('=',1) for value in state['Config']['Env'] if '=' in value)
port = state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']

def connect(database, service=False):
    connection = psycopg2.connect(host='127.0.0.1', port=port, dbname=database,
        user='postgres', password=settings['POSTGRES_PASSWORD'], connect_timeout=5,
        options='-c statement_timeout=10000 -c lock_timeout=5000')
    connection.autocommit = True
    if service:
        with connection.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
    return connection

def query(connection, statement, args=None):
    with connection.cursor() as cursor:
        cursor.execute(statement, args)
        return cursor.fetchone()[0] if cursor.description else None

control = connect('postgres')
assert query(control, 'SELECT count(*) FROM pg_stat_activity WHERE datname=%s', (config['database'],)) == 0
database = 'openplan_attempt_cli_'+uuid.uuid4().hex
query(control, sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(config['database'])))
control.close()
config = {**config, 'database':database}
(out/'database.json').write_text(json.dumps(config)+'\n')
admin, service = connect(database), connect(database, True)
workspace, actor = str(uuid.uuid4()), str(uuid.uuid4())
query(admin, 'INSERT INTO auth.users(id,email) VALUES(%s,%s)', (actor, actor+'@example.invalid'))
query(admin, 'INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)',
      (workspace, 'Synthetic late upload', 'late-'+workspace))
query(admin, "INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')", (workspace, actor))

# Scope the temporary policy to this synthetic workspace and currently open imports.
# SECURITY DEFINER reads private execution state; no real user is impersonated.
predicate = """SELECT EXISTS (
 SELECT 1 FROM openplan_gtfs.executions e
 JOIN public.gtfs_feed_versions v ON v.id=e.version_id
 WHERE v.workspace_id='%s'::uuid AND e.archive_identity->>'path'=object_name
 AND e.state='awaiting_archive' AND v.ingest_closed_at IS NULL
)""" % workspace
function = """CREATE OR REPLACE FUNCTION openplan_gtfs.proof_upload_allowed(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
%s
$body$;"""
query(admin, function % predicate)
query(admin, """REVOKE ALL ON FUNCTION openplan_gtfs.proof_upload_allowed(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA openplan_gtfs TO anon;
GRANT EXECUTE ON FUNCTION openplan_gtfs.proof_upload_allowed(text) TO anon;
CREATE POLICY proof_late_upload ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id='gtfs-uploads' AND openplan_gtfs.proof_upload_allowed(name));""")

def admit():
    source = {'kind':'upload','provisionalName':'Synthetic late upload',
              'uploadSha256':hashlib.sha256(archive).hexdigest(),'uploadBytes':len(archive)}
    row = query(service, 'SELECT public.admit_gtfs_ingest(%s,%s,%s,NULL,%s)',
                (str(uuid.uuid4()),workspace,actor,Json(source)))
    return row['versionId'], f"{workspace}/{row['feedId']}/{row['versionId']}.zip"

def cancel(version):
    row = query(service, 'SELECT public.cancel_gtfs_ingest(%s,%s,%s,%s,%s)',
                (workspace,version,str(uuid.uuid4()),actor,'Synthetic held upload cancellation'))
    assert row['state'] == 'cancelled', 'Native cancellation did not close the import'

def check_absent_cleanup(native, headers, version, path):
    queued = query(service, 'SELECT storage_path FROM public.gtfs_ingest_storage_cleanup WHERE version_id=%s', (version,))
    assert queued == path, 'Cancellation did not retain cleanup identity'
    response = requests.delete(native['url']+'/object/gtfs-uploads', headers=headers,
                               json={'prefixes':[path]}, timeout=10)
    assert response.status_code == 200, 'Storage refused the cleanup request'
    assert response.json() == [], 'Held upload already had a completed metadata row'
    # Execute the same acknowledgement predicate as persist.ts, after actual API success.
    acknowledged = query(service, 'DELETE FROM public.gtfs_ingest_storage_cleanup WHERE version_id=%s AND storage_path=%s RETURNING version_id', (version,path))
    assert str(acknowledged) == version

def exercise(native, mode):
    version, path = admit()
    admin_headers = {'Authorization':'Bearer '+native['token']}
    token = native['token'] if mode == 'service-late' else native['anon_token']
    headers = {'Authorization':'Bearer '+token,'Content-Type':'application/zip','x-upsert':'false'}
    if mode == 'closed-before-start':
        cancel(version)
        try:
            response = requests.post(native['url']+'/object/gtfs-uploads/'+path,
                                     headers=headers,data=archive,timeout=10)
            assert response.status_code == 400 and str(response.json().get('statusCode')) == '403', 'Closed import was allowed to start'
            return {'case':mode,'http':response.status_code,'storageCode':response.json()['statusCode']}
        finally:
            removed = requests.delete(native['url']+'/object/gtfs-uploads',headers=admin_headers,
                                      json={'prefixes':[path]},timeout=10)
            assert removed.status_code == 200, 'Closed-start fixture cleanup failed'
    target = urlsplit(native['url'])
    connection = http.client.HTTPConnection(target.hostname,target.port,timeout=10)
    before = set(Path(native['object_directory']).rglob('*'))
    try:
        connection.putrequest('POST','/object/gtfs-uploads/'+path)
        for key,value in headers.items():
            connection.putheader(key,value)
        connection.putheader('Content-Length',str(len(archive)))
        connection.endheaders()
        split = len(archive)//2
        connection.send(archive[:split])
        deadline = time.monotonic()+4
        staged = []
        while time.monotonic() < deadline:
            staged = [p for p in set(Path(native['object_directory']).rglob('*'))-before
                      if p.is_file() and p.stat().st_size > 0 and version in str(p)]
            if staged:
                break
            time.sleep(.02)
        assert staged, 'Upload never reached the owned file backend'
        assert query(admin, 'SELECT count(*) FROM storage.objects WHERE bucket_id=%s AND name=%s', ('gtfs-uploads',path)) == 0
        late = mode.endswith('-late')
        if late:
            cancel(version)
            assert query(admin, 'SELECT openplan_gtfs.proof_upload_allowed(%s)', (path,)) is False
            check_absent_cleanup(native,admin_headers,version,path)
        connection.send(archive[split:])
        response = connection.getresponse()
        body = json.loads(response.read())
        assert response.status == 200, ('Expected completed upload',response.status,body)
        downloaded = requests.get(native['url']+'/object/authenticated/gtfs-uploads/'+path,
                                  headers=admin_headers,timeout=10)
        assert downloaded.status_code == 200 and hashlib.sha256(downloaded.content).digest() == hashlib.sha256(archive).digest(), 'Completed object bytes differ'
        row = query(admin, "SELECT jsonb_build_object('state',e.state,'status',v.status,'cleanupRows',(SELECT count(*) FROM public.gtfs_ingest_storage_cleanup WHERE version_id=v.id),'objectRows',(SELECT count(*) FROM storage.objects WHERE bucket_id='gtfs-uploads' AND name=%s)) FROM openplan_gtfs.executions e JOIN public.gtfs_feed_versions v ON v.id=e.version_id WHERE v.id=%s", (path,version))
        if late:
            assert row['state'] == 'cancelled' and row['cleanupRows'] == 0 and row['objectRows'] == 1, 'Late orphan counterexample did not occur'
        return {'case':mode,'http':response.status,'bytes':len(downloaded.content),
                'bodyObservedBeforeCancellation':late,'after':row}
    finally:
        connection.close()
        removed = requests.delete(native['url']+'/object/gtfs-uploads',headers=admin_headers,json={'prefixes':[path]},timeout=10)
        assert removed.status_code == 200, 'Owned fixture cleanup failed'

records = []
try:
    with storage(config) as native:
        for variant, expression, failure in [
            ('baseline',predicate,None),
            ('harmless',predicate+'\n-- Synthetic comment control',None),
            ('deny-live','SELECT false','Upload never reached the owned file backend'),
            ('allow-closed','SELECT true','Closed import was allowed to start'),
            ('restored',predicate,None),
        ]:
            query(admin, function % expression)
            runs = []
            try:
                for mode in ['closed-before-start','anonymous-live','service-late','anonymous-late']:
                    runs.append(exercise(native,mode))
            except AssertionError as error:
                if failure is None or str(error) != failure:
                    raise
                records.append({'variant':variant,'result':'expected assertion failure','message':str(error),'cases':runs})
            else:
                assert failure is None, 'Broken policy escaped its intended control'
                records.append({'variant':variant,'result':'pass','cases':runs})
        result = {'storageImage':native['image'],'postgres':query(admin,'SHOW server_version'),
                  'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
                  'fixtureSha256':hashlib.sha256(archive).hexdigest(),
                  'runnerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'helperSha256':hashlib.sha256((here.parent/'2026-10-09-gtfs-ingest-recovery/isolated_storage.py').read_bytes()).hexdigest(),
                  'records':records}
finally:
    query(admin, 'DROP POLICY IF EXISTS proof_late_upload ON storage.objects; DROP FUNCTION openplan_gtfs.proof_upload_allowed(text); REVOKE USAGE ON SCHEMA openplan_gtfs FROM anon;')
    assert query(admin, "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND policyname='proof_late_upload'") == 0
    assert query(admin, "SELECT has_schema_privilege('anon','openplan_gtfs','USAGE')") is False
    service.close()
    admin.close()

# Publish success only after the owned container, files and temporary policy close.
assert not Path(native['object_directory']).exists(), 'Owned temporary files remain'
result['temporaryResourcesRemoved'] = True
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
