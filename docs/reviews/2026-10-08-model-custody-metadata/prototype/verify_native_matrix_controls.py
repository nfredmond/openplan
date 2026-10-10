"""Native demand-matrix regression controls for index storage and OMX format."""
import json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent


def main():
    root=Path(os.environ['OPENPLAN_MATRIX_CONTROLS_OUTPUT']).absolute();root.mkdir(mode=0o700,parents=True,exist_ok=False)
    records=[]
    for name,fault,error in [('baseline','',''),('harmless','harmless',''),('replace-index','replace-index',"'numpy.ndarray' object has no attribute 'flush'"),('false-omx','false-omx','file signature not found'),('restored','','')]:
        result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_matrix_scope.py')],env={**os.environ,'OPENPLAN_MATRIX_SCOPE_PROOF_OUTPUT':str(root/name),'OPENPLAN_MATRIX_SCOPE_FAULT':fault},capture_output=True,text=True,timeout=60)
        (root/(name+'.log')).write_text(result.stdout+result.stderr)
        if error:
            if result.returncode!=1 or error not in result.stderr:raise AssertionError(name+' missed native fault: '+result.stderr)
            records.append({'control':name,'expected_failure':error})
        else:
            if result.returncode:raise AssertionError(name+' failed: '+result.stderr)
            records.append({'control':name,'result':json.loads((root/name/'native-matrix-scope.json').read_text())})
    report={'controls':records,'limits':'Actual assignment demand factory, native matrix close and exported OMX reopen with synthetic 2x2 values. Confirms two regressions and records outstanding view handles, not assignment completion or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n';(root/'result.json').write_text(content);(ROOT/'native-matrix-controls.json').write_text(content);print(content)


if __name__=='__main__':main()
