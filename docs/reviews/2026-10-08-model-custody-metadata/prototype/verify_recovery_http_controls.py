"""Controls for retained abandonment over actual HTTP and a fresh recovery CLI."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_RECOVERY_HTTP_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','baseline'),('harmless','harmless'),('omit-disconnect','omit-disconnect'),('restored','baseline')]:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_recovery_decision_http.py')],capture_output=True,text=True,timeout=120,
        env=dict(os.environ,OPENPLAN_RECOVERY_HTTP_OUTPUT=str(output/case),OPENPLAN_RECOVERY_HTTP_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-disconnect':
        assert result.returncode==1 and 'Recovery reply loss was not observed' in result.stderr,result.stderr
        records.append({'control':case,'detected':'Recovery reply loss was not observed'})
    else:
        assert result.returncode==0,result.stderr
        records.append({'control':case,'result':json.loads((output/case/'result.json').read_text())})
worker=ROOT.parents[3]/'workers/aequilibrae_worker'
report={'controls':records,'evidence_directory':str(output),'source_sha256':{str(p.relative_to(ROOT.parents[3])):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'recovery-decision.sql',ROOT/'verify_recovery_decision_http.py',worker/'model_command_client.py',worker/'model_recovery_decision_command.py']},
 'limits':'Actual PostgREST and SQL receipts with synthetic operator identity. Application actor derivation, agent approval, visible recovery, cancellation and restart remain unconnected.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'recovery-http-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
