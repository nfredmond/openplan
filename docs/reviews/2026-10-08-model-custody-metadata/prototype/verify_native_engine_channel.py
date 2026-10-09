"""Native assignment progress through the reserved child and parent journal."""
import hashlib,json,os,select,shutil,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
from model_engine_process import EngineProcess
from model_engine_channel import ChannelStopped
import model_command_journal as journal
from test_model_attempt_writer import WriterTests
from verify_native_progress_failure import CHILD


def child_source():
    body=CHILD.replace("root=Path(sys.argv[1]);project_path=root/'project'", "from model_engine_channel import inherited_progress_client\nclient=inherited_progress_client()\nroot=Path(sys.argv[1]);project_path=root/'project'")
    body=body.replace("   if line.startswith('Assignment iteration'):raise failure", "   try:client.progress(line)\n   except Exception as error:raise failure from error")
    body=body.replace("source=Path('main.py').read_text()", "source=(Path(sys.argv[3])/'main.py').read_text()")
    body=body.replace("if not caught_same or returned:raise AssertionError('Native solver continued after unconfirmed progress')", "client.stop()\nexpected_failure=sys.argv[2] in ('lost-write','lost-response')\nif expected_failure and (not caught_same or returned):raise AssertionError('Native solver continued after unconfirmed progress')\nif not expected_failure and (caught_same or not returned):raise AssertionError('Confirmed native assignment did not finish')")
    return body


def main():
    output=Path(os.environ['OPENPLAN_NATIVE_CHANNEL_OUTPUT']).absolute()
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    results=[]
    for mode in ('baseline','harmless','lost-write','lost-response','false-ack','restored'):
        fixture=WriterTests('test_completion_uses_database_receipt_time_without_parent_patch')
        fixture.setUp();handle=None
        try:
            writer=fixture.writer
            writer.workspace(fixture.directory/'work',writer.context.run_id)
            original=fixture.response
            def deliver(url,**kwargs):
                log=kwargs['json'].get('p_log_tail','')
                if mode=='lost-write' and log.startswith('Assignment iteration'):
                    raise TimeoutError('Synthetic lost database response')
                return original(url,**kwargs)
            fixture.post.side_effect=deliver
            env=dict(os.environ,PYTHONPATH=str(WORKER))
            body=child_source()+('\n# Harmless comment.\n' if mode=='harmless' else '')
            handle=EngineProcess(writer,[sys.executable,'-B','-c',body,str(writer.files.path),mode,str(WORKER)],env=env,progress=True)
            handle.progress.connection.settimeout(10)
            if mode=='false-ack':
                write=writer.patch_stage
                def skip_iteration(stage,payload):
                    if payload['log_tail'].startswith('Assignment iteration'):return None
                    return write(stage,payload)
                writer.patch_stage=skip_iteration
            send=handle.progress.send
            if mode=='lost-response':
                def response(payload):
                    if (writer.state or {}).get('log_tail','').startswith('Assignment iteration'):
                        raise BrokenPipeError('Synthetic lost child response')
                    return send(payload)
                handle.progress.send=response
            failure=None;deadline=time.monotonic()+60
            while handle.process.poll() is None:
                if time.monotonic()>deadline:raise AssertionError('Native channel deadline exceeded')
                ready,_,_=select.select([handle.progress.connection],[],[],0.1)
                if not ready:continue
                # EOF after all acknowledged progress is not another request.
                if not handle.progress.connection.recv(1, __import__('socket').MSG_PEEK):break
                try:handle.progress.serve_one()
                except Exception as error:
                    failure=type(error).__name__
                    break
            handle.process.wait(timeout=15)
            if handle.process.returncode:raise AssertionError(mode+' child failed: '+(handle.directory/'engine.log').read_text())
            native=json.loads((writer.files.path/'result.json').read_text())
            pending=journal.pending(fixture.directory,fixture.cmd['destination'])
            commands=[row for row in journal.read_existing(fixture.directory,fixture.cmd['destination'],include_resolved=True) if row['command']['operation']=='write_model_stage_attempt']
            def verify_progress():
                assert [row['command']['arguments']['log_tail'] for row in commands]==[row['line'] for row in native['observed']], 'Native progress was acknowledged without its exact database command'
                for row in commands:
                    args=row['command']['arguments']
                    assert (args['run_id'],args['stage_id'],args['attempt_id'])==(writer.context.run_id,writer.context.stage_id,writer.context.attempt_id)
            if mode!='false-ack':verify_progress()
            if mode=='false-ack':
                try:verify_progress()
                except AssertionError as error:results.append({'control':mode,'detected':str(error)})
                else:raise AssertionError('False acknowledgement control did not execute')
            elif mode=='lost-write':
                assert failure and writer.stopped and len(pending)==1
                assert not native['execute_returned']
                results.append({'control':mode,'pending_commands':len(pending),'writer_stopped':True,'native':native})
            elif mode=='lost-response':
                assert failure=='BrokenPipeError' and writer.stopped and not pending
                assert not native['execute_returned']
                results.append({'control':mode,'pending_commands':0,'writer_stopped':True,'native':native})
            else:
                assert failure is None and fixture.post.call_count>0 and not pending
                assert native['execute_returned']
                receipt=handle.confirm_exit()
                assert receipt['execution_ready'] is False
                results.append({'control':mode,'confirmed_commands':fixture.post.call_count,'exit_code':receipt['returncode'],'native':native})
            # Preserve synthetic journal and engine files only after child exit.
            shutil.copytree(fixture.directory,output/mode)
        finally:
            if handle is not None:
                handle.progress.stop()
                if handle.process.poll() is None:handle.process.terminate()
                handle.process.wait(timeout=10)
            fixture.doCleanups()
    report={'source_hashes':{name:hashlib.sha256((WORKER/name).read_bytes()).hexdigest() for name in ('model_engine_process.py','model_engine_channel.py','assignment_progress.py','main.py')},'controls':results,'limits':'Native tiny-network solver, reserved subprocess, inherited progress channel and real parent command journal. HTTP and claimed ownership are fixtures; lost-write case is a transport timeout, not proof of server commit. No full stage input/result protocol, native database recovery, detached descendants or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'native-engine-channel.json').write_text(content);(ROOT/'native-engine-channel.json').write_text(content)
    print(content)


if __name__=='__main__':main()
