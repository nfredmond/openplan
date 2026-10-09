"""Retain isolated full-handler controls without changing production files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[3]
output=Path(os.environ['OPENPLAN_STAGE_PUBLICATION_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
faults={'drop-kpi':'Stage KPI inventory differs','drop-artifact':'Stage evidence registration differs','drop-terminal':'Managed terminal transaction did not complete run'}
uncertainty=os.environ.get('OPENPLAN_STAGE_PUBLICATION_UNCERTAINTY')=='1'
controls=('normal','harmless',*faults,'restored')
boundary=os.environ.get('OPENPLAN_PUBLICATION_LOSS_BOUNDARY','artifact')
if uncertainty:
    faults=({'lost-reply-wrong-request':'Fresh recovery process failed'} if boundary=='terminal'
            else {'lost-reply-bypass-stop':'Stopped writer accepted later terminal write'})
    controls=('lost-reply','lost-reply-harmless',*faults,'lost-reply-restored')
cases=[]
for control in controls:
    result=subprocess.run([sys.executable,'-B',str(HERE/'verify_activity_handoff_copy_http.py')],
        env={**os.environ,'OPENPLAN_STAGE_PUBLICATION_CONTROL':control,'OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT':str(output/control)},
        text=True,capture_output=True,timeout=90)
    (output/(control+'.log')).write_text(result.stdout+result.stderr)
    if control in faults:
        assert result.returncode!=0 and 'AssertionError: '+faults[control] in result.stderr,result.stderr
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/control/'activity-stage-publication.json').read_text())
        assert report['gateway_removed'] is True
    cases.append({'control':control,'returncode':result.returncode,'expected_behavior_observed':True})
report={'boundary':boundary if uncertainty else None,'cases':cases,'worker_sha256':hashlib.sha256((REPO/'workers/activitysim_worker/supabase_poll.py').read_bytes()).hexdigest(),
    'limits':['Actual scaffold stage handler with native managed database commands','Storage byte service is synthetic; no real Storage acceptance','No normal dispatcher, native engine execution, concurrent revocation fence or scientific acceptance']}
if os.environ.get('OPENPLAN_STAGE_USE_ENTRY') == '1':
    report['entry'] = 'process_stage with a fresh admitted and bound writer'
    report['limits'] = ['Actual ActivitySim process_stage entry and scaffold handler with native database commands',
        'Storage byte service is synthetic; no real Storage acceptance',
        'No automatic poll enrollment, native engine execution, concurrent revocation fence or scientific acceptance']
content=json.dumps(report,indent=2)+'\n'
(output/'controls.json').write_text(content)
(HERE/('activity-admitted-entry-controls.json' if os.environ.get('OPENPLAN_STAGE_USE_ENTRY')=='1' else 'activity-publication-'+boundary+'-uncertainty-controls.json' if uncertainty else 'activity-stage-publication-controls.json')).write_text(content)
print(content)
