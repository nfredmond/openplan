import json,shutil,subprocess
from pathlib import Path
import yaml
E=Path('docs/modeling/activitysim-tbi2019-2026-10-23/chunk-cause-evidence')
R=Path('data/_screening_cache/tbi2019-chunk-cause').resolve()
OLD=Path('/home/nathaniel/.t3/worktrees/openplan/t3-8dddce31/data/_screening_cache/tbi2019-convergence')
INPUT=Path('/home/nathaniel/.t3/worktrees/openplan/t3-fe427aa8/data/_screening_cache/tbi2019-choice-parity')
for mode in ['disabled','training']:
 c=R/f'config-{mode}';shutil.copytree(INPUT/f'parity-config-current-{mode}',c)
 settings=yaml.safe_load((c/'settings.yaml').read_text());settings['resume_after']='trip_purpose_and_destination'
 (c/'settings.yaml').write_text(yaml.safe_dump(settings,sort_keys=False))
 out=R/f'reproduce-{mode}';out.mkdir()
 subprocess.run(['cp','-a','--reflink=auto',str(OLD/f'parity-current-{mode}'/'pipeline.parquetpipeline'),str(out/'pipeline.parquetpipeline')],check=True)
(E/'criterion.json').write_text(json.dumps({'criterion':'All seven final tables, row identities, row counts and all non-auxiliary fields exact. Finite logsum/utility differences <= max(4*max(ulp(a),ulp(b)),1e-12*max(abs(a),abs(b))). Missing and nonfinite mismatches fail.','seed':0,'outcomes_accessed':False,'diagnostic_replays':'64-household existing checkpoints only; no installed source patch','input_freeze':'../choice-parity-evidence/input-freeze.json'},indent=2)+'\n')
