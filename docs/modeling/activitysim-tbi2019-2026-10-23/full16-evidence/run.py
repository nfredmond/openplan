"""Run the retained hybrid design at 16 GiB, without engine tracing or outcomes."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

E = Path(__file__).resolve().parent
REPO = E.parents[3]
ARCHIVE = Path('/home/nathaniel/.local/state/openplan/tbi2019-evidence-archive-20261024')
R = Path('/home/nathaniel/.local/state/openplan/tbi2019-full16-20261024')
PRIOR = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fb678273/data/_screening_cache/tbi2019-prechunk')
REFERENCES = Path('/home/nathaniel/.t3/worktrees/openplan/t3-85dfd8b2/data/_screening_cache/tbi2019-chunk-cause')
INPUT = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fe427aa8/data/_screening_cache/tbi2019-choice-parity')
CACHE = Path('/home/nathaniel/.t3/worktrees/openplan/t3-7ed7ca64/data/_screening_cache/tbi2019-memory-fit/training-2000/cache/chunk_cache.csv')
PYTHON = '/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python'


def digest(p):
    with Path(p).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(name, data):
    (R/name).write_text(json.dumps(data, indent=2)+'\n')


def source(relative):
    p = E.parent/relative
    return p if p.exists() else ARCHIVE/p.relative_to(REPO)


def verify():
    sys.path.insert(0, str(REPO/'scripts/modeling'))
    from activitysim_chunk_parity import compare_tables
    scan = json.loads(source('prechunk-evidence/input-column-scan.json').read_text())
    for name, row in scan['inputs'].items():
        if digest(PRIOR/name) != row['candidate_sha256']:
            raise RuntimeError('Reduced input custody mismatch')
    freeze = json.loads(source('choice-parity-evidence/input-freeze.json').read_text())
    for folder in ['bundle', 'inputs-2000']:
        for name, expected in freeze['inputs'][folder].items():
            if digest(INPUT/folder/name) != expected:
                raise RuntimeError('Frozen input custody mismatch')
    proof = json.loads(source('prechunk-evidence/columns-parity.json').read_text())
    if proof['status'] != 'passed_exact_parity' or digest(CACHE) != proof['cache_sha256']:
        raise RuntimeError('Cache or parity admission mismatch')
    for arm, reference in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
        receipt = json.loads(source(f'prechunk-evidence/columns-2000-{arm}.comparison.json').read_text())
        tables = compare_tables(REFERENCES/reference, PRIOR/f'columns-2000-{arm}')
        if receipt['status'] != 'passed_exact_parity' or tables != receipt['tables']:
            raise RuntimeError('Exact parity custody mismatch')
    save('preflight.json', {'status':'passed', 'cache_sha256':digest(CACHE),
         'input_hashes':{name:row['candidate_sha256'] for name,row in scan['inputs'].items()},
         'households':1060601,'persons':2617177,'zones':634,'outcomes_accessed':False})


def command(name, cfg, output, stock):
    return ['systemd-run','--user','--scope','--unit=tbi16-'+name,'-p','MemoryMax=16G','-p','MemorySwapMax=0',
            'env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1','MALLOC_MMAP_THRESHOLD_=131072',
            'MALLOC_TRIM_THRESHOLD_=0','MALLOC_ARENA_MAX=2',PYTHON,'-B',str(R/'monitor.py'),str(R/name),
            PYTHON,'-B','-m','activitysim','run','-c',str(cfg),'-c',str(INPUT/'bundle/configs'),
            '-c',str(stock),'-d',str(PRIOR/'inputs-full'),'-o',str(output)]


def run_stage(name, cfg, output, stock):
    cmd = command(name,cfg,output,stock)
    record = {'command':cmd,'config_hashes':{p.name:digest(p) for p in cfg.iterdir() if p.is_file()},'outcomes_accessed':False}
    save(name+'.started.json',record)
    start=time.monotonic()
    with (R/(name+'.scope.log')).open('x') as log:
        proc=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT)
        observer=None
        while proc.poll() is None:
            group=subprocess.run(['systemctl','--user','show','tbi16-'+name+'.scope','-p','ControlGroup','--value'],capture_output=True,text=True).stdout.strip()
            if group and (Path('/sys/fs/cgroup')/group.lstrip('/')).exists():
                observer=subprocess.Popen([PYTHON,'-B',str(R/'observe-scope.py'),'tbi16-'+name+'.scope',str(R/(name+'.external.jsonl'))])
                break
            time.sleep(0.1)
        code=proc.wait()
        if observer is not None:
            observer.wait(timeout=30)
    record.update(exit_code=code,elapsed_seconds=time.monotonic()-start)
    save(name+'.run.json',record)
    with (R/(name+'.systemd.log')).open('x') as log:
        subprocess.run(['journalctl','--user','-u','tbi16-'+name+'.scope','--no-pager'],stdout=log,stderr=subprocess.STDOUT)
    print(json.dumps({'stage':name,'exit_code':code,'elapsed_seconds':record['elapsed_seconds']}),flush=True)
    if code:
        raise RuntimeError('Stage failed; no further execution: '+name)


def execute(records, stage):
    for record in records:
        for part in ['prefix','suffix']:
            record['status']='running_'+part
            save('full-runs.json',records)
            try:
                stage(record['arm'],part)
            except Exception as exc:
                record.update(status='failed',error=str(exc))
                save('full-runs.json',records)
                raise
        record['status']='complete_pending_modeled_health'
        record['final_hashes']={p.name:digest(p) for p in (R/record['arm']).glob('final_*.csv')}
        save('full-runs.json',records)


def main():
    import activitysim
    R.mkdir(mode=0o700)
    verify()
    for name in ['monitor.py','observe-scope.py']:
        shutil.copyfile(E.parent/'prechunk-evidence'/name,R/name)
    stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
    for arm in ['current','semcog']:
        out=R/arm; out.mkdir(); (out/'cache').mkdir(); shutil.copyfile(CACHE,out/'cache/chunk_cache.csv')
        for part in ['prefix','suffix']:
            shutil.copytree(PRIOR/f'config-columns-2000-{arm}-{part}',R/f'config-{arm}-{part}')
    save('execution-freeze.json',{'source_sha256':digest(__file__),'python':sys.version,'engine':activitysim.__version__,
        'memory_max_bytes':16*1024**3,'swap_max_bytes':0,'engine_tracing':False,'sequence':['current-prefix','current-suffix','semcog-prefix','semcog-suffix'],
        'monitor_sha256':digest(R/'monitor.py'),'observer_sha256':digest(R/'observe-scope.py'),'outcomes_accessed':False})
    records=[{'arm':arm,'status':'not_run','tours':None,'trips':None,'mode_shares_MODELED':None,'final_hashes':{},'outcomes_accessed':False} for arm in ['current','semcog']]
    execute(records,lambda arm,part:run_stage(arm+'-'+part,R/f'config-{arm}-{part}',R/arm,stock))


if __name__=='__main__':
    main()
