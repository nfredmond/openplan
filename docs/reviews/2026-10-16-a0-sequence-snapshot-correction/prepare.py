#!/usr/bin/python3
"""R6 preparation and selected custody. No native dispatcher lives here."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import uuid

REPO=Path('/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52')
HERE=REPO/'docs/reviews/2026-10-16-a0-sequence-snapshot-correction'
SOURCE=HERE/'runtime'
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-usage-limit-native-wrapper-20261016-r6')
EVIDENCE=Path('/home/nathaniel/.local/state/openplan/a0-sequence-snapshot-correction-20261016')
PRIOR=REPO/'docs/reviews/2026-10-16-a0-case-temp-oid-correction'
OLD=ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r5')
REVIEW=Path('/home/nathaniel/.t3/worktrees/openplan/t3-706f7154/docs/reviews/2026-10-16-a0-r5-restore419-admission-independent')
DECISION=ROOT.parent/'a0-r5-restore419-root-decision-20261016'
PARENT=ROOT.parent/'a0-native-wrapper-r5-restore419-parent-operation-20261016/restore419'
REPORTS=ROOT.parent/'project-budget-reviewed-combined-20261016/docs/reviews'
RUNTIME=['controller.py','cases.py','fixture.py','journal.py','policy.py','run_stage.sh',
         'sql/assertions.sql','sql/post_rollback.sql','sql/shadows.sql']
FAILED_TARGET='openplan_a0_limit_c2e1f4598374c1bf439baa3b'
REVIEW_SHA='bfedfa199bc98e72f3efc54102b8defda9500d67203e54ff14747845865ecf14'


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def write(path,value):
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with path.open('x') as stream:json.dump(value,stream,indent=2);stream.write('\n')
    path.chmod(0o600)


def pin(path):
    info=path.lstat()
    assert path.is_file() and not path.is_symlink(),str(path)
    return {'sha256':sha(path),'bytes':info.st_size,'mode':oct(info.st_mode&0o777),
            'uid':info.st_uid,'gid':info.st_gid}


def selected():
    """Select immutable seals and native journals, never copy old campaign trees."""
    paths=set()
    prior=json.loads((PRIOR/'evidence-pins.json').read_text())
    for name in [*prior['public'],'evidence-pins.json']:paths.add(PRIOR/name)
    paths.add(OLD/prior['privateManifest']['path'])
    for name in prior['selectedPrivateEvidence']:paths.add(OLD/name)
    for name in RUNTIME:paths.add(OLD/'templates'/name)
    package=json.loads((OLD/'bindings/package-pins.json').read_text())
    for name in [*package['bindings'],'package-pins.json']:paths.add(OLD/'bindings'/name)
    for name in json.loads((OLD/'bindings/preceding-helper-pins.json').read_text()):paths.add(Path(name))
    # Source bindings are byte pins, not copied source or campaign bodies.
    for name in json.loads((OLD/'bindings/source-pins.json').read_text())['files']:
        paths.add(REPO/name)
    for root in [OLD/'stages',OLD/'admissions',DECISION,PARENT,REVIEW]:
        for path in root.rglob('*'):
            if path.is_file():paths.add(path)
            assert not path.is_symlink(),str(path)
    for stage in ['observe','allocate']:
        folder=REPORTS/('2026-10-16-a0-r5-native-'+stage)
        paths.update(folder.iterdir())
    # Old R3/R4 packets stay selected seals/plans/runtimes, not recursive copies.
    for suffix in ['-r3','-r4']:
        root=ROOT.with_name('a0-usage-limit-native-wrapper-20261016'+suffix)
        paths.add(root/'plan.json')
        paths.update((root/'bindings').glob('*.json'))
        paths.update(root/'templates'/name for name in RUNTIME)
    r3=ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r3')/'stages/observe'
    paths.update(path for path in r3.rglob('*') if path.is_file())
    return {str(path):pin(path) for path in sorted(paths)}


def verify_old():
    for name,expected in json.loads((OLD/'bindings/source-pins.json').read_text())['files'].items():
        assert sha(REPO/name)==expected,'frozen-source:'+name
    package=json.loads((OLD/'bindings/package-pins.json').read_text())
    for name,expected in package['files'].items():assert sha(OLD/'templates'/name)==expected,'runtime:'+name
    for name,expected in package['bindings'].items():assert sha(OLD/'bindings'/name)==expected,'binding:'+name
    for name,expected in json.loads((OLD/'bindings/preceding-helper-pins.json').read_text()).items():
        actual=pin(Path(name));assert all(actual[k]==v for k,v in expected.items()),'helper:'+name
    evidence=json.loads((PRIOR/'evidence-pins.json').read_text())
    assert sha(OLD/evidence['privateManifest']['path'])==evidence['privateManifest']['sha256']
    assert evidence['privateManifest']['entries']==17376
    assert sha(REVIEW/'REVIEW.md')==REVIEW_SHA
    history=json.loads((OLD/'stages/restore419/controller/request-019/stdout.bin').read_text())
    plan=json.loads((OLD/'plan.json').read_text())
    assert history['versions']==plan['sourceVersions'] and history['count']==plan['sourceHistory']['count'] and history['latest']==plan['sourceVersions'][-1] and history['digest']==plan['sourceHistory']['digest'],'retained-history-match'
    snapshot=json.loads(Path(next(k for k in json.loads((OLD/'bindings/preceding-helper-pins.json').read_text()) if k.endswith('/source-binding-private.json'))).read_text())['snapshot']
    projected=[row for row in snapshot if 'table' in row or 'sequences' in row]
    assert projected==plan['sourceTableDigests'],'frozen-source-table-sequence-pins'
    return {'sourcePins':652,'runtimeFiles':9,'bindingFiles':5,'precedingHelpers':7,
            'oldCampaign':'17,376-file manifest hash and selected files only; no recursive copy or full rerun',
            'failedRestoreHistory':'raw 419 row matches plan; no accepted restoration inferred'}


def emit_sql(destination,subject,plan):
    destination.mkdir(mode=0o700,parents=True)
    sys.path.insert(0,str(subject))
    import controller,cases,fixture
    files={}
    def emit(name,text):
        path=destination/name
        with path.open('x') as stream:stream.write('-- PREPARATION ONLY. Controller prepends actual root-admitted native identity.\n'+text+'\n')
        path.chmod(0o600);files[name]={'bytes':path.stat().st_size,'sha256':sha(path)}
    emit('fixture.sql','BEGIN; '+controller.BOUNDS+' SET LOCAL ROLE postgres;\n'+fixture.seed(plan)+'\nCOMMIT;')
    for name in cases.CASES:
        text='BEGIN; '+controller.BOUNDS+'\n'
        if name=='shadow':text+=(subject/'sql/shadows.sql').read_text()+'\n'
        text+='SET LOCAL ROLE service_role;\n'+(subject/'sql/assertions.sql').read_text()+'\n'+cases.body(name,plan)+'\nROLLBACK;\n'+(subject/'sql/post_rollback.sql').read_text()
        emit('case-'+name+'.sql',text)
    for name in cases.MUTATIONS:
        text=cases.mutation_sql(name,(REPO/controller.SQL18).read_text())
        emit('mutation-'+name+'.sql','BEGIN; '+controller.BOUNDS+' SET LOCAL ROLE postgres;\n'+text+'\n-- Controller adds named assertion and restoration checks.\nROLLBACK;')
    write(destination/'pins.json',{'files':files,'planSHA256':sha(ROOT/'plan.json'),'parsedByPostgres':False,'executed':False,
        'authority':'Controller builds actual admitted inputs; artifacts grant no admission.'})
    return files


def main():
    os.umask(0o077)
    assert not (ROOT/'admissions').exists() and not (ROOT/'stages').exists()
    old=verify_old();write(EVIDENCE/'old-selected-before.json',selected());write(EVIDENCE/'old-verification.json',old)
    plan=json.loads((OLD/'plan.json').read_text())
    plan['database']='openplan_a0_limit_'+secrets.token_hex(12)
    plan['fixture']={key:str(uuid.uuid4()) for key in plan['fixture']}
    plan['tokenHash']=hashlib.sha256(secrets.token_bytes(32)).hexdigest()
    plan['protected']=list(dict.fromkeys([*plan['protected'],FAILED_TARGET]))
    write(ROOT/'plan.json',plan)
    templates=ROOT/'templates';templates.mkdir(mode=0o700)
    for name in RUNTIME:
        path=templates/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write((SOURCE/name).read_bytes())
        path.chmod(0o700 if name=='run_stage.sh' else 0o600)
    bindings=ROOT/'bindings';bindings.mkdir(mode=0o700)
    pins=json.loads((OLD/'bindings/source-pins.json').read_text())
    pins.update(wrapperBaseCommit='1b21ef6dbc3c9a75872ad6d36e6b7d369c6fda9a',
        restoreProposalReviewCommit='98cff4cf63ab760dc6be8550263470a019be1ec7',
        actualFailure='request021 snapshot sequence composite type; no old-stage retry')
    already={str(REPO/name) for name in pins['files']}
    for path,details in json.loads((EVIDENCE/'old-selected-before.json').read_text()).items():
        if path not in already:pins['files'][path]=details['sha256']
    write(bindings/'source-pins.json',pins)
    write(bindings/'preceding-helper-pins.json',json.loads((OLD/'bindings/preceding-helper-pins.json').read_text()))
    sys.path.insert(0,str(templates))
    import controller,cases
    write(bindings/'inventory.json',{'stages':controller.STAGES,'cases':cases.CASES,'nativeMutations':cases.MUTATIONS,
        'races':controller.RACES,'nativeStagesExecuted':0,'rootAloneAdmitsAllocatesExecutes':True})
    write(bindings/'proposed-target.json',{'database':plan['database'],'allocated':False,'planSHA256':sha(ROOT/'plan.json'),
        'failedR5TargetExcluded':FAILED_TARGET})
    example=json.loads((OLD/'bindings/admission.example.json').read_text())
    example['notice']='PREPARED R6 PLACEHOLDER. Fresh independent exact-source review and separate root admission required. Nulls grant no admission.'
    write(bindings/'admission.example.json',example)
    write(bindings/'package-pins.json',{'files':{name:sha(templates/name) for name in RUNTIME},
        'bindings':{path.name:sha(path) for path in sorted(bindings.glob('*.json'))},
        'wrapperBaseCommit':'1b21ef6dbc3c9a75872ad6d36e6b7d369c6fda9a',
        'newAdmissionReview':'MISSING: fresh R6 review required'})
    files=emit_sql(ROOT/'prepared-sql',templates,plan)
    print(json.dumps({'preparedSQL':len(files),'targetAllocated':False,'nativeDispatches':0}))


if __name__=='__main__':main()
