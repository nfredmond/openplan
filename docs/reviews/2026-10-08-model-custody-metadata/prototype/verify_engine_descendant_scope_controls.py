"""Require scope membership to detect a detached child after its leader exits."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_ENGINE_SCOPE_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case in ('baseline','harmless','process-group-only','restored'):
    env=dict(os.environ,OPENPLAN_ENGINE_SCOPE_OUTPUT=str(output/case),OPENPLAN_ENGINE_SCOPE_CONTROL='baseline' if case=='restored' else case)
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_engine_scope_descendants.py')],env=env,capture_output=True,text=True,timeout=40)
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='process-group-only':
        assert result.returncode==1 and 'AssertionError: Detached descendant escaped completion check' in result.stderr,'Detached descendant fault not detected: '+result.stderr
        records.append({'control':case,'detected':'Detached descendant escaped completion check'})
    else:
        assert result.returncode==0,result.stderr
        r=json.loads((output/case/'result.json').read_text())
        records.append({'control':case,'unit':r['unit'],'progress_channel_confirmed':r['progress_channel_confirmed'],'completion_refused_while_descendant_live':r['completion_refused_while_descendant_live'],'scope_removed_after_descendant_exit':r['scope_removed_after_descendant_exit']})
report={'proof_sha256':hashlib.sha256((ROOT/'verify_engine_scope_descendants.py').read_bytes()).hexdigest(),'controls':records,'evidence_directory':str(output),
        'limits':'Real Linux scope feasibility, mocked database transport. No production startup fence, parent-loss recovery, sandbox, output capture or dispatch activation.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-descendant-scope-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
