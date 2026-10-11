"""Exercise exact refusals and omitted guards without starting native services."""
import ast, copy, hashlib, json
from pathlib import Path
import guards as g

SOURCE = Path(g.__file__).read_text()
records = []
SQL = "CREATE ROLE supabase_admin;\nALTER ROLE supabase_admin WITH PASSWORD 'fixture';\nCREATE ROLE anon;\n"
INVENTORY = {'roles': [{'rolname': 'pg_monitor'}, {'rolname': 'supabase_admin'},
                       {'rolname': 'anon'}], 'memberships': []}
BOOTSTRAP = ['pg_monitor', 'supabase_admin']
COMMAND = ['-c', 'fixture init and postgres command']
RECEIPT = {'id': 'a' * 64, 'commandSha256': hashlib.sha256('\n'.join(COMMAND).encode()).hexdigest()}
VOLUME = 'openplan-new-fixture-volume'
KEYFILE = g.OUT / 'fixture-private.key'
INFO = {'Id': RECEIPT['id'], 'Name': '/' + g.NAME, 'Image': g.IMAGE,
        'Config': {'Labels': {'com.supabase.cli.project': g.PROJECT,
                              'openplan.purpose': g.PURPOSE},
                   'Entrypoint': ['sh'], 'Cmd': COMMAND},
        'HostConfig': {'Memory': 1073741824, 'MemorySwap': 1073741824,
                       'NanoCpus': 1000000000, 'PidsLimit': 128,
                       'NetworkMode': 'none', 'PortBindings': {}},
        'NetworkSettings': {'Networks': {'none': {}}},
        'Mounts': [{'Type': 'volume', 'Name': VOLUME,
                    'Destination': '/var/lib/postgresql/data', 'RW': True},
                   {'Type': 'bind', 'Source': str(KEYFILE),
                    'Destination': g.KEY, 'RW': False}]}


def load(omit=None, harmless=False):
    tree = ast.parse(('# Harmless comment\n' if harmless else '') + SOURCE)
    if omit:
        found = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require' and len(node.args) == 2 and isinstance(node.args[1], ast.Constant) and node.args[1].value == omit:
                node.args[0] = ast.Constant(value=True); found += 1
        assert found == 1, (omit, found)
    namespace = {'__file__': str(g.OUT / 'guards.py')}
    exec(compile(ast.fix_missing_locations(tree), '<in-memory guards>', 'exec'), namespace)
    return namespace


def exercise(name, scenario=None, omit=None, harmless=False):
    subject = load(omit, harmless)
    info = copy.deepcopy(INFO); sql = SQL; bootstrap = BOOTSTRAP[:]
    inventory = copy.deepcopy(INVENTORY); actual_sql = SQL
    expected_hash = hashlib.sha256(SQL.encode()).hexdigest()
    tool_sha = g.TOOL_SHA; controls_sha = 'fixture-source'
    result = {'state': 'passed-native', 'snapshotId': g.SNAPSHOT,
              'sourceHead': 'bf1f6ffa710b11b7f36747a676943edab667a4ae',
              'capturedFiles': 1541, 'capturedBytes': 644693866}
    container_exists = scenario == 'cluster-existing-container'
    volume_exists = scenario == 'cluster-existing-volume'
    free_disk = 10 * 1024 ** 3; available_memory = 4 * 1024 ** 3
    properties = {'owner': 'postgres', 'localeProvider': 'i', 'settingsSha256': 'fixture'}
    actual_properties = dict(properties)
    databases = ['postgres', 'template0', 'template1']
    statement = b'ALTER DATABASE captured_target CONNECTION LIMIT -1;'
    binding = {'target': 'captured_target', 'sha256': hashlib.sha256(statement).hexdigest()}
    if scenario == 'cluster-database-properties': actual_properties['localeProvider'] = 'c'
    if scenario == 'cluster-existing-database': databases.append('prior-agency-database')
    if scenario == 'cluster-property-command-target': binding['target'] = 'foreign'
    if scenario == 'cluster-property-command-bytes': statement += b' -- changed'
    if scenario == 'cluster-resource-headroom': available_memory = 2 * 1024 ** 3
    if scenario == 'cluster-backup-tool': tool_sha = 'foreign'
    if scenario == 'cluster-captured-point': result['snapshotId'] = 'foreign'
    if scenario == 'cluster-controls-source': controls_sha = 'foreign'
    if scenario == 'cluster-container-identity': info['Id'] = 'foreign'
    if scenario == 'cluster-image': info['Image'] = 'foreign'
    if scenario == 'cluster-command': info['Config']['Cmd'] = ['foreign']
    if scenario == 'cluster-owner': info['Config']['Labels']['openplan.purpose'] = 'foreign'
    if scenario == 'cluster-limits': info['HostConfig']['MemorySwap'] += 1
    if scenario == 'cluster-network': info['NetworkSettings']['Networks']['foreign'] = {}
    if scenario == 'cluster-mount-count': info['Mounts'].append({'Type': 'bind'})
    if scenario == 'cluster-data-volume': info['Mounts'][0]['Name'] = 'foreign'
    if scenario == 'cluster-key-bind': info['Mounts'][1]['RW'] = True
    if scenario == 'cluster-role-captured-bytes': expected_hash = 'foreign'
    if scenario == 'cluster-role-bootstrap': bootstrap.append('existing-agency-role')
    if scenario == 'cluster-role-bootstrap-statement': sql = SQL.replace('CREATE ROLE supabase_admin;', '-- omitted'); expected_hash = hashlib.sha256(sql.encode()).hexdigest()
    if scenario == 'cluster-role-catalog': inventory['memberships'].append(['foreign'])
    if scenario == 'cluster-role-password-and-grants': actual_sql = SQL.replace("'fixture'", "'changed'")
    if harmless: info['harmlessMarker'] = 'retained'; actual_sql = '-- harmless dump comment\n' + actual_sql
    failure = None
    try:
        subject['verify_capture'](tool_sha, result, controls_sha, 'fixture-source')
        subject['verify_unused'](container_exists, volume_exists, free_disk, available_memory)
        subject['verify_properties'](properties, actual_properties)
        subject['verify_database_bootstrap'](databases)
        subject['verify_property_command']('captured_target', statement, binding)
        subject['verify_container'](info, RECEIPT, VOLUME, KEYFILE)
        prepared = subject['prepare_role_sql'](sql, expected_hash, bootstrap, INVENTORY)
        subject['verify_roles'](INVENTORY, inventory, SQL, actual_sql)
        if not scenario:
            assert prepared.count('CREATE ROLE supabase_admin;') == 0
            assert "ALTER ROLE supabase_admin WITH PASSWORD 'fixture';" in prepared
            assert 'CREATE ROLE anon;' in prepared
    except ValueError as error:
        failure = str(error)
    if omit:
        assert failure is None, (name, 'secondary refusal', failure)
        records.append({'case': name, 'result': 'intended omitted-guard oracle failure', 'reason': scenario})
    elif scenario:
        assert failure == scenario, (name, failure)
        records.append({'case': name, 'result': 'refused', 'reason': failure})
    else:
        assert failure is None, (name, failure)
        records.append({'case': name, 'result': 'survived'})


exercise('baseline'); exercise('harmless', harmless=True)
reasons = [n.args[1].value for n in ast.walk(ast.parse(SOURCE))
           if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
           and n.func.id == 'require' and len(n.args) == 2]
for reason in reasons:
    exercise('protected ' + reason, scenario=reason)
    exercise('omit ' + reason, scenario=reason, omit=reason)
exercise('restored')
assert Path(g.__file__).read_text() == SOURCE
(g.OUT / 'guard-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(SOURCE.encode()).hexdigest(), 'cases': records, 'nativeLaunches': 0, 'boundary': 'Pure container/role observations for this pinned fixture; no native role, key, database or disk verification.'}, indent=2) + '\n')
print(len(records), 'pure guard cases pass; source unchanged')
