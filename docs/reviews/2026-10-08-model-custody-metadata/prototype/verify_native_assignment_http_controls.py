"""Detect missing installed input registration despite successful native computation."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case in ('baseline','harmless','omit-geometry-registration','restored'):
    env=dict(os.environ,OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT=str(output/case),OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL='baseline' if case=='restored' else case)
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_assignment_http.py')],env=env,capture_output=True,text=True,timeout=150)
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-geometry-registration':
        if result.returncode!=1 or 'AssertionError: Installed input registration differs' not in result.stderr:raise AssertionError('Missing registration fault missed: '+result.stderr)
        records.append({'control':case,'detected':'Installed input registration differs'})
    else:
        if result.returncode:raise AssertionError(case+': '+result.stderr)
        native=json.loads((output/case/'result.json').read_text())
        records.append({'control':case,'native_converged':native['native_converged'],'modeled_transit':native['modeled_transit'],
                        'registered_artifacts':native['registered_artifacts'],'stage_remains_running':native['stage_remains_running'],'database':native['database']})
report={'proof_sha256':hashlib.sha256((ROOT/'verify_native_assignment_http.py').read_bytes()).hexdigest(),'controls':records,'evidence_directory':str(output),
        'limits':'Full synthetic native stage with live isolated PostgREST and installed commands. No lost-commit recovery, final publication, model restart, larger-network or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-assignment-http-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
