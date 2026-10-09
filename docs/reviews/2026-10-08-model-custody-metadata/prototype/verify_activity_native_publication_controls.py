"""Run native publication controls serially on separate retained database clones."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
output=Path(os.environ['OPENPLAN_NATIVE_PUBLICATION_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for control in ('normal','harmless','drop-demand-matrix','restored'):
    print('Running '+control,flush=True)
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_activity_handoff_copy_http.py')],
        env={**os.environ,'OPENPLAN_STAGE_PUBLICATION_CONTROL':'native','OPENPLAN_NATIVE_PUBLICATION_CONTROL':control,
             'OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT':str(output/control)},text=True,capture_output=True,timeout=300)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    if control=='drop-demand-matrix':
        assert result.returncode!=0 and 'AssertionError: Native demand artifact inventory differs' in result.stderr,result.stderr
        summary={'expected_missing_artifact_detected':True}
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'activity-stage-publication.json').read_text())
        assert report['gateway_removed'] is True
        summary=next(c for c in report['controls'] if c['control']=='native-stage-publication')
    cases.append({'case':control,'returncode':result.returncode,'expected_behavior_observed':True,'result':summary})
    print('Verified '+control,flush=True)
report={'cases':cases,'sources':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in (
    'workers/activitysim_worker/supabase_poll.py','workers/activitysim_worker/runtime.py','scripts/modeling/run_behavioral_demand_prototype.py')},
    'limits':['Copied prepared development bundle; builder boundary substituted and sample limited to 100 households',
              'Native scheduling log includes coerced departure choices; no scientific acceptance',
              'Synthetic Storage byte service; no Census rebuild, full population, normal dispatcher or native-process recovery']}
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/'activity-native-publication-controls.json').write_text(content)
print(content)
