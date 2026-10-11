"""Prove schema comparisons retain policy and privilege differences."""
import ast, copy, hashlib, json
from pathlib import Path
import schema_semantics as s

SOURCE = Path(s.__file__).read_text()
TEXT = "CREATE TABLE public.fixture (id integer);\nCREATE POLICY fixture_select ON public.fixture FOR SELECT TO authenticated, anon USING (true);\nALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT SELECT ON TABLES TO anon;\nALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon;\nALTER TABLE public.fixture OWNER TO owner;\n"
CATALOG = {'policies': [{'schema': 'public', 'table': 'fixture', 'name': 'fixture_select', 'command': 'r', 'permissive': True, 'roles': ['authenticated', 'anon'], 'using': 'true', 'check': None}],
           'defaultPrivileges': [{'role': 'owner', 'schema': 'public', 'objectType': 'r', 'privileges': [{'grantor': 'owner', 'grantee': 'anon', 'privilege': 'SELECT', 'grantable': False}]}]}
records = []


def load(omit=None, harmless=False):
    tree = ast.parse(('# Harmless comment\n' if harmless else '') + SOURCE)
    if omit:
        found = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require' and len(node.args) == 2 and isinstance(node.args[1], ast.Constant) and node.args[1].value == omit:
                node.args[0] = ast.Constant(True); found += 1
        assert found == 1
    namespace = {'__file__': str(Path(s.__file__))}
    exec(compile(ast.fix_missing_locations(tree), '<in-memory schema controls>', 'exec'), namespace)
    return namespace['verify']


def exercise(label, scenario=None, omit=None, harmless=False):
    left = TEXT; right = TEXT; expected = copy.deepcopy(CATALOG); actual = copy.deepcopy(CATALOG)
    reason = scenario
    if scenario == 'schema-catalog-sections': expected['unknown'] = []; actual['unknown'] = []
    if scenario == 'schema-policy-projection': expected['policies'][0].pop('check'); actual['policies'][0].pop('check')
    if scenario == 'schema-policy-role-duplicates': expected['policies'][0]['roles'].append('anon'); actual['policies'][0]['roles'].append('anon')
    if scenario == 'schema-default-projection': expected['defaultPrivileges'][0]['privileges'][0].pop('grantor'); actual['defaultPrivileges'][0]['privileges'][0].pop('grantor')
    if scenario == 'schema-policy-statement-census':
        left = '\n'.join(x for x in left.splitlines() if not x.startswith('CREATE POLICY ')); right = left
    if scenario == 'schema-default-statement-shape':
        left = left.replace('GRANT SELECT ON TABLES TO anon;', 'GRANT SELECT ON TABLES TO anon'); right = left
    if scenario == 'schema-policy-catalog': actual['policies'][0]['using'] = 'false'
    if scenario == 'schema-default-catalog': actual['defaultPrivileges'][0]['privileges'][0]['grantable'] = True
    if scenario == 'schema-default-statements': right = right.replace('GRANT SELECT ON TABLES TO anon;', 'GRANT ALL ON TABLES TO anon;')
    if scenario == 'schema-core-statements': right = right.replace('OWNER TO owner;', 'OWNER TO anon;')
    if scenario and scenario.startswith('policy-field-'):
        field = scenario.removeprefix('policy-field-'); actual['policies'][0][field] = ['service_role'] if field == 'roles' else False if field == 'permissive' else 'changed'; reason = 'schema-policy-catalog'
    if scenario and scenario.startswith('default-field-'):
        field = scenario.removeprefix('default-field-'); actual['defaultPrivileges'][0]['privileges'][0][field] = True if field == 'grantable' else 'changed'; reason = 'schema-default-catalog'
    if harmless:
        actual['policies'][0]['roles'].reverse()
        lines = right.splitlines(); defaults = [x for x in lines if x.startswith('ALTER DEFAULT PRIVILEGES ')]; core = [x for x in lines if not x.startswith('ALTER DEFAULT PRIVILEGES ')]
        right = '-- harmless dump comment\n' + '\n'.join(core + defaults[::-1])
        right = right.replace('TO authenticated, anon USING', 'TO anon, authenticated USING')
    if scenario == 'multiline-positive':
        left = left.replace('USING (true);', 'USING (\ntrue\n);')
        right = right.replace('USING (true);', 'USING (\ntrue\n);')
        scenario = None; reason = None
    failure = None
    try: load(omit, harmless)(left, right, expected, actual)
    except ValueError as error: failure = str(error)
    if omit:
        assert failure is None, (label, 'secondary refusal', failure)
        result = 'intended omitted-guard oracle failure'
    elif scenario:
        assert failure == reason, (label, failure, reason); result = 'refused'
    else:
        assert failure is None, (label, failure); result = 'survived'
    records.append({'case': label, 'result': result, 'reason': reason})


exercise('baseline'); exercise('harmless role and ACL ordering', harmless=True)
exercise('multiline policy', scenario='multiline-positive')
reasons = [node.args[1].value for node in ast.walk(ast.parse(SOURCE)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require' and len(node.args) == 2]
for reason in reasons:
    exercise('protected ' + reason, scenario=reason)
    exercise('omit ' + reason, scenario=reason, omit=reason)
for field in ['schema', 'table', 'name', 'command', 'permissive', 'roles', 'using', 'check']:
    exercise('changed policy ' + field, scenario='policy-field-' + field)
for field in ['grantor', 'grantee', 'privilege', 'grantable']:
    exercise('changed default privilege ' + field, scenario='default-field-' + field)
exercise('restored')
assert Path(s.__file__).read_text() == SOURCE
(Path(s.__file__).parent / 'schema-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(SOURCE.encode()).hexdigest(), 'cases': records, 'limits': 'Synthetic schema text and catalog observations. Actual catalog projection, quiescence and database identity need native checks. Policy-start census matches the complete native policy catalog; multiline continuation text stays in core. This is a pinned fixture comparison, not a general SQL parser.'}, indent=2)+'\n')
print(len(records), 'schema cases pass; source unchanged')
