"""Audit sealed v2 and frozen old bytes/modes without services or database queries."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

from prepare_v2 import PUBLIC, OLD_PUBLIC, OLD, ROOT, FROZEN, OBS, sha, inventory
os.umask(0o077)

def write(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
    path.chmod(0o600)

def read(path):return json.loads(path.read_bytes())

# Prove the preservation comparison sees harmless reads, changed bytes and modes.
specimen=ROOT/'audit-specimen-02';specimen.mkdir(mode=0o700)
p=specimen/'file';p.write_text('original');p.chmod(0o600)
baseline=inventory(specimen)
assert p.read_text()=='original' and inventory(specimen)==baseline
try:
    p.write_text('changed');assert inventory(specimen)!=baseline
    p.write_text('original');p.chmod(0o644);assert inventory(specimen)!=baseline
finally:p.write_text('original');p.chmod(0o600)
assert inventory(specimen)==baseline
before=read(ROOT/'old-roots-before-private.json')
for root,expected in before.items():assert inventory(Path(root))==expected, 'old-root-changed:'+root
# Also compare the pre-transition frozen original baseline, never a new anchor.
historical=read(OLD/'frozen-before-private.json')
current=before[str(FROZEN)]
assert all(current.get(name)==value for name,value in historical.items())
assert not (OLD/'candidate').exists() and not list((OLD/'execution').iterdir())
assert not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir())

binding=read(ROOT/'binding-private.json')
assert {name:sha(ROOT/name) for name in binding['files']}==binding['files']
old_manifest=read(OLD_PUBLIC/'manifest.json')
for name in binding['files']:
    if name not in ['app_binding_v1.py','attest_start_v1.py']:
        assert sha(ROOT/name)==old_manifest['privateInputs'][name]==sha(OLD/name)
for name in ['app_binding_v1.py','attest_start_v1.py']:
    assert sha(ROOT/name)==sha(PUBLIC/'templates'/name)
    old=(OLD_PUBLIC/'templates'/name).read_text()
    expected=old.replace(str(OLD),str(ROOT))
    if name=='attest_start_v1.py':
        expected=expected.replace("health['deployment']['commit']==a.APP_HEAD and", "health['deployment']['commit']==a.APP_HEAD[:12].lower() and")
    assert (PUBLIC/'templates'/name).read_text()==expected,'nonmechanical-template-diff'
recipe=(PUBLIC/'PARENT_RECIPE.md').read_text()
assert all('sh \"$APP_PACKET/run_stage_v2.sh\" '+stage in recipe for stage in ['active-check','checkout','build','start','attest'])
assert (PUBLIC/'run_stage_v2.sh').read_bytes()==(ROOT/'run_stage_v2.sh').read_bytes()
assert (PUBLIC/'operation-files.sha256').read_bytes()==(ROOT/'operation-files.sha256').read_bytes()
for line in (ROOT/'operation-files.sha256').read_text().splitlines():
    digest,path=line.split('  ',1);assert sha(Path(path))==digest
for p in PUBLIC.rglob('*.py'):ast.parse(p.read_bytes(),filename=str(p))
for p in ROOT.rglob('*'):
    if not p.is_symlink():assert p.stat().st_mode & 0o777==(0o700 if p.is_dir() else 0o600), 'private-mode:'+str(p.relative_to(ROOT))
pin=read(ROOT/'recovery-active-binding.json')
assert {name:sha(FROZEN/'rest-uri-recovery-01'/name) for name in pin['files']}==pin['files']
assert sha(OBS/'observations.json')==pin['operationObservationSha256']

secrets=[]
values=read(ROOT/'app-env-private.json')
for key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET',
            'SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']:
    if key in values and len(values[key])>=8:secrets.append(values[key].encode())
for env in read(FROZEN/'envs-private.json').values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):
            secrets.append(value.encode())
secrets=list(set(secrets))
aggregate=b'\n'.join(p.read_bytes() for p in PUBLIC.rglob('*') if p.is_file())
def scan(data):return any(value in data for value in secrets)
assert not scan(aggregate) and not scan(aggregate+b'\nHarmless note.\n')
assert all(scan(aggregate+b'\n'+value) for value in secrets)
controls=read(ROOT/'controls-baseline-05.json')
assert controls==read(ROOT/'controls-restored-05.json') and len(controls)==47
attest=read(ROOT/'attestation-controls-01.json')
assert len(attest['cases'])==31 and attest['restored']
assert next(x for x in attest['mutations'] if x['mutation']=='restore old full-SHA comparison')['reason']=='identified readback baseline:unexpected:attest-http-identity'
producer=read(ROOT/'actual-health-producer.json')
assert producer['baseline']['appCommitSha']==old_manifest['appHead']
assert producer['baseline']['payload']['deployment']['commit']==old_manifest['appHead'][:12]
composition=read(ROOT/'composed-controls-07.json')
assert len(composition['cases'])==26 and composition['restored'] and composition['recipeSha256']==sha(ROOT/'run_stage_v2.sh')
artifacts=['composed-controls-07.json','operation-files.sha256','run_stage_v2.sh','controls-baseline-05.json','controls-restored-05.json','mutations-05.json','attestation-controls-01.json',
    'actual-health-producer.json','small-guard-controls-01.json','boundary-controls-02.json','preparation-private.json','old-roots-before-private.json']
review_root=Path('/home/nathaniel/.t3/worktrees/openplan/t3-a504c307/docs/reviews/2026-10-15-current-project-preview-app-binding-independent')
review_files={name:sha(review_root/name) for name in ['REVIEW.md','nested_probe.py','health_probe.py','evidence.json']}
result={**old_manifest,'packetVersion':2,'supersedesPacketCommit':'f29968d67c8177f33122691ad5879c675d457e08',
    'privateRoot':str(ROOT),'templates':{name:sha(ROOT/name) for name in ['app_binding_v1.py','attest_start_v1.py']},
    'bindingSha256':sha(ROOT/'binding-private.json'),'privateInputs':binding['files'],
    'healthContract':{'commit':old_manifest['appHead'][:12],'migrations':{'expected':419,'latest':'20261017000016'}},
    'actualAppUnit':'openplan-current-project-preview-app-678-v1-web.service',
    'independentReviewCommit':'bcd47064b87306fc742704a742c24ceeb873f25c','independentReviewFiles':review_files,
    'operationFilesSha256':sha(ROOT/'operation-files.sha256'),'runnerSha256':sha(ROOT/'run_stage_v2.sh'),
    'recipeFiles':{name:sha(PUBLIC/name) for name in ['PARENT_RECIPE.md','run_stage_v2.sh','operation-files.sha256','template-diff.patch','recipe-diff.patch','verify_composition.py']}}
evidence={'preparedOnly':True,'appHead':old_manifest['appHead'],'consumerControls':controls,
    'consumerMutations':read(ROOT/'mutations-05.json'),'attestation':attest,'producer':producer,
    'composition':composition,'boundary':read(ROOT/'boundary-controls-02.json'),'smallGuards':read(ROOT/'small-guard-controls-01.json'),
    'preservation':{'roots':{root:len(value) for root,value in before.items()},'changed':0,'added':0,'removed':0,
        'historicalOriginalFiles':len(historical),'historicalOriginalUnchanged':True,
        'harmlessReadSurvives':True,'changedSpecimenBytesDetected':True,'changedSpecimenModeDetected':True,'specimenRestored':True,
        'blindCategory':'File bytes, modes and link text only; no logical source/global/Storage acquisition.'},
    'privacy':{'knownValues':len(secrets),'harmlessSurvives':True,'eachKnownValueInjectionDetected':True,
        'blindCategory':'Unknown secrets, short common values and files outside this public directory.'},
    'scriptHashes':{str(p.relative_to(PUBLIC)):sha(p) for p in sorted(PUBLIC.rglob('*')) if p.is_file() and p.suffix in ['.py','.cjs','.sh']},
    'privateArtifactHashes':{name:sha(ROOT/name) for name in artifacts},
    'privateTrialHashes':{path.name:sha(path) for path in sorted(ROOT.iterdir()) if path.is_file() and not path.name.startswith('audit-') and (path.suffix=='.log' or path.name.startswith('verify_'))},
    'limitations':['No actual application checkout/build/start or live attestation','No database/helper/source recapture or dependency writes',
        'Fixture process/systemd/HTTP acquisition is synthetic','No Next server or bundler execution; NextResponse adapter only',
        'Build-time migration environment comes from pinned git filenames, not a built file',
        'No desktop/390px/console/artifact/practitioner/public readiness acceptance','New independent review remains required']}
out=ROOT/'public-output-02';out.mkdir(mode=0o700)
write(out/'manifest.json',result);write(out/'evidence.json',evidence)
# Journals describe test units only, never application operations.
units=['prepare-01','controls-01','attestation-01','small-01','boundary-01','boundary-02','boundary-03','direction-01',
    'nested-probe-01','nested-probe-02','direct-probe-01',
    'composition-controller-01','composition-controller-02','composition-controller-03','composition-controller-04','composition-controller-05','composition-controller-06','composition-controller-07']
execution=[]
for name in units:
    unit='openplan-health-v2-'+name+'.service'
    proc=subprocess.run(['/usr/bin/journalctl','--user','-u',unit,'--no-pager','-o','json'],capture_output=True,check=True)
    records=[json.loads(line) for line in proc.stdout.splitlines()]
    write(ROOT/('journal-'+name+'-audit02-private.json'),records)
    execution.append({'unit':unit,'configured':{'MemoryMax':'512M','MemorySwapMax':'0','CPUQuota':'50%'},
        'messages':[r.get('MESSAGE','') for r in records]})
write(out/'execution.json',execution)
assert not scan(b'\n'.join(p.read_bytes() for p in out.iterdir()))
print(json.dumps({'consumerCases':47,'startupCases':31,'compositionObservations':26,'knownValueControls':len(secrets),'oldRootsUnchanged':True,
    'historicalOriginalFiles':len(historical),'candidateExists':False,'executionFiles':0}))
