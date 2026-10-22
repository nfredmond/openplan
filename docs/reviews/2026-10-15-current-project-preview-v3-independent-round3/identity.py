"""Small source-producer/real-attestor assay with explicitly replaced operational I/O."""
import json
import os
from pathlib import Path
import subprocess
import sys
import types
from unittest.mock import patch

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
REPO=PUBLIC.parents[2]
SUBJECT=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-v3'
OUT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-v3-independent-round3-20261015')
SEALED=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
HEAD='21510042e94bcaf80f262205ad156a7bb639e35c'
OLD='67828c17c4c270529468eef1edd144e4a52b693a'

# Retain the actual producer fixture and its harmless/fault/restoration controls.
# Only its repository lookup changes to this assigned checkout.
producer_source=(SUBJECT/'health_producer.cjs').read_text()
producer_source=producer_source.replace("const repo = '/home/nathaniel/.t3/worktrees/openplan/t3-c2662e5b';",'const repo = '+json.dumps(str(REPO))+';')
producer_path=OUT/'health_producer.cjs';producer_path.write_text(producer_source)
producer=json.loads(subprocess.check_output(['/usr/bin/node','--max-old-space-size=640',str(producer_path)],timeout=40))
assert producer['baseline']['appCommitSha']==HEAD
assert producer['baseline']['payload']['deployment']['commit']==HEAD[:12]
assert producer['baseline']['payload']['deployment']['migrations']=={'expected':419,'latest':'20261017000016'}
(OUT/'producer.json').write_text(json.dumps(producer,indent=2)+'\n')

# Reuse fixture builders only, before the supplied campaign. Copies and mutations
# go to a NEW owned fixture root. Inputs still read the sealed packet read-only.
text=(SUBJECT/'verify_controls.py').read_text().split('\nrows=campaign(m)\n')[0]
text=text.replace("FIX=PRIVATE/'fixtures-05'",'FIX=Path('+repr(str(OUT/'identity-specimen-03'))+')')
h=types.ModuleType('review_fixture_support');h.__file__=str(SUBJECT/'verify_controls.py')
exec(compile(text,h.__file__,'exec'),vars(h))
a=h.m
BASE=(SUBJECT/'templates/attest_start_v1.py').read_bytes()
UNIT='openplan-current-project-preview-app-21510042e-v3-web.service'
GROUP='/user.slice/user-1000.slice/user@1000.service/app.slice/'+UNIT
rt=Path.read_text;rb=Path.read_bytes;rr=Path.resolve
state={}
rows=[]

def read_text(path,*args,**kwargs):
    if str(path)=='/proc/400001/cgroup':return '0::'+GROUP
    if str(path).startswith('/sys/fs/cgroup'+GROUP+'/'):return h.resources('start')[path.name]
    return rt(path,*args,**kwargs)
def read_bytes(path,*args,**kwargs):
    if str(path)=='/proc/400001/environ':
        env=a.environment(h.new,'start');env.update(state.get('processEnvironment',{}))
        return '\0'.join(k+'='+v for k,v in env.items()).encode()
    return rb(path,*args,**kwargs)
def resolve(path,*args,**kwargs):
    if str(path)=='/proc/400001/cwd':return a.APP
    return rr(path,*args,**kwargs)
def command(argv,**kwargs):
    if argv[0]=='/usr/bin/systemctl':
        assert argv[3]==state.get('requestedUnit',UNIT),'attestor-requested-wrong-unit'
        group=state.get('group',GROUP)
        return ('ActiveState=active\nControlGroup='+group+'\nMainPID=400000').encode()
    if argv[0]=='/usr/bin/ss':return ('LISTEN 0 511 '+a.HOST+':3585 0.0.0.0:* users:(("next",pid=400001,fd=20))').encode()
    return h.fake_command(argv,**kwargs)
class Response(h.Response):
    def read(self,limit):return json.dumps(state.get('health',producer['baseline']['payload'])).encode()
class Opener(h.Opener):
    def open(self,request,timeout):
        if not isinstance(request,str):return super().open(request,timeout)
        assert request==a.WEB+'/api/health'
        return Response(status=200)

def trial(label,source=BASE,changes=None,expected=None):
    h.build_setup(a);h.run_consumer(a,'build');h.run_consumer(a,'start');state.clear();state.update(changes or {})
    path=h.FIX/'attest_start_v1.py';path.write_bytes(source);h.refresh_binding(a)
    module=types.ModuleType('review_attestor');module.__file__=str(path)
    with patch.dict(sys.modules,{'app_binding_v1':a}):exec(compile(source,str(path),'exec'),vars(module))
    try:
        with patch.object(a,'load_recovery',return_value=h.recovery(a)),patch.object(a,'command',side_effect=command),\
            patch.object(Path,'read_text',read_text),patch.object(Path,'read_bytes',read_bytes),patch.object(Path,'resolve',resolve),\
            patch.object(h.real.urllib.request,'build_opener',return_value=Opener()):
            module.attest()
    except (ValueError,AssertionError) as error:
        if expected is None or str(error)!=expected:raise AssertionError(label+':unexpected:'+str(error)) from error
        rows.append({'case':label,'outcome':'refused','reason':str(error)})
    else:
        if expected is not None:raise AssertionError(label+':accepted-broken-behavior')
        result=a.read(a.RUN/'runtime-start-attestation.json')
        assert result['app']['head']==HEAD and result['unit']==UNIT
        rows.append({'case':label,'outcome':'survived'})
    finally:
        path.write_bytes(BASE);h.refresh_binding(a)

# Survivor precedes all kills. Each negative requires a named reason.
trial('harmless attestor comment first',BASE+b'\n# Harmless round 3 comment.\n')
trial('actual 215 producer baseline')
for label,changes,reason in [
    ('old 678 HTTP prefix',{'health':{**producer['baseline']['payload'],'deployment':{'commit':OLD[:12],'migrations':{'expected':419,'latest':'20261017000016'}}}},'attest-http-identity'),
    ('full SHA in HTTP',{'health':{**producer['baseline']['payload'],'deployment':{'commit':HEAD,'migrations':{'expected':419,'latest':'20261017000016'}}}},'attest-http-identity'),
    ('old full process SHA',{'processEnvironment':{'OPENPLAN_COMMIT_SHA':OLD}},'attest-process-environment'),
    ('short process SHA',{'processEnvironment':{'OPENPLAN_COMMIT_SHA':HEAD[:12]}},'attest-process-environment'),
    ('old web cgroup',{'group':GROUP.replace(UNIT,'openplan-current-project-preview-app-678-v1-web.service')},'attest-unit'),
]:trial(label,changes=changes,expected=reason)
mutations=[]
for name,source,changes,refusal in [
    ('old fixed attestor unit',BASE.replace(UNIT.encode(),b'openplan-current-project-preview-app-678-v1-web.service'),{},'attestor-requested-wrong-unit'),
    ('old full-SHA HTTP comparison',BASE.replace(b'a.APP_HEAD[:12].lower()',b'a.APP_HEAD'),{},'attest-http-identity'),
]:
    assert source!=BASE
    trial(name,source,changes,refusal)
    mutations.append({'mutation':name,'outcome':'detected','reason':refusal})
source=BASE.replace(b"a.require(all(environment.get(key)==value for key,value in expected.items()), 'attest-process-environment')",b"a.require(True, 'attest-process-environment')")
assert source!=BASE
try:
    trial('removed process env guard',source,{'processEnvironment':{'OPENPLAN_COMMIT_SHA':OLD}},'attest-process-environment')
except AssertionError as e:
    assert str(e)=='removed process env guard:accepted-broken-behavior'
    mutations.append({'mutation':'remove process environment guard','outcome':'detected','reason':str(e)})
else:raise AssertionError('mutation harness missed accepted old process SHA')
trial('exact restored attestor')
assert (h.FIX/'attest_start_v1.py').read_bytes()==BASE and (SUBJECT/'templates/attest_start_v1.py').read_bytes()==BASE
(OUT/'identity.json').write_text(json.dumps({'cases':rows,'mutations':mutations,'producer':producer,'restored':True,
    'adapters':['Actual source producer fixture, assigned repo path','Supplied fixture builders only, new owned root','Git, npm, services, HTTP and proc acquisition replaced before invocation'],
    'limits':['No build/server/transport/readiness proof','Full real attest consumer, synthetic acquisition and receipts','No hostile-host boundary']},indent=2)+'\n')
print(json.dumps({'cases':len(rows),'codeFaultDetections':len(mutations),'harmlessSurvivor':True,'restored':True}))
