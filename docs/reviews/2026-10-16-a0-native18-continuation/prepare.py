"""Prepare only this new capsule. No imports or execution of an old subject."""
import hashlib
import json
import os
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-native18-continuation-20261016')
PRIOR=ROOT.with_name('a0-predecessor-map-correction-20261016')


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def emit(path,value):
    with path.open('x') as out:json.dump(value,out,indent=2,sort_keys=True);out.write('\n')
    path.chmod(0o600)


def pin(path):
    info=path.lstat()
    if not path.is_file() or path.is_symlink():raise ValueError('pin-regular')
    return {'sha256':sha(path),'bytes':info.st_size,'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}


def main():
    os.umask(0o077)
    templates=ROOT/'templates';templates.mkdir(mode=0o700)
    for path in sorted((HERE/'runtime').rglob('*')):
        if not path.is_file():continue
        target=templates/path.relative_to(HERE/'runtime')
        target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with target.open('xb') as out:out.write(path.read_bytes())
        target.chmod(0o700 if target.suffix=='.sh' else 0o600)
    bindings=ROOT/'bindings';bindings.mkdir(mode=0o700)
    for name in ['source-pins.json','preceding-helper-pins.json','prior-function-pins.json','external-predecessor.json']:
        with (bindings/name).open('xb') as out:out.write((PRIOR/'bindings'/name).read_bytes())
    for name in ['continued-predecessor.json','expected-post-functions.json']:
        with (bindings/name).open('xb') as out:out.write((HERE/name).read_bytes())
    with (ROOT/'plan.json').open('xb') as out:out.write((PRIOR/'plan.json').read_bytes())
    reports=json.loads((PRIOR/'bindings/review-pins.json').read_text())
    for path in sorted((ROOT/'reports').iterdir()):reports[str(path)]=pin(path)
    for path in HERE.with_name('2026-10-16-a0-predecessor-map-correction').rglob('*'):
        if path.is_file():reports[str(path)]=pin(path)
    for name in ['private-manifest.json','local-commit.json','plan.json','bindings/package-pins.json','proposed-admission.json']:
        path=PRIOR/name;reports[str(path)]=pin(path)
    emit(bindings/'review-pins.json',reports)
    package={'files':{str(p.relative_to(templates)):sha(p) for p in sorted(templates.rglob('*')) if p.is_file()},
        'bindings':{p.name:sha(p) for p in sorted(bindings.iterdir()) if p.is_file()},
        'notice':'NEW18-only capsule. Actual map17 and originalR6 remain external actual predecessors. No admission.'}
    emit(bindings/'package-pins.json',package)
    proposal=json.loads((PRIOR/'proposed-admission.json').read_text())
    proposal.update(stage='apply18',packageSHA256=sha(bindings/'package-pins.json'),independentReviewSHA256=None,
        predecessorSHA256=json.loads((HERE/'continued-predecessor.json').read_text())['completeSHA256'],
        originalR6Predecessor=proposal['continuedPredecessor'],continuedPredecessor=json.loads((HERE/'continued-predecessor.json').read_text()),
        expectedPostFunctions=json.loads((HERE/'expected-post-functions.json').read_text()),functionPins=None,
        notice='PROPOSAL ONLY. New18-only continuation from actual map17. Root independent source review and separate actual admission required.')
    emit(ROOT/'proposed-admission.json',proposal)
    paths=set(Path(x) for x in proposal['continuedPredecessor']['files'])|set(Path(x) for x in proposal['originalR6Predecessor']['files'])|set(Path(x) for x in reports)
    emit(ROOT/'selected-before.json',{str(p):pin(p) for p in sorted(paths)})
    print(json.dumps({'runtimeFiles':len(package['files']),'selectedExternalAndPrior':len(paths),'packageSHA256':sha(bindings/'package-pins.json'),'planSHA256':sha(ROOT/'plan.json'),'admitted':False}))


if __name__=='__main__':main()
