"""Reproduce and reject mixed legacy/managed row-lock cycles in owned fixtures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from pathlib import Path
import hashlib,json,os,re,subprocess,sys,time,uuid
import psycopg2
from psycopg2.extras import Json
from psycopg2 import sql

here=Path(__file__).resolve().parent;root=here.parents[2]
config=json.loads(Path(sys.argv[1]).read_text());container=config['container']
assert container=='supabase_db_openplan-restore-target-2026091050'
assert os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER')==container
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}',config['database'])
out=Path(sys.argv[2]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
state=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
settings=dict(value.split('=',1) for value in state['Config']['Env'] if '=' in value)
port=state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
connections=[]
def connect(database,service=False):
    c=psycopg2.connect(host='127.0.0.1',port=port,dbname=database,user='postgres',password=settings['POSTGRES_PASSWORD'],
      connect_timeout=5,application_name='openplan-gtfs-lock-'+uuid.uuid4().hex,
      options='-c statement_timeout=8000 -c lock_timeout=6000')
    c.autocommit=True;connections.append(c)
    if service:
        with c.cursor() as cur:cur.execute('SET ROLE service_role')
    return c

def query(c,statement,args=()):
    with c.cursor() as cur:
        cur.execute(statement,args if args else None)
        return cur.fetchone()[0] if cur.description else None

def rpc(c,name,*args):
    statement=sql.SQL('SELECT public.{}({})').format(sql.Identifier(name),sql.SQL(',').join(sql.Placeholder() for _ in args))
    try:return {'value':query(c,statement,[Json(v) if isinstance(v,(dict,list)) else v for v in args]),'code':None}
    except psycopg2.Error as error:return {'value':None,'code':error.pgcode,'message':error.diag.message_primary}

control=connect('postgres')
assert query(control,'SELECT count(*) FROM pg_stat_activity WHERE datname=%s',(config['database'],))==0
candidate='openplan_attempt_cli_'+uuid.uuid4().hex
query(control,sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(candidate),sql.Identifier(config['database'])))
(out/'database.json').write_text(json.dumps({'container':container,'database':candidate})+'\n')
admin=connect(candidate);observer=connect(candidate);managed=connect(candidate,True);legacy=connect(candidate,True)
source=root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
text=source.read_text();assert text.count('-- Begin legacy feed lock order')==text.count('-- End legacy feed lock order')==1
fixed=text.split('-- Begin legacy feed lock order\n')[1].split('-- End legacy feed lock order')[0]
signatures={'promotion':'public.promote_gtfs_feed_version(uuid)','reaper':'public.reap_gtfs_feed_version(uuid,timestamp with time zone)',
            'closure':'public.close_failed_gtfs_version(uuid,text,text,text)'}
old={name:query(admin,'SELECT pg_get_functiondef(%s::regprocedure)',(sig,)) for name,sig in signatures.items()}
assert all('target_feed' not in definition for definition in old.values()), 'Use the recorded pre-fix candidate'
workspace,actor=str(uuid.uuid4()),str(uuid.uuid4())
query(admin,'INSERT INTO auth.users(id,email) VALUES(%s,%s)',(actor,actor+'@example.invalid'))
query(admin,'INSERT INTO public.workspaces(id,name,slug) VALUES(%s,%s,%s)',(workspace,'Synthetic mixed GTFS locks','mixed-'+workspace))
query(admin,"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(%s,%s,'owner')",(workspace,actor))

def setup(kind):
    if kind=='promotion':
        feed,version=str(uuid.uuid4()),str(uuid.uuid4())
        query(admin,'INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(%s,%s,%s)',(feed,workspace,'Synthetic legacy ready feed'))
        query(admin,"INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,route_count,stop_count,route_service_level_rows,stop_service_level_rows) VALUES(%s,%s,%s,'upload','ready',1,1,1,1)",(version,workspace,feed))
        query(admin,"INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method) VALUES(%s,%s,'synthetic',3,'monday',1,'scheduled')",(workspace,version))
        query(admin,"INSERT INTO public.gtfs_stop_service_levels(workspace_id,feed_version_id,stop_id,stop_name,latitude,longitude,service_day,trips_per_day,derivation_method) VALUES(%s,%s,'synthetic','Synthetic stop',13.4443,144.7937,'monday',1,'scheduled')",(workspace,version))
    else:
        url='https://example.invalid/'+uuid.uuid4().hex+'.zip'
        admitted=rpc(legacy,'admit_gtfs_ingest',str(uuid.uuid4()),workspace,actor,None,
          {'kind':'url','provisionalName':'Synthetic managed pending','sourceUrl':url,'normalizedSourceUrl':url})
        assert admitted['code'] is None,admitted
        feed,version=admitted['value']['feedId'],admitted['value']['versionId']
    return feed,version

def exercise(kind):
    feed,version=setup(kind)
    managed.autocommit=False
    query(managed,'SELECT id FROM public.gtfs_feeds WHERE id=%s FOR UPDATE',(feed,))
    with ThreadPoolExecutor(max_workers=1) as pool:
        if kind=='promotion':future=pool.submit(rpc,legacy,'promote_gtfs_feed_version',version)
        elif kind=='reaper':future=pool.submit(rpc,legacy,'reap_gtfs_feed_version',version,datetime.now(timezone.utc)+timedelta(days=1))
        else:future=pool.submit(rpc,legacy,'close_failed_gtfs_version',version,'synthetic_failure','Synthetic held legacy close',None)
        try:
            deadline=time.monotonic()+4;blocked=False
            while time.monotonic()<deadline:
                state=query(admin,"SELECT jsonb_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=%s",(legacy.get_backend_pid(),))
                if state and state['wait']=='Lock' and managed.get_backend_pid() in state['blockers']:
                    blocked=True;break
                assert not future.done(),('Legacy command did not block',future.result())
                time.sleep(.02)
            assert blocked,'Expected feed lock wait was not observed'
            if kind=='promotion':result=rpc(managed,'adopt_gtfs_ingest',workspace,version,str(uuid.uuid4()),actor,None)
            else:result=rpc(managed,'cancel_gtfs_ingest',workspace,version,str(uuid.uuid4()),actor,'Synthetic lock-order cancellation')
            if result['code'] is None:managed.commit()
            else:managed.rollback()
        finally:
            managed.rollback();managed.autocommit=True
        other=future.result(timeout=8)
    return {'kind':kind,'blockedOnManagedTransaction':blocked,'managed':result,'legacy':other,'version':version,'feed':feed}

def require_success(result):
    assert '40P01' not in [result['managed']['code'],result['legacy']['code']], 'Mixed lifecycle deadlocked'
    assert result['managed']['code'] is None and result['legacy']['code'] is None,result
    if result['kind']=='promotion':
        assert result['managed']['value']['adopted'] is True
        observed=query(admin,"SELECT jsonb_build_object('pointer',f.current_version_id,'currentCount',(SELECT count(*) FROM public.gtfs_feed_versions v WHERE v.feed_id=f.id AND is_current),'status',f.status) FROM public.gtfs_feeds f WHERE id=%s",(result['feed'],))
        assert observed=={'pointer':result['version'],'currentCount':1,'status':'ready'},observed
    else:
        assert result['managed']['value']['state']=='cancelled'
        assert result['legacy']['value'] is False if result['kind']=='reaper' else result['legacy']['value']['recorded'] is False
        assert query(admin,'SELECT state FROM openplan_gtfs.executions WHERE version_id=%s',(result['version'],))=='cancelled'
    assert query(admin,'SELECT count(*) FROM openplan_gtfs.write_context')==0

def moved_version(kind):
    feed,version=setup("promotion")
    if kind!="promotion":query(admin,"UPDATE public.gtfs_feed_versions SET status='pending' WHERE id=%s",(version,))
    destination=str(uuid.uuid4())
    query(admin,'INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(%s,%s,%s)',(destination,workspace,'Synthetic moved destination'))
    admin.autocommit=False
    query(admin,'SELECT id FROM public.gtfs_feeds WHERE id=%s FOR UPDATE',(feed,))
    with ThreadPoolExecutor(max_workers=1) as pool:
        if kind=='promotion':future=pool.submit(rpc,legacy,'promote_gtfs_feed_version',version)
        elif kind=='reaper':future=pool.submit(rpc,legacy,'reap_gtfs_feed_version',version,datetime.now(timezone.utc)+timedelta(days=1))
        else:future=pool.submit(rpc,legacy,'close_failed_gtfs_version',version,'synthetic_failure','Synthetic moved version',None)
        try:
            deadline=time.monotonic()+4;blocked=False
            while time.monotonic()<deadline:
                state=query(observer,"SELECT jsonb_build_object('wait',wait_event_type,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=%s",(legacy.get_backend_pid(),))
                if state and state['wait']=='Lock' and admin.get_backend_pid() in state['blockers']:
                    blocked=True;break
                assert not future.done(),('Moved-version command did not wait',future.result())
                time.sleep(.02)
            assert blocked,'Moved-version feed wait not observed'
            query(admin,'UPDATE public.gtfs_feed_versions SET feed_id=%s WHERE id=%s',(destination,version))
            admin.commit()
        finally:
            admin.rollback();admin.autocommit=True
        result=future.result(timeout=8)
    observed=query(admin,"SELECT jsonb_build_object('feed',feed_id,'status',status,'current',is_current,'closed',ingest_closed_at,'abandoned',ingest_abandoned_at) FROM public.gtfs_feed_versions WHERE id=%s",(version,))
    return {'kind':kind,'result':result,'observed':observed,'destination':destination,'blockedBeforeMove':True}

def require_move_refusal(result):
    kind=result['kind'];reply=result['result']
    refused=(reply['code']=='P0002') if kind=='promotion' else (reply['code'] is None and
      (reply['value'] is False if kind=='reaper' else reply['value']=={'recorded':False,'feedStatusChanged':False}))
    assert refused,'Moved version did not refuse at association recheck'
    assert result['observed']=={'feed':result['destination'],'status':'ready' if kind=='promotion' else 'pending',
      'current':False,'closed':None,'abandoned':None},'Moved version changed after refusal'

records=[]
move_records=[]
try:
    # The prior implementations must actually reproduce a deadlock first.
    for kind in signatures:
        result=exercise(kind)
        assert '40P01' in [result['managed']['code'],result['legacy']['code']],('Counterexample did not reproduce',result)
        records.append({'case':'before-'+kind,'expected':'native deadlock','result':result})
    for label,definition in [('fixed',fixed),('harmless',fixed+'\n-- Harmless lock-order comment.\n')]:
        query(admin,definition)
        for kind in signatures:
            result=exercise(kind);require_success(result)
            records.append({'case':label+'-'+kind,'expected':'success','result':result})
    for kind,definition in old.items():
        query(admin,fixed);query(admin,definition)
        result=exercise(kind)
        try:require_success(result)
        except AssertionError as error:
            assert str(error)=='Mixed lifecycle deadlocked',(kind,str(error))
            records.append({'case':'reverse-'+kind,'expected':'intended assertion failure','assertion':str(error),'result':result})
        else:raise AssertionError('Reversed lock order survived '+kind)
    query(admin,fixed)
    for kind in signatures:
        result=exercise(kind);require_success(result)
        records.append({'case':'restored-'+kind,'expected':'success','result':result})
    for label in ['fixed','harmless']:
        query(admin,fixed+('\n-- Harmless association comment.' if label=='harmless' else ''))
        for kind in signatures:
            result=moved_version(kind);require_move_refusal(result)
            move_records.append({'case':label+'-'+kind,'expected':'refusal','result':result})
    for kind,signature in signatures.items():
        query(admin,fixed)
        definition=query(admin,'SELECT pg_get_functiondef(%s::regprocedure)',(signature,))
        target='AND feed_id=v_feed_id' if kind=='promotion' else 'AND candidate.feed_id=target_feed'
        assert definition.count(target)==1
        query(admin,definition.replace(target,''))
        result=moved_version(kind)
        try:require_move_refusal(result)
        except AssertionError as error:
            assert str(error)=='Moved version did not refuse at association recheck'
            move_records.append({'case':'omit-recheck-'+kind,'expected':'intended assertion failure','assertion':str(error),'result':result})
        else:raise AssertionError('Removed association recheck survived '+kind)
    query(admin,fixed)
    for kind in signatures:
        result=moved_version(kind);require_move_refusal(result)
        move_records.append({'case':'restored-'+kind,'expected':'refusal','result':result})
    privileges={name:query(admin,"SELECT jsonb_build_object('anon',has_function_privilege('anon',%s,'EXECUTE'),'authenticated',has_function_privilege('authenticated',%s,'EXECUTE'),'service',has_function_privilege('service_role',%s,'EXECUTE'))",(sig,sig,sig)) for name,sig in signatures.items()}
    assert all(value=={'anon':False,'authenticated':False,'service':True} for value in privileges.values())
finally:
    # Restore the verified replacements in this owned clone, even on failure.
    try:query(admin,fixed)
    finally:
        for connection in connections:connection.close()
record={'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'proofSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'previousFunctionHashes':{key:hashlib.sha256(value.encode()).hexdigest() for key,value in old.items()},
        'cases':records,'associationCases':move_records,'privileges':privileges,
        'scope':'Actual two-connection service-role commands with an explicit feed-lock interleaving, native deadlock counterexamples and single-function reversals. Synthetic fixtures; not every direct SQL caller, reverse initial schedule, HTTP load or browser acceptance.'}
(out/'lock-order.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'cases':len(records),'nativeCounterexamples':3,'fixedHarmlessRestored':9,'reversalsCaught':3,'associationCases':len(move_records),'privilegesPreserved':True}))
