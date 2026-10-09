"""Exercise scoped native execution and live receipt recovery together."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_SCOPED_HTTP_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','baseline'),('harmless','harmless'),('lost-progress','lost-progress'),('lost-progress-harmless','lost-progress-harmless'),('omit-scope','omit-scope'),('restored','lost-progress')]:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_scoped_http_assignment.py')],capture_output=True,text=True,timeout=150,
        env=dict(os.environ,OPENPLAN_SCOPED_HTTP_OUTPUT=str(output/case),OPENPLAN_SCOPED_HTTP_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-scope':
        assert result.returncode==1 and 'AssertionError: Live native scope supervision missing' in result.stderr,'Scope omission not detected: '+result.stderr
        records.append({'control':case,'detected':'Live native scope supervision missing'})
    else:
        assert result.returncode==0,case+': '+result.stderr
        r=json.loads((output/case/'result.json').read_text())
        records.append({'control':case,'scope_empty':r['scope_empty_observation']['observed_scope_empty'],'database':r['native_http']['database'],
                        'native_converged':r['native_http']['native_converged'],'modeled_transit':r['native_http']['modeled_transit'],
                        'replay':r['native_http']['replay'],'final_outputs_absent':r['native_http']['final_outputs_absent']})
report={'proof_sha256':hashlib.sha256((ROOT/'verify_scoped_http_assignment.py').read_bytes()).hexdigest(),'controls':records,'evidence_directory':str(output),
        'limits':'Actual small native assignment, production scope and isolated installed SQL. No cancellation, parent-loss recovery, final publication, scientific acceptance or dispatcher activation.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'scoped-http-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
