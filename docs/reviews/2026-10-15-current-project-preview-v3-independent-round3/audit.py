"""Independent read-only packet/source/retained-receipt review. No operational I/O."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import types
from unittest.mock import patch

os.umask(0o077)
PUBLIC = Path(__file__).resolve().parent
REPO = PUBLIC.parents[2]
SUBJECT = PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-v3'
OLD = PUBLIC.parent/'2026-10-15-current-project-preview-health-contract-fix'
OUT = Path('/home/nathaniel/.local/state/openplan/current-project-preview-v3-independent-round3-20261015')
OUT = OUT/'audit-02'
OUT.mkdir(mode=0o700)
HEAD = '21510042e94bcaf80f262205ad156a7bb639e35c'
OLD_HEAD = '67828c17c4c270529468eef1edd144e4a52b693a'

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def read(path):return json.loads(Path(path).read_bytes())
def save(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,indent=2);f.write('\n')
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def deny(*args,**kwargs):raise AssertionError('operational-io-forbidden')
def git(*args):return subprocess.check_output(['/usr/bin/git','-C',str(REPO),*args])

c=load(SUBJECT/'common.py','review_common')
m=read(SUBJECT/'manifest.json');root=Path(m['privateRoot']);oldroot=Path(read(OLD/'manifest.json')['privateRoot'])
# Inventory is tested against owned specimens before reading the frozen roots.
spec=OUT/'inventory-specimen';spec.mkdir(mode=0o700)
f=spec/'file';f.write_bytes(b'original');f.chmod(0o600);link=spec/'link';link.symlink_to('file')
baseline=c.inventory(spec);assays=[]
try:
    f.read_bytes();assert c.inventory(spec)==baseline;assays.append('harmless read survived')
    for kind in ['bytes','mode','link']:
        if kind=='bytes':f.write_bytes(b'fault')
        if kind=='mode':f.chmod(0o644)
        if kind=='link':link.unlink();link.symlink_to('other')
        assert c.inventory(spec)!=baseline,'inventory-missed-'+kind
        assays.append(kind+' detected')
        f.write_bytes(b'original');f.chmod(0o600);link.unlink();link.symlink_to('file')
finally:
    f.write_bytes(b'original');f.chmod(0o600);link.unlink();link.symlink_to('file')
assert c.inventory(spec)==baseline
prior=read(root/'old-roots-before-private.json')
roots=list(prior)+[str(root),str(SUBJECT),str(PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-independent'),str(PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-independent-round2')]
inventories={p:c.inventory(Path(p)) for p in roots}
assert all(inventories[p]==value for p,value in prior.items()),'frozen-preparation-baseline'
save('before-private.json',inventories)

assert m['appHead']==HEAD
for key,name in [('bindingSha256','binding-private.json'),('operationFilesSha256','operation-files.sha256'),('runnerSha256','run_stage_v3.sh')]:assert sha(root/name)==m[key],key
for name,digest in m['privateInputs'].items():assert sha(root/name)==digest,name
for name,digest in m['templates'].items():assert sha(root/name)==sha(SUBJECT/'templates'/name)==digest
for name,digest in m['recipeFiles'].items():assert sha(SUBJECT/name)==digest,name
assert (root/'run_stage_v3.sh').read_bytes()==(SUBJECT/'run_stage_v3.sh').read_bytes()
assert (root/'operation-files.sha256').read_bytes()==(SUBJECT/'operation-files.sha256').read_bytes()
entries={}
for line in (root/'operation-files.sha256').read_text().splitlines():
    digest,p=line.split('  ',1);p=Path(p)
    assert p.parent==root and p.name not in entries and sha(p)==digest
    entries[p.name]=digest
assert set(entries)==set(m['privateInputs'])|{'binding-private.json','run_stage_v3.sh'}
oldapp=(OLD/'templates/app_binding_v1.py').read_bytes()
assert (SUBJECT/'templates/app_binding_v1.py').read_bytes()==oldapp.replace(OLD_HEAD.encode(),HEAD.encode()).replace(str(oldroot).encode(),str(root).encode())
assert (SUBJECT/'templates/attest_start_v1.py').read_bytes()==(OLD/'templates/attest_start_v1.py').read_bytes().replace(b'openplan-current-project-preview-app-678-v1-web.service',m['actualAppUnit'].encode())
assert (SUBJECT/'run_stage_v3.sh').read_bytes()==(OLD/'run_stage_v2.sh').read_bytes().replace(str(oldroot).encode(),str(root).encode()).replace(b'openplan-current-project-preview-app-678-v1-',b'openplan-current-project-preview-app-21510042e-v3-')
for name in ['app-env-private.json','app-v1.env']:
    assert (root/name).read_bytes()==(oldroot/name).read_bytes().replace(OLD_HEAD.encode(),HEAD.encode())
for name in ['migrations.json','dependency-binding.json','recovery-active-binding.json']:assert (root/name).read_bytes()==(oldroot/name).read_bytes()

a=load(root/'app_binding_v1.py','readonly_installed_subject')
with patch.object(subprocess,'run',side_effect=deny),patch.object(socket,'socket',side_effect=deny):
    binding=a.bindings();r=a.load_recovery();rb={k:id(v) for k,v in vars(r).items()};pb={k:id(v) for k,v in vars(r.p).items()}
    values=a.app_values(r);receipts=r.active_receipts()
    assert r.p.HEAD==m['helperHead'] and r.p.PURPOSE=='project-geography-preview-final-20261015'
    assert a.SOURCE_ANCHOR==m['sourceAnchor'] and a.HELPERS==m['helperModules']
    assert a.read(root/'recovery-active-binding.json')==m['activeBinding']
    assert receipts['rest']['id']==m['activeBinding']['restId']
    assert {n:sha(a.ACTIVE.parent/n) for n in m['activeBinding']['files']}==m['activeBinding']['files']
    assert sha(a.OPERATION_OBSERVATION)==m['activeBinding']['operationObservationSha256']
    g=dict(vars(a));g.update(APP=REPO/'openplan',CANDIDATE=REPO)
    migrations=types.FunctionType(a.migrations.__code__,g)();deps=types.FunctionType(a.dependencies.__code__,g)()
    assert rb=={k:id(v) for k,v in vars(r).items()} and pb=={k:id(v) for k,v in vars(r.p).items()}
    assert not a.CANDIDATE.exists() and not a.CANDIDATE.is_symlink() and not list(a.RUN.iterdir())

changed=git('diff','--name-only',OLD_HEAD,HEAD,'--','openplan/src').decode().splitlines()
assert len(changed)==5
production=[p for p in changed if not p.startswith('openplan/src/test/')]
assert production==['openplan/src/app/(app)/projects/[projectId]/_components/_types.ts']
assert git('diff',HEAD,'4373e82872b743694f0b463f08b43856ba79ee36','--','openplan/src')==b''
assert git('diff',OLD_HEAD,HEAD,'--','openplan/tsconfig.json','openplan/package.json','openplan/package-lock.json')==b''
compiler=read(PUBLIC.parent/'2026-10-15-project-compiler-repair-join/evidence.json')
for p,record in compiler['files'].items():assert sha(p)==record['sha256'] and Path(p).stat().st_size==record['bytes']
assert compiler['attempt02']==read('/home/nathaniel/.local/state/openplan/project-combined-full-types-20261015-02/result.json')
assert compiler['attempt01']['exitCode']==134 and compiler['attempt02']['exitCode']==0
assert Path('/home/nathaniel/.local/state/openplan/project-combined-full-types-20261015-02/compiler.log').read_bytes()==b''
assert sha(REPO/'openplan/tsconfig.json')==compiler['attempt02']['tsconfigSha256']
for moment in ['before','after']:
    v=compiler['attempt02'][moment];assert v['head']==HEAD and v['status']==''
    assert all(row.split()[1]=='0' for row in v['resources']['memory.events'].splitlines())
e=read(SUBJECT/'evidence.json')
for rel,digest in e['scriptHashes'].items():assert sha(SUBJECT/rel)==digest
for rel,digest in e['privateArtifactHashes'].items():assert sha(root/rel)==digest
assert len(e['consumerCases'])==47 and len(e['attestation']['cases'])==34 and len(e['composition']['cases'])==26
for part in ['attestation','composition','identity','mechanical','entry']:assert e[part]['restored']
assert e['retainedPreparationFailure']['error'] if 'error' in e['retainedPreparationFailure'] else e['retainedPreparationFailure']
accounting=read(SUBJECT/'execution.json')
assert any(v['journalAccounting'] is None for v in accounting)
save('audit.json',{'integrationCommit':git('rev-parse','HEAD').decode().strip(),'appHead':HEAD,'runtimeMechanical':True,
    'manifestSha256':sha(SUBJECT/'manifest.json'),'installedOperationFiles':entries,'changedApplicationFiles':changed,
    'productionChanges':production,'compilerReceiptHashesMatch':True,'compilerAttempt02':compiler['attempt02'],
    'dependencyBindingDigest':deps,'migrationDigest':migrations,'counts':{'migrations':419,'nonRootLock':1143,'installedPackages':969},
    'oldRootEntries':{p:len(v) for p,v in inventories.items()},'inventoryControls':assays,'candidateAbsent':True,'executionFiles':[],
    'nullJournalAccountingUnits':[v['unit'] for v in accounting if v['journalAccounting'] is None],
    'retainedReportingFailures':[e['retainedPreparationFailure'],e['retainedFinalizationFailure']],
    'limits':['Read-only file and metadata evidence, no runtime readiness','Retained compiler result, no rerun or accepted Next build','Package manifests do not hash all installed JS','No live database/global/Storage or hostile-host proof']})
print('Read-only runtime parity, installed bindings, retained compiler receipts and preservation baseline agree.')
