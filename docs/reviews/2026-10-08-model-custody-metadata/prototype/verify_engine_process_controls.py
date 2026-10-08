"""Durable launch and observed-exit faults using disposable real processes."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    source=(WORKER/'model_engine_process.py').read_text()
    def change(old,new):
        if source.count(old)!=1:raise AssertionError('Engine process anchor changed')
        return source.replace(old,new)
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
      ('ignore-nonzero',change('if code!=0:','if False:'),'test_nonzero_exit_is_retained_and_stops_writer'),
      ('ignore-group',change("raise EngineStillRunning('Engine process group still has members')",'pass'),'test_group_members_prevent_completion'),
      ('erase-attempt',change("'attempt_id':writer.context.attempt_id","'attempt_id':None"),'test_completed_child_records_original_identity'),
      ('adopt-reservation-directory',change("os.mkdir('engine_process',mode=0o700,dir_fd=descriptor)","os.makedirs(self.directory,mode=0o700,exist_ok=True)"),'test_existing_reservation_never_launches_again'),
      ('restored',source,None)]
    runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_engine_process',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_engine_process'+('.EngineProcessTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        p=Path(temp)/'candidate.py'
        for name,body,target in cases:
            p.write_text(body)
            r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+' missed target: '+r.stderr)
            elif r.returncode:raise AssertionError(name+' failed: '+r.stderr)
            records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
    report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real disposable subprocesses, mocked group-member probe and managed registration fixtures. No restored supervisor, escaped descendants, native engine child protocol, output-capture authorization or normal dispatch.'}
    (ROOT/'engine-process-controls.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))


if __name__=='__main__':main()
