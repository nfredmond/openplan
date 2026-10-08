"""Exercise combined output mapping with isolated function mutations."""
import hashlib,inspect,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
from test_model_skip_dispatch import aeq


def main():
    source=inspect.getsource(aeq.retain_managed_state_and_package)
    def change(old,new):
        if source.count(old)!=1:raise AssertionError('Output mapping mutation anchor changed')
        return source.replace(old,new)
    cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
      ('skip-count-mapping',change('mapped = model_predecessor_inputs.map_assignment_counts(\n                {**state_input, "state": mapped}, output_input)','mapped = mapped'),'test_complete_mapping_preserves_original_and_consumable_counts'),
      ('retained-as-working',change('mapping["execution_paths"]["outputs_directory"] = working_outputs["outputs_directory"]','mapping["execution_paths"]["outputs_directory"] = output_input["outputs_directory"]'),'test_complete_mapping_preserves_original_and_consumable_counts'),
      ('erase-input-hash',change('"input_manifest_sha256": working_outputs["input_manifest_sha256"]','"input_manifest_sha256": None'),'test_complete_mapping_preserves_original_and_consumable_counts'),
      ('skip-project-prerequisite',change('if include_outputs and not include_project:','if False:'),'test_output_mode_requires_project_preparation'),
      ('restored',source,None)]
    runner='''
import sys,unittest
from types import FunctionType
from test_model_skip_dispatch import aeq
namespace=dict(aeq.__dict__)
exec(compile(open(sys.argv[1]).read(),'<output-mapping-control>','exec'),namespace)
f=namespace['retain_managed_state_and_package']
aeq.retain_managed_state_and_package=FunctionType(f.__code__,aeq.__dict__)
aeq.retain_managed_state_and_package.__kwdefaults__=f.__kwdefaults__
name='test_managed_output_mapping'+('.OutputMappingTests.'+sys.argv[2] if sys.argv[2] else '')
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
    report={'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'controls':records,'limits':'Actual combined helpers, real synthetic input files and actual count consumption; mocked HTTP. No native combined mapping recovery, full dispatch, engine closure or scientific acceptance.'}
    (ROOT/'output-mapping-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
