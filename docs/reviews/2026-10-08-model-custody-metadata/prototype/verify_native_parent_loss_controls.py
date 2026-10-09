"""Native supervisor-loss controls with owned parent/engine processes and installed SQL."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_PARENT_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','parent-loss'),('harmless','parent-loss-harmless'),('omit-parent-loss','omit-parent-loss'),('swallow-parent-loss','swallow-parent-loss'),('restored','parent-loss')]:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_parent_loss.py')],capture_output=True,text=True,timeout=180,
        env=dict(os.environ,OPENPLAN_NATIVE_PARENT_OUTPUT=str(output/case),OPENPLAN_NATIVE_PARENT_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case in ('omit-parent-loss','swallow-parent-loss'):
        expected='Native supervisor loss was not observed' if case=='omit-parent-loss' else 'Native child published outputs after supervisor loss'
        assert result.returncode==1 and 'AssertionError: '+expected in result.stderr,case+' failed to detect fault: '+result.stderr
        candidate=json.loads((output/case/'live/candidate.json').read_text())
        records.append({'control':case,'database':candidate['database'],'detected':expected})
    else:
        assert result.returncode==0,case+': '+result.stderr
        r=json.loads((output/case/'result.json').read_text());live=r['native_http']
        records.append({'control':case,'database':live['database'],'parent_loss':live['parent_loss'],'stage_remains_running':live['stage_remains_running']})
report={'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_parent_loss.py','verify_native_parent_supervisor.py','verify_native_assignment_http.py')},
        'controls':records,'evidence_directory':str(output),
        'limits':'Actual parent SIGKILL and native channel-loss handling at a confirmed iteration, installed SQL and fresh inspection. No general parent-loss supervision during computation, durable reconciliation, restart, UI workflow, publication or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-parent-loss-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
