"""Selected code removals use the same function fixture, with a fresh owned root."""
from pathlib import Path
import json
import sys
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
source=(PUBLIC/'verify_attestor.py').read_text().split("\ntrial('harmless comment first'",1)[0]
source=source.replace('attestor-specimen-02','attestor-specimen-guard-02')
h=types.ModuleType('guard_fixture');h.__file__=str(PUBLIC/'verify_attestor.py')
exec(compile(source,h.__file__,'exec'),vars(h))
h.trial('harmless guard campaign first',source=h.BASE+'\n# Harmless guard assay.\n')
rows=[]


def refusal(action,reason):
    try:action()
    except ValueError as error:
        assert str(error)==reason,'wrong-refusal:'+str(error)
        return
    raise AssertionError('accepted-broken-behavior:'+reason)


def detect(name,action):
    try:action()
    except AssertionError as error:
        assert str(error).startswith('accepted-broken-behavior:'),str(error)
        rows.append({'mutation':name,'detectedBy':str(error)})
    else:raise AssertionError('guard-removal-missed:'+name)


# The no-op survivor precedes each deliberate code fault in this assay.
base=h.BASE
prefix="if hashlib.sha256((V3/'app_binding_v1.py').read_bytes()).hexdigest() != BINDING_SHA:"
assert prefix in base
wrong=lambda path: b'wrong' if path==h.V3/'app_binding_v1.py' else h.rb(path)
with patch.object(Path,'read_bytes',wrong):
    refusal(lambda:h.load(), 'attest-binding-sha')
    detect('remove preimport source hash',lambda:refusal(lambda:h.load(base.replace(prefix,'if False:')),'attest-binding-sha'))
fake=types.SimpleNamespace(__file__=str(h.ROOT/'wrong-binding.py'),require=h.a.require,sha=lambda p:h.m.BINDING_SHA)
module_guard="a.require(Path(a.__file__).resolve()==V3/'app_binding_v1.py' and\n          a.sha(Path(a.__file__))==BINDING_SHA, 'attest-binding-module')"
assert module_guard in base
with patch.dict(sys.modules,{'app_binding_v1':fake}):
    refusal(lambda:h.load(),'attest-binding-module')
    detect('remove imported module path/hash',lambda:refusal(lambda:h.load(base.replace(module_guard,"a.require(True, 'attest-binding-module')")),'attest-binding-module'))
subject=h.load()
with patch.object(h.a,'sha',return_value='0'*64):
    refusal(lambda:subject.npm_child_path('/usr/bin:/bin'),'attest-npm-source:run.js')
    changed=h.load(base.replace("a.require(a.sha(Path(name))==expected,",'a.require(True,'))
    detect('remove npm source hashes',lambda:refusal(lambda:changed.npm_child_path('/usr/bin:/bin'),'attest-npm-source:run.js'))
refusal(lambda:subject.npm_child_path('/bin:/usr/bin'),'attest-base-path')
changed=h.load(base.replace("a.require(base=='/usr/bin:/bin',",'a.require(True,'))
detect('remove trusted base PATH guard',lambda:refusal(lambda:changed.npm_child_path('/bin:/usr/bin'),'attest-base-path'))
needle="a.require(Path(__file__).resolve()==NEW_ROOT/'attest_start_v2.py','attestor-root')"
assert needle in base
try:h.trial('remove new file guard',{'wrongEntry':True},'attestor-root',base.replace(needle,"a.require(True,'attestor-root')"),entry=True)
except AssertionError as error:
    assert str(error)=='remove new file guard:accepted-broken-behavior';rows.append({'mutation':'remove new file guard','detectedBy':str(error)})
else:raise AssertionError('file-guard-removal-missed')
h.trial('removed PATH replacement refuses actual helper PATH',reason='attest-process-environment',source=base.replace("    expected['PATH']=npm_child_path(expected['PATH'])\n",''))
rows.append({'mutation':'remove PATH replacement','detectedBy':'attest-process-environment'})
h.trial('restored after guard faults')
(h.ROOT/'new-guard-controls.json').write_text(json.dumps({'cases':h.rows,'guardRemovalDetections':rows,'restored':True,'limits':['Same explicit operational fixture adapters as verify_attestor.py.','The original binding module is read and imported, never rewritten. Hash acquisition faults are in-memory adapters.']},indent=2)+'\n')
print(json.dumps({'guardRemovalDetections':len(rows),'restored':True}))
