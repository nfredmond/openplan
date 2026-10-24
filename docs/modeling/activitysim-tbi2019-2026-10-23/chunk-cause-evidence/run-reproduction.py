from pathlib import Path
import subprocess,json,time
E=Path('docs/modeling/activitysim-tbi2019-2026-10-23/chunk-cause-evidence').resolve()
R=Path('data/_screening_cache/tbi2019-chunk-cause').resolve()
I=Path('/home/nathaniel/.t3/worktrees/openplan/t3-fe427aa8/data/_screening_cache/tbi2019-choice-parity')
PY='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python'
STOCK=Path(PY).parent.parent/'lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs'
for mode in ['disabled','training']:
 out=R/f'reproduce-{mode}'
 cmd=['systemd-run','--user','--scope','--unit=tbi-cause-'+mode,'-p','MemoryMax=9G','-p','MemorySwapMax=0','env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1',PY,'-B',str(E.parent/'convergence-evidence/scope-runner.py'),str(E/f'reproduce-{mode}.health.json'),PY,'-B',str(E/'trace-engine.py'),str(E/f'reproduce-{mode}.trace.jsonl'),'run','-c',str(R/f'config-{mode}'),'-c',str(I/'bundle/configs'),'-c',str(STOCK),'-d',str(I/'parity-inputs'),'-o',str(out)]
 (E/f'reproduce-{mode}.command.json').write_text(json.dumps(cmd,indent=2)+'\n')
 with (E/f'reproduce-{mode}.stdout.log').open('x') as f:r=subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT)
 print(mode,r.returncode,flush=True)
 if r.returncode:break
