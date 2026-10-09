"""Run the complete assignment stage in a reserved child with synthetic inputs."""
import hashlib,json,os,select,socket,sys,time
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
from aequilibrae import Project
from shapely.geometry import Point,LineString
from model_engine_scope import project_scope
from model_engine_process import EngineProcess
import model_project_inputs,model_package_inputs,model_attempt_writer as managed
from test_project_working_copy import ProjectWorkingCopyTests
from test_model_skip_dispatch import aeq
from test_transit_feed_handoff import _feed_bytes

CHILD='''
import json,sys
from pathlib import Path
from importlib.metadata import version
from model_engine_channel import inherited_progress_client
from model_engine_binding import EngineBinding,bind
# Network calls are forbidden in this synthetic assignment. The inherited
# socket is already connected; its reads/writes need no socket.connect event.
def audit(event,args):
 if event=='socket.connect':raise RuntimeError('Child network connection forbidden')
sys.addaudithook(audit)
import main
root=Path(sys.argv[1]);setup=json.loads(sys.argv[4])
client=inherited_progress_client()
try:
 with bind(EngineBinding(client,run_id=sys.argv[2],stage_id=sys.argv[3],work_directory=root,output_name='run_output')):
  paths=client.read_paths()
  result=main.stage_assignment(sys.argv[2],sys.argv[3],str(root),setup,paths['package_directory'])
 (root/'assignment-result.json').write_text(json.dumps(result,allow_nan=False,indent=2)+'\\n')
 (root/'native-version.txt').write_text(version('aequilibrae'))
finally:client.stop()
'''


def main():
    output=Path(os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    control=os.environ.get('OPENPLAN_BOUND_ASSIGNMENT_CONTROL','baseline')
    if control not in ('baseline','harmless','disable-mode-choice'):raise ValueError('Unknown proof control')
    fixture=ProjectWorkingCopyTests();fixture.setUp();handle=None
    try:
        writer=fixture.writer;writer.get=fixture.get
        root=writer.workspace(output/'runs',writer.context.run_id)
        source=root/'source_project'
        with project_scope(Project,str(source),create=True) as project:
            points=[(-121.050,39.200),(-121.070,39.220)]
            for node_id,point in enumerate(points,1):
                node=project.network.nodes.new_centroid(node_id);node.geometry=Point(*point);node.save()
            link=project.network.links.new();link.__dict__['a_node']=1;link.__dict__['b_node']=2
            link.direction=0;link.modes='c';link.distance=3000.
            link.speed_ab=30.;link.speed_ba=30.;link.travel_time_ab=5.;link.travel_time_ba=5.
            link.capacity_ab=1000.;link.capacity_ba=1000.;link.geometry=LineString(points);link.save()
        producer={'artifact_id':fixture.artifact['id'],'stage_id':fixture.artifact['stage_id'],'attempt_id':fixture.artifact['attempt_id']}
        record=model_project_inputs.retain(source,root/'predecessor_project');record['producer']={**producer,'manifest_sha256':record['manifest_sha256']}
        writer.prepare_project_working_copy(record)
        package=root/'source_package';package.mkdir()
        (package/'zone_attributes.csv').write_text('zone_id,centroid_lon,centroid_lat,area_sq_mi,est_population,total_jobs\n20,-121.050,39.200,2,100,100\n10,-121.070,39.220,1,100,100\n')
        (package/'od_trip_matrix.csv').write_text('zone_id,20,10\n20,10,100\n10,100,10\n')
        record=model_package_inputs.retain(package,root/'predecessor_package');record['producer']={**producer,'manifest_sha256':record['manifest_sha256']}
        writer.prepare_package_working_copy(record)
        setup={'centroid_map':{'20':1,'10':2},'cordon_map':{}}
        local=root/'synthetic-feed.zip';local.write_bytes(_feed_bytes())
        row={'id':writer.context.run_id,'workspace_id':writer.context.workspace_id,'input_snapshot_json':{}}
        with managed.bind(writer):
            counts=aeq.managed_assignment_count_preparer(setup,counts_path_override=str(root/'absent-counts.csv'))
            transit=aeq.managed_assignment_transit_preparer(setup,deadline=time.monotonic()+60)
        env={'PATH':os.environ.get('PATH','/usr/bin'),'PYTHONPATH':str(WORKER),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','AEQ_CORES':'1',
             'SPATIALITE_LIBRARY_PATH':'/usr/lib/x86_64-linux-gnu/mod_spatialite.so',
             'SUPABASE_URL':'http://synthetic.invalid','SUPABASE_SERVICE_ROLE_KEY':'synthetic-not-a-key',
             'MODE_SPLIT_ENABLED':'1','AEQ_CALIBRATE':'0','COUNT_VALIDATION_ENABLED':'0'}
        if control=='disable-mode-choice':env['MODE_SPLIT_ENABLED']='0'
        body=CHILD+('\n# Harmless comment.\n' if control=='harmless' else '')
        with patch.object(writer,'read_run',return_value=row),patch.dict(os.environ,{'GTFS_PATH':str(local),'GTFS_URL':''}):
            handle=EngineProcess(writer,[sys.executable,'-B','-c',body,str(root),writer.context.run_id,writer.context.stage_id,json.dumps(setup)],env=env,
                progress=True,output_name='run_output',count_preparer=counts,transit_preparer=transit)
            handle.progress.connection.settimeout(10)
            deadline=time.monotonic()+90
            while handle.process.poll() is None:
                if time.monotonic()>deadline:raise RuntimeError('Native assignment observation deadline exceeded')
                ready,_,_=select.select([handle.progress.connection],[],[],0.1)
                if not ready:continue
                if not handle.progress.connection.recv(1,socket.MSG_PEEK):break
                handle.progress.serve_one()
            code=handle.process.wait(timeout=15)
        (output/'child.log').write_text((handle.directory/'engine.log').read_text())
        if code:raise AssertionError('Native child failed; inspect '+str(output/'child.log'))
        result=json.loads((root/'assignment-result.json').read_text())
        assert isinstance(result['mode_split'],dict) and result['mode_split']['transit_status']=='modeled','Expected modeled transit outcome'
        assert result['mode_split']['transit_los']['feed_origin']=='operator_path'
        assert result['loaded_links']>0 and result['convergence']['converged'],result
        assert Path(result['counts_path']).is_relative_to(root/'run_output/child_count_inputs')
        receipt=handle.confirm_exit();assert receipt['execution_ready'] is False
        artifacts={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'run_output').rglob('*') if p.is_file()}
        assert 'run_output/link_volumes.csv' in artifacts
        report={'control':control,'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'source_sha256':{name:hashlib.sha256((WORKER/name).read_bytes()).hexdigest() for name in ('model_engine_binding.py','model_engine_channel.py','model_engine_process.py','model_transit_execution.py','model_geometry_inputs.py','model_count_inputs.py')},
                'engine_version':(root/'native-version.txt').read_text(),
                'convergence':result['convergence'],'loaded_links':result['loaded_links'],'mode_split':result['mode_split'],'artifacts':artifacts,'exit_receipt':receipt,
                'limits':'Full native stage_assignment with two synthetic centroid nodes and one link; mocked parent run/database transport, directly constructed consumed predecessor fixtures, no calibration/cordons. No interruption recovery, scientific validity, normal dispatcher or release acceptance.'}
        content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('native-bound-assignment-'+control+'.json')).write_text(content)
        print(json.dumps({'output':str(output),'engine_version':report['engine_version'],'converged':result['convergence']['converged'],'loaded_links':result['loaded_links'],'artifact_count':len(artifacts)}))
    finally:
        if handle is not None:
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=15)
        fixture.doCleanups()

if __name__=='__main__':main()
