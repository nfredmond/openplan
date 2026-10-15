"""Selected actual-function fixtures and installed npm-helper parity, offline."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
PACKET=PUBLIC.parent/'2026-10-15-current-project-preview-host-attestation-v2'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-independent-round4-20261015')
ORIGINAL=ROOT.parent/'current-project-preview-host-attestation-v2-20261015'
# Reuse only inspected builders/adapters, never the old campaign or old write root.
support=(PACKET/'verify_attestor.py').read_text().split("\ntrial('harmless comment first'",1)[0]
support=support.replace("ROOT=Path("+repr(str(ORIGINAL))+")", "ROOT=Path("+repr(str(ROOT))+")")
h=types.ModuleType('independent_r4_fixture');h.__file__=str(PACKET/'verify_attestor.py')
exec(compile(support,h.__file__,'exec'),vars(h))
assert h.ROOT==ROOT and str(h.h.FIX).startswith(str(ROOT)+'/')
assert h.BASE==(PACKET/'attest_start_v2.py').read_text()
# Both installed helpers execute directly. Neither dispatches npm or a script.
js="""const base='/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/';
const app=process.argv[1];const env={PATH:'/usr/bin:/bin'};
const direct=require(base+'set-path.js')(app,false,{...env}).PATH;
const made=require(base+'make-spawn-args.js')({path:app,args:[],cmd:'no-dispatch',env,event:'start',stdio:'pipe'});
process.stdout.write(JSON.stringify({direct,spawn:made[2].env.PATH,cwd:made[2].cwd}));"""
actual=json.loads(subprocess.check_output(['/usr/bin/node','--max-old-space-size=128','-e',js,str(h.fixed_app)],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home')},timeout=10))
with patch.object(h.a,'APP',h.fixed_app):expected=h.m.npm_child_path('/usr/bin:/bin')
def parity(value):assert value['direct']==value['spawn']==expected and value['cwd']==str(h.fixed_app),'actual-helper-parity'
parity({**actual,'harmless':'first'})
try:parity({**actual,'spawn':'/usr/bin:/bin'})
except AssertionError as e:assert str(e)=='actual-helper-parity'
else:raise AssertionError('parity-oracle-missed')
parity(actual)
# No operational acquisition is left unadapted by trial(). A live fallback fails closed.
real_run=subprocess.run
real_check=subprocess.check_output
def only_node(argv,*args,**kwargs):
    assert argv[:2]==['/usr/bin/node','--max-old-space-size=128'],'unexpected-subprocess'
    return real_check(argv,*args,**kwargs)
with patch.object(subprocess,'check_output',side_effect=only_node):
    h.trial('harmless source comment first',source=h.BASE+'\n# Independent harmless comment.\n')
    h.trial('exact actual-helper PATH')
    parts=h.node_path(h.a.APP).split(':')
    for name,path in [('pre-npm base','/usr/bin:/bin'),('wrong order',':'.join([parts[1],parts[0],*parts[2:]])),('extra entry','/tmp/extra:'+':'.join(parts)),('missing node-gyp',':'.join(x for x in parts if 'node-gyp-bin' not in x))]:
        h.trial(name,{'env':{'PATH':path}},'attest-process-environment')
    h.trial('other sealed environment value',{'env':{'OPENPLAN_GTFS_MANAGED_INGESTION':'1'}},'attest-process-environment')
    h.trial('short process identity',{'env':{'OPENPLAN_COMMIT_SHA':h.a.APP_HEAD[:12]}},'attest-process-environment')
    h.trial('wrong process cwd',{'cwd':ROOT},'attest-process-cwd')
    h.trial('exclusive new fixture receipt',{'duplicate':True},'exclusive-receipt')
    h.trial('new file identity',{'wrongEntry':True},'attestor-root',entry=True)
    needle="a.require(all(environment.get(key)==value for key,value in expected.items()), 'attest-process-environment')"
    assert needle in h.BASE
    try:h.trial('removed environment enforcement',{'env':{'PATH':'/usr/bin:/bin'}},'attest-process-environment',h.BASE.replace(needle,"a.require(True, 'attest-process-environment')"))
    except AssertionError as e:assert str(e)=='removed environment enforcement:accepted-broken-behavior'
    else:raise AssertionError('environment-removal-missed')
    h.trial('missing PATH replacement',reason='attest-process-environment',source=h.BASE.replace("    expected['PATH']=npm_child_path(expected['PATH'])\n",''))
    h.trial('exact source restored')
# Independently exercise two new import guards without substituting attest().
controls=[]
def refuse(fn,reason):
    try:fn()
    except ValueError as e:assert str(e)==reason
    else:raise AssertionError('accepted-broken-behavior:'+reason)
with patch.object(Path,'read_bytes',lambda p: b'changed' if p==h.V3/'app_binding_v1.py' else h.rb(p)):
    refuse(h.load,'attest-binding-sha')
    removed=h.BASE.replace("if hashlib.sha256((V3/'app_binding_v1.py').read_bytes()).hexdigest() != BINDING_SHA:",'if False:')
    try:refuse(lambda:h.load(removed),'attest-binding-sha')
    except AssertionError as e:assert str(e)=='accepted-broken-behavior:attest-binding-sha';controls.append(str(e))
    else:raise AssertionError('import-hash-removal-missed')
fake=types.SimpleNamespace(__file__=str(ROOT/'other.py'),require=h.a.require,sha=lambda p:h.m.BINDING_SHA)
with patch.dict(sys.modules,{'app_binding_v1':fake}):refuse(h.load,'attest-binding-module')
with patch.object(h.a,'sha',return_value='0'*64):refuse(lambda:h.m.npm_child_path('/usr/bin:/bin'),'attest-npm-source:run.js')
refuse(lambda:h.m.npm_child_path('/bin:/usr/bin'),'attest-base-path')
assert (ROOT/'attest_start_v2.py').read_text()==h.BASE,'source-not-restored'
result={'adapterSourceSha256':hashlib.sha256((PACKET/'verify_attestor.py').read_bytes()).hexdigest(),'cases':h.rows,'actualHelperParity':True,'derivedPathSha256':hashlib.sha256(expected.encode()).hexdigest(),'parityControls':['harmless-survives','wrong-spawn-path-detected'],'mutations':['environment-guard-removal-exposes-acceptance','missing-PATH-replacement-refuses',*controls],'newImportModuleNpmBaseRefusals':True,'exactSourceRestored':True,'limits':['Actual attest() and binding consumers execute. Synthetic producers and operational proc/systemd/HTTP/recovery adapters do not establish real acquisition.','Source/global/Storage and service acquisition use fixtures. No actual attestation, npm dispatch, build or start.']}
(ROOT/'function.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'cases':len(h.rows),'actualHelperParity':True,'mutations':len(result['mutations']),'restored':True}))
