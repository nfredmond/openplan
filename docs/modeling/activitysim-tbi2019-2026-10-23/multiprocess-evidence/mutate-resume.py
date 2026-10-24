"""Mutation evidence for the corrected checkpoint boundary and stop path."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest

E=Path(__file__).resolve().parent
R=Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024')
spec=importlib.util.spec_from_file_location('recovery_tests',E/'test-resume.py')
tests=importlib.util.module_from_spec(spec); spec.loader.exec_module(tests)
original={name:(E/name).read_text() for name in ['resume.py','replay.py']}
before={name:hashlib.sha256((E/name).read_bytes()).hexdigest() for name in original}
cases=[
 ('harmless_comment','replay.py',original['replay.py']+'\n# Preserve failed inventories.\n',True),
 ('disable_checkpoint_guard','replay.py',original['replay.py'].replace("if 'mp_households' not in inventory['checkpoint_name'].tolist():",'if False:'),False),
 ('swallow_parity_failure','replay.py',original['replay.py'].replace('            raise\n','            return\n'),False),
 ('disable_suffix_guard','resume.py',original['resume.py'].replace("if (settings['resume_after'] != 'mp_households'", "if False and (settings['resume_after'] != 'mp_households'"),False),
 ('disable_copy_custody','resume.py',original['resume.py'].replace('if copied != original:', 'if False:'),False),
]
rows=[]
for name,file,source,survivor in cases:
    module=types.ModuleType('mutation_'+name); module.__file__=str(E/file)
    exec(compile(source,str(E/file),'exec'),module.__dict__)
    if file=='replay.py':
        tests.m=module
    else:
        spec2=importlib.util.spec_from_file_location('base_replay',E/'replay.py')
        tests.m=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(tests.m)
        tests.m.r=module
    stream=io.StringIO(); result=unittest.TextTestRunner(stream=stream).run(unittest.defaultTestLoader.loadTestsFromTestCase(tests.Recovery))
    rows.append({'name':name,'survivor':survivor,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),
        'accepted':result.wasSuccessful() if survivor else bool(result.failures) and not result.errors,'detail':stream.getvalue()})
assert all(hashlib.sha256((E/name).read_bytes()).hexdigest()==digest for name,digest in before.items())
(R/'resume-mutations.json').write_text(json.dumps({'source_hashes':before,'source_unchanged':True,'controls':rows},indent=2)+'\n')
assert all(row['accepted'] for row in rows)
print(json.dumps({'accepted':len(rows),'harmless':1,'targeted':len(rows)-1,'source_unchanged':True}))
