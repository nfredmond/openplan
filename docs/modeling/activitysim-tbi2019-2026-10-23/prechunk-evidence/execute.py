"""Execute named, isolated ActivitySim stages within the authorized scope."""
import json
from pathlib import Path
import subprocess
import sys
import time
from prepare import m, E, config, MODELS


def run(name, cfg, data, output, profile=False, allocator=False):
    base = E/name
    unit = 'tbi-prechunk-'+name
    engine = [sys.executable, '-B']
    if profile:
        engine += [str(E/'profile-engine.py'), str(E/(name+'.profile.jsonl'))]
    else:
        engine += ['-m', 'activitysim']
    engine += ['run','-c',str(cfg),'-c',str(m.INPUT/'bundle/configs'),'-c',str(m.STOCK),'-d',str(data),'-o',str(output)]
    allocator_env = ['MALLOC_MMAP_THRESHOLD_=131072', 'MALLOC_TRIM_THRESHOLD_=0', 'MALLOC_ARENA_MAX=2'] if allocator else []
    command = ['systemd-run','--user','--scope','--unit='+unit,'-p','MemoryMax=9G','-p','MemorySwapMax=0',
               'env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1',*allocator_env,sys.executable,'-B',str(E/'monitor.py'),str(base),*engine]
    record = {'command': command, 'config_files': {p.name:m.digest(p) for p in cfg.iterdir() if p.is_file()}, 'outcomes_accessed':False}
    m.save(name+'.started.json', record)
    start=time.monotonic()
    with (E/(name+'.scope.log')).open('x') as log:
        completed=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
    record.update(exit_code=completed.returncode,elapsed_seconds=time.monotonic()-start)
    m.save(name+'.run.json',record)
    with (E/(name+'.systemd.log')).open('x') as log:
        subprocess.run(['journalctl','--user','-u',unit+'.scope','--no-pager'],stdout=log,stderr=subprocess.STDOUT)
    print(json.dumps({'name':name,'exit_code':completed.returncode}),flush=True)
    if completed.returncode:
        raise RuntimeError('Stage failed: '+name)
    return record


if __name__=='__main__':
    run('profile-20000',m.R/'config-profile-20000',m.R/'inputs-20000',m.R/'profile-20000',profile=True)
