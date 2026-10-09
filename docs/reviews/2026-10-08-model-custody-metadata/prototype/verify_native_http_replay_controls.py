"""Check native committed-reply recovery and detect a missing interruption."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_HTTP_REPLAY_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','lost-progress'),('harmless','lost-progress-harmless'),('omit-disconnect','omit-disconnect'),('restored','lost-progress')]:
    env=dict(os.environ,OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT=str(output/case),OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL=control)
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_assignment_http.py')],env=env,capture_output=True,text=True,timeout=150)
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-disconnect':
        assert result.returncode==1 and 'AssertionError: Native interruption did not stop both sides' in result.stderr,'Missing interruption was not detected: '+result.stderr
        records.append({'control':case,'detected':'Native interruption did not stop both sides'})
    else:
        assert result.returncode==0,case+': '+result.stderr
        report=json.loads((output/case/'result.json').read_text())
        assert report['replay']['database_state_unchanged'] and report['final_outputs_absent']
        records.append({'control':case,'database':report['database'],'replay':report['replay'],'final_outputs_absent':True})
report={'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_assignment_http.py','verify_native_bound_assignment.py')},
        'controls':records,'evidence_directory':str(output),
        'limits':'Small synthetic native assignment and actual installed SQL. Backup journal replay only; no model restart, supervisor recovery, scientific acceptance or dispatcher activation.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-http-replay-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
