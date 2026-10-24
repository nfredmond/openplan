"""Exercise both custody refusal assertions in isolated source namespaces."""
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('custody_tests',E/'test-finalize.py')
t=importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
source=(E/'finalize.py').read_text()
cases=[('harmless',source+'\n# Retain opaque custody.\n',True),('frozen_engine_refusal',source.replace("assert engine_result['all_hashes_unchanged'] and frozen_result['all_hashes_unchanged']",'pass'),False),('output_refusal',source.replace('assert not mismatches','pass'),False)]
rows=[]
for name,changed,survivor in cases:
    module=types.ModuleType(name); module.__file__=str(E/'finalize.py'); exec(compile(changed,module.__file__,'exec'),module.__dict__); t.m=module
    stream=io.StringIO(); result=unittest.TextTestRunner(stream=stream).run(unittest.defaultTestLoader.loadTestsFromTestCase(t.Custody))
    rows.append({'name':name,'survivor':survivor,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'accepted':result.wasSuccessful() if survivor else bool(result.failures) and not result.errors,'detail':stream.getvalue()})
assert (E/'finalize.py').read_text()==source
(E/'custody-mutations.json').write_text(json.dumps({'source_unchanged':True,'controls':rows},indent=2)+'\n')
assert all(x['accepted'] for x in rows)
print('3 accepted custody controls; source unchanged')
