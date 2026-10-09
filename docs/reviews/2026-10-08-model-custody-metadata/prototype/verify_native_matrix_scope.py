"""Measure native matrix closure and retained views in a disposable child."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    output=Path(os.environ['OPENPLAN_MATRIX_SCOPE_PROOF_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    runner='''
import ast,gc,json,os,sys
from pathlib import Path
import numpy as np
from aequilibrae.matrix import AequilibraeMatrix
from importlib.metadata import version
from model_engine_scope import matrix_scope
path=Path(sys.argv[1])/'demand.aem'
def descriptors():
 found=[]
 for fd in Path('/proc/self/fd').iterdir():
  try:target=os.readlink(fd)
  except FileNotFoundError:continue
  if target==str(path):found.append(fd.name)
 return found
worker_source=Path('main.py').read_text()
fault=os.environ.get('OPENPLAN_MATRIX_SCOPE_FAULT','')
if fault=='replace-index':worker_source=worker_source.replace('mat.index[:] = np.array(assignment_centroids)','mat.index = np.array(assignment_centroids)')
elif fault=='false-omx':
 worker_source=worker_source.replace('file_name=os.path.join(out_dir, f"{file_stem}.aem")','file_name=os.path.join(out_dir, f"{file_stem}.omx")')
 worker_source=worker_source.replace('mat.export(os.path.join(out_dir, f"{file_stem}.omx"))','pass')
elif fault=='harmless':worker_source+=chr(10)+'# Harmless comment.'+chr(10)
elif fault:raise AssertionError('Unknown native matrix control')
tree=ast.parse(worker_source)
stage=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stage_assignment')
factory=next(n for n in ast.walk(stage) if isinstance(n,ast.FunctionDef) and n.name=='_demand_matrix')
with matrix_scope() as own:
 namespace={'AequilibraeMatrix':AequilibraeMatrix,'np':np,'os':os,'out_dir':str(path.parent),'n_assign':2,'assignment_centroids':[1,2],'own_matrix':own}
 exec(compile(ast.Module(body=[factory],type_ignores=[]),'main.py','exec'),namespace)
 matrix=namespace['_demand_matrix']('demand','demand',np.array([[0,17],[23,0]],dtype=float))
 retained_view=matrix.matrix_view
 before=descriptors()
after=descriptors()
values=retained_view.tolist()
if values!=[[0.0,17.0],[23.0,0.0]]:raise AssertionError('Native demand values changed')
# Keep the borrowed view alive while releasing the matrix owner.
del matrix,own,namespace
gc.collect()
after_owner_release=descriptors()
del retained_view
gc.collect()
after_view_release=descriptors()
report={'aequilibrae_version':version('aequilibrae'),'file_descriptors_before_close':len(before),'file_descriptors_after_scope':len(after),'file_descriptors_after_owner_release':len(after_owner_release),'file_descriptors_after_view_release':len(after_view_release),'retained_view_values':values}
(Path(sys.argv[1])/'child-result.json').write_text(json.dumps(report,indent=2)+'\\n')
'''
    child=subprocess.run([sys.executable,'-B','-c',runner,str(output)],cwd=WORKER,capture_output=True,text=True,timeout=30)
    (output/'child.log').write_text(child.stdout+child.stderr)
    if child.returncode:raise AssertionError('Native matrix measurement failed: '+child.stderr)
    observed=json.loads((output/'child-result.json').read_text())
    # Verify persisted bytes only after the child has exited.
    reader='''
import json,sys
from aequilibrae.matrix import AequilibraeMatrix
matrix=AequilibraeMatrix();matrix.load(sys.argv[1])
try:
 matrix.computational_view(['demand'])
 values=matrix.matrix_view.tolist()
 if values!=[[0.0,17.0],[23.0,0.0]]:raise AssertionError('Persisted native matrix differs')
 if matrix.index.tolist()!=[1,2]:raise AssertionError('Persisted matrix indices differ')
 print(json.dumps(values))
finally:matrix.close()
'''
    reopened=subprocess.run([sys.executable,'-B','-c',reader,str(output/'demand.omx')],cwd=WORKER,capture_output=True,text=True,timeout=30)
    (output/'reopen.log').write_text(reopened.stdout+reopened.stderr)
    if reopened.returncode:raise AssertionError('Native matrix reopen failed: '+reopened.stderr)
    report={'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'scope_sha256':hashlib.sha256((WORKER/'model_engine_scope.py').read_bytes()).hexdigest(),'observed':observed,'child_exit_code':child.returncode,'separate_process_reopen_values':json.loads(reopened.stdout),'limits':'Actual assignment demand-matrix factory with synthetic 2x2 disk-backed matrix and live borrowed computational view. Measures descriptors, not all mappings or engine threads. Child exit is observed; no production subprocess boundary, assignment, crash recovery or scientific acceptance is established.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'native-matrix-scope.json').write_text(content);(ROOT/'native-matrix-scope.json').write_text(content)
    print(content)


if __name__=='__main__':main()
