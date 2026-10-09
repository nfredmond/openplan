"""Retain database-backed instrument writer cases in fresh proof clones."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
output=Path(os.environ['OPENPLAN_NATIVE_INSTRUMENT_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
assessed=os.environ.get('OPENPLAN_NATIVE_INSTRUMENT_CONTENT')=='assessed-fixture'
controls=('normal','harmless','drop-write','changed-output','restored') if assessed else ('normal','harmless','drop-write','restored')
for control in controls:
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_activity_handoff_copy_http.py')],
        env={**os.environ,'OPENPLAN_STAGE_PUBLICATION_CONTROL':'instrument','OPENPLAN_NATIVE_INSTRUMENT_CONTROL':control,
             'OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT':str(output/control)},text=True,capture_output=True,timeout=90)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    if control=='changed-output':
        assert result.returncode!=0 and 'AssertionError: Evaluated bytes differ from publication bytes' in result.stderr,result.stderr
    elif control=='drop-write':
        assert result.returncode!=0 and 'AssertionError: Native instrument records missing' in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'activity-stage-publication.json').read_text())
        assert report['gateway_removed'] is True
        instrument=next(c for c in report['controls'] if c['control']=='native-instrument-writer')
        assert instrument.get('synthetic_evaluator_used') is assessed
        assert instrument['separate_methods']==2 and instrument['attempt_bound_artifacts']==12
    cases.append({'case':control,'returncode':result.returncode,'expected_behavior_observed':True})
report={'cases':cases,'writer_sha256':hashlib.sha256((ROOT/'workers/aequilibrae_worker/model_attempt_writer.py').read_bytes()).hexdigest(),
    'limits':['Native database instrument relationships and exact receipt reuse over empty synthetic files',
              'No real prepared instrument, scientific assessment, worker dispatch, Storage or concurrent revocation acceptance']}
if assessed:
    report['limits']=['Native custody over nonempty synthetic evaluated files, separate method values 100 and 120', 'No real source preparation, native model assessment, general diagnosis, dispatcher or Storage acceptance']
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/('native-assessed-instrument-controls.json' if assessed else 'native-instrument-writer-controls.json')).write_text(content)
print(content)
