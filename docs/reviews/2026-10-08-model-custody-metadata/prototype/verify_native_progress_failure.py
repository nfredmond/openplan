"""Observe native solver behavior after a synthetic unconfirmed progress write."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'

CHILD='''
import ast,json,os,sys,threading
from pathlib import Path
from importlib.metadata import version
import numpy as np
from aequilibrae import Project
from aequilibrae.context import get_active_project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment,TrafficClass
from shapely.geometry import Point,LineString
from model_engine_scope import project_scope,matrix_scope
from assignment_settings import build_traffic_assignment,resolve_assignment_profile
from assignment_progress import stream_assignment_progress
root=Path(sys.argv[1]);project_path=root/'project'
class Unconfirmed(RuntimeError):pass
failure=Unconfirmed('Synthetic lost progress receipt')
observed=[];owner=threading.get_ident();returned=False;caught_same=False
try:
 with project_scope(Project,str(project_path),create=True) as project, matrix_scope() as own:
  for node_id,x in ((1,0.0),(2,0.01)):
   node=project.network.nodes.new_centroid(node_id);node.geometry=Point(x,0);node.save()
  link=project.network.links.new()
  link.__dict__['a_node']=1;link.__dict__['b_node']=2
  link.direction=0;link.modes='c';link.distance=1000.0
  link.speed_ab=30.0;link.speed_ba=30.0
  link.travel_time_ab=2.0;link.travel_time_ba=2.0
  link.capacity_ab=1000.0;link.capacity_ba=1000.0
  link.geometry=LineString([(0,0),(0.01,0)]);link.save()
  project.network.build_graphs(modes=['c']);graph=project.network.graphs['c']
  graph.set_graph('travel_time');graph.prepare_graph(np.array([1,2]));graph.set_blocked_centroid_flows(True)
  matrix=own(AequilibraeMatrix());matrix.create_empty(zones=2,matrix_names=['resident'],memory_only=True)
  matrix.index[:]=[1,2];matrix.computational_view(['resident']);matrix.matrix_view[:]=[[0,17],[23,0]]
  traffic=TrafficClass('resident',graph,matrix)
  assignment=build_traffic_assignment(TrafficAssignment,[traffic],profile=resolve_assignment_profile({}))
  def emit(line):
   observed.append({'line':line,'on_invocation_thread':threading.get_ident()==owner})
   if line.startswith('Assignment iteration'):raise failure
  clock=[0]
  def now():
   clock[0]+=6
   return clock[0]
  def timed_stream(*args,**kwargs):
   return stream_assignment_progress(*args,now=now,**kwargs)
  source=Path('main.py').read_text()
  if sys.argv[2]=='swallow':source=source.replace('fatal_exceptions=(WorkerStateWriteUnconfirmed,),','fatal_exceptions=(),')
  if sys.argv[2]=='wrong-logger':source=source.replace('logger_name=project.logger.name,',"logger_name='aequilibrae',")
  tree=ast.parse(source)
  stage=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stage_assignment')
  call=next(n for n in ast.walk(stage) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='stream_assignment_progress')
  context=eval(compile(ast.Expression(call),'main.py','eval'),{'stream_assignment_progress':timed_stream,'WorkerStateWriteUnconfirmed':Unconfirmed},{'_emit_progress':emit,'assig':assignment,'project':project})
  with context:
   assignment.execute()
   returned=True
except Unconfirmed as error:
 caught_same=error is failure
if not caught_same or returned:raise AssertionError('Native solver continued after unconfirmed progress')
if not any(row['line'].startswith('Assignment iteration') for row in observed):raise AssertionError('Native solver emitted no iteration progress')
if not all(row['on_invocation_thread'] for row in observed):raise AssertionError('Progress used a different invocation thread')
if get_active_project(must_exist=False) is not None:raise AssertionError('Native project remains active')
opened=[]
for fd in Path('/proc/self/fd').iterdir():
 try:target=os.readlink(fd)
 except FileNotFoundError:continue
 if target.startswith(str(project_path)+'/'):opened.append(target)
if opened:raise AssertionError('Native project descriptors remain open: '+repr(opened))
report={'engine_version':version('aequilibrae'),'observed':observed,'original_error_propagated':caught_same,'execute_returned':returned,'project_descriptors_after_exit':opened}
(root/'result.json').write_text(json.dumps(report,indent=2)+'\\n')
'''


def main():
    output=Path(os.environ['OPENPLAN_NATIVE_PROGRESS_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    records=[]
    for case in ('baseline','harmless','swallow','wrong-logger','restored'):
        directory=output/case;directory.mkdir(mode=0o700)
        body=CHILD+('\n# Harmless comment.\n' if case=='harmless' else '')
        result=subprocess.run([sys.executable,'-B','-c',body,str(directory),case],cwd=WORKER,
                              capture_output=True,text=True,timeout=60)
        (directory/'child.log').write_text(result.stdout+result.stderr)
        if case in ('swallow','wrong-logger'):
            if result.returncode!=1 or 'AssertionError: Native solver continued after unconfirmed progress' not in result.stderr:
                raise AssertionError('Swallowed-progress fault missed: '+result.stderr)
            records.append({'control':case,'detected':'Native solver continued after unconfirmed progress'})
        else:
            if result.returncode:raise AssertionError(case+' failed: '+result.stderr)
            records.append({'control':case,'result':json.loads((directory/'result.json').read_text())})
    report={'progress_sha256':hashlib.sha256((WORKER/'assignment_progress.py').read_bytes()).hexdigest(),
            'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),
            'scope_sha256':hashlib.sha256((WORKER/'model_engine_scope.py').read_bytes()).hexdigest(),
            'controls':records,'limits':'Native two-node one-link assignment with synthetic demand, accelerated progress clock and synthetic iteration callback failure. No database transport, full stage function, larger network thread behavior, supervisor loss or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'native-progress-failure.json').write_text(content)
    (ROOT/'native-progress-failure.json').write_text(content)
    print(content)


if __name__=='__main__':main()
