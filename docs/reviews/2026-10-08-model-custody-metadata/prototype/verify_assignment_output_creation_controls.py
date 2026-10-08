"""Check assignment directory ownership and no-adoption behavior."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    source=(WORKER/'model_attempt_writer.py').read_text()
    begin=source.index('    def create_assignment_outputs(');end=source.index('    def retain_assignment_outputs(',begin)
    part=source[begin:end]
    def change(old,new):
        if part.count(old)!=1:raise AssertionError('Assignment directory anchor changed')
        return source[:begin]+part.replace(old,new)+source[end:]
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
      ('adopt-existing',change('os.mkdir(name, mode=0o700, dir_fd=descriptor)',"if not (self.files.path/name).exists(): os.mkdir(name, mode=0o700, dir_fd=descriptor)"),'test_existing_outputs_are_not_adopted_or_changed'),
      ('ignore-attempt',change('Path(work_dir) != self.files.path','False'),'test_foreign_attempt_refused'),
      ('allow-traversal',change("if name not in ('run_output', 'activitysim_assignment_output'):",'if False:'),'test_traversal_name_refused'),
      ('restored',source,None)]
    runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_attempt_writer',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_assignment_output_creation'+('.OutputCreationTests.'+sys.argv[2] if sys.argv[2] else '')
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
    report={'writer_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Owned local directory creation and actual assignment entry refusal; registration fixtures mocked. No engine computation, closure, full dispatcher or scientific acceptance.'}
    (ROOT/'assignment-output-creation-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
