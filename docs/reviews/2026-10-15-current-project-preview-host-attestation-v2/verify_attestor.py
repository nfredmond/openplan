"""Actual v2 function, private fixture files and explicit operational I/O adapters."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
SUBJECT=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-v3'
BASE=(PUBLIC/'attest_start_v2.py').read_text()
os.umask(0o077)
# Use the existing synthetic fixture builders, never their campaign or original root.
support=(SUBJECT/'verify_controls.py').read_text().split('\nrows=campaign(m)\n')[0]
support=support.replace("FIX=PRIVATE/'fixtures-05'",'FIX=Path('+repr(str(ROOT/'attestor-specimen-02'))+')')
h=types.ModuleType('fixture_support');h.__file__=str(SUBJECT/'verify_controls.py')
exec(compile(support,h.__file__,'exec'),vars(h))
a=h.m
producer=json.loads((ROOT.parent/'current-project-preview-v3-independent-round3-20261015/identity.json').read_bytes())['producer']['baseline']['payload']
assert producer['deployment']['commit']==a.APP_HEAD[:12]
assert producer['deployment']['migrations']=={'expected':419,'latest':'20261017000016'}
UNIT='openplan-current-project-preview-app-21510042e-v3-web.service'
GROUP='/user.slice/user-1000.slice/user@1000.service/app.slice/'+UNIT
rt=Path.read_text;rb=Path.read_bytes;rr=Path.resolve
state={};rows=[];mutations=[]


def load(source=BASE):
    m=types.ModuleType('attestor_fixture');m.__file__=str(ROOT/'attest_start_v2.py')
    exec(compile(source,m.__file__,'exec'),vars(m))
    # Adapter uses actual binding consumers with synthetic filesystem and acquisition.
    m.a=a;m.NEW_ROOT=ROOT/'receipt-specimen';m.NEW_ROOT.mkdir(exist_ok=True)
    return m


m=load()
# Execute the installed, pinned helper independently. No npm command or shell runs.
helper='/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/set-path.js'
js='const setPATH=require('+json.dumps(helper)+'); process.stdout.write(setPATH(process.argv[1],false,{PATH:"/usr/bin:/bin"}).PATH)'

def node_path(app):
    return subprocess.check_output(['/usr/bin/node','--max-old-space-size=128','-e',js,str(app)],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home')},timeout=10).decode()

fixed_app=V3/'candidate/openplan'
with patch.object(a,'APP',fixed_app):expected=m.npm_child_path('/usr/bin:/bin')
actual=node_path(fixed_app)
assert actual==expected,'npm-helper-parity'
# Preserve the startup context finding: npm run does not pass binPaths; pkg defaults false.
assert 'binPaths = false' in Path('/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/run-script-pkg.js').read_text()
parity={'equal':True,'derivedPathSha256':hashlib.sha256(expected.encode()).hexdigest(),'safePath':expected,'sources':m.NPM_SOURCES,'binPaths':False}


def read_text(path,*args,**kwargs):
    if str(path)=='/proc/400001/cgroup':return '0::'+state.get('processGroup',GROUP)
    if str(path).startswith('/sys/fs/cgroup'+GROUP+'/'):
        return {**h.resources('start'),**state.get('resources',{})}[path.name]
    return rt(path,*args,**kwargs)


def read_bytes(path,*args,**kwargs):
    if str(path)=='/proc/400001/environ':
        env=a.environment(h.new,'start');env['PATH']=state['nodePath'];env.update(state.get('env',{}))
        return '\0'.join(k+'='+v for k,v in env.items()).encode()
    return rb(path,*args,**kwargs)


def resolve(path,*args,**kwargs):
    if str(path)=='/proc/400001/cwd':return state.get('cwd',a.APP)
    return rr(path,*args,**kwargs)


def command(argv,**kwargs):
    if argv[0]=='/usr/bin/systemctl':
        assert argv[3]==UNIT,'requested-wrong-unit'
        return ('ActiveState='+state.get('activeState','active')+'\nControlGroup='+GROUP+'\nMainPID=400000').encode()
    if argv[0]=='/usr/bin/ss':return state.get('socket','LISTEN 0 511 '+a.HOST+':3585 0.0.0.0:* users:(("next",pid=400001,fd=20))').encode()
    return h.fake_command(argv,**kwargs)


class Response(h.Response):
    def read(self,limit):return json.dumps(state.get('health',producer)).encode()
class Opener(h.Opener):
    def open(self,request,timeout):
        if not isinstance(request,str):return super().open(request,timeout)
        assert request==a.WEB+'/api/health'
        return Response(status=state.get('httpStatus',200))


def trial(name,changes=None,reason=None,source=BASE,entry=False):
    h.build_setup(a);h.run_consumer(a,'build');h.run_consumer(a,'start')
    state.clear();state.update(changes or {});state['nodePath']=node_path(a.APP)
    (ROOT/'attest_start_v2.py').write_text(source)
    subject=load(source);receipt=subject.NEW_ROOT/'runtime-start-attestation.json'
    if receipt.exists():receipt.unlink()  # Owned synthetic receipt only.
    original_write=a.write_once
    def capture(path,value):
        assert path==receipt,'wrong-receipt-target'
        original_write(path,value)
    if state.get('duplicate'):receipt.write_text('{}')
    before=dict(os.environ)
    try:
        with patch.object(a,'load_recovery',return_value=h.recovery(a)),patch.object(a,'command',side_effect=command),patch.object(a,'write_once',side_effect=capture),patch.object(Path,'read_text',read_text),patch.object(Path,'read_bytes',read_bytes),patch.object(Path,'resolve',resolve),patch.object(h.real.urllib.request,'build_opener',return_value=Opener()):
            if entry:
                subject.__file__=str(subject.NEW_ROOT/'attest_start_v2.py') if not state.get('wrongEntry') else str(ROOT/'wrong.py')
                # Source hash remains the actual tested bytes in this owned entry fixture.
                Path(subject.__file__).write_text(source)
                subject.main()
            else:subject.attest()
    except (ValueError,AssertionError,FileExistsError,SystemExit) as error:
        observed='exclusive-receipt' if isinstance(error,FileExistsError) else str(error)
        if isinstance(error,SystemExit):observed='entry-refused'
        if reason!=observed:raise AssertionError(name+':unexpected:'+observed) from error
        rows.append({'case':name,'outcome':'REFUSED','reason':observed})
    else:
        if reason:raise AssertionError(name+':accepted-broken-behavior')
        result=a.read(receipt)
        assert result['app']['head']==a.APP_HEAD and result['unit']==UNIT
        assert result['attestorSha256']==hashlib.sha256(source.encode()).hexdigest()
        assert result['npmSourceHashes']==subject.NPM_SOURCES
        assert result['derivedNpmPathSha256']==hashlib.sha256(state['nodePath'].encode()).hexdigest()
        assert result['buildResultSha256']==a.sha(a.RUN/'build-result.json')
        assert result['startIntentSha256']==a.sha(a.RUN/'start-intent.json')
        rows.append({'case':name,'outcome':'SURVIVED'})
    finally:
        os.environ.clear();os.environ.update(before)
        (ROOT/'attest_start_v2.py').write_text(BASE)


trial('harmless comment first',source=BASE+'\n# Harmless fixture comment.\n')
trial('baseline exact npm child PATH')
# Independent actual-helper output supplies the process PATH, not the Python algorithm.
parts=node_path(a.APP).split(':')
for name,value in [('base-only','/usr/bin:/bin'),('wrong-order',':'.join([parts[1],parts[0],*parts[2:]])),('extra-entry',':'.join(['/tmp/extra',*parts])),('omitted-project-prefix',':'.join(parts[1:])),('omitted-root-prefix',':'.join(x for x in parts if x!='/node_modules/.bin')),('omitted-node-gyp',':'.join(x for x in parts if 'node-gyp-bin' not in x)),('wrong-base',':'.join(parts[:-2]+['/bin','/usr/bin']))]:
    trial(name,{'env':{'PATH':value}},'attest-process-environment')
for name,changes,reason in [
 ('wrong full SHA',{'env':{'OPENPLAN_COMMIT_SHA':a.HELPER_HEAD}},'attest-process-environment'),
 ('short full SHA',{'env':{'OPENPLAN_COMMIT_SHA':a.APP_HEAD[:12]}},'attest-process-environment'),
 ('other sealed value',{'env':{'OPENPLAN_GTFS_MANAGED_INGESTION':'1'}},'attest-process-environment'),
 ('ambient proxy',{'env':{'HTTP_PROXY':'harmless-fixture'}},'attest-ambient-environment'),
 ('inactive unit',{'activeState':'inactive'},'attest-unit'),
 ('missing listener PID',{'socket':'LISTEN 0 511 '+a.HOST+':3585 0.0.0.0:*'},'attest-listener-pid'),
 ('wrong listener',{'socket':'LISTEN 0 511 127.0.0.1:3585 0.0.0.0:*'},'attest-listener'),
 ('wrong cwd',{'cwd':ROOT},'attest-process-cwd'),
 ('wrong process group',{'processGroup':GROUP+'-wrong'},'attest-process-cgroup'),
 ('swap enabled',{'resources':{'memory.swap.max':'1'}},'cgroup-memory'),
 ('HTTP status',{'httpStatus':503},'attest-http-status'),
 ('HTTP full SHA',{'health':{**producer,'deployment':{**producer['deployment'],'commit':a.APP_HEAD}}},'attest-http-identity'),
 ('exclusive new receipt',{'duplicate':True},'exclusive-receipt'),
]:trial(name,changes,reason)
trial('new entry baseline',entry=True)
trial('wrong new entry',{'wrongEntry':True},'attestor-root',entry=True)
# New source/hash and base guards refuse independently, with no source mutation.
for name,context,call,reason in [
 ('npm source bytes',patch.object(a,'sha',return_value='0'*64),lambda:m.npm_child_path('/usr/bin:/bin'),'attest-npm-source:run.js'),
 ('wrong trusted base',patch.dict(os.environ,{}),lambda:m.npm_child_path('/bin:/usr/bin'),'attest-base-path')]:
    try:
        with context:call()
    except ValueError as e:assert str(e)==reason;rows.append({'case':name,'outcome':'REFUSED','reason':reason})
    else:raise AssertionError(name+':accepted-broken-behavior')
# Test the new import guards before any business call.
try:
    with patch.object(Path,'read_bytes',lambda path: b'wrong' if path==V3/'app_binding_v1.py' else rb(path)):load()
except ValueError as e:assert str(e)=='attest-binding-sha';rows.append({'case':'binding hash','outcome':'REFUSED','reason':str(e)})
else:raise AssertionError('binding hash accepted')
fake=types.SimpleNamespace(__file__=str(ROOT/'wrong-binding.py'),require=a.require,sha=lambda p:'c195d3be5eb3bcafb016f8794bf77e704d940bbf878bd725a874d85559c58329')
try:
    with patch.dict(sys.modules,{'app_binding_v1':fake}):load()
except ValueError as e:assert str(e)=='attest-binding-module';rows.append({'case':'binding module path','outcome':'REFUSED','reason':str(e)})
else:raise AssertionError('wrong binding module accepted')
# Remove the enforcing comparison; wrong process PATH must expose acceptance.
needle="a.require(all(environment.get(key)==value for key,value in expected.items()), 'attest-process-environment')"
assert needle in BASE
try:trial('removed environment guard',{'env':{'PATH':'/usr/bin:/bin'}},'attest-process-environment',BASE.replace(needle,"a.require(True, 'attest-process-environment')"))
except AssertionError as e:
    assert str(e)=='removed environment guard:accepted-broken-behavior';mutations.append({'mutation':'remove environment guard','detectedBy':str(e)})
else:raise AssertionError('guard removal missed')
# Wrong algorithms must disagree with the independently executed helper.
for name,changed in [('omit ancestor',BASE.replace("entries.append(str(directory/'node_modules/.bin'))","entries.append(str(directory/'node_modules/.bin')) if directory==a.APP else None")),('omit node-gyp',BASE.replace("'/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',base","base"))]:
    subject=load(changed)
    assert subject.npm_child_path('/usr/bin:/bin')!=node_path(a.APP),name+':parity-missed'
    mutations.append({'mutation':name,'detectedBy':'npm-helper-parity'})
trial('exact restoration')
assert (ROOT/'attest_start_v2.py').read_text()==BASE
(ROOT/'attestor-controls.json').write_text(json.dumps({'cases':rows,'mutations':mutations,'npmParity':parity,'producerPayload':producer,'restored':True,'limits':['Operational HTTP/proc/systemd/recovery acquisition uses explicit fixture adapters. Actual full attestor function and binding consumers run.','No actual readiness, source/global/Storage or runtime identity acquisition.','No hostile same-user or loader protection.']},indent=2)+'\n')
print(json.dumps({'cases':len(rows),'mutations':len(mutations),'npmParity':True,'restored':True}))
