"""Test monitor mutations without changing the delivered source bytes."""
import io
import json
from pathlib import Path
import types
import unittest
import test_monitor

P=Path(__file__).resolve().parent
source=(P/'monitor.py').read_text();original=test_monitor.monitor
changes=[('comment survives',source+'\n# Harmless monitor comment.\n',False),
 ('chunk overwrites model label',source.replace("and not message.startswith(('Running chunk', 'Running compute_logsums'))","and True"),True),
 ('headroom stop removed',source.replace("int(row['memory.current']) > int(limit)*0.96","False"),True),
 ('engine failure ignored',source.replace('if code or failure:', 'if failure:'),True)]
results=[]
for name,code,must_fail in changes:
    module=types.ModuleType('mutated_monitor');exec(compile(code,'<mutation>','exec'),module.__dict__)
    test_monitor.monitor=module
    result=unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(test_monitor.MonitorTests))
    if result.errors or bool(result.failures)!=must_fail:raise AssertionError((name,result.errors,result.failures))
    results.append({'mutation':name,'tests':result.testsRun,'assertion_failures':len(result.failures),'errors':0,'skips':len(result.skipped)})
test_monitor.monitor=original
assert (P/'monitor.py').read_text()==source
print(json.dumps({'controls':results,'restoration':'source never changed','blind_category':'small owned subprocesses; no full-scale peak accuracy'},indent=2))
