"""Pure disk-budget/admission controls. No allocation, service, SQL or build."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types

HERE = Path(__file__).resolve().parent
DURABLE = Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016')
ROOT = Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-working-20261016')
PRIVATE = DURABLE/'checks-02'
HEAD = '607ee0895a79457181eda1d2ebbda1de4f2a4d40'
TREE = 'bed283ab0c937ead65378a2e9d26c177ceee6938'
OLD_REVIEW = '0b363901455bb955e9f67395f9fd6a5ed40e3ccd'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def namespace(source):
    result = {'__name__': 'pure_disk_specimen'}
    exec(compile(source, '<pure-disk-specimen>', 'exec'), result)
    return result


def rejects(callback, reason):
    try:
        callback()
    except ValueError as error:
        assert str(error) == reason, (str(error), reason)
    else:
        raise AssertionError('Expected refusal: '+reason)


def capacity_oracle(source):
    ns = namespace(source); check = ns['capacity_check']; big = 100*1024**3
    memory = 12*1024**3
    b = check(memory, big, big)
    raw = ns['SOURCE_BYTES'] + 3*1024**3 + 1024**3//2
    assert b['memoryRequired'] == memory and b['unitCap'] == 10*1024**3, 'Unchanged build and host memory reservations'
    assert b['durableRequired'] == 2*raw+raw//100+1024**3//4, 'Shared disk must reserve working plus archive'
    rejects(lambda: check(memory-1, big, big), 'disk-memory-total-budget')
    rejects(lambda: check(memory, b['durableRequired']-1, big), 'disk-combined-budget')
    rejects(lambda: check(memory, big, b['durableRequired']-1), 'disk-combined-budget')
    rejects(lambda: check(memory, 8*1024**3-1, big, raw), 'disk-headroom-floor')
    rejects(lambda: check(memory, big, big, -1), 'disk-staged-count')
    staged = check(memory, big, big, raw+1024**3)
    assert staged['archiveRequired'] > b['archiveRequired'], 'Actual larger inventory increases archive reservation'
    observed = {'target':'/', 'source':'/dev/nvme0n1p2', 'fstype':'ext4', 'options':'rw,relatime',
                'uuid':'c7f8e9a2-2767-4dba-81a8-5ae1ade8d595'}
    ns['mount_check'](observed)
    for field, value in [('target','/dev/shm'),('source','/dev/other'),('fstype','tmpfs'),('uuid','wrong')]:
        rejects(lambda f=field,v=value: ns['mount_check']({**observed,f:v}), 'disk-mount-identity')
    rejects(lambda: ns['mount_check']({**observed,'options':'rw,noexec'}), 'disk-execution')
    rejects(lambda: ns['mount_check']({**observed,'options':'ro'}), 'disk-execution')
    observe_oracle(ns)
    return 20


def observe_oracle(ns):
    # Exercise the actual producer guards against controlled metadata. These
    # input stand-ins establish refusals, not current filesystem/kernel state.
    fixture = PRIVATE/'producer-fixture'
    fixture.mkdir(mode=0o700, exist_ok=True)
    link = PRIVATE/'producer-link'
    if not link.exists():link.symlink_to(fixture, target_is_directory=True)
    mount = {'target':'/', 'source':'/dev/nvme0n1p2', 'fstype':'ext4', 'options':'rw,relatime',
             'uuid':'c7f8e9a2-2767-4dba-81a8-5ae1ade8d595'}
    census = [mount]; dev_fault = False
    def observed_run(argv, **kwargs):
        assert kwargs.get('timeout') == 5, 'Mount observation must stay bounded'
        return types.SimpleNamespace(stdout=json.dumps({'filesystems':census}).encode())
    def observed_stat(path):
        dev = os.stat(path).st_dev
        return types.SimpleNamespace(st_dev=dev + (1 if dev_fault and path == fixture else 0))
    ns.update(ROOT=fixture/'absent-working-root', DURABLE=DURABLE,
              os=types.SimpleNamespace(stat=observed_stat), subprocess=types.SimpleNamespace(run=observed_run),
              Path=lambda value: types.SimpleNamespace(read_text=lambda:'MemAvailable: 104857600 kB\n')
              if value == '/proc/meminfo' else Path(value),
              shutil=types.SimpleNamespace(disk_usage=lambda _:types.SimpleNamespace(free=100*1024**3)))
    ns['observe_capacity']()
    ns['ROOT'] = link/'absent-working-root'
    rejects(ns['observe_capacity'], 'disk-parent-symlink')
    ns['ROOT'] = fixture/'absent-working-root'
    dev_fault = True; rejects(ns['observe_capacity'], 'disk-shared-device'); dev_fault = False
    census = [mount,mount]; rejects(ns['observe_capacity'], 'disk-mount-census')


def admission_oracle(source):
    fixture = PRIVATE/'admission-fixture'
    fixture.mkdir(mode=0o700, exist_ok=True)
    packet = {'head':HEAD,'appTree':TREE}
    (fixture/'packet.json').write_text(json.dumps(packet))
    j = types.ModuleType('journal'); j.DURABLE=fixture; j.HEAD=HEAD; j.TREE=TREE; j.require=require
    m = types.ModuleType('memory_storage'); m.sha=sha
    saved = {key:sys.modules.get(key) for key in ['journal','memory_storage']}
    try:
        sys.modules.update(journal=j,memory_storage=m)
        ns = namespace(source)
        approved = {'head':HEAD,'appTree':TREE,'acceptedByParent':True,'capacityAdmitted':True,
                    'storage':'disk','capacityModel':'disk-v1','packetSealSHA256':sha(fixture/'packet.json'),
                    'reviewCommit':'a'*40}
        def invoke(value):
            (fixture/'admission.json').write_text(json.dumps(value))
            return ns['admission']()
        assert invoke(approved) == (packet,approved), 'Well-shaped synthetic admission rejected'
        faults = {'storage':'memory','capacityModel':'memory-v1','reviewCommit':OLD_REVIEW,
                  'acceptedByParent':False,'capacityAdmitted':False,'packetSealSHA256':'0'*64,
                  'head':'0'*40,'appTree':'0'*40}
        for field, value in faults.items():
            rejects(lambda f=field,v=value: invoke({**approved,f:v}), 'final-parent-review-admission')
        rejects(lambda: invoke({**approved,'reviewCommit':HEAD}), 'final-parent-review-admission')
        return 10
    finally:
        for name, old in saved.items():
            if old is None:sys.modules.pop(name,None)
            else:sys.modules[name]=old


def main():
    os.umask(0o077);PRIVATE.mkdir(mode=0o700,exist_ok=False)
    paths = {name:DURABLE/'templates'/name for name in ['memory_storage.py','storage_stage.py']}
    original = {name:p.read_text() for name,p in paths.items()}
    receipts=[]
    oracles={'memory_storage.py':capacity_oracle,'storage_stage.py':admission_oracle}
    for name, oracle in oracles.items():
        observations=oracle(original[name]);receipts.append({'trial':'baseline-'+name,'observations':observations,'pass':True})
        oracle(original[name]+'\n# Harmless comment.\n');receipts.append({'trial':'harmless-'+name,'survived':True})
    faults=[
        ('host-reserve','memory_storage.py','memory_required = 10*GiB + HOST_RESERVE','memory_required = 10*GiB','Unchanged build and host memory reservations'),
        ('memory-gate','memory_storage.py','require(available >= memory_required,','require(True,','Expected refusal: disk-memory-total-budget'),
        ('double-count-disk','memory_storage.py','combined_required = working_required + archive_required','combined_required = max(working_required, archive_required)','Shared disk must reserve working plus archive'),
        ('disk-gate','memory_storage.py','require(min(working_free, durable_free) >= combined_required,','require(True,','Expected refusal: disk-combined-budget'),
        ('disk-floor','memory_storage.py','require(min(working_free, durable_free) >= 8*GiB,','require(True,','Expected refusal: disk-headroom-floor'),
        ('disk-device','memory_storage.py',"observed['source'] == '/dev/nvme0n1p2'",'True','Expected refusal: disk-mount-identity'),
        ('disk-execution','memory_storage.py',"'noexec' not in flags",'True','Expected refusal: disk-execution'),
        ('staged-count','memory_storage.py','type(staged) is int and staged >= 0','True','Expected refusal: disk-staged-count'),
        ('parent-symlink','memory_storage.py','ROOT.parent.resolve() == ROOT.parent and DURABLE.resolve() == DURABLE','True','Expected refusal: disk-parent-symlink'),
        ('shared-device','memory_storage.py','os.stat(ROOT.parent).st_dev == os.stat(DURABLE).st_dev','True','Expected refusal: disk-shared-device'),
        ('mount-census','memory_storage.py','len(mount) == 1','True','Expected refusal: disk-mount-census'),
        ('mount-timeout','memory_storage.py','check=True, timeout=5','check=True, timeout=None','Mount observation must stay bounded'),
        ('disk-admission','storage_stage.py',"approved.get('storage')=='disk'",'True','Expected refusal: final-parent-review-admission'),
        ('capacity-model','storage_stage.py',"approved.get('capacityModel')=='disk-v1'",'True','Expected refusal: final-parent-review-admission'),
        ('old-review','storage_stage.py',"approved.get('reviewCommit') not in {j.HEAD,'"+OLD_REVIEW+"'}",'True','Expected refusal: final-parent-review-admission'),
    ]
    for label,name,before,after,intended in faults:
        assert original[name].count(before)==1,(label,'anchor')
        specimen=original[name].replace(before,after)
        try:oracles[name](specimen)
        except AssertionError as error:
            assert str(error)==intended,(label,str(error),intended)
            receipts.append({'trial':label,'namedAssertion':str(error),'failedAsIntended':True})
        else:raise AssertionError('Fault survived: '+label)
        assert paths[name].read_text()==original[name], 'Actual source was changed'
        oracles[name](original[name])
    packet=json.loads((DURABLE/'packet.json').read_text())
    for name,expected in packet['sealed'].items():
        assert sha(DURABLE/'templates'/name)==expected['sha256'],('runtime seal',name)
    ns=namespace(original['memory_storage.py'])
    capacity=None;refusal=None
    try:capacity=ns['observe_capacity']()
    except ValueError as error:refusal=str(error)
    assert not ROOT.exists() and not (DURABLE/'admission.json').exists() and not (DURABLE/'journal').exists()
    result={'trials':receipts,'harmlessSurvivors':2,'namedFaults':len(faults),'restoredSourceSHA256':{n:sha(p) for n,p in paths.items()},
            'runtimeSeals':len(packet['sealed']),'currentCapacity':capacity,'currentCapacityRefusal':refusal,
            'runtimeStages':0,'injectedAdmissionFixtureOnly':True,
            'blindCategories':['actual build peak/output','kernel/Docker/bwrap semantics','SQL and service behavior',
              'truth of parent review authorization','concurrent mount/filesystem changes','browser and human acceptance']}
    for p in (PRIVATE/'controls.json',HERE/'controls-02.json'):
        with p.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
        p.chmod(0o600)
    print(json.dumps({'harmlessSurvivors':2,'namedFaults':len(faults),'runtimeStages':0,'capacityAdmitted':False,
                      'capacityRefusal':refusal}))


if __name__=='__main__':main()
