"""Exercise network ownership and CIDR refusals without Docker mutations."""
import ast, copy, hashlib, json
from pathlib import Path
import network_scope as n

SOURCE = Path(n.__file__).read_text(); records = []
INFO = {'Id': 'new-network', 'Name': n.NETWORK, 'Driver': 'bridge', 'Internal': True,
        'Labels': {'openplan.purpose': n.PURPOSE}, 'Containers': {n.DB_ID: {}},
        'IPAM': {'Config': [{'Subnet': '172.31.0.0/16'}]}}


def exercise(label, scenario=None, omit=None, harmless=False):
    tree = ast.parse(('# Harmless comment\n' if harmless else '')+SOURCE)
    if omit:
        found = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require' and node.args[1].value == omit:
                node.args[0] = ast.Constant(True); found += 1
        assert found == 1
    module = {}; exec(compile(ast.fix_missing_locations(tree), '<in-memory network guard>', 'exec'), module)
    info = copy.deepcopy(INFO); database = {'NetworkSettings': {'Networks': {n.NETWORK: {}}}}
    subnet = '172.31.0.0/16'; calls = []
    if scenario == 'api-network-identity': info['Id'] = 'foreign'
    if scenario == 'api-network-owner': info['Internal'] = False
    if scenario == 'api-network-peers': info['Containers']['foreign'] = {}
    if scenario == 'api-network-ipam-count': info['IPAM']['Config'].append({'Subnet':'172.30.0.0/16'})
    if scenario == 'api-network-cidr': info['IPAM']['Config'][0]['Subnet'] = '0.0.0.0/0'
    if scenario == 'api-database-network': database['NetworkSettings']['Networks']['foreign'] = {}
    if scenario == 'api-hba-cidr': subnet = '0.0.0.0/0'
    if harmless: info['Labels']['note'] = 'Unrelated'
    def base_guard(actual, *args):
        assert set(actual['NetworkSettings']['Networks']) == {'none'}
        calls.append('base owner/limits/command/key guard')
    failure = None
    try:
        module['verify_network'](info, 'new-network', {n.DB_ID})
        module['verify_database_attachment'](database, {}, 'volume', Path('/private/key'), base_guard, True)
        module['hba_rule'](subnet)
    except ValueError as error: failure = str(error)
    if omit: assert failure is None, (label, 'secondary refusal', failure)
    elif scenario: assert failure == scenario, (label, failure)
    else: assert failure is None and len(calls) == 1, (label, failure)
    records.append({'case': label, 'result': 'intended omitted-guard oracle failure' if omit else 'refused' if failure else 'survived', 'reason': scenario})


exercise('baseline'); exercise('harmless', harmless=True)
reasons = [node.args[1].value for node in ast.walk(ast.parse(SOURCE)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require']
for reason in reasons:
    exercise('protected '+reason, scenario=reason); exercise('omit '+reason, scenario=reason, omit=reason)
exercise('restored')
assert Path(n.__file__).read_text() == SOURCE
(Path(n.__file__).parent/'network-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(SOURCE.encode()).hexdigest(),'cases':records,'scope':'Pure ownership and CIDR fixtures; no native network, HBA, password or API acceptance.'},indent=2)+'\n')
print(len(records), 'network guard cases pass')
