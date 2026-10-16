"""Audit preparation, preservation and proof; emit public records without raw logs."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import types
from unittest.mock import patch
from common import PUBLIC,REPO,ROOT,V2,V1,FROZEN,OBS,OLD_PUBLIC,HEAD,OLD_HEAD,UNIT,sha,inventory,read,write

os.umask(0o077)
old=read(OLD_PUBLIC/'manifest.json')


def deny(*args,**kwargs):raise AssertionError('operational-io-forbidden')

spec=importlib.util.spec_from_file_location('v3_installed_readonly',ROOT/'app_binding_v1.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
with patch.object(subprocess,'run',side_effect=deny),patch.object(socket,'socket',side_effect=deny):
    binding=a.bindings();r=a.load_recovery()
    helper_before={key:id(value) for key,value in vars(r).items()}
    policy_before={key:id(value) for key,value in vars(r.p).items()}
    values=a.app_values(r);receipts=r.active_receipts()
    assert helper_before=={key:id(value) for key,value in vars(r).items()}
    assert policy_before=={key:id(value) for key,value in vars(r.p).items()}
    assert a.APP_HEAD==HEAD and a.HELPER_HEAD==old['helperHead'] and a.HELPERS==old['helperModules']
    assert r.p.PURPOSE=='project-geography-preview-final-20261015' and r.p.HEAD==a.HELPER_HEAD
    assert r.p.DB_ID=='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
    assert a.read(FROZEN/'target-identity.json')=={'oid':'6118831','database':'openplan_project_combined_preview_0752bc2e8104b7a40faab27f','owner':'postgres'}
    assert a.read(ROOT/'recovery-active-binding.json')==old['activeBinding']
    pin=a.read(ROOT/'recovery-active-binding.json')
    assert {name:sha(a.ACTIVE.parent/name) for name in pin['files']}==pin['files']
    assert sha(OBS/'observations.json')==pin['operationObservationSha256']
    assert sha(a.ACTIVE)=='89042f1acf194f483ab6e1e0b1e7e64c4ec217d3984200d167a589c43e215e8d'
    assert receipts['rest']['id']==a.ACTIVE_REST_ID
    assert not a.CANDIDATE.exists() and not a.CANDIDATE.is_symlink() and not list(a.RUN.iterdir())
    # These new function globals point only metadata readers at this exact source tree.
    # Installed module/helper globals stay unchanged. No operation or CLI is invoked.
    g=dict(vars(a));g.update(APP=REPO/'openplan',CANDIDATE=REPO)
    dependency_digest=types.FunctionType(a.dependencies.__code__,g)()
    migration_digest=types.FunctionType(a.migrations.__code__,g)()
    for name in binding['files']:
        if name not in ['app_binding_v1.py','attest_start_v1.py','app-env-private.json','app-v1.env']:
            assert sha(ROOT/name)==sha(V2/name)==old['privateInputs'][name]
    prior=read(V2/'app-env-private.json')
    assert values=={**prior,'OPENPLAN_COMMIT_SHA':HEAD}
    for name in ['app-env-private.json','app-v1.env']:
        assert (ROOT/name).read_bytes()==(V2/name).read_bytes().replace(OLD_HEAD.encode(),HEAD.encode()),'nonmechanical-env-bytes:'+name
    assert not any(key in values for key in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','RESEND_API_KEY','SMTP_HOST'])
    for name in ['app_binding_v1.py','attest_start_v1.py']:assert sha(ROOT/name)==sha(PUBLIC/'templates'/name)
    assert (ROOT/'run_stage_v3.sh').read_bytes()==(PUBLIC/'run_stage_v3.sh').read_bytes()
    assert (ROOT/'operation-files.sha256').read_bytes()==(PUBLIC/'operation-files.sha256').read_bytes()
    entries={}
    for line in (ROOT/'operation-files.sha256').read_text().splitlines():
        digest,path=line.split('  ',1);path=Path(path)
        assert path.parent==ROOT and path.name not in entries
        entries[path.name]=digest;assert sha(path)==digest
    assert set(entries)==set(binding['files'])|{'binding-private.json','run_stage_v3.sh'}

# A small owned specimen checks the inventory's own detection boundary first.
specimen=ROOT/'inventory-specimen-02';specimen.mkdir(mode=0o700)
f=specimen/'file';f.write_text('original');f.chmod(0o600)
link=specimen/'link';link.symlink_to('file')
baseline=inventory(specimen);assays=[]
try:
    assert f.read_text()=='original' and inventory(specimen)==baseline;assays.append('harmless read survives')
    f.write_text('fault');assert inventory(specimen)!=baseline;assays.append('changed bytes detected');f.write_text('original')
    f.chmod(0o644);assert inventory(specimen)!=baseline;assays.append('changed mode detected');f.chmod(0o600)
    link.unlink();link.symlink_to('other');assert inventory(specimen)!=baseline;assays.append('changed symlink text detected')
finally:
    f.write_text('original');f.chmod(0o600);link.unlink();link.symlink_to('file')
assert inventory(specimen)==baseline;assays.append('exact restoration')
before=read(ROOT/'old-roots-before-private.json')
for root,expected in before.items():assert inventory(Path(root))==expected,'frozen-root-changed:'+root
historical=read(V1/'frozen-before-private.json')
assert all(before[str(FROZEN)].get(name)==value for name,value in historical.items())
assert not (V2/'execution/build-result.json').exists()
assert not (V2/'execution/build-files.json').exists()
assert not (V2/'candidate/openplan/.next/BUILD_ID').exists()
for path in ROOT.rglob('*'):
    if not path.is_symlink():
        trap=(path.parent.parent.parent==ROOT/'entry-specimens' and path.parent.name=='fake-bin' and path.name in ['python3','sha256sum','systemd-run'])
        expected_mode=0o700 if path.is_dir() or trap else 0o600
        assert path.stat().st_mode & 0o777==expected_mode,'private-mode:'+str(path.relative_to(ROOT))
for path in PUBLIC.rglob('*.py'):ast.parse(path.read_bytes(),filename=str(path))

compiler_root=Path('/home/nathaniel/.local/state/openplan/project-combined-full-types-20261015-02')
compiler=read(compiler_root/'result.json')
assert compiler['exitCode']==0 and (compiler_root/'compiler.log').read_bytes()==b''
assert compiler['compilerLogSha256']==sha(compiler_root/'compiler.log')
assert compiler['tsconfigSha256']==sha(REPO/'openplan/tsconfig.json')=='cb3404493257250c77d7145c9825ed31f79246b640eb30a59b8069d39091bf29'
for moment in ['before','after']:
    assert compiler[moment]['head']==HEAD and compiler[moment]['status']==''
    assert all(line.split()[1]=='0' for line in compiler[moment]['resources']['memory.events'].splitlines())
assert compiler['after']['resources']['memory.peak']=='5874405376'
prior_root=compiler_root.parent/'project-combined-full-types-20261015-01'
assert read(prior_root/'result.json')['exitCode']==134
assert b'OOMErrorHandler' in (prior_root/'compiler.log').read_bytes()
compiler_proof={str(root/name):sha(root/name) for root,names in [(compiler_root,['result.json','compiler.log','run.py','prior-run.json']),
    (prior_root,['result.json','compiler.log','generated-type-inputs.json'])] for name in names}

controls=read(ROOT/'controls-baseline-05.json');assert len(controls)==47 and controls==read(ROOT/'controls-restored-05.json')
attest=read(ROOT/'attestation-controls-01.json');assert len(attest['cases'])==34 and attest['restored']
producer=read(ROOT/'actual-health-producer.json');assert producer['sourceCommit']==HEAD
assert producer['baseline']['appCommitSha']==HEAD and producer['baseline']['payload']['deployment']['commit']==HEAD[:12]
composition=read(ROOT/'composed-controls-07.json');assert len(composition['cases'])==26 and composition['restored']
assert composition['recipeSha256']==sha(ROOT/'run_stage_v3.sh')
identity=read(ROOT/'identity-controls-01.json');assert len(identity['cases'])==8 and identity['restored']
mechanical=read(ROOT/'mechanical-controls-01.json');assert len(mechanical['cases'])==10 and mechanical['restored']
entry=read(ROOT/'entry-controls-01.json');assert len(entry['cases'])==9 and entry['restored']

secrets=[]
for key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']:
    if key in values and len(values[key])>=8:secrets.append(values[key].encode())
for env in read(FROZEN/'envs-private.json').values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):secrets.append(value.encode())
secrets=list(set(secrets))
aggregate=b'\n'.join(path.read_bytes() for path in PUBLIC.rglob('*') if path.is_file())
def scan(data):return any(value in data for value in secrets)
assert not scan(aggregate) and not scan(aggregate+b'\nHarmless note.\n')
assert all(scan(aggregate+b'\n'+value) for value in secrets)

manifest={**old,'appHead':HEAD,'privateRoot':str(ROOT),'packetVersion':3,
    'supersedesPacketCommit':'807c89b29692e1e56ae1d8e3d34714480e72ede7',
    'reviewedV2IndependentCommit':'4eb906b32fd1d6cd74c435e662d396a768438f8e',
    'parentCompilerReportCommit':'fa696fa9a93b265649b454483ad8904e28fa1781',
    'templates':{name:sha(ROOT/name) for name in ['app_binding_v1.py','attest_start_v1.py']},
    'bindingSha256':sha(ROOT/'binding-private.json'),'privateInputs':binding['files'],
    'healthContract':{'commit':HEAD[:12],'migrations':{'expected':419,'latest':'20261017000016'}},
    'actualAppUnit':UNIT,'operationFilesSha256':sha(ROOT/'operation-files.sha256'),
    'runnerSha256':sha(ROOT/'run_stage_v3.sh'),
    'recipeFiles':{name:sha(PUBLIC/name) for name in ['PARENT_RECIPE.md','run_stage_v3.sh','operation-files.sha256','template-diff.patch','runner-diff.patch','verify_composition.py']},
    'executionBlockedPendingIndependentV3Review':True}
artifacts=['seal-failed-01.py','seal-failed-01.json','preparation-private.json','old-roots-before-private.json','controls-baseline-05.json','controls-restored-05.json','mutations-05.json',
    'attestation-controls-01.json','actual-health-producer.json','composed-controls-07.json','identity-controls-01.json','mechanical-controls-01.json','entry-controls-01.json']
evidence={'preparedOnly':True,'appHead':HEAD,'publicRuntimeOnlyMechanicalDelta':True,
    'consumerCases':controls,'consumerMutations':read(ROOT/'mutations-05.json'),'attestation':attest,'producer':producer,
    'composition':composition,'identity':identity,'mechanical':mechanical,'entry':entry,
    'actualPureInputConsumers':{'accepted':True,'helperGlobalsUnchanged':True,'dependencyBindingDigest':dependency_digest,'migrationDigest':migration_digest,
        'migrationCount':419,'nonRootLockEntries':1143,'installedEntries':969,'environmentDelta':['OPENPLAN_COMMIT_SHA'],
        'blindCategory':'No Docker, SQL, HTTP or live readiness; package metadata does not hash each installed JavaScript byte.'},
    'preservation':{'roots':{root:len(value) for root,value in before.items()},'added':0,'removed':0,'changed':0,
        'historicalOriginalFiles':len(historical),'historicalOriginalUnchanged':True,'inventoryAssays':assays,
        'blindCategory':'File bytes, modes and link text only. No logical database, global or Storage acquisition.'},
    'privacy':{'knownValues':len(secrets),'harmlessSurvives':True,'eachKnownInjectionDetected':True,
        'blindCategory':'Unknown secrets and short/common values are outside this known-value screen.'},
    'parentCompiler':{'result':compiler,'proofFileHashes':compiler_proof,'priorAttemptExit':134,
        'parentReportCommit':'fa696fa9a93b265649b454483ad8904e28fa1781','blindCategory':'Assignability only; retained Next declaration inputs are not an accepted build or new types-generation evidence.'},
    'scriptHashes':{str(path.relative_to(PUBLIC)):sha(path) for path in sorted(PUBLIC.rglob('*')) if path.is_file() and path.suffix in ['.py','.sh','.cjs']},
    'privateArtifactHashes':{name:sha(ROOT/name) for name in artifacts},
    'candidateAbsent':True,'executionFiles':[],
    'retainedPreparationFailure':read(ROOT/'seal-failed-01.json'),
    'notReplayed':['Prior seven small resource/private-file controls','Prior five standalone boundary observations','Independent round2 seven retained-code/tool probes','121 page-focused cases','72 report-focused cases','Full QA/native artifacts'],
    'limitations':['Execution blocked on new proportional independent review','No actual application checkout/build/start/attestation or listener',
        'No helper/service transition, SQL/DB clone, source-anchor recapture, provider request or install',
        'No full QA, native application, browser/fallback, desktop/390px/console/artifact/practitioner/public/scientific acceptance',
        'Trusted controllers retain ordinary user filesystem/Docker permissions; npm payload uses kernel read-only boundary',
        'No hostile-host, same-user adversary, crash/power-loss, concurrent-donor or large-build capacity proof']}
out=ROOT/'public-output-01';out.mkdir(mode=0o700)
assert not scan(json.dumps(manifest).encode()) and not scan(json.dumps(evidence).encode())
write(out/'manifest.json',manifest);write(out/'evidence.json',evidence)
print(json.dumps({'preparedOnly':True,'consumerCases':47,'attestationCases':34,'compositionObservations':26,'identityCases':8,'mechanicalCases':10,
    'entryObservations':9,'oldRootsUnchanged':True,'candidateAbsent':True,'executionFiles':0,'compilerExit':0,'knownValueControls':len(secrets)}))
