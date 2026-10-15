"""Challenge only the new runner preconditions in memory, without invoking checks."""
import ast
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATH = HERE / 'check.py'
original = PATH.read_bytes()

def statement(text, name):
    module = ast.parse(text)
    main = next(n for n in module.body if isinstance(n, ast.If))
    if name == 'resource':
        return next(n for n in main.body if isinstance(n, ast.If))
    final = next(n for n in main.body if isinstance(n, ast.Try)).finalbody
    return next(n for n in final if isinstance(n, ast.If))

def exercise(node, name):
    samples = [({'memory.max': '1073741824', 'memory.swap.max': '0'}, False),
               ({'memory.max': 'max', 'memory.swap.max': '0'}, True),
               ({'memory.max': '1073741824', 'memory.swap.max': 'max'}, True)] if name == 'resource' else [([], False), (['synthetic.ts'], True)]
    code = compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(PATH), 'exec')
    for value, refused in samples:
        observed = False
        try:
            exec(code, {'resources': value} if name == 'resource' else {'changed': value})
        except RuntimeError as error:
            expected = 'Run in the required 1 GiB, zero-swap scope' if name == 'resource' else 'Source changed during checks: synthetic.ts'
            if str(error) != expected:
                raise
            observed = True
        assert observed == refused, name + ': intended precondition refusal'

rows = []
for name in ['resource', 'restoration']:
    baseline = statement(original.decode(), name)
    exercise(baseline, name)
    harmless = statement(original.decode() + '\n# Harmless controller comment.\n', name)
    exercise(harmless, name)
    broken = copy.deepcopy(baseline)
    broken.test = ast.Constant(value=False)
    try:
        exercise(broken, name)
    except AssertionError as error:
        if str(error) != name + ': intended precondition refusal':
            raise
        rows.append({'guard': name, 'baseline': 'pass', 'harmless': 'survived', 'fault': 'remove refusal', 'failure': str(error)})
    else:
        raise RuntimeError('Fault survived: ' + name)
if PATH.read_bytes() != original:
    raise RuntimeError('Runner bytes changed')
(HERE / 'evidence/runner-controls.json').write_text(json.dumps({'guards': rows, 'restoredSha256': hashlib.sha256(original).hexdigest(), 'scope': 'Actual guard AST statements, in memory. Does not rerun application controls or prove cgroup enforcement.'}, indent=2) + '\n')
print('2 harmless survivors, 2 intended named assertion faults; exact runner bytes retained')
