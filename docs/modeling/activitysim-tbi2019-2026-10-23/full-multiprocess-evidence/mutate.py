"""Check successor refusals without modifying admitted source bytes."""
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('continuation_tests',E/'test-run.py')
t=importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
source=(E/'run.py').read_text(); original=t.m
cases=[('harmless_comment',source+'\n# Modeled health only.\n',True),
 ('dtype_guard',source.replace('if not frames[0].dtypes.equals(frames[1].dtypes):','if False:'),False),
 ('reference_guard',source.replace("if {p.name:digest(p) for p in Path(reference['path']).glob('final_*.csv')} != reference['hashes']:",'if False:'),False),
 ('choice_comparison',source.replace("tables = compare_choices(reference['path'], output)",'tables = []'),False),
 ('full_admission',source.replace("if state['parity'] != {'current':'passed_choice_parity_retained','semcog':'passed_choice_parity'}:",'if False:'),False),
 ('stop_sequence',source.replace('            raise\n        finally:', '            return\n        finally:'),False),
 ('engine_custody',source.replace('if digest(path) != expected:', 'if False:'),False),
 ('cache_guard',source.replace("if 'initial_row_size is zero' in log:",'if False:'),False),
 ('parity_stop',source.replace('        raise\n    finally:', '        return\n    finally:'),False)]
rows=[]
for name,changed,survivor in cases:
    module=types.ModuleType(name); module.__file__=str(E/'run.py')
    exec(compile(changed,module.__file__,'exec'),module.__dict__); t.m=module
    stream=io.StringIO(); result=unittest.TextTestRunner(stream=stream).run(unittest.defaultTestLoader.loadTestsFromTestCase(t.Continuation))
    rows.append({'name':name,'survivor':survivor,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'accepted':result.wasSuccessful() if survivor else bool(result.failures) and not result.errors,'detail':stream.getvalue()})
t.m=original
monitor=E/'monitor.py'; text=monitor.read_text(); real=Path.read_text
changed=text.replace("if message.startswith('#run_model running '):",'if False:')
with patch.object(Path,'read_text',lambda p,*a,**k:changed if p==monitor else real(p,*a,**k)):
    stream=io.StringIO(); result=unittest.TextTestRunner(stream=stream).run(unittest.defaultTestLoader.loadTestsFromTestCase(t.Continuation))
rows.append({'name':'stage_label','survivor':False,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'accepted':bool(result.failures) and not result.errors,'detail':stream.getvalue()})
assert (E/'run.py').read_text()==source and monitor.read_text()==text
(E/'mutations.json').write_text(json.dumps({'source_unchanged':True,'controls':rows},indent=2)+'\n')
assert all(x['accepted'] for x in rows)
print(json.dumps({'controls':len(rows),'all_accepted':True}))
