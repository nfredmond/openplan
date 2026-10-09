"""Run native profile controls serially and preserve every child log."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
output = Path(os.environ['OPENPLAN_LIVE_PROFILE_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
results = []
for control in ('baseline','harmless','recorded-factor','target-drift','vdf-drift','capacity-drift','graph-drift','skip-guard','skip-graph','centroid-through','compact-centroid','skip-centroid-policy','compact-edge','skip-compact','restored'):
    env = dict(os.environ,OPENPLAN_LIVE_PROFILE_CONTROL=control,
               OPENPLAN_BOUND_ASSIGNMENT_OUTPUT=str(output/control),OPENPLAN_BOUND_ASSIGNMENT_CONTROL='baseline')
    result = subprocess.run([sys.executable,'-B',str(root/'verify_native_live_profile.py')],
                            env=env,capture_output=True,text=True,timeout=150)
    log = result.stdout+result.stderr
    (output/(control+'.log')).write_text(log)
    failure = 'Native solver drift was not refused' if control in ('skip-guard','skip-graph','skip-centroid-policy','skip-compact') else None
    matched = result.returncode == 0 if failure is None else result.returncode != 0 and failure in log
    results.append({'control':control,'returncode':result.returncode,'expected_failure':failure,'matched':matched})
    if not matched: raise AssertionError(f'{control}: {log[-4000:]}')
report = {'controls':results,'limits':'Native AequilibraE 1.6.2 fixture with injected parent database responses. Drift controls inspect stopped child output and absence of execution marker, initial manifest and final volumes. No scientific acceptance.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(root/'native-live-profile-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
