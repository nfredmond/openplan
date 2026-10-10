"""Inspect actual native cancellation custody after confirmed or lost receipts."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_INSPECTION_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
cases=[('baseline','cancel-receipt-loss'),('harmless','cancel-receipt-loss-harmless'),('omit-receipt-loss','omit-receipt-loss'),('restored','cancel-receipt-loss'),('confirmed-cancellation','cancel-progress')]
for case,control in cases:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_scoped_http_assignment.py')],capture_output=True,text=True,timeout=150,
        env=dict(os.environ,OPENPLAN_SCOPED_HTTP_OUTPUT=str(output/case),OPENPLAN_SCOPED_HTTP_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-receipt-loss':
        assert result.returncode==1 and 'AssertionError: Native cancellation receipt loss was not preserved' in result.stderr,'Missing receipt-loss fault not detected: '+result.stderr
        candidate=json.loads((output/case/'live/candidate.json').read_text())
        records.append({'control':case,'database':candidate['database'],'detected':'Native cancellation receipt loss was not preserved'})
    else:
        assert result.returncode==0,case+': '+result.stderr
        r=json.loads((output/case/'result.json').read_text());live=r['native_http']
        records.append({'control':case,'database':live['database'],'scope_empty':r['scope_empty_observation']['observed_scope_empty'],
                        'cancellation_receipt_lost':live['cancellation_receipt_lost'],'engine_inspection':live['engine_inspection'],
                        'database_observation':live['database_observation'],'final_outputs_absent':live['final_outputs_absent']})
report={'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_scoped_http_assignment.py','verify_native_assignment_http.py','verify_native_bound_assignment.py')},
        'controls':records,'evidence_directory':str(output),
        'limits':'Actual native interruption, production scope, installed claim and fresh read-only inspection. No durable reconciliation decision, parent-loss handling, database/UI cancellation decision, restart, output publication or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-inspection-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
