"""Run isolated source mutations; never edit the admitted controller bytes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest

E=Path(__file__).resolve().parent
R=Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024')
path=E/'run.py'; original=path.read_text(); before=hashlib.sha256(path.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('controller_tests',E/'test-run.py')
tests=importlib.util.module_from_spec(spec); spec.loader.exec_module(tests)

cases=[
 ('harmless_comment',original+'\n# Retain exact whole-table comparisons.\n',True),
 ('disable_suffix_guard',original.replace("if (prefix['models'][-1] != BOUNDARY", "if False and (prefix['models'][-1] != BOUNDARY"),False),
 ('disable_process_guard',original.replace("if (prefix['num_processes'] != PROCESS_COUNT", "if False and (prefix['num_processes'] != PROCESS_COUNT"),False),
 ('disable_engine_custody',original.replace('if digest(path) != expected:', 'if False:'),False),
 ('disable_initial_reference_custody',original.replace('if files != expected:', 'if False:'),False),
 ('disable_frozen_reference_custody',original.replace("if {p.name:digest(p) for p in Path(reference['path']).glob('final_*.csv')} != reference['hashes']:", 'if False:'),False),
 ('swallow_exact_failure',original.replace("        raise\n    save(arm+'-comparison.json'", "        return\n    save(arm+'-comparison.json'"),False),
 ('disable_cache_guard',original.replace("if 'initial_row_size is zero' in log:", 'if False:'),False),
 ('swallow_execution_failure',original.replace("            raise\n        finally:", "            return\n        finally:"),False),
]
records=[]
for name,source,survives in cases:
    assert source != original
    module=types.ModuleType('mutation_'+name); module.__file__=str(path)
    exec(compile(source,str(path),'exec'),module.__dict__)
    tests.m=module
    stream=io.StringIO()
    result=unittest.TextTestRunner(stream=stream).run(unittest.defaultTestLoader.loadTestsFromTestCase(tests.Admission))
    row={'name':name,'expected_survivor':survives,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'detail':stream.getvalue()}
    row['accepted']=result.wasSuccessful() if survives else bool(result.failures) and not result.errors
    records.append(row)
assert hashlib.sha256(path.read_bytes()).hexdigest()==before
(R/'mutations.json').write_text(json.dumps({'source_sha256':before,'source_unchanged':True,'controls':records},indent=2)+'\n')
assert all(r['accepted'] for r in records),records
print(json.dumps({'accepted':len(records),'harmless':1,'targeted':len(records)-1,'source_unchanged':True}))
