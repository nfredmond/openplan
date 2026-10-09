"""Run the complete assignment stage in a reserved child with synthetic inputs."""
import hashlib,json,os,select,socket,sqlite3,subprocess,sys,time
from contextlib import closing
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
import model_command_journal as journal
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
except BaseException as error:
 from aequilibrae.context import get_active_project
 (root/'assignment-failure.json').write_text(json.dumps({'error_type':type(error).__name__,'active_project':get_active_project(must_exist=False) is not None}))
 raise
finally:client.stop()
'''


def main():
    output=Path(os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    control=os.environ.get('OPENPLAN_BOUND_ASSIGNMENT_CONTROL','baseline')
    if control not in ('baseline','harmless','disable-mode-choice','lost-progress','lost-response','swallow-progress-fault'):raise ValueError('Unknown proof control')
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
        parent_failure=None
        if control in ('lost-progress','swallow-progress-fault'):
            def lose_progress(url,**kwargs):
                if 'Assignment iteration' in kwargs['json'].get('p_log_tail',''):
                    raise TimeoutError('Synthetic lost database reply during native iteration')
                return fixture.response(url,**kwargs)
            fixture.post.side_effect=lose_progress
        body=CHILD+('\n# Harmless comment.\n' if control=='harmless' else '')
        if control=='swallow-progress-fault':
            body=body.replace('import main\n', "import main\noriginal_stream=main.stream_assignment_progress\ndef swallow(*args,**kwargs):\n kwargs['fatal_exceptions']=()\n return original_stream(*args,**kwargs)\nmain.stream_assignment_progress=swallow\n")
        with patch.object(writer,'read_run',return_value=row),patch.dict(os.environ,{'GTFS_PATH':str(local),'GTFS_URL':''}):
            handle=EngineProcess(writer,[sys.executable,'-B','-c',body,str(root),writer.context.run_id,writer.context.stage_id,json.dumps(setup)],env=env,
                progress=True,output_name='run_output',count_preparer=counts,transit_preparer=transit)
            handle.progress.connection.settimeout(10)
            if control=='lost-response':
                send=handle.progress.send
                def lose_ack(payload):
                    if 'Assignment iteration' in (writer.state or {}).get('log_tail',''):
                        raise BrokenPipeError('Synthetic lost acknowledgement during native iteration')
                    return send(payload)
                handle.progress.send=lose_ack
            deadline=time.monotonic()+90
            while handle.process.poll() is None:
                if time.monotonic()>deadline:raise RuntimeError('Native assignment observation deadline exceeded')
                ready,_,_=select.select([handle.progress.connection],[],[],0.1)
                if not ready:continue
                if not handle.progress.connection.recv(1,socket.MSG_PEEK):break
                try:handle.progress.serve_one()
                except Exception as error:
                    parent_failure=type(error).__name__
                    if control not in ('lost-progress','lost-response','swallow-progress-fault'):raise
                    break
            code=handle.process.wait(timeout=15)
        (output/'child.log').write_text((handle.directory/'engine.log').read_text())
        if control in ('lost-progress','lost-response','swallow-progress-fault'):
            assert code!=0 and writer.stopped and parent_failure,'Native interruption did not stop both sides'
            failure=json.loads((root/'assignment-failure.json').read_text())
            assert failure=={'error_type':'WorkerStateWriteUnconfirmed','active_project':False},failure
            assert not (root/'assignment-result.json').exists()
            assert not (root/'run_output/link_volumes.csv').exists(),'Final assignment outputs survived uncertain iteration'
            pending=journal.pending(fixture.directory,writer.context.destination)
            assert len(pending)==(1 if control in ('lost-progress','swallow-progress-fault') else 0),pending
            if pending:
                assert 'Assignment iteration' in pending[0]['command']['arguments']['log_tail']
                (output/'pending-command.json').write_text(json.dumps(pending[0],indent=2)+'\n')
            snapshot=output/'recovery-journal';snapshot.mkdir(mode=0o700)
            with closing(sqlite3.connect(fixture.directory/'model-commands.sqlite3')) as source_db, closing(sqlite3.connect(snapshot/'model-commands.sqlite3')) as destination_db:
                source_db.backup(destination_db)
            os.chmod(snapshot/'model-commands.sqlite3',0o600)
            commands=journal.read_existing(snapshot,writer.context.destination,include_resolved=True)
            iteration=next(row for row in reversed(commands) if row['command']['operation']=='write_model_stage_attempt' and 'Assignment iteration' in row['command']['arguments']['log_tail'])
            config={'journal':str(snapshot),'base_url':writer.base_url,'deployment_id':writer.deployment_id,
                    'request_id':iteration['command']['request_id'],'report':str(output/'replay-result.json')}
            config_path=output/'replay-config.json';config_path.write_text(json.dumps(config))
            replay=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_command_replay.py'),str(config_path)],capture_output=True,text=True,timeout=30)
            (output/'replay.log').write_text(replay.stdout+replay.stderr)
            assert replay.returncode==0,'Fresh native command replay failed: '+replay.stderr
            replay_result=json.loads((output/'replay-result.json').read_text())
            assert not (root/'assignment-result.json').exists() and not (root/'run_output/link_volumes.csv').exists()
            report={'control':control,'parent_failure':parent_failure,'replay':replay_result,'child_failure':failure,'child_exit_code':code,
                    'pending_commands':len(pending),'final_outputs_absent':True,'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),
                    'limits':'Full synthetic native stage failure with mocked transport. Fresh-process exact command replay tested on snapshot with mocked RPC. No live database replay, model restart, supervisor loss, escaped descendants or scientific acceptance.'}
            content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('native-bound-assignment-'+control+'.json')).write_text(content)
            print(content);return
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
