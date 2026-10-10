"""Use isolated module mutations and owned disposable scopes to test cancellation."""
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
modules=('model_engine_process.py','model_engine_supervision.py','model_engine_bootstrap.py')
sources={name:(WORKER/name).read_text() for name in modules};records=[]
cases=[('baseline',None,None),('harmless',None,None),
('signal-before-intent','test_failed_intent_record_never_signals','Engine signaled before cancellation record'),
('ignore-invocation','test_identity_change_refuses_signal','ValueError not raised'),
('ignore-directory','test_cgroup_directory_change_refuses_signal','ValueError not raised'),
('ignore-thread','test_foreign_thread_refuses_signal','ValueError not raised'),
('resend-uncertain','test_lost_signal_receipt_never_sends_again','Uncertain cancellation resent'),
('omit-signal','test_stopped_writer_can_stop_its_own_engine','timed out after'),
('ignore-unrequested','test_unrequested_termination_observation_refused','signal has not been confirmed'),
('ignore-unscoped','test_unscoped_handle_refuses_cancel','AttributeError'),
('ignore-observed-exit','test_confirmed_exit_refuses_cancel','exit was already observed'),
('restored',None,None)]
for case,test,expected in cases:
    with tempfile.TemporaryDirectory(prefix='openplan-cancel-control-') as temporary:
        directory=Path(temporary);candidate=dict(sources)
        if case=='harmless':candidate['model_engine_process.py']+='\n# Harmless cancellation comment.\n'
        if case=='signal-before-intent':
            old="                record_intent(dict(self.identity))\n                if os.write(kill_file,b'1')!=1:raise OSError('Owned scope signal write was incomplete')"
            new="                if os.write(kill_file,b'1')!=1:raise OSError('Owned scope signal write was incomplete')\n                record_intent(dict(self.identity))"
            assert old in candidate['model_engine_supervision.py'];candidate['model_engine_supervision.py']=candidate['model_engine_supervision.py'].replace(old,new)
        if case in ('ignore-invocation','ignore-directory','omit-signal'):
            s=candidate['model_engine_supervision.py'];start=s.index('    def kill_owned(');prefix,part=s[:start],s[start:]
            if case=='ignore-invocation':part=part.replace("if state.get('InvocationID')!=self.identity['invocation_id'] or state.get('ControlGroup')!=self.identity['cgroup']:","if False:")
            if case=='ignore-directory':part=part.replace("if (info.st_dev,info.st_ino)!=(self.identity['cgroup_device'],self.identity['cgroup_inode']):","if False:")
            if case=='omit-signal':part=part.replace("if os.write(kill_file,b'1')!=1:","if False:")
            candidate['model_engine_supervision.py']=prefix+part
        if case=='ignore-thread':candidate['model_engine_process.py']=candidate['model_engine_process.py'].replace("        if self.writer.thread_id!=threading.get_ident():raise ValueError('Cancellation belongs to another invocation thread')\n",'',1)
        if case=='resend-uncertain':candidate['model_engine_process.py']=candidate['model_engine_process.py'].replace("        if self.cancellation_requested:raise RuntimeError('Unconfirmed cancellation requires reconciliation')\n",'')
        removed_guards={
            'ignore-unrequested':"        if self.cancellation is None:raise RuntimeError('Cancellation signal has not been confirmed')\n",
            'ignore-unscoped':"        if self.scope is None:raise ValueError('Cancellation requires an owned engine scope')\n",
            'ignore-observed-exit':"        if self.receipt is not None:raise ValueError('Engine exit was already observed')\n"}
        if case in removed_guards:candidate['model_engine_process.py']=candidate['model_engine_process.py'].replace(removed_guards[case],'')
        for name,content in candidate.items():(directory/name).write_text(content)
        target='test_engine_scope_cancellation'+('.ScopeCancellationTests.'+test if test else '')
        result=subprocess.run([sys.executable,'-B','-m','unittest',target,'-v'],cwd=directory,
            env=dict(os.environ,PYTHONPATH=str(directory)+os.pathsep+str(WORKER),OPENPLAN_LIVE_ENGINE_SCOPE='1'),capture_output=True,text=True,timeout=60)
        if expected:
            assert result.returncode!=0 and expected in result.stderr,case+' failed to detect mutation: '+result.stderr
            records.append({'control':case,'detected':expected})
        else:
            assert result.returncode==0,case+': '+result.stderr
            records.append({'control':case,'passed':True,'summary':result.stderr.strip().splitlines()[-3:]})
report={'sources_sha256':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in sources.items()},'controls':records,
        'limits':'Actual owned disposable Linux scopes. Mocked database transport; cancellation records remain local, not a model-stage status decision. No parent-loss recovery, native solver cancellation, UI cancellation or normal dispatch activation.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'scope-cancellation-controls.json').write_text(content);print(content)
