"""Detect missing scope supervision even when native computation succeeds."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_SCOPED_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case in ('baseline','harmless','omit-scope','restored'):
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_scoped_assignment.py')],capture_output=True,text=True,timeout=150,
        env=dict(os.environ,OPENPLAN_NATIVE_SCOPED_OUTPUT=str(output/case),OPENPLAN_NATIVE_SCOPED_CONTROL='baseline' if case=='restored' else case))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-scope':
        assert result.returncode==1 and 'AssertionError: Native scope supervision missing' in result.stderr,'Scope omission not detected: '+result.stderr
        records.append({'control':case,'detected':'Native scope supervision missing'})
    else:
        assert result.returncode==0,case+': '+result.stderr
        report=json.loads((output/case/'result.json').read_text())
        records.append({'control':case,'scope':report['exit_receipt']['scope'],'converged':report['convergence']['converged'],'modeled_transit':report['modeled_transit'],'artifact_count':report['artifact_count']})
report={'proof_sha256':hashlib.sha256((ROOT/'verify_native_scoped_assignment.py').read_bytes()).hexdigest(),'controls':records,'evidence_directory':str(output),
        'limits':'Full small synthetic native assignment and production scoped launch. Mocked parent database transport, no recovery/cancellation, completed publication, scientific acceptance or normal dispatch.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-scoped-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
