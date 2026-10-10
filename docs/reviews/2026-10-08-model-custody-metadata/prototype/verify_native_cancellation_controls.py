"""Cancel an actual native iteration with installed SQL and detect omitted cancellation."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_CANCEL_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
cases=[('baseline','cancel-progress'),('harmless','cancel-progress-harmless'),('omit-cancellation','omit-cancellation'),('restored','cancel-progress'),('normal-assignment','baseline'),('receipt-replay','lost-progress')]
for case,control in cases:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_scoped_http_assignment.py')],capture_output=True,text=True,timeout=150,
        env=dict(os.environ,OPENPLAN_SCOPED_HTTP_OUTPUT=str(output/case),OPENPLAN_SCOPED_HTTP_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-cancellation':
        assert result.returncode==1 and 'AssertionError: Native cancellation did not stop engine' in result.stderr,'Missing cancellation not detected: '+result.stderr
        candidate=json.loads((output/case/'live/candidate.json').read_text())
        records.append({'control':case,'database':candidate['database'],'detected':'Native cancellation did not stop engine'})
    else:
        assert result.returncode==0,case+': '+result.stderr
        r=json.loads((output/case/'result.json').read_text());live=r['native_http']
        records.append({'control':case,'database':live['database'],'scope_empty':r['scope_empty_observation']['observed_scope_empty'],
                        'cancellation':live['cancellation'],'database_observation':live['database_observation'],
                        'native_converged':live['native_converged'],'replay':live['replay'],'final_outputs_absent':live['final_outputs_absent']})
report={'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_scoped_http_assignment.py','verify_native_assignment_http.py','verify_native_bound_assignment.py')},
        'controls':records,'evidence_directory':str(output),
        'limits':'Real small native assignment, Linux scope and isolated installed SQL. Forced cancellation at a confirmed iteration before acknowledgement. No fresh cancellation reconciliation, parent-loss recovery, UI/database cancellation decision, output publication, scientific acceptance or normal dispatch.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-cancellation-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
