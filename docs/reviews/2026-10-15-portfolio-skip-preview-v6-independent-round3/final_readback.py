"""Final report custody and known-value screen. No operating transport."""
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
PROOF = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-independent-round3-20261015-4cefaf52')
SEALED = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def read(path):
    return json.loads(Path(path).read_text())


def main():
    subject = HERE.with_name('2026-10-15-portfolio-skip-preview-v6-active-helper-fix')
    bindings = read(HERE/'source-bindings.json')
    require(all(sha(SEALED/name)==value for name,value in bindings['subjectSealedPrivateFiles'].items()),'sealed-custody')
    require(all(sha(subject/name)==value for name,value in bindings['subjectPublicFiles'].items()),'public-custody')
    priors = {}
    for worktree,name,commit in [
        ('t3-1eb9f303','2026-10-15-portfolio-skip-preview-v4-independent-round1','b037efc892359dcbd5350eb64438604610713ca5'),
        ('t3-78ca8e4a','2026-10-15-portfolio-skip-preview-v5-independent-round2','0257e77b1a4d76d42e9bdb621e05374b83db613e')]:
        root = Path('/home/nathaniel/.t3/worktrees/openplan')/worktree/'docs/reviews'/name
        files = {path.name:sha(path) for path in root.iterdir() if path.is_file()}
        for path in root.iterdir():
            if path.is_file():
                require(subprocess.check_output(['/usr/bin/git','show',commit+':docs/reviews/'+name+'/'+path.name],cwd=HERE.parents[2])==path.read_bytes(),'prior-review-commit')
        priors[commit] = {'root':str(root),'files':files}
    failure = subject/'harness-failures.json'
    attempt = read(failure)['attempts'][0]
    require(sha(SEALED/'controls/final-audit-failed-01.py')==attempt['failedSourceSHA256'],'failed-source-custody')
    require(sha(SEALED/'controls/final-audit-failed-01-output.txt')==attempt['retainedToolOutputSHA256'],'failed-output-custody')
    secrets = set()
    for value in [read(SEALED/'app-env-private.json'),*read(SEALED/'envs-private.json').values()]:
        for key,item in value.items():
            if any(word in key for word in ['KEY','SECRET','DATABASE_URL','DB_URI']) and len(item)>15:
                secrets.add(item.encode())
    require(bool(secrets),'no-known-values')
    def screen(data):
        require(not any(secret in data for secret in secrets),'known-secret')
        require(bytes.fromhex('e28094') not in data,'em-dash')
    def detector(scanner, data, reason):
        try:
            scanner(data)
        except AssertionError as error:
            require(str(error)==reason,'wrong-screen-failure')
        else:
            raise AssertionError('missing-screen-refusal')
    screen(b'harmless public text')
    detector(screen,next(iter(secrets)),'known-secret')
    detector(screen,bytes.fromhex('e28094'),'em-dash')
    try:
        detector(lambda data:None,next(iter(secrets)),'known-secret')
    except AssertionError as error:
        require(str(error)=='missing-screen-refusal','wrong-disabled-screen-failure')
    else:
        raise AssertionError('disabled-screen-survived')
    for path in HERE.rglob('*'):
        if path.is_file():
            screen(path.read_bytes())
            if path.suffix=='.py':
                compile(path.read_text(),str(path),'exec')
    require(not list((SEALED/'execution').iterdir()) and not (SEALED/'candidate').exists(),'operating-stage-present')
    result = {'scope':'File/report readback and known-value screen only.',
        'priorReviews':priors,'retainedFailedAuditSourceAndOutputExact':True,
        'knownValueScreenHarmlessInjectionAndDisabledScannerControls':True,
        'blindCategories':['Known-value scanning cannot prove absence of unknown secrets.',
            'File readback does not establish runtime preservation or operating-stage acceptance.'],
        'reportFileHashes':{str(path.relative_to(HERE)):sha(path) for path in HERE.rglob('*') if path.is_file()},
        'operatingStages':0}
    for path in [PROOF/'final-readback.json',HERE/'final-readback.json']:
        with path.open('x') as stream:
            json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps({'priorReviewFiles':sum(len(value['files']) for value in priors.values()),
        'screen':'pass with negative controls','operatingStages':0}))


if __name__=='__main__':
    main()
