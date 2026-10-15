"""Exercise start readback through fake process/systemd/HTTP acquisition only."""
import json
import os
import subprocess
from pathlib import Path
import sys
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
os.umask(0o077)
producer=json.loads(subprocess.check_output(['/usr/bin/node','--max-old-space-size=640',str(PUBLIC/'health_producer.cjs')],
    env={'PATH':'/usr/bin:/bin','HOME':str(PRIVATE/'home'),'XDG_CACHE_HOME':str(PRIVATE/'cache')},timeout=30))
with (PRIVATE/'actual-health-producer.json').open('x') as f:json.dump(producer,f,indent=2);f.write('\n')
# Reuse the explicit fixture builders, without running their campaign or mutators.
text=(PUBLIC/'verify_controls.py').read_text().split('\nrows=campaign(m)\n')[0]
text=text.replace('fixtures-05','attest-fixtures-01')
h=types.ModuleType('fixture_support');h.__file__=str(PUBLIC/'verify_controls.py')
exec(compile(text,h.__file__,'exec'),h.__dict__)
a=h.m
BASE=(PUBLIC/'templates/attest_start_v1.py').read_bytes()
unit='openplan-current-project-preview-app-21510042e-v3-web.service'
group='/user.slice/user-1000.slice/user@1000.service/app.slice/'+unit
real_read_text=Path.read_text;real_read_bytes=Path.read_bytes;real_resolve=Path.resolve
rows=[]
state={}


def read_text(path,*args,**kwargs):
    if str(path)=='/proc/400001/cgroup':return state.get('processCgroup','0::'+group)
    if str(path).startswith('/sys/fs/cgroup'+group+'/'):
        return state.get('runtimeResources',h.resources('start'))[path.name]
    return real_read_text(path,*args,**kwargs)


def read_bytes(path,*args,**kwargs):
    if str(path)=='/proc/400001/environ':
        values=a.environment(h.new,'start')
        values.update(state.get('processEnvironment',{}))
        return '\0'.join(k+'='+v for k,v in values.items()).encode()
    return real_read_bytes(path,*args,**kwargs)


def resolve(path,*args,**kwargs):
    if str(path)=='/proc/400001/cwd':return state.get('cwd',a.APP)
    return real_resolve(path,*args,**kwargs)


def command(argv,**kwargs):
    if argv[0]=='/usr/bin/systemctl':
        props={'ActiveState':'active','ControlGroup':group,'MainPID':'400000',**state.get('unit',{})}
        return '\n'.join(k+'='+v for k,v in props.items()).encode()
    if argv[0]=='/usr/bin/ss':
        return state.get('ss','LISTEN 0 511 '+a.HOST+':3585 0.0.0.0:* users:(("next",pid=400001,fd=20))').encode()
    return h.fake_command(argv,**kwargs)


class Health(h.Response):
    def read(self,limit):
        data={**producer['baseline']['payload'],**state.get('health',{})}
        return json.dumps(data).encode()


class Opener(h.Opener):
    def open(self,request,timeout):
        if isinstance(request,str):
            assert request==a.WEB+'/api/health'
            return Health(status=state.get('httpStatus',200))
        return super().open(request,timeout)


def load(source):
    module=types.ModuleType('attest_fixture');module.__file__=str(h.FIX/'attest_start_v1.py')
    with patch.dict(sys.modules,{'app_binding_v1':a}):exec(compile(source,module.__file__,'exec'),module.__dict__)
    return module


def invoke(module):
    r=h.recovery(a)
    with patch.object(a,'load_recovery',return_value=r),patch.object(a,'command',side_effect=command),\
        patch.object(Path,'read_text',read_text),patch.object(Path,'read_bytes',read_bytes),patch.object(Path,'resolve',resolve),\
        patch.object(h.real.urllib.request,'build_opener',return_value=Opener()):
        module.attest()


def campaign(source):
    module=load(source);observed=[]
    def setup():
        h.build_setup(a);h.run_consumer(a,'build');h.run_consumer(a,'start');state.clear()
        assert a.read(a.RUN/'build-result.json')['app']['head']==a.APP_HEAD and len(a.APP_HEAD)==40
        assert a.read(a.RUN/'start-intent.json')['app']['head']==a.APP_HEAD
        assert a.environment(h.new,'start')['OPENPLAN_COMMIT_SHA']==a.APP_HEAD
        (h.FIX/'attest_start_v1.py').write_bytes(source);h.refresh_binding(a)
    def attempt(label,reason=None):
        try:invoke(module)
        except BaseException as e:
            if reason is None or reason not in str(e):raise AssertionError(label+':unexpected:'+str(e)) from e
            observed.append({'case':label,'outcome':'refused','reason':str(e)})
        else:
            if reason:raise AssertionError(label+':accepted-broken-behavior')
            observed.append({'case':label,'outcome':'survived'})
    setup();attempt('identified readback baseline')
    for label,key,value,reason in [
        ('unready HTTP','httpStatus',503,'attest-http-status'),
        ('wrong HTTP commit','health',producer['old']['payload'],'attest-http-identity'),
        ('old 678 HTTP identity','health',{'deployment':{**producer['baseline']['payload']['deployment'],'commit':'67828c17c4c2'}},'attest-http-identity'),
        *[(label,'health',{'deployment':{**producer['baseline']['payload']['deployment'],'commit':value}},'attest-http-identity')
          for label,value in [('wrong twelve characters','0'*12),('full forty characters',a.APP_HEAD),
            ('seven characters',a.APP_HEAD[:7]),('uppercase twelve characters',a.APP_HEAD[:12].upper()),
            ('arbitrary longer prefix',a.APP_HEAD[:12]+'abc'),('wrong type null',None),('wrong type integer',67828),
            ('wrong type object',{}),('wrong type list',[]),('wrong type boolean',True)]],
        ('unknown actual producer commit','health',producer['unknown']['payload'],'attest-http-identity'),
        ('actual producer migration error','health',producer['migrationError']['payload'],'attest-http-identity'),
        ('wrong migration count','health',{'deployment':{**producer['baseline']['payload']['deployment'],
            'migrations':{'expected':418,'latest':'20261017000016'}}},'attest-http-identity'),
        ('wrong latest migration','health',{'deployment':{**producer['baseline']['payload']['deployment'],
            'migrations':{'expected':419,'latest':'20261017000015'}}},'attest-http-identity'),
        ('wrong listener address','ss','LISTEN 0 511 127.0.0.1:3585 0.0.0.0:* users:(("next",pid=400001,fd=20))','attest-listener'),
        ('no listener owner','ss','LISTEN 0 511 '+a.HOST+':3585 0.0.0.0:*','attest-listener-pid'),
        ('wrong process cwd','cwd',h.FIX/'foreign','attest-process-cwd'),
        ('wrong process cgroup','processCgroup','0::/foreign','attest-process-cgroup'),
        ('wrong process commit','processEnvironment',{'OPENPLAN_COMMIT_SHA':a.HELPER_HEAD},'attest-process-environment'),
        ('old 678 full process SHA','processEnvironment',{'OPENPLAN_COMMIT_SHA':'67828c17c4c270529468eef1edd144e4a52b693a'},'attest-process-environment'),
        ('short process commit refuses','processEnvironment',{'OPENPLAN_COMMIT_SHA':a.APP_HEAD[:12]},'attest-process-environment'),
        ('ambient provider credential','processEnvironment',{'OPENAI_API_KEY':'fixture-only'},'attest-ambient-environment'),
        ('inactive unit','unit',{'ActiveState':'inactive'},'attest-unit'),
        ('zero main PID','unit',{'MainPID':'0'},'attest-unit'),
        ('wrong unit group','unit',{'ControlGroup':'/foreign'},'attest-unit'),
        ('old 678 web unit','unit',{'ControlGroup':group.replace(unit,'openplan-current-project-preview-app-678-v1-web.service')},'attest-unit'),
        ('runtime OOM','runtimeResources',{**h.resources('start'),'memory.events':h.resources('start')['memory.events'].replace('oom 0','oom 1')},'cgroup-events'),
    ]:
        setup();state[key]=value;attempt(label,reason)
    setup();path=a.APP/'.next/server/file.js';saved=path.read_bytes()
    try:path.write_bytes(b'fault');attempt('changed built server bytes','attest-built-bytes')
    finally:path.write_bytes(saved)
    setup();cache=a.APP/'.next/cache';cache.mkdir();(cache/'runtime-cache').write_text('owned runtime cache')
    attempt('runtime cache change survives')
    setup();path=a.RUN/'start-intent.json';saved=path.read_bytes()
    try:
        data=json.loads(saved);data['active']['activeReceiptSha256']='0'*64;path.write_text(json.dumps(data))
        attempt('old start receipt active hash','attest-inputs')
    finally:path.write_bytes(saved)
    return observed

baseline=campaign(BASE)
mutations=[
    ('harmless comment',BASE+b'\n# Harmless comment.\n',None),
    ('restore old web unit',BASE.replace(b'openplan-current-project-preview-app-21510042e-v3-web.service',b'openplan-current-project-preview-app-678-v1-web.service'),'identified readback baseline:unexpected:attest-unit'),
    ('restore old full-SHA comparison',BASE.replace(b"health['deployment']['commit']==a.APP_HEAD[:12].lower()",b"health['deployment']['commit']==a.APP_HEAD"),'identified readback baseline:unexpected:attest-http-identity'),
    ('allow arbitrary prefix',BASE.replace(b"health['deployment']['commit']==a.APP_HEAD[:12].lower()",b"isinstance(health['deployment']['commit'],str) and health['deployment']['commit'].startswith(a.APP_HEAD[:12].lower())"),'full forty characters:accepted-broken-behavior'),
    ('remove migration identity',BASE.replace(b"health['deployment']['migrations']=={'expected':419,'latest':'20261017000016'}",b"True"),'actual producer migration error:accepted-broken-behavior'),
    ('remove HTTP identity',BASE.replace(b"a.require(health['service']=='openplan'",b"a.require(True or health['service']=='openplan'"),'wrong HTTP commit:accepted-broken-behavior'),
    ('remove process cwd',BASE.replace(b"a.require(proc.joinpath('cwd').resolve()==a.APP, 'attest-process-cwd')",b"a.require(True, 'attest-process-cwd')"),'wrong process cwd:accepted-broken-behavior'),
    ('remove process env',BASE.replace(b"a.require(all(environment.get(key)==value for key,value in expected.items()), 'attest-process-environment')",b"a.require(True, 'attest-process-environment')"),'wrong process commit:accepted-broken-behavior'),
    ('remove unit identity',BASE.replace(b"a.require(properties['ActiveState']=='active'",b"a.require(True or properties['ActiveState']=='active'"),'inactive unit:accepted-broken-behavior'),
    ('remove immutable built bytes',BASE.replace(b"a.require({k:v for k,v in before.items()",b"a.require(True or {k:v for k,v in before.items()"),'changed built server bytes:accepted-broken-behavior'),
]
results=[]
for name,source,reason in mutations:
    assert source!=BASE
    try:
        campaign(source)
        if reason:raise AssertionError('fault-survived:'+name)
        results.append({'mutation':name,'outcome':'survived'})
    except AssertionError as e:
        if not reason or reason not in str(e):raise
        results.append({'mutation':name,'outcome':'detected','reason':str(e)})
    finally:
        (h.FIX/'attest_start_v1.py').write_bytes(BASE);h.refresh_binding(a)
restored=campaign(BASE)
assert baseline==restored
assert (PUBLIC/'templates/attest_start_v1.py').read_bytes()==BASE
with (PRIVATE/'attestation-controls-01.json').open('x') as f:
    json.dump({'cases':baseline,'mutations':results,'restored':True},f,indent=2);f.write('\n')
print(json.dumps({'cases':len(baseline),'mutations':len(results),'survivors':1,'restored':True}))
