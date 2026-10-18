"""Read-only sealed-file comparison and known-value publication screen."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
PUBLIC=Path(__file__).resolve().parent


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()


def same_record(a,b):
    return all(a[k]==b[k] for k in ['sha256','mode','bytes'])


def main():
    before=json.loads((ROOT/'preservation-before.json').read_bytes())
    after={p:{'sha256':sha(Path(p)),'mode':Path(p).stat().st_mode&0o777,'bytes':Path(p).stat().st_size} for p in before}
    assert after==before,'selected-preservation-changed'
    # Exercise this comparison on owned specimens, never mutate a sealed file.
    specimen=ROOT/'preservation-specimen';specimen.write_bytes(b'unchanged');specimen.chmod(0o600)
    record=lambda:{'sha256':sha(specimen),'mode':specimen.stat().st_mode&0o777,'bytes':specimen.stat().st_size}
    saved=record();controls=[]
    try:
        harmless={**record(),'comment':'harmless metadata'}
        assert same_record(saved,harmless);controls.append({'case':'harmless-metadata','outcome':'SURVIVED'})
        specimen.write_bytes(b'different')
        assert not same_record(saved,record());controls.append({'case':'changed-bytes','outcome':'DETECTED'})
        specimen.write_bytes(b'unchanged');specimen.chmod(0o640)
        assert not same_record(saved,record());controls.append({'case':'changed-mode','outcome':'DETECTED'})
    finally:specimen.write_bytes(b'unchanged');specimen.chmod(0o600)
    assert same_record(saved,record())
    # Compare exact hash identity of new installed runner with external reviewed copy.
    assert sha(ROOT/'run_attest_host.sh')==sha(PUBLIC/'run_attest_host.sh')
    pins=json.loads((ROOT/'external-pins.json').read_bytes())
    assert all(sha(Path(p))==d for p,d in pins.items()),'external-seal'
    manifest=json.loads((PUBLIC/'manifest.json').read_bytes())
    assert manifest['runnerSha256']==sha(ROOT/'run_attest_host.sh'),'runner-external-hash'
    changed=copy.deepcopy(manifest);changed['runnerSha256']='0'*64
    assert changed['runnerSha256']!=sha(ROOT/'run_attest_host.sh')
    # Values stay private. Publish detection counts and hashes only.
    env=json.loads((V3/'app-env-private.json').read_bytes())
    needles=[v.encode() for k,v in env.items() if isinstance(v,str) and len(v)>=12 and any(t in k for t in ['KEY','SECRET','TOKEN','PASSWORD','DATABASE_URL','URI'])]
    needles=list(dict.fromkeys(needles))
    def screen(data):return any(n in data for n in needles)
    assert not screen(b'Harmless public output.');privacy=[{'case':'harmless-text','outcome':'SURVIVED'}]
    for i,n in enumerate(needles):
        assert screen(b'fault '+n);privacy.append({'case':'known-value-%02d'%i,'outcome':'DETECTED'})
    for p in PUBLIC.rglob('*'):
        if p.is_file():assert not screen(p.read_bytes()),'known-private-value-in-public-output'
    web=subprocess.run(['/usr/bin/systemctl','--user','show','openplan-current-project-preview-app-21510042e-v3-web.service','--property=ActiveState,InvocationID'],env={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'XDG_RUNTIME_DIR':'/run/user/1000'},capture_output=True,text=True,timeout=5)
    assert web.returncode==0 and set(web.stdout.splitlines())=={'ActiveState=active','InvocationID=34615ba06b554482b0f79c90fe999a61'}
    assert not (V3/'execution/runtime-start-attestation.json').exists()
    assert not (ROOT/'attempt-host-01').exists()
    result={'selectedPreservationFiles':len(before),'selectedPreservationUnchanged':True,'preservationControls':controls,'privacyControls':privacy,'runnerMatchesExternalManifest':True,'externalPinsUnchanged':True,'originalWebInvocationUnchanged':True,'noActualHostAttemptReserved':True,'noRuntimeReceipt':True,'limits':['Selected fixed code/input/receipt files only. V3 candidate and execution cache naturally change while web runs.','No logical database or Storage preservation acquisition; no live attestation.','Known-value screen cannot detect unknown secrets.','Hash comparisons trust reviewed bytes, ordinary host tools and same-user custody.']}
    (ROOT/'final-checks.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'selectedFiles':len(before),'preservation':'unchanged','privacyControls':len(privacy),'noActualAttestation':True}))


if __name__=='__main__':main()
