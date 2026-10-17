"""Finite pure preparation. Copies source, never imports an old runtime."""
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/a0-migration-history-literal-correction-20261016')
OLD = ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r6')
AUTHOR = Path('/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52')
REVIEW = Path('/home/nathaniel/.t3/worktrees/openplan/t3-012fdf58/docs/reviews/2026-10-16-a0-r6-apply17-admission-independent/REVIEW.md')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def emit(path, value):
    with path.open('x',encoding='utf-8') as out:
        json.dump(value,out,indent=2,sort_keys=True);out.write('\n')
    path.chmod(0o600)


def pin(path):
    info=path.lstat()
    if not path.is_file() or path.is_symlink():
        raise ValueError('pin-regular:'+str(path))
    return {'sha256':sha(path),'bytes':info.st_size,'mode':info.st_mode & 0o777,
            'uid':info.st_uid,'gid':info.st_gid}


def main():
    os.umask(0o077)
    templates=ROOT/'templates';templates.mkdir(mode=0o700)
    for path in sorted((HERE/'runtime').rglob('*')):
        if not path.is_file():continue
        destination=templates/path.relative_to(HERE/'runtime')
        destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with destination.open('xb') as out:out.write(path.read_bytes())
        destination.chmod(0o700 if destination.suffix=='.sh' else 0o600)
    bindings=ROOT/'bindings';bindings.mkdir(mode=0o700)
    for name in ['source-pins.json','preceding-helper-pins.json']:
        with (bindings/name).open('xb') as out:out.write((OLD/'bindings'/name).read_bytes())
    with (ROOT/'plan.json').open('xb') as out:out.write((OLD/'plan.json').read_bytes())
    rejected=ROOT.parent/'a0-r6-apply17-admission-proposal-20261016'
    prior=json.loads((rejected/'prior-function-pins.json').read_text())
    emit(bindings/'prior-function-pins.json',prior)
    paths={OLD/'plan.json'}
    for stage,count in [('observe',89),('allocate',131),('restore419',169)]:
        directory=ROOT.parent/('a0-r6-'+stage.replace('restore419','restore419')+'-root-decision-20261016')
        manifest=directory/'native-proof-pins.json'
        entries=json.loads(manifest.read_text())
        if len(entries)!=count:raise ValueError('proof-entry-count')
        paths.add(manifest)
        for entry in entries:
            path=Path(entry['path']);actual=pin(path)
            expected={**entry};expected.pop('path')
            expected['mode']=int(expected['mode'],8)
            if actual!=expected:raise ValueError('actual-external-receipt-drift:'+str(path))
            paths.add(path)
    paths.update((OLD/'bindings').glob('*.json'))
    paths.update(x for x in (OLD/'templates').rglob('*') if x.is_file())
    paths.update(rejected/x for x in ['actual-prior-definitions.json','prior-function-pins.json','apply17-proposal.json','proposal-custody.json'])
    paths.add(ROOT.parent/'a0-r6-apply17-parent-runner-20261016.py')
    target=json.loads((OLD/'stages/allocate/target.json').read_text())
    binding={'root':str(OLD),'kind':'actual-r6-restore419','stage':'restore419',
        'completeSHA256':'fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f',
        'target':target,'planSHA256':sha(OLD/'plan.json'),
        'files':{str(path):pin(path) for path in sorted(paths)}}
    emit(bindings/'external-predecessor.json',binding)
    reports={str(path):pin(path) for path in sorted((ROOT/'reports').iterdir())}
    reports[str(REVIEW)]=pin(REVIEW)
    research=Path('/home/nathaniel/.t3/worktrees/openplan/t3-989ae2bb/docs/reviews/2026-10-16-postgres-history-literal-semantics')
    for name in ['RESEARCH.md','SOURCES.md','STATUS.md','source-pins.json']:
        reports[str(research/name)]=pin(research/name)
    upstream=ROOT.parent/'postgres-history-literal-semantics-20261016'
    for name in ['custody-manifest.json','official/src__bin__psql__mainloop.c',
                 'official/src__bin__psql__common.c','official/src__fe_utils__psqlscan.l']:
        reports[str(upstream/name)]=pin(upstream/name)
    emit(bindings/'review-pins.json',reports)
    # The new executable seal does not rename old executions or copy stage trees.
    package={'files':{str(x.relative_to(templates)):sha(x) for x in sorted(templates.rglob('*')) if x.is_file()},
        'bindings':{x.name:sha(x) for x in sorted(bindings.glob('*.json'))},
        'notice':'NEW source continuation. No native execution or admission.'}
    emit(bindings/'package-pins.json',package)
    proposal={'stage':'apply17','packageSHA256':sha(bindings/'package-pins.json'),
        'planSHA256':sha(ROOT/'plan.json'),'predecessorSHA256':binding['completeSHA256'],
        'sourceCommit':'f8a571bb0a18b8b6501870acb5ef1e760d487e1c',
        'appTree':'d577a9cd955018b3253f42b3d9af2a96a9a10b53',
        'memoryBytes':1073741824,'swapBytes':0,'cpuPercent':50,
        'independentReviewSHA256':None,'continuedPredecessor':binding,
        'priorFunctionPins':prior,'functionPins':None,
        'notice':'PROPOSAL ONLY. Fresh independent exact-candidate review and explicit root continuation decision required.'}
    emit(ROOT/'proposed-admission.json',proposal)
    emit(ROOT/'selected-before.json',{str(x):pin(x) for x in sorted(paths)})
    print(json.dumps({'newRuntimeFiles':len(package['files']),'externalSelected':len(paths),
                      'packageSHA256':sha(bindings/'package-pins.json'),'admitted':False}))


if __name__=='__main__':main()
