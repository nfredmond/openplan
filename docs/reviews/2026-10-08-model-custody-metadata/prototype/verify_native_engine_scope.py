"""Native interrupted project cleanup and reopen, without model assignment."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    output=Path(os.environ['OPENPLAN_ENGINE_SCOPE_PROOF_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    source=(WORKER/'model_engine_scope.py').read_text()
    if source.count('                project.close()')!=1:raise AssertionError('Native scope anchor changed')
    runner='''
import hashlib,importlib.util,json,os,sys
from pathlib import Path
from importlib.metadata import version
from aequilibrae import Project
from aequilibrae.context import get_active_project
import model_project_inputs as custody
spec=importlib.util.spec_from_file_location('scope_candidate',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=Path(sys.argv[2]);root.mkdir(mode=0o700)
path=root/'project'
project=Project();project.new(str(path))
try:
 with project.db_connection_spatial as connection:
  connection.execute("INSERT INTO nodes(node_id,is_centroid,geometry) VALUES (1,1,GeomFromText('POINT(-121 38)',4326)),(2,1,GeomFromText('POINT(-120.99 38)',4326))")
  connection.execute("INSERT INTO links(link_id,a_node,b_node,direction,modes,link_type,geometry) VALUES (1,1,2,0,'c','default',GeomFromText('LINESTRING(-121 38,-120.99 38)',4326))")
finally:project.close()
failure=KeyboardInterrupt('Synthetic native interruption')
try:
 with module.project_scope(Project,str(path)) as opened:
  with opened.db_connection_spatial as connection:
   nodes=connection.execute('SELECT node_id,is_centroid,AsText(geometry) FROM nodes ORDER BY node_id').fetchall()
  raise failure
except KeyboardInterrupt as caught:
 if caught is not failure:raise AssertionError('Interruption identity changed')
else:raise AssertionError('Interruption was suppressed')
if get_active_project(must_exist=False) is not None:
 raise AssertionError('Interrupted native project remains active')
opened_paths=[]
for fd in Path('/proc/self/fd').iterdir():
 try:target=os.readlink(fd)
 except FileNotFoundError:continue
 if target==str(path) or target.startswith(str(path)+'/'):opened_paths.append(target)
if opened_paths:raise AssertionError('Interrupted project still has open file descriptors: '+repr(opened_paths))
retained=custody.retain(path,root/'retained')
with module.project_scope(Project,str(path)) as reopened:
 with reopened.db_connection_spatial as connection:
  actual=connection.execute('SELECT node_id,is_centroid,AsText(geometry) FROM nodes ORDER BY node_id').fetchall()
if actual!=nodes or nodes!=[(1,1,'POINT(-121 38)'),(2,1,'POINT(-120.99 38)')]:raise AssertionError('Native reopen changed geometry')
if get_active_project(must_exist=False) is not None:raise AssertionError('Normal scope exit remains active')
report={'aequilibrae_version':version('aequilibrae'),'interruption_preserved':True,'active_project_cleared':True,'project_file_descriptors_after_interruption':opened_paths,'native_reopen_preserves_nodes':True,'copied_databases':retained['database_checks']}
(root/'result.json').write_text(json.dumps(report,indent=2)+'\\n')
print(json.dumps(report))
'''
    results=[]
    for name,body in [('baseline',source),('harmless',source+'\n# Harmless comment.\n'),('omit-close',source.replace('                project.close()','                pass')),('restored',source)]:
        candidate=output/(name+'.py');candidate.write_text(body)
        result=subprocess.run([sys.executable,'-B','-c',runner,str(candidate),str(output/name)],cwd=WORKER,text=True,capture_output=True,timeout=60)
        (output/(name+'.log')).write_text(result.stdout+result.stderr)
        if name=='omit-close':
            if result.returncode!=1 or 'AssertionError: Interrupted native project remains active' not in result.stderr:
                raise AssertionError('Native cleanup fault not detected: '+result.stderr)
            results.append({'control':name,'expected_failure':'Interrupted native project remains active'})
        else:
            if result.returncode:raise AssertionError(name+' failed: '+result.stderr)
            results.append({'control':name,'result':json.loads((output/name/'result.json').read_text())})
    report={'scope_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,'limits':'Native two-node one-link project, interruption after completed spatial read, actual project deactivation, current-process file-descriptor scan, copied SQLite integrity and native reopen. No assignment threads/matrices, mid-write crash, cross-process quiescence, full dispatch or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'native-engine-scope.json').write_text(content);(ROOT/'native-engine-scope.json').write_text(content)
    print(content)


if __name__=='__main__':main()
