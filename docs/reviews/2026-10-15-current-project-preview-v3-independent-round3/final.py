"""Final private readback and sanitized export. Never changes reviewed subjects."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
REPO=PUBLIC.parents[2]
SUBJECT=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-v3'
OUT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-v3-independent-round3-20261015')
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
HEAD='21510042e94bcaf80f262205ad156a7bb639e35c'
def read(p):return json.loads(Path(p).read_bytes())
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def save(name,v):
    with (OUT/name).open('x') as f:json.dump(v,f,indent=2);f.write('\n')
spec=importlib.util.spec_from_file_location('final_inventory',SUBJECT/'common.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
initial=read(OUT/'before-private.json');second=read(OUT/'audit-02/before-private.json')
assert initial==second
for p,entries in initial.items():assert c.inventory(Path(p))==entries,'preservation:'+p
assert not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir())
compiler=read(PUBLIC.parent/'2026-10-15-project-compiler-repair-join/evidence.json')
generated=read('/home/nathaniel/.local/state/openplan/project-combined-full-types-20261015-01/generated-type-inputs.json')
assert len(generated['types'])==446
parent=Path('/home/nathaniel/.t3/worktrees/openplan/t3-e33fc359/openplan')
for rel,digest in generated['types'].items():assert sha(parent/rel)==digest,'generated-declaration:'+rel
failed=read(PUBLIC.parent/'2026-10-15-current-project-preview-parent-operation/failed-build-evidence.json')['observerSummary']
v2=Path(failed['packet'])
for name,entry in failed['evidenceFiles'].items():
    p=v2/'execution'/name
    assert p.exists()==entry['exists']
    if entry['exists']:assert sha(p)==entry['sha256'] and p.stat().st_size==entry['bytes']
assert not (v2/'candidate/openplan/.next/BUILD_ID').exists()
readback_path=Path('/home/nathaniel/.local/state/openplan/current-project-preview-parent-v3-readback-20261015-01.json')
readback=read(readback_path)
assert len(readback['checks'])==22 and all(readback['checks'].values())
assert readback['manifestSha256']==sha(SUBJECT/'manifest.json')

# Falsify the exact-delta oracle using in-memory subjects only.
expected={n:(SUBJECT/n).read_bytes() for n in ['templates/app_binding_v1.py','templates/attest_start_v1.py','run_stage_v3.sh']}
checker="def check(subject,label):\n    assert subject==expected, 'mechanical-runtime-delta'\n"
def campaign(code):
    g={'expected':expected};exec(compile(code,'mechanical-oracle','exec'),g)
    rows=[]
    for name,data,reason in [
        ('harmless label first',expected,None),
        ('old HEAD',{**expected,'templates/app_binding_v1.py':expected['templates/app_binding_v1.py'].replace(HEAD.encode(),b'67828c17c4c270529468eef1edd144e4a52b693a')},'mechanical-runtime-delta'),
        ('old UNIT',{**expected,'templates/attest_start_v1.py':expected['templates/attest_start_v1.py'].replace(b'openplan-current-project-preview-app-21510042e-v3-web.service',b'openplan-current-project-preview-app-678-v1-web.service')},'mechanical-runtime-delta')]:
        try:g['check'](data,name+' harmless report wording')
        except AssertionError as e:
            assert str(e)==reason;rows.append({'case':name,'outcome':'refused','reason':reason})
        else:
            assert reason is None,name+':accepted-broken-behavior'
            rows.append({'case':name,'outcome':'survived'})
    return rows
mechanical=campaign(checker+'\n# Harmless checker comment.\n')
try:campaign(checker.replace("assert subject==expected, 'mechanical-runtime-delta'",'pass'))
except AssertionError as e:assert str(e)=='old HEAD:accepted-broken-behavior';oracle_fault=str(e)
else:raise AssertionError('oracle fault survived')
assert campaign(checker)==mechanical

units=[]
for stage,attempt,exit_code in [('direction','01',0),('audit','01',1),('audit','02',0),('identity','01',1),('identity','02',1),('identity','03',0),('composition','01',1),('composition','02',0)]:
    unit=f'openplan-review-v3-r3-{stage}-{attempt}.service'
    raw=subprocess.check_output(['/usr/bin/journalctl','--user','-u',unit,'--no-pager','-o','json'])
    records=[json.loads(x) for x in raw.splitlines()]
    assert records and any(row.get('JOB_RESULT')=='done' for row in records)
    save(f'journal-{stage}-{attempt}-private.json',records)
    account=next((r for r in records if 'MEMORY_PEAK' in r),None)
    if account is not None:assert account['MEMORY_SWAP_PEAK']=='0' and int(account['MEMORY_PEAK'])<=512*1024**2
    units.append({'unit':unit,'configured':{'MemoryMax':'512M','MemorySwapMax':'0','CPUQuota':'50%'},'terminalExit':exit_code,
        'exitEvidence':'Tool terminal result' if stage!='direction' else 'Retained unit success journal',
        'journalAccounting':None if account is None else {k:account[k] for k in ['MEMORY_PEAK','MEMORY_SWAP_PEAK','CPU_USAGE_NSEC']},
        'journalSha256':sha(OUT/f'journal-{stage}-{attempt}-private.json')})
composition=read(OUT/'composition.json');identity=read(OUT/'identity.json');entry=read(OUT/'entry.json')
assert composition['restored'] and identity['restored'] and entry['restored']
assert len(composition['cases'])==12 and len(identity['cases'])==10 and len(entry['cases'])==3
report={'integrationCommit':'4373e82872b743694f0b463f08b43856ba79ee36','packetCandidateCommit':'a968f2ec4ed6dd018b82fe09c4d6558c16a4dca3','appHead':HEAD,
    'manifestSha256':sha(SUBJECT/'manifest.json'),'audit':read(OUT/'audit-02/audit.json'),
    'identity':identity,'composition':composition,'entry':entry,'mechanicalOracle':{'cases':mechanical,'guardRemovalDetected':oracle_fault,'restored':True},
    'preservation':{'roots':{p:len(v) for p,v in initial.items()},'added':0,'removed':0,'changed':0,'candidateAbsent':True,'executionEmpty':True},
    'retainedGeneratedDeclarations':{'count':446,'allCurrentParentHashesMatch':True,'newGeneration':False},
    'failedV2Build':{'invocation':failed['expectedInvocation'],'exit':failed['buildExit']['returncode'],'filesMatchFrozenRecord':True,'acceptedBuild':False},
    'parentReadback':{'checks':22,'allTrue':True,'proofSha256':sha(readback_path)},'units':units,
    'reviewHarnessFailures':[
        {'unit':'audit-01','reason':'Wrong expected type-module path, corrected to _components/_types.ts'},
        {'unit':'identity-01','reason':'Overstrict deployment equality omitted valid version field; corrected to compare identity fields'},
        {'unit':'identity-02','reason':'HTTP stand-in omitted helper Request handling; restored inspected helper stand-in fallback'},
        {'unit':'composition-01','reason':'Root relocation adapter used output root instead of sealed root; own unit refused missing controller.py before any business code; corrected adapter and added predispatch owned-root assertion'}],
    'scriptHashes':{p.name:sha(p) for p in PUBLIC.iterdir() if p.suffix in ['.py','.sh']},
    'privateEvidenceHashes':{str(p.relative_to(OUT)):sha(p) for p in OUT.rglob('*') if p.is_file() and not p.is_symlink() and ('failed-' in p.name or p.name in ['identity.json','composition.json','entry.json','producer.json','audit.json','before-private.json'])},
    'limitations':['No actual app checkout/build/start/listener/attestation or HTTP','No SQL, DB clone, helper/service transition, provider, browser/fallback or install','No repeated fullcompiler/fullQA/121+72 or native-artifact campaigns','Trusted controllers retain ordinary same-user filesystem/Docker permissions; resource caps are not OS confinement','No logical DB/global/Storage, concurrent-donor, hostile-host, crash/power-loss, large-build capacity or human/scientific acceptance','Missing short-unit journal accounting and event fields remain unobserved, not zero']}
# Known-value privacy assay, including public prose. Values never leave this process.
secrets=[]
values=read(ROOT/'app-env-private.json')
for key,value in values.items():
    if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or 'TOKEN' in key):secrets.append(value.encode())
for env in read(c.FROZEN/'envs-private.json').values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):secrets.append(value.encode())
encoded=json.dumps(report).encode()+b'\n'+b'\n'.join(p.read_bytes() for p in PUBLIC.iterdir() if p.is_file())
def scan(data):return any(s in data for s in secrets)
assert not scan(encoded) and not scan(encoded+b'\nHarmless note.\n')
assert all(scan(encoded+b'\n'+s) for s in secrets)
report['privacy']={'knownValues':len(set(secrets)),'harmlessSurvives':True,'eachKnownInjectionDetected':True,'blindCategory':'Unknown secrets and short/common values'}
save('evidence-public.json',report)
print('Frozen bytes/modes/links preserved; retained build/type receipts match; sanitized evidence ready.')
