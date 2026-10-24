"""Prove controller refusal and terminal-order tests detect intended regressions."""
import io
import json
from pathlib import Path
import types
import unittest
import test_runner

P=Path(__file__).resolve().parent
source=(P/'runner.py').read_text();original=test_runner.runner
changes=[('comment survives',source+'\n# Harmless controller comment.\n',False),
 ('process guard removed',source.replace("env.get('TBI_NUM_PROCESSES','4') != '4'","False"),True),
 ('missing env guard removed',source.replace("any(not env.get(k) for k in required)","False"),True),
 ('credential isolation broken',source.replace("return {'PATH':", "return {**os.environ, 'PATH':"),True),
 ('terminal object misnamed',source.replace("Key=prefix+'/terminal.json'","Key=prefix+'/not-terminal.json'"),True)]
results=[]
for name,code,must_fail in changes:
    module=types.ModuleType('mutated_runner');module.__file__=str(P/'runner.py')
    exec(compile(code,'<mutation>','exec'),module.__dict__);test_runner.runner=module
    result=unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(test_runner.RunnerTests))
    if result.errors or bool(result.failures)!=must_fail:raise AssertionError((name,result.errors,result.failures))
    results.append({'mutation':name,'tests':result.testsRun,'assertion_failures':len(result.failures),'errors':0,'skips':len(result.skipped)})
test_runner.runner=original
assert (P/'runner.py').read_text()==source
print(json.dumps({'controls':results,'restoration':'source never changed',
                  'blind_category':'mocked transport publication; no hosted S3 or scientific proof'},indent=2))
