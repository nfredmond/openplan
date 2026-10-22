"""Private fixtures and replaced I/O only. No real service, git mutation or npm."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
FIX=PRIVATE/'fixtures-05'
FIX.mkdir(mode=0o700)
SOURCE=(PUBLIC/'templates/app_binding_v1.py').read_bytes()

def load(data):
    module=types.ModuleType('binding_fixture')
    module.__file__=str(FIX/'app_binding_v1.py')
    exec(compile(data,module.__file__,'exec'),module.__dict__)
    return module

m=load(SOURCE)
real_root=m.ROOT; real_frozen=m.FROZEN
# These two actual consumers only read files. No helper CLI/failure writer runs.
real=m.load_recovery()
try:real.active_receipts()
except ValueError as e:
    assert str(e)=='recovery-state:complete'
else:pass  # Parent may complete its separately authorized transition while preparation runs.
original_policy=real.p

for name in ['app_binding_v1.py','app-env-private.json','app-v1.env','migrations.json','dependency-binding.json','binding-private.json','recovery-active-binding.json','attest_start_v1.py']:
    shutil.copyfile(PRIVATE/name,FIX/name);(FIX/name).chmod(0o600)
(FIX/'execution').mkdir(mode=0o700)
(FIX/'candidate/openplan/supabase/migrations').mkdir(parents=True)
(FIX/'frozen/rest-uri-recovery-01').mkdir(parents=True)
app=FIX/'candidate/openplan';frozen=FIX/'frozen';run=FIX/'execution'
for f in ['package-lock.json','package.json']:
    shutil.copyfile(PUBLIC.parents[2]/'openplan'/f,app/f)
for rel in json.loads((FIX/'migrations.json').read_bytes()):
    shutil.copyfile(PUBLIC.parents[2]/rel,FIX/'candidate'/rel)
shutil.copyfile(PRIVATE/'migrations.json',frozen/'candidate-migrations.json')
shutil.copyfile(PRIVATE/'app-v1.env',app/'.env.local');(app/'.env.local').chmod(0o600)
(app/'node_modules').symlink_to(m.DEPS,target_is_directory=True)
old=json.loads((real_frozen/'app-env-private.json').read_bytes())
# Only synthetic credentials go into fixture acquisition records.
old={key:('fixture-key' if key not in ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_APP_URL','OPENPLAN_COMMIT_SHA',
    'OPENPLAN_GTFS_MANAGED_INGESTION','OPENPLAN_GTFS_PARSER_BUILD'] else value) for key,value in old.items()}
new={**old,'OPENPLAN_COMMIT_SHA':m.APP_HEAD}
(FIX/'app-env-private.json').write_text(json.dumps(new));(FIX/'app-env-private.json').chmod(0o600)
encoded=''.join(k+'='+json.dumps(v)+'\n' for k,v in new.items())
(FIX/'app-v1.env').write_text(encoded);(app/'.env.local').write_text(encoded)
original=json.loads((real_frozen/'service-receipts-private.json').read_bytes())
active=copy.deepcopy(original);active['rest']['id']=m.ACTIVE_REST_ID
created=copy.deepcopy(active['rest'])
target=json.loads((real_frozen/'target-identity.json').read_bytes())


def put(path,value):
    path.write_text(json.dumps(value));path.chmod(0o600)

put(frozen/'app-env-private.json',old)
put(frozen/'target-identity.json',target)
put(frozen/'clone-ready.json',{'sourceSha256':m.SOURCE_ANCHOR})
put(frozen/'service-receipts-private.json',original)
put(frozen/'rest-uri-recovery-01/envs-v1-private.json',{key:{} for key in original})
put(frozen/'rest-uri-recovery-01/replacement-receipt-private.json',created)
put(frozen/'rest-uri-recovery-01/replacement-started-private.json',{'id':created['id'],'running':True})
put(frozen/'rest-uri-recovery-01/active-service-receipts-private.json',active)


def refresh_active(module):
    rec=frozen/'rest-uri-recovery-01'
    put(rec/'active-binding-private.json',{'id':created['id'],
        'receiptSha256':module.sha(rec/'active-service-receipts-private.json'),
        'createdSha256':module.sha(rec/'replacement-receipt-private.json'),
        'startedSha256':module.sha(rec/'replacement-started-private.json')})


def refresh_pin(module):
    pin=json.loads((FIX/'recovery-active-binding.json').read_bytes())
    pin['files']={name:module.sha(frozen/'rest-uri-recovery-01'/name) for name in pin['files']}
    put(FIX/'recovery-active-binding.json',pin)


def refresh_binding(module):
    b=json.loads((FIX/'binding-private.json').read_bytes())
    b['files']={name:module.sha(FIX/name) for name in b['files']}
    put(FIX/'binding-private.json',b)

refresh_active(m);refresh_pin(m);refresh_binding(m)
state={};calls=[];observations=[]


def resources(phase):
    return {'memory.max':str(10*m.GiB if phase=='build' else 512*1024**2),'memory.swap.max':'0',
        'memory.swap.current':'0','memory.peak':'1000000','cpu.max':'50000 100000',
        'memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0'}


def configure(module):
    module.ROOT=FIX;module.FROZEN=frozen;module.CANDIDATE=FIX/'candidate';module.APP=app;module.RUN=run
    module.ACTIVE=frozen/'rest-uri-recovery-01/active-service-receipts-private.json'


def fake_command(argv,**kwargs):
    calls.append(argv)
    if argv[3:]==['rev-parse','HEAD']:return (state.get('head',m.APP_HEAD)+'\n').encode()
    if 'status' in argv:return state.get('dirty','').encode()
    if argv[3:]==['rev-parse',m.APP_HEAD+'^{commit}']:return (m.APP_HEAD+'\n').encode()
    if 'clone' in argv:
        state['cloneCalls']=state.get('cloneCalls',0)+1
        raise RuntimeError('fixture-lost-clone-ack')
    raise AssertionError('unexpected-command:'+repr(argv))


class Response:
    def __init__(self,status=200,origin=None):self.status=status;self.headers={'Access-Control-Allow-Origin':origin}
    def __enter__(self):return self
    def __exit__(self,*args):pass


class Opener:
    def open(self,request,timeout):
        calls.append(['HTTP',request.method,request.full_url])
        if request.method=='OPTIONS':return Response(origin=state.get('origin',m.WEB))
        return Response(status=state.get('restStatus',200) if request.method=='HEAD' else 200)


def recovery(module):
    g=dict(real.__dict__)
    g.update(OUT=frozen,RECOVERY=frozen/'rest-uri-recovery-01',ACTIVE_RECEIPTS=module.ACTIVE,
        read=lambda name:json.loads((frozen/name).read_bytes()),sha=module.sha)
    g['active_receipts']=types.FunctionType(real.active_receipts.__code__,g)
    def pinned():calls.append(['pinned']);return {'names':{k:v['name'] for k,v in original.items()},'target':target['database']}
    g['pinned_files']=pinned
    g['db_check']=lambda:calls.append(['db-check'])
    def target_check():
        calls.append(['target-check']);original_policy.exact(target,json.loads((frozen/'target-identity.json').read_bytes()),'target-identity')
    g['target_check']=target_check
    g['expected_service']=lambda kind,receipt,env:{'id':receipt['id']}
    g['observed_service']=lambda kind,receipt:{'id':state.get('observedId',receipt['id'])}
    g['health']=types.FunctionType(real.health.__code__,g)
    verify=types.FunctionType(real.verify_services.__code__,g)
    def preservation():
        calls.append(['source-check']);assert not state.get('sourceIssue'), 'fixture-source-preservation'
    def unchanged():
        calls.append(['unchanged-inputs']);assert not state.get('unchangedIssue'), 'fixture-unchanged-inputs'
    return types.SimpleNamespace(p=original_policy,read=g['read'],pinned_files=pinned,
        active_receipts=g['active_receipts'],verify_services=verify,source_check=preservation,unchanged_inputs=unchanged)


def fake_build(argv,**kwargs):
    calls.append(['BUILD',*argv])
    assert argv[0]=='/usr/bin/bwrap' and '--unshare-net' in argv
    assert kwargs['env']['NODE_OPTIONS']=='--max-old-space-size=6144'
    if state.get('lostBuildAck'):raise RuntimeError('fixture-lost-build-ack')
    (app/'.next').mkdir();(app/'.next/BUILD_ID').write_text('fixture-build')
    (app/'.next/server').mkdir();(app/'.next/server/file.js').write_text('fixture-server')
    if state.get('changeActive'):put(module.ACTIVE,{**active,'rest':{**active['rest'],'id':'e'*64}})
    return types.SimpleNamespace(returncode=state.get('returncode',0))


class Probe:
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def bind(self,address):
        calls.append(['BIND',*address]);assert address==(m.HOST,3585)
        if state.get('occupiedWeb'):raise OSError('fixture-web-occupied')


def fake_exec(path,argv,env):
    calls.append(['EXEC',path,*argv]);assert path=='/usr/bin/bwrap'
    assert env['NODE_OPTIONS']=='--max-old-space-size=320'
    assert argv[-4:]==['--hostname',m.HOST,'--port','3585']


def run_consumer(module,phase):
    configure(module)
    r=recovery(module)
    with patch.object(module,'load_recovery',return_value=r),patch.object(module,'command',side_effect=fake_command),\
         patch.object(module,'cgroup',side_effect=lambda:copy.deepcopy(state.get('resources',resources(phase)))),\
         patch.object(module,'headroom',return_value={'availableMemory':20*m.GiB,'freeDisk':30*m.GiB}),\
         patch.object(module.subprocess,'run',side_effect=fake_build),\
         patch.object(module.os,'execve',side_effect=fake_exec),\
         patch.object(module.socket,'socket',return_value=Probe()),\
         patch.object(real.urllib.request,'build_opener',return_value=Opener()):
        getattr(module,phase)()


def reset_execution():
    for f in list(run.iterdir()):
        if f.is_dir():shutil.rmtree(f)
        else:f.unlink()
    if (app/'.next').exists():shutil.rmtree(app/'.next')


def build_setup(module):
    reset_execution();state.clear();calls.clear();configure(module);refresh_active(module)
    refresh_pin(module)
    refresh_binding(module)
    r=recovery(module)
    with patch.object(module,'command',side_effect=fake_command):
        observed,_=module.app_check(r)
    put(run/'checkout-ready.json',observed)


def campaign(module):
    global m
    m=module
    rows=[]
    def attempt(label,action,reason=None):
        try:action()
        except BaseException as e:
            if reason is None or reason not in str(e):raise AssertionError(label+':unexpected:'+type(e).__name__+':'+str(e)) from e
            rows.append({'case':label,'outcome':'refused','reason':str(e)})
        else:
            if reason:raise AssertionError(label+':accepted-broken-behavior')
            rows.append({'case':label,'outcome':'survived'})
    build_setup(module)
    attempt('baseline actual build consumer',lambda:run_consumer(module,'build'))
    assert any(c[0]=='HTTP' and c[1]=='HEAD' for c in calls), 'actual HTTP HEAD acquisition'
    assert ['source-check'] in calls, 'actual source acquisition'
    assert ['unchanged-inputs'] in calls, 'actual unchanged inputs acquisition'
    attempt('baseline actual start consumer',lambda:run_consumer(module,'start'))
    assert ['BIND',module.HOST,3585] in calls and not any(c[:2]==['BIND',module.HOST] and c[-1]==29948 for c in calls)
    attempt('duplicate start intent',lambda:run_consumer(module,'start'),'File exists')
    # Each faulty input goes through actual build/start consumers or the guard's direct acquisition path.
    for label,key,value,reason in [
        ('wrong local HEAD','head',module.HELPER_HEAD,'app-head'),
        ('dirty checkout','dirty',' M tracked-file\n','app-dirty'),
        ('HTTP REST 503','restStatus',503,'health:rest'),
        ('CORS old origin','origin','http://127.74.15.10:3583','health:ownOrigin'),
        ('wrong helper observed ID','observedId','e'*64,'service:id'),
        ('source preservation failure','sourceIssue',True,'fixture-source-preservation'),
        ('prior input preservation failure','unchangedIssue',True,'fixture-unchanged-inputs'),
        ('build nonzero','returncode',1,'build-exit'),
        ('lost build acknowledgement','lostBuildAck',True,'fixture-lost-build-ack')]:
        build_setup(module);state[key]=value
        attempt(label,lambda:run_consumer(module,'build'),reason)
        if key=='lostBuildAck':attempt('lost build retry',lambda:run_consumer(module,'build'),'File exists')
    # Resource guards use acquired cgroup strings, including malformed/missing/unbounded edges.
    for label,field,value,reason in [
        ('wrong memory','memory.max','max','cgroup-memory'),('swap enabled','memory.swap.max','1','cgroup-memory'),
        ('current swap','memory.swap.current','1','cgroup-memory'),('unbounded CPU','cpu.max','max 100000','cgroup-cpu-format'),
        ('zero CPU','cpu.max','0 100000','cgroup-cpu-bound'),('zero CPU period','cpu.max','50000 0','cgroup-cpu-bound'),
        ('excess CPU','cpu.max','300000 100000','cgroup-cpu-bound'),('bad CPU','cpu.max','abc','cgroup-cpu-format'),
        ('missing OOM','memory.events','low 0\nhigh 0\nmax 0','cgroup-events'),
        ('OOM observed','memory.events',resources('build')['memory.events'].replace('oom_kill 0','oom_kill 1'),'cgroup-events'),
        ('duplicate OOM','memory.events',resources('build')['memory.events']+'\noom 0','cgroup-events-format'),
        ('peak exceeds cap','memory.peak',str(11*module.GiB),'cgroup-peak')]:
        build_setup(module);state['resources']={**resources('build'),field:value}
        attempt(label,lambda:run_consumer(module,'build'),reason)
    build_setup(module);state['resources']={**resources('build'),'cpu.max':'200000 100000'}
    attempt('bounded CPU200 survives',lambda:run_consumer(module,'build'))
    for label,path,change,reason in [
        ('wrong env bytes',app/'.env.local',lambda b:b+b'UNKNOWN="x"\n','app-env-file'),
        ('migration byte change',next((app/'supabase/migrations').glob('*.sql')),lambda b:b+b'\n-- fault\n','migration-bytes'),
        ('dependency metadata change',app/'package-lock.json',lambda b:b+b' ','deps-input-hash'),
        ('wrong private binding head',FIX/'binding-private.json',lambda b:b.replace(module.APP_HEAD.encode(),module.HELPER_HEAD.encode()),'binding-identity'),
        ('wrong private env delta',FIX/'app-env-private.json',lambda b:b.replace(module.APP_HEAD.encode(),module.HELPER_HEAD.encode()),'binding-sha:app-env-private.json'),
        ('wrong target OID',frozen/'target-identity.json',lambda b:b.replace(b'6118831',b'6118832'),'target-identity:oid'),
        ('wrong replacement receipt ID',frozen/'rest-uri-recovery-01/replacement-receipt-private.json',lambda b:b.replace(module.ACTIVE_REST_ID.encode(),b'e'*64),'files:rest'),
        ('missing replacement start',frozen/'rest-uri-recovery-01/replacement-started-private.json',lambda b:b.replace(b'true',b'false'),'replacement-started:running')]:
        build_setup(module);saved=path.read_bytes()
        try:
            path.write_bytes(change(saved));attempt(label,lambda:run_consumer(module,'build'),reason)
        finally:path.write_bytes(saved)
    build_setup(module)
    pin=FIX/'recovery-active-binding.json';saved=pin.read_bytes()
    try:
        data=json.loads(saved);data['files']['active-service-receipts-private.json']='0'*64;put(pin,data)
        refresh_binding(module)
        attempt('wrong pinned active hash',lambda:run_consumer(module,'build'),'active-pin-hashes')
    finally:pin.write_bytes(saved);refresh_binding(module)
    build_setup(module)
    extra=app/'.env.production';extra.write_text('UNOWNED=1\n')
    try:attempt('unowned environment',lambda:run_consumer(module,'build'),'unowned-env')
    finally:extra.unlink()
    build_setup(module);run_consumer(module,'build')
    report=run/'build-result.json';saved=report.read_bytes();data=json.loads(saved)
    try:
        data['active']['activeReceiptSha256']='0'*64;put(report,data)
        attempt('old build receipt active hash',lambda:run_consumer(module,'start'),'build-receipt-binding')
    finally:report.write_bytes(saved)
    state['occupiedWeb']=True
    attempt('occupied web refuses only at start',lambda:run_consumer(module,'start'),'fixture-web-occupied')
    state.clear()
    js=app/'.next/server/file.js';saved=js.read_bytes()
    try:
        js.write_bytes(b'fault');attempt('changed build inventory',lambda:run_consumer(module,'start'),'build-inventory')
    finally:js.write_bytes(saved)
    # Direct durable intents exercise both an acknowledged stage and lost acknowledgement.
    build_setup(module)
    path=run/'exclusive-fixture.json'
    module.write_once(path,{'value':1})
    attempt('exclusive intent retry',lambda:module.write_once(path,{'value':2}),'File exists')
    assert json.loads(path.read_bytes())=={'value':1}
    build_setup(module)
    attempt('existing checkout refuses creation',lambda:run_consumer(module,'checkout'),'checkout-exists')
    retained=FIX/'retained-candidate'
    module.CANDIDATE.rename(retained)
    try:
        attempt('lost checkout acknowledgement',lambda:run_consumer(module,'checkout'),'fixture-lost-clone-ack')
        attempt('lost checkout duplicate refuses',lambda:run_consumer(module,'checkout'),'File exists')
        assert state['cloneCalls']==1, 'checkout-duplicate-command'
    finally:retained.rename(module.CANDIDATE)
    # Actual readonly helper import and root consumers, using only owned file copies.
    hdir=FIX/'helper-copies';hdir.mkdir(exist_ok=True)
    for name in module.HELPERS:shutil.copyfile(real_frozen/name,hdir/name);(hdir/name).chmod(0o600)
    saved_frozen=module.FROZEN
    try:
        module.FROZEN=hdir
        f=hdir/'rest_uri_recovery_01_policy.py';saved=f.read_bytes();f.write_bytes(saved+b'\n# fault\n')
        attempt('changed helper SHA',module.load_recovery,'helper-sha:rest_uri_recovery_01_policy.py');f.write_bytes(saved)
        attempt('wrong helper module root',module.load_recovery,'helper-module-root')
    finally:module.FROZEN=saved_frozen
    saved_root=module.ROOT
    try:
        module.ROOT=FIX/'wrong';attempt('wrong launcher root',module.bindings,'launcher-root')
    finally:module.ROOT=saved_root
    # Command construction asserts actual bwrap confinement and fixed runtime binding.
    args=module.confined_argv('build');runtime=module.confined_argv('start')
    assert args[0]=='/usr/bin/bwrap' and '--unshare-net' in args
    assert ['--ro-bind',str(module.DEPS),str(module.DEPS)] == args[args.index(str(module.DEPS))-1:args.index(str(module.DEPS))+2]
    assert '--tmpfs' in args and '/run' in args and '--clearenv' not in args
    assert runtime[-4:]==['--hostname',module.HOST,'--port','3585']
    assert not any(k in module.environment(new,'build') for k in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','HTTP_PROXY','NODE_PATH'])
    rows.append({'case':'actual bubblewrap argv and clean environment','outcome':'survived'})
    return rows

rows=campaign(m)
put(PRIVATE/'controls-baseline-05.json',rows)
# Mutation subprocesses are unnecessary here: compile() executes fresh bytes, no bytecode cache.
mutations=[
    ('harmless comment',SOURCE+b'\n# Harmless fixture comment.\n',None),
    ('remove app HEAD guard',SOURCE.replace(b"require(head == APP_HEAD, 'app-head')",b"require(True, 'app-head')"), 'wrong local HEAD:unexpected:ValueError:checkout-receipt'),
    ('remove dirty guard',SOURCE.replace(b"require(not command(['/usr/bin/git', '-C', str(CANDIDATE), 'status', '--porcelain', '--untracked-files=all']).strip(), 'app-dirty')",b"require(True, 'app-dirty')"), 'dirty checkout:accepted-broken-behavior'),
    ('remove acquisition HTTP',SOURCE.replace(b'receipts = r.verify_services()',b'receipts = r.active_receipts()'), 'actual HTTP HEAD acquisition'),
    ('remove source acquisition',SOURCE.replace(b'    r.source_check()\n',b'    pass\n'), 'actual source acquisition'),
    ('remove unchanged inputs',SOURCE.replace(b'    r.unchanged_inputs()\n',b'    pass\n'), 'actual unchanged inputs acquisition'),
    ('remove memory budget',SOURCE.replace(b"require(observed['memory.max'] == str(10*GiB if phase == 'build' else 512*1024**2) and",b"require(True or observed['memory.max'] == str(10*GiB if phase == 'build' else 512*1024**2) and"), 'wrong memory:unexpected'),
    ('remove OOM guard',SOURCE.replace(b"require(all(events.get(key) == '0' for key in ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']), 'cgroup-events')",b"require(True, 'cgroup-events')"), 'missing OOM:accepted-broken-behavior'),
    ('wrong start active receipt',SOURCE.replace(b"report['active'] == active",b"True"), 'old build receipt active hash:accepted-broken-behavior'),
    ('remove env bytes guard',SOURCE.replace(b"require((APP/'.env.local').read_bytes() == (ROOT/'app-v1.env').read_bytes(), 'app-env-file')",b"require(True, 'app-env-file')"), 'wrong env bytes:unexpected:ValueError:checkout-receipt'),
    ('remove migration comparison',SOURCE.replace(b"require(actual == expected, 'migration-bytes')",b"require(True, 'migration-bytes')"), 'migration byte change:unexpected'),
    ('overwrite exclusive intents',SOURCE.replace(b'os.O_EXCL | os.O_NOFOLLOW',b'os.O_TRUNC | os.O_NOFOLLOW'),'duplicate start intent:accepted-broken-behavior'),
    ('remove active pin hashes',SOURCE.replace(b"require({name: sha(ACTIVE.parent/name) for name in names} == pin['files'], 'active-pin-hashes')",b"require(True, 'active-pin-hashes')"),'wrong pinned active hash:accepted-broken-behavior'),
    ('bare npm bypasses confinement',SOURCE.replace(b"result = subprocess.run(confined_argv('build')",b"result = subprocess.run(['/usr/bin/npm','run','build']"),'baseline actual build consumer:unexpected'),
]
results=[]
for name,data,reason in mutations:
    assert data!=SOURCE
    try:
        candidate=load(data)
        # Fixture self-binding follows the copied test subject, never installed production files.
        (FIX/'app_binding_v1.py').write_bytes(data)
        outcome=campaign(candidate)
        if reason:raise AssertionError('mutation-survived:'+name)
        results.append({'mutation':name,'outcome':'survived'})
    except AssertionError as e:
        if not reason or reason not in str(e):raise
        results.append({'mutation':name,'outcome':'detected','reason':str(e)})
    finally:
        (FIX/'app_binding_v1.py').write_bytes(SOURCE)
        m=load(SOURCE);configure(m);refresh_binding(m)
# Repeat after exact restoration, retaining both row sets.
restored=campaign(m)
assert restored==rows
put(PRIVATE/'controls-restored-05.json',restored)
put(PRIVATE/'mutations-05.json',results)
assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==SOURCE
assert (PRIVATE/'app_binding_v1.py').read_bytes()==SOURCE
print(json.dumps({'cases':len(rows),'refusals':sum(x['outcome']=='refused' for x in rows),'mutations':len(results),
    'survivors':sum(x['outcome']=='survived' for x in results),'restored':True}))
