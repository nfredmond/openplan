"""Serial live-scope controls; restore source bytes after each bounded mutation."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/aequilibrae_worker'
PYTHON=os.environ['OPENPLAN_GUARD_TEST_PYTHON']
SUITE='test_model_engine_supervision.LiveEngineScopeTests.'


def run(name,file,old,new,test,expected=None):
    path=WORKER/file
    original=path.read_bytes()
    try:
        text=original.decode()
        if old is None:text+='\n# Harmless guard lifecycle control.\n'
        else:
            assert text.count(old)==1,(name,text.count(old))
            text=text.replace(old,new)
        path.write_text(text)
        result=subprocess.run([PYTHON,'-B','-m','unittest',test,'-v'],cwd=WORKER,
            env=dict(os.environ,OPENPLAN_LIVE_ENGINE_SCOPE='1'),capture_output=True,text=True,timeout=45)
        output=result.stdout+result.stderr
        if expected is None:assert result.returncode==0,output
        else:assert result.returncode!=0 and expected in output,output
        return {'case':name,'returncode':result.returncode,'expected_failure':expected,'verified':True}
    finally:path.write_bytes(original)


if __name__=='__main__':
    results=[]
    results.append(run('harmless','model_engine_owner_guard.py',None,None,'test_model_engine_supervision'))
    results.append(run('missing-systemd-binding','model_engine_supervision.py',
        "binding=['--property=BindsTo='+self.owner_guard.unit,'--property=After='+self.owner_guard.unit,'--property=KillSignal=SIGKILL']",
        'binding=[]',SUITE+'test_identity_is_retained_before_engine_and_channel_survives_exec','Engine owner guard binding differs'))
    results.append(run('missing-guard-record','model_engine_process.py',
        "_record(descriptor,'owner-guard-started.json',{**self.identity,'guard':self.owner_guard.identity})",
        'pass',SUITE+'test_identity_is_retained_before_engine_and_channel_survives_exec','Owner guard identity not retained'))
    results.append(run('missing-completion-guard-check','model_engine_process.py',
        '            if self.owner_guard is not None:self.owner_guard.require_alive()\n            self.writer.files.verify()',
        '            self.writer.files.verify()',SUITE+'test_guard_loss_stops_busy_engine_and_detached_descendant','Engine exited unsuccessfully'))
    results.append(run('restored','model_engine_owner_guard.py',None,None,'test_model_engine_supervision'))
    print(json.dumps({'cases':results,'limits':['Synthetic engine processes only','No native engine or database acceptance','No owner-service termination case','No normal-dispatch activation']},indent=2))
