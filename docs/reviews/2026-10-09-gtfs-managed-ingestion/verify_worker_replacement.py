"""Observe real PostgreSQL blocking and stale-write refusal in both lock orders."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
import psycopg2
from psycopg2.extras import Json
from psycopg2 import sql

here=Path(__file__).resolve().parent
root=here.parents[2]
config=json.loads(Path(sys.argv[1]).read_text())
assert config['container']=='supabase_db_openplan-restore-target-2026091050'
assert os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER')==config['container']
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}',config['database'])
out=Path(sys.argv[2]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
state=json.loads(subprocess.check_output(['docker','inspect',config['container']],text=True))[0]
settings=dict(value.split('=',1) for value in state['Config']['Env'] if '=' in value)
port=state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
connections=[]
def connect(service=False):
    conn=psycopg2.connect(host='127.0.0.1',port=port,dbname=config['database'],user='postgres',
                         password=settings['POSTGRES_PASSWORD'],connect_timeout=5,
                         application_name='openplan-gtfs-replacement-'+uuid.uuid4().hex,
                         options='-c statement_timeout=8000 -c lock_timeout=6000')
    conn.autocommit=True;connections.append(conn)
    if service:
        with conn.cursor() as cur:cur.execute('SET ROLE service_role')
    return conn

def query(conn, statement, values=()):
    with conn.cursor() as cur:
        cur.execute(statement,values)
        return cur.fetchone()[0] if cur.description else None

def rpc(conn,name,*args):
    query_text=sql.SQL('SELECT public.{}({})').format(sql.Identifier(name),sql.SQL(',').join(sql.Placeholder() for _ in args))
    return query(conn,query_text,[Json(value) if isinstance(value,(dict,list)) else value for value in args])

admin=connect();first=connect(True);second=connect(True)
actual=query(admin,'SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations')
expected=sorted(path.name.split('_')[0] for path in (root/'openplan/supabase/migrations').glob('*.sql'))
assert actual==expected, 'Use the complete CLI-upgraded candidate database'
workspace,actor=str(uuid.uuid4()),str(uuid.uuid4())
query(admin,'INSERT INTO auth.users(id,email) VALUES(%s,%s)',(actor,actor+'@example.invalid'))
query(admin,'INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)',(workspace,'Synthetic lease ordering','lease-'+workspace))
query(admin,"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')",(workspace,actor))
plan={'sha256':'a'*64,'bytes':100,'routeRows':1,'stopRows':1,'routeBatches':1,'stopBatches':1}

def setup():
    source_url='https://example.invalid/'+uuid.uuid4().hex+'.zip'
    admitted=rpc(first,'admit_gtfs_ingest',str(uuid.uuid4()),workspace,actor,None,
                 {'kind':'url','provisionalName':'Synthetic lease fixture','sourceUrl':source_url,
                  'normalizedSourceUrl':source_url})
    version=admitted['versionId'];token=str(uuid.uuid4())
    assert rpc(first,'claim_gtfs_ingest',version,token)['active'] is True
    assert rpc(second,'claim_gtfs_ingest',version,str(uuid.uuid4())) is None, 'Live owner replaced'
    rpc(first,'stage_gtfs_ingest',version,token,'fetching')
    archive={'path':workspace+'/'+admitted['feedId']+'/'+version+'.zip','sha256':'b'*64,'bytes':100}
    rpc(first,'prepare_gtfs_archive',version,token,archive)
    rpc(first,'confirm_gtfs_archive',version,token,archive)
    rpc(first,'stage_gtfs_ingest',version,token,'parsing')
    rpc(first,'prepare_gtfs_derived',version,token,plan)
    return version,token

def row(version,name):
    return {'workspace_id':workspace,'feed_version_id':version,'route_id':name,'route_type':3,'service_day':'monday',
            'trips_per_day':1,'derivation_method':'scheduled','scheduled_trips':1,'frequency_trips':0,
            'stops_served':1,'peak_headway_is_lower_bound':False,'median_headway_basis':'not_determined_too_few_departures',
            'departures_beyond_bin_range':0}

def write(conn,version,token,name):
    try:
        receipt=rpc(conn,'write_gtfs_ingest_batch',version,token,str(uuid.uuid4()),'route',0,[row(version,name)])
        return {'receipt':receipt,'code':None}
    except psycopg2.Error as error:
        return {'receipt':None,'code':error.pgcode,'message':error.diag.message_primary}

def wait_for_lock(waiter,blocker,future):
    deadline=time.monotonic()+4
    while time.monotonic()<deadline:
        state=query(admin,"SELECT jsonb_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=%s",(waiter.get_backend_pid(),))
        if state and state['wait']=='Lock' and blocker.get_backend_pid() in state['blockers']:
            return {'waitEventType':state['wait'],'expectedBlockerObserved':True}
        assert not future.done(), 'Contending command did not wait on the owned transaction'
        time.sleep(.02)
    raise AssertionError('Expected native row-lock contention not observed')

def rows(version):
    return query(admin,"SELECT coalesce(jsonb_agg(jsonb_build_object('route',route_id,'trips',trips_per_day) ORDER BY route_id),'[]') FROM public.gtfs_route_service_levels WHERE feed_version_id=%s",(version,))

def require_replacement_rows(value):
    assert value==[{'route':'replacement','trips':1}], 'Replacement rows contain stale work'

cases=[]
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        for order in ['old-batch-first','replacement-claim-first']:
            version,old=setup();new=str(uuid.uuid4())
            if order=='old-batch-first':
                first.autocommit=False
                initial_write=write(first,version,old,'original')
                assert initial_write['code'] is None, initial_write
                # Advance only this synthetic attempt's lease within the open
                # transaction. No wall-clock wait or unrelated execution changes.
                query(first,'RESET ROLE')
                query(first,"UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=%s",(version,))
                query(first,'SET LOCAL ROLE service_role')
                future=pool.submit(rpc,second,'claim_gtfs_ingest',version,new)
                try:
                    blocking=wait_for_lock(second,first,future)
                finally:
                    first.commit();first.autocommit=True
                    query(first,'SET ROLE service_role')
                claimed=future.result(timeout=8)
                assert claimed['active'] is True and claimed['claim']['attempt']==2
                assert rows(version)==[{'route':'original','trips':1}], 'Old transaction did not commit before replacement'
            else:
                initial_write=write(first,version,old,'original')
                assert initial_write['code'] is None, initial_write
                query(admin,"UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=%s",(version,))
                second.autocommit=False
                claimed=rpc(second,'claim_gtfs_ingest',version,new)
                assert claimed['active'] is True and claimed['claim']['attempt']==2
                future=pool.submit(write,first,version,old,'late-old')
                try:
                    blocking=wait_for_lock(first,second,future)
                finally:
                    second.commit();second.autocommit=True
                refused=future.result(timeout=8)
                assert refused['code']=='55000' and refused['message']=='GTFS attempt no longer owns batch', 'Stale batch crossed replacement'
            assert rpc(first,'renew_gtfs_ingest',version,old) is False, 'Expired owner renewed'
            old_claim=rpc(first,'claim_gtfs_ingest',version,old)
            assert old_claim['active'] is False and old_claim['claim']['attempt']==1
            assert rpc(first,'read_gtfs_ingest_attempt',version,old)['active'] is False
            prepared=rpc(second,'prepare_gtfs_derived',version,new,plan)
            assert prepared['removedRoutes']==1 and prepared['removedStops']==0
            assert write(second,version,new,'replacement')['code'] is None
            refused=write(first,version,old,'late-old')
            assert refused['code']=='55000' and refused['message']=='GTFS attempt no longer owns batch'
            require_replacement_rows(rows(version))
            assert query(admin,'SELECT count(*) FROM openplan_gtfs.write_context')==0
            controls=[]
            for name,change,passes in [('harmless',"UPDATE public.gtfs_route_service_levels SET created_at=created_at",True),
                                       ('stale-row',"UPDATE public.gtfs_route_service_levels SET route_id='late-old'",False)]:
                admin.autocommit=False
                try:
                    query(admin,"SET LOCAL session_replication_role='replica'")
                    query(admin,change+' WHERE feed_version_id=%s',(version,))
                    try:require_replacement_rows(rows(version))
                    except AssertionError as error:
                        assert not passes and str(error)=='Replacement rows contain stale work'
                        controls.append({'name':name,'result':'intended assertion failure'})
                    else:
                        assert passes,'Stale data observation was vacuous'
                        controls.append({'name':name,'result':'pass'})
                finally:
                    admin.rollback();admin.autocommit=True
            require_replacement_rows(rows(version))
            cases.append({'order':order,'blocking':blocking,'claimAttempt':claimed['claim']['attempt'],
                          'oldRenewalRefused':True,'oldClaimInactive':True,'oldWriteCode':refused['code'],
                          'removedRoutes':prepared['removedRoutes'],'rows':rows(version),'observationControls':controls})
    signatures=['public.claim_gtfs_ingest(uuid,uuid,integer)','public.renew_gtfs_ingest(uuid,uuid,integer)',
                'public.write_gtfs_ingest_batch(uuid,uuid,uuid,text,integer,jsonb)','public.prepare_gtfs_derived(uuid,uuid,jsonb)']
    definitions={signature:hashlib.sha256(query(admin,'SELECT pg_get_functiondef(%s::regprocedure)',(signature,)).encode()).hexdigest() for signature in signatures}
finally:
    for connection in connections:connection.close()
record={'migrationSha256':hashlib.sha256((root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_bytes()).hexdigest(),
        'proofSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'installedFunctionHashes':definitions,
        'migrationRecords':len(actual),'cases':cases,
        'scope':'Actual service-role SQL commands and observed two-connection PostgreSQL contention. Fixture lease expiry is explicitly advanced. Synthetic archive declarations, not Storage verification, HTTP contention, full replacement worker processing or mixed legacy/managed promotion.'}
(out/'replacement.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'ordersVerified':len(cases),'nativeBlockingObserved':True,'staleWritesRefused':True,'migrationRecords':len(actual)}))
