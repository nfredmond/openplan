"""Test each continuation refusal and omission in memory."""
import ast, copy, hashlib, json
from pathlib import Path
import resume_guards as g

SOURCE = Path(g.__file__).read_text(); records = []


def exercise(label, scenario=None, omit=None, harmless=False):
    tree = ast.parse(('# Harmless comment\n' if harmless else '') + SOURCE)
    if omit:
        found = 0
        for n in ast.walk(tree):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'require' and n.args[1].value == omit:
                n.args[0] = ast.Constant(True); found += 1
        assert found == 1
    module = {}; exec(compile(ast.fix_missing_locations(tree), '<in-memory resume guard>', 'exec'), module)
    state = 'failed'; expected = {'producer.py': 'fixture'}; actual = dict(expected); controls = 'schema'; sha = 'schema'; clients = 0
    baseline = {'schemaSha256': 'captured', 'tables': [1], 'sequences': [2]}; observed = copy.deepcopy(baseline); source_sha = 'captured'
    observed_reason = 'policy'; expected_reason = 'policy'
    if scenario == 'resume-native-control-oracle': observed_reason = None
    if scenario == 'resume-producer-state': state = 'passed-native'
    if scenario == 'resume-executed-source': actual['producer.py'] = 'changed'
    if scenario == 'resume-schema-control-source': controls = 'foreign'
    if scenario == 'resume-active-clients': clients = 1
    if scenario == 'resume-source-schema': source_sha = 'changed'
    if scenario == 'resume-table-images': observed['tables'] = [0]
    if scenario == 'resume-sequence-images': observed['sequences'] = [0]
    failure = None
    try:
        module['preflight'](state, expected, actual, controls, sha)
        module['quiescent'](clients)
        module['native_records'](source_sha, baseline, observed)
        module['native_control_reason'](observed_reason, expected_reason)
    except ValueError as error: failure = str(error)
    if omit: assert failure is None, (label, 'secondary refusal', failure)
    elif scenario: assert failure == scenario, (label, failure)
    else: assert failure is None, (label, failure)
    records.append({'case': label, 'result': 'intended omitted-guard oracle failure' if omit else 'refused' if failure else 'survived', 'reason': scenario})


exercise('baseline'); exercise('harmless', harmless=True)
reasons = [n.args[1].value for n in ast.walk(ast.parse(SOURCE)) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'require']
for reason in reasons:
    exercise('protected '+reason, scenario=reason); exercise('omit '+reason, scenario=reason, omit=reason)
exercise('restored')
assert Path(g.__file__).read_text() == SOURCE
(Path(g.__file__).parent / 'resume-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(SOURCE.encode()).hexdigest(), 'cases': records, 'scope': 'Pure continuation inputs; no native database or restart acceptance.'}, indent=2)+'\n')
print(len(records), 'resume guard cases pass')
