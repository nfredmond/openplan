"""Control count-path relocation without editing checkout sources."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'


def main():
    source=(WORKER/'model_predecessor_inputs.py').read_text()
    begin=source.index('def map_assignment_counts(')
    prefix,body=source[:begin],source[begin:]
    def change(old,new):
        if body.count(old)!=1:raise AssertionError('Count mapping anchor changed')
        return prefix+body.replace(old,new)
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
           ('ignore-producer',change("if any(not producer.get(key) or producer.get(key) != output_input['producer'].get(key)\n           for key in ('stage_id', 'attempt_id')):",'if False:'),'test_different_attempt_refused'),
           ('ignore-paths',change("if any(counts.get(key) != value for key, value in expected.items()) or assignment.get('counts_path') != expected['counts_path']:",'if False:'),'test_foreign_count_path_refused'),
           ('mutate-original',change('mapped = copy.deepcopy(original)','mapped = original'),'test_mapped_record_can_be_consumed_without_rewriting_sources'),
           ('retain-original-path',change("target = Path(output_input['outputs_directory']) / 'count_inputs'","target = source"),'test_mapped_record_can_be_consumed_without_rewriting_sources'),
           ('restored',source,None)]
    runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_predecessor_inputs',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_assignment_count_mapping'+('.CountMappingTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        p=Path(temp)/'candidate.py'
        for name,text,target in cases:
            p.write_text(text)
            r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+' missed target: '+r.stderr)
            elif r.returncode:raise AssertionError(name+' failed: '+r.stderr)
            records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
    report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real retained count/output files and actual count consumer, synthetic data. Mapping helper only; not yet joined to native state preparation or normal dispatch. No scientific acceptance.'}
    (ROOT/'assignment-count-mapping-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
