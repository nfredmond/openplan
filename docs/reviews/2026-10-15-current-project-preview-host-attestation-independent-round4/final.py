"""Selected preservation, unit-state readback and known-value privacy checks."""
import hashlib
import json
import marshal
import os
from pathlib import Path
import subprocess

PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-independent-round4-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
NEW=ROOT.parent/'current-project-preview-host-attestation-v2-20261015'
OLD=ROOT.parent/'current-project-preview-host-attestation-fix-20261015'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
record=lambda p:{'sha256':sha(p),'mode':p.stat().st_mode&0o777,'bytes':p.stat().st_size}
before=json.loads((ROOT/'preservation-before.json').read_bytes())
def same(a,b):return all(a[k]==b[k] for k in ['sha256','mode','bytes'])
def unchanged(a,b):assert set(a)==set(b) and all(same(a[p],b[p]) for p in a),'selected-fixed-file-changed'
# Harmless first, byte and mode faults only on an owned specimen, then restore.
p=ROOT/'preservation-specimen';p.write_bytes(b'original');p.chmod(0o600)
saved=p.read_bytes();saved_mode=0o600;baseline={'specimen':record(p)}
unchanged(baseline,{'specimen':{**record(p),'harmless':'metadata'}})
for kind in ['bytes','mode']:
    try:
        if kind=='bytes':p.write_bytes(b'changed')
        else:p.chmod(0o640)
        try:unchanged(baseline,{'specimen':record(p)})
        except AssertionError as e:assert str(e)=='selected-fixed-file-changed'
        else:raise AssertionError('preservation-oracle-missed:'+kind)
    finally:p.write_bytes(saved);p.chmod(saved_mode)
unchanged(baseline,{'specimen':record(p)})
unchanged(before,{name:record(Path(name)) for name in before})
# Python -B prevents writes but may read an existing cache. Compare this small
# imported module cache to fresh compilation without executing the cached code.
source=V3/'app_binding_v1.py';caches=list((V3/'__pycache__').glob('app_binding_v1.*.pyc'))
cache_rows=[]
for cache in caches:
    cached=marshal.loads(cache.read_bytes()[16:])
    fresh=compile(source.read_bytes(),str(source),'exec')
    assert cached==fresh,'binding-bytecode-source-mismatch'
    cache_rows.append({'file':str(cache),'matchesFreshCompilation':True,'sha256':sha(cache)})
# Current bytecode equality is observation, not an external seal or loader defense.
paths=[V3/'execution/runtime-start-attestation.json',NEW/'runtime-start-attestation.json',OLD/'runtime-start-attestation.json',NEW/'attempt-host-v2-01',OLD/'attempt-host-01']
def absent(path):assert not path.exists() and not path.is_symlink(),'actual-receipt-or-attempt-exists'
for path in paths:absent(path)
probe=ROOT/'absence-probe'
absent(probe);probe.symlink_to(ROOT/'missing-peer')
try:
    try:absent(probe)
    except AssertionError as e:assert str(e)=='actual-receipt-or-attempt-exists'
    else:raise AssertionError('absence-oracle-missed')
finally:probe.unlink()
absent(probe)
env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home'),'XDG_RUNTIME_DIR':'/run/user/1000'}
def properties(unit,names):
    result=subprocess.run(['/usr/bin/systemctl','--user','show',unit,'--property='+names],env=env,capture_output=True,text=True,timeout=5)
    assert result.returncode==0,'unit-readback-failed'
    return dict(row.split('=',1) for row in result.stdout.splitlines())
web=properties('openplan-current-project-preview-app-21510042e-v3-web.service','ActiveState,InvocationID,ControlGroup')
assert web['ActiveState']=='active' and web['InvocationID']=='34615ba06b554482b0f79c90fe999a61','web-invocation-changed'
units={}
for unit in ['openplan-current-project-preview-app-21510042e-v3-attest-host-01.service','openplan-current-project-preview-app-21510042e-v3-attest-host-v2-01.service']:
    r=subprocess.run(['/usr/bin/systemctl','--user','show',unit,'--property=LoadState','--value'],env=env,capture_output=True,text=True,timeout=5)
    assert r.stdout.strip()=='not-found','actual-host-unit-exists'
    units[unit]='not-found'
# Publish no process environments or known credential values.
values=json.loads((V3/'app-env-private.json').read_bytes())
needles=list(dict.fromkeys(v.encode() for k,v in values.items() if isinstance(v,str) and len(v)>=12 and any(t in k for t in ['KEY','SECRET','TOKEN','PASSWORD','DATABASE_URL','URI'])))
def private(data):return any(n in data for n in needles)
assert not private(b'Harmless first privacy control.')
for n in needles:assert private(b'fault '+n),'privacy-oracle-missed'
for f in PUBLIC.rglob('*'):
    if f.is_file():assert not private(f.read_bytes()),'known-secret-in-public-file'
result={'selectedFixedFiles':len(before),'selectedFixedFilesUnchanged':True,'preservationControls':['harmless-survives','byte-fault-detected','mode-fault-detected','restored'],'absenceControls':['absent-survives','dangling-link-detected','restored'],'absentPaths':[str(p) for p in paths],'originalWeb':web,'actualHostUnits':units,'existingBindingBytecode':cache_rows,'knownValuePrivacyControls':len(needles),'publicKnownValueScreenClear':True,'limits':['Unknown secrets are outside the known-value screen.','Selected fixed files exclude running runtime caches and all logical DB/global/Storage preservation.','Bytecode observation does not seal future loader/cache behavior. Host tools/loader and same-user custody remain trust assumptions.','No actual listener/process-environment/HTTP/readiness/preservation attestation or product acceptance.']}
(ROOT/'final.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'selectedFiles':len(before),'unchanged':True,'actualHostAttemptsAndReceiptsAbsent':True,'originalWebInvocationUnchanged':True,'bytecodeCopiesCompared':len(cache_rows),'knownValueControls':len(needles)}))
