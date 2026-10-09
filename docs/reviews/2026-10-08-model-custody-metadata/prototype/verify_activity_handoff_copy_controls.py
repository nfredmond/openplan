"""Live database and file-copy controls with isolated per-case proof state."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
output=Path(os.environ['OPENPLAN_HANDOFF_COPY_CONTROLS']);output.mkdir(mode=0o700,parents=True,exist_ok=False)
cases=[]
for mode in ('normal','harmless','tampered','bypass-hash','restored'):
    run=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('verify_activity_handoff_copy_http.py'))],
        env={**os.environ,'OPENPLAN_HANDOFF_COPY_MODE':mode,'OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT':str(output/mode)},
        text=True,capture_output=True,timeout=90)
    (output/(mode+'.log')).write_text(run.stdout+run.stderr)
    if mode=='bypass-hash':
        assert run.returncode!=0 and 'AssertionError: Corrupted source survived registered-byte verification' in run.stderr,run.stderr
    else:
        assert run.returncode==0,run.stderr
        result=json.loads((output/mode/'activity-handoff-copy-http.json').read_text())
        if mode=='tampered':assert any(c.get('control')=='changed-source-bytes' and c.get('refused') and c.get('writer_stopped') for c in result['controls'])
    cases.append({'case':mode,'returncode':run.returncode,'expected_behavior_observed':True})
report={'cases':cases,'sources':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in (
    'workers/activitysim_worker/supabase_poll.py','workers/aequilibrae_worker/model_activitysim_handoff.py','workers/aequilibrae_worker/model_handoff_files.py')},
    'limits':['Real database-selected registered synthetic files and attempt directory','No native engine dispatch, concurrent revocation fence, full RLS matrix or scientific acceptance']}
text=json.dumps(report,indent=2)+'\n';(output/'controls.json').write_text(text);print(text)
