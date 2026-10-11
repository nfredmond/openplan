"""Exercise exact API admission guards without starting services."""
import ast, copy, hashlib, json
from pathlib import Path
import services as s, start_services as r

p = Path(__file__).parent
fixture = {'state': 'passed-native-database-continuation', 'targetDatabase': r.DATABASE, 'databaseContainerId': r.DB_ID}
records = []
for label in ('baseline', 'harmless', 'restored'):
    value = dict(fixture)
    if label == 'harmless': value['reviewerNote'] = 'Unrelated'
    r.verify_result(value); s.verify_stage('api')
    records.append({'case': label, 'passed': True})
variants = [(r, 'verify_result', {**fixture, field: 'foreign'}, 'api-database-result') for field in fixture]
variants += [(s, 'verify_stage', 'target', 'expanded-stack-stage'), (s, 'verify_stage', 'source', 'expanded-stack-stage')]
for module, name, value, reason in variants:
    try: getattr(module, name)(value)
    except ValueError as error: assert str(error) == reason
    else: raise AssertionError('Broken API admission survived: '+reason)
    node = next(n for n in ast.parse(Path(module.__file__).read_text()).body if isinstance(n, ast.FunctionDef) and n.name == name)
    node = copy.deepcopy(node); node.body = [ast.Pass()]
    namespace = dict(vars(module)); exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), module.__file__, 'exec'), namespace)
    namespace[name](value)
    records.append({'case': name, 'reason': reason, 'refused': True, 'omittedGuardAllowsBroken': True})
(p/'start-controls.json').write_text(json.dumps({'records': records, 'sourceSha256': {name: hashlib.sha256((p/name).read_bytes()).hexdigest() for name in ('start_services.py','services.py')}, 'limits': 'Pure admission controls. No native service, Storage, credential authentication or database writes.'}, indent=2)+'\n')
print('3 positive, 5 broken API admission cases and 5 omitted-guard controls pass.')
