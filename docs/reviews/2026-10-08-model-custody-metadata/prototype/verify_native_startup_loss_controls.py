"""Startup supervisor-loss controls using installed SQL and the real gated engine command."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_STARTUP_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('before-record','startup-before'),('harmless','startup-before-harmless'),('after-record','startup-after'),('early-release','startup-early'),('restored','startup-before')]:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_parent_loss.py')],capture_output=True,text=True,timeout=180,
        env=dict(os.environ,OPENPLAN_NATIVE_PARENT_OUTPUT=str(output/case),OPENPLAN_NATIVE_PARENT_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='early-release':
        expected='Engine began before startup custody was released'
        assert result.returncode==1 and 'AssertionError: '+expected in result.stderr,case+' failed to detect fault: '+result.stderr
        candidate=json.loads((output/case/'live/candidate.json').read_text())
        records.append({'control':case,'database':candidate['database'],'detected':expected})
    else:
        assert result.returncode==0,case+': '+result.stderr
        live=json.loads((output/case/'result.json').read_text())['native_http']
        records.append({'control':case,'database':live['database'],'parent_loss':live['parent_loss'],'stage_remains_running':live['stage_remains_running']})
report={'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_parent_loss.py','verify_native_parent_supervisor.py','verify_native_assignment_http.py')},
        'controls':records,'evidence_directory':str(output),
        'limits':'Actual supervisor SIGKILL before or after scope record and before authorization. The engine body must remain unexecuted. The outer fixture retains scope identity only for cleanup observation; missing production startup custody remains unconfirmed. No restart, durable reconciliation, UI workflow, publication or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-startup-loss-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
