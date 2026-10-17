"""Finite budget target/history rules. This is a trusted local parent boundary."""
import hashlib
import json
import re

SOURCE = '3f3639f54243f40dfe7ff093dbb7f4e982a18cbc'
APP = '44e638d6d79378042343bf5b18408f09ee991d57'
TARGET = 'openplan_budget_native_9c47bd610f2a49e8a35c706d'
CONTAINER = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
PROJECT = 'openplan-restore-target-2026091050'
NETWORK = 'supabase_network_' + PROJECT
NETWORK_ID = 'a095943e3f3c26f3c41fb1df0054bf455c210eafc17a5f650e48e35b2bd2b154'
ARCHIVE_SHA = '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'
STAGES = ('observe', 'allocate', 'render419', 'restore419', 'apply17', 'apply18', 'apply19')
PARENT = dict(zip(STAGES[1:], STAGES))
PREFIX = ['/usr/bin/docker', 'exec', '-i', CONTAINER]
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8'}
SCOPE_SCHEMA = 'budget-protected-catalog-v2'
CAPTURE_UNIT = 'openplan-budget-catalog-settings-v2-20261016'
OBSERVE_UNIT = 'openplan-budget-settings-v2-observe'
NATIVE_ENV = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8',
    'HOME=/nonexistent', 'PGPASSFILE=/nonexistent/openplan-budget-catalog-v2-20261016.pgpass',
    'PGSERVICEFILE=/nonexistent/openplan-budget-catalog-v2-20261016.pg_service.conf',
    'PGCONNECT_TIMEOUT=5']
MANAGER_FIELDS = ('Id', 'InvocationID', 'MainPID', 'ControlGroup', 'ActiveState',
    'SubState', 'RuntimeMaxUSec', 'MemoryMax', 'MemorySwapMax',
    'CPUQuotaPerSecUSec', 'TasksMax')


def require(value, reason):
    if not value:
        raise ValueError(reason)


def same(expected, actual, reason):
    require(type(expected) is type(actual) and expected == actual, reason)


def positive(value, reason):
    require(type(value) is int and value > 0, reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)+'\n').encode()


def hash_text(value, reason):
    require(type(value) is str and re.fullmatch('[a-f0-9]{64}', value), reason)


def container(row):
    for key, expected in {'Id': CONTAINER, 'Image': IMAGE,
                          'Name': '/supabase_db_'+PROJECT, 'Project': PROJECT,
                          'NetworkID': NETWORK_ID, 'Running': True,
                          'Paused': False, 'Restarting': False}.items():
        same(expected, row.get(key), 'container-'+key)


def native(row, expected, database):
    same(database, row.get('database'), 'native-database')
    for key in ('oid', 'pid', 'sessionOid', 'currentOid', 'postgresOid'):
        positive(row.get(key), 'native-positive-'+key)
    require(type(row.get('systemIdentifier')) is str and
            re.fullmatch('[1-9][0-9]{9,29}', row['systemIdentifier']), 'native-system')
    for key, value in {'sessionRole': 'supabase_admin', 'currentRole': 'supabase_admin',
                       'adminSuperuser': True, 'postgresSuperuser': False,
                       'applicationName': 'budget-target-history', 'version': '170006'}.items():
        same(value, row.get(key), 'native-'+key)
    for key in ('systemIdentifier', 'oid', 'sessionOid', 'currentOid', 'postgresOid'):
        if key in expected:
            same(expected[key], row.get(key), 'native-pin-'+key)


def history(rows, versions):
    require(type(rows) is list and len(rows) == len(versions), 'history-count')
    same(versions, [r.get('version') for r in rows], 'history-versions')
    for row in rows:
        same(['name', 'statements', 'version'], sorted(row), 'history-complete-fields')
        require(row.get('name') is None or type(row.get('name')) is str, 'history-name')
        require(row.get('statements') is None or
                (type(row.get('statements')) is list and
                 all(x is None or type(x) is str for x in row.get('statements'))), 'history-statements')


def resource(row):
    for key, value in {'memoryMax': 536870912, 'swapMax': 0,
                       'cpuMax': '50000 100000', 'tasksMax': 64}.items():
        same(value, row.get(key), 'resource-'+key)


def admission(row, stage, package_sha, plan_sha, parent_sha, now):
    for key, value in {'schema': 2, 'stage': stage, 'source': SOURCE, 'app': APP,
                       'target': TARGET, 'packageSHA256': package_sha,
                       'planSHA256': plan_sha, 'predecessorSHA256': parent_sha,
                       'exclusive': True, 'nativeOperationGranted': True}.items():
        same(value, row.get(key), 'admission-'+key)
    positive(row.get('uid'), 'admission-uid')
    for key in ('reviewSHA256', 'publicationSHA256', 'windowSHA256', 'inputSHA256'):
        hash_text(row.get(key), 'admission-'+key)
    require(type(row.get('notBefore')) is int and type(row.get('notAfter')) is int and
            row['notBefore'] <= now < row['notAfter'] and
            0 < row['notAfter']-row['notBefore'] <= 600, 'admission-window')
    same('root-published-exclusive-budget-operation', row.get('authority'), 'admission-authority')


def argv(kind, database=TARGET):
    require(kind == 'sql' and database == 'postgres', 'HELD_NON_CATALOG_COMMAND')
    common = ['-h', '/var/run/postgresql', '-p', '5432', '-w', '-U', 'supabase_admin']
    return PREFIX+NATIVE_ENV+['psql', '-XqAt']+common+['-d', database, '-v', 'ON_ERROR_STOP=1']


def absence_argv():
    return PREFIX+['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8',
                   '/usr/bin/find', '-P', '/', '-mindepth', '1', '-maxdepth', '1',
                   '-name', 'nonexistent', '-print']


def settings(row):
    require(type(row) is dict and set(row) == {'rows', 'digest'}, 'scope-settings-fields')
    require(type(row.get('rows')) is int and row['rows'] >= 0, 'scope-settings-count')
    require(type(row.get('digest')) is str and re.fullmatch('[a-f0-9]{32}', row['digest']),
            'scope-settings-digest')
    if row['rows'] == 0:
        same('d41d8cd98f00b204e9800998ecf8427e', row['digest'], 'scope-zero-settings-digest')


def scope(row):
    require(type(row) is dict and set(row) == {
        'scopeSchema', 'databases', 'roles', 'memberships', 'globalSettings'}, 'scope-v2-fields')
    same(SCOPE_SCHEMA, row.get('scopeSchema'), 'scope-v2-version')
    databases = row.get('databases')
    require(type(databases) is list and bool(databases), 'scope-v2-databases')
    names, oids = [], []
    for database in databases:
        require(type(database) is dict and set(database) == {
            'name', 'oid', 'owner', 'acl', 'settings'}, 'scope-database-fields')
        name = database.get('name')
        require(type(name) is str and bool(name) and chr(0) not in name and name != TARGET,
                'scope-database-name')
        positive(database.get('oid'), 'scope-database-oid')
        positive(database.get('owner'), 'scope-database-owner')
        acl = database.get('acl')
        require(acl is None or (type(acl) is list and all(type(x) is str for x in acl)),
                'scope-database-acl')
        settings(database.get('settings'))
        names.append(name)
        oids.append(database['oid'])
    require(len(names) == len(set(names)) and len(oids) == len(set(oids)), 'scope-database-unique')
    # SQL owns PostgreSQL name ordering. Full equality preserves the captured order.
    for key in ('roles', 'memberships', 'globalSettings'):
        require(type(row.get(key)) is str and re.fullmatch('[a-f0-9]{32}', row[key]),
                'scope-global-digest')


def same_scope(expected, actual, reason):
    scope(expected)
    scope(actual)
    same(expected, actual, reason)


def manager_argv(unit):
    require(unit in (CAPTURE_UNIT, OBSERVE_UNIT), 'manager-fixed-owned-unit')
    return ['/usr/bin/systemctl', '--user', 'show', unit+'.service', '--no-pager',
            '--property='+','.join(MANAGER_FIELDS)]


def manager_env():
    import os
    uid = os.getuid()
    positive(uid, 'manager-local-uid')
    return {'PATH': '/usr/bin:/bin', 'HOME': '/home/nathaniel', 'LANG': 'C.UTF-8',
            'XDG_RUNTIME_DIR': '/run/user/'+str(uid),
            'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/'+str(uid)+'/bus'}


def duration_us(value):
    # Finite systemctl duration spellings only; no infinity, duplicate units or rounding.
    require(type(value) is str and bool(value), 'manager-duration')
    units = {'us': 1, 'ms': 1000, 's': 1000000, 'min': 60000000, 'h': 3600000000}
    total, seen = 0, set()
    for token in value.split(' '):
        match = re.fullmatch(r'([0-9]+)(?:\.([0-9]{1,6}))?(us|ms|s|min|h)', token)
        require(match is not None and match[3] not in seen, 'manager-duration-token')
        seen.add(match[3])
        scale = units[match[3]]
        fraction = match[2] or ''
        numerator = int(match[1])*10**len(fraction)+(int(fraction) if fraction else 0)
        require(numerator*scale % 10**len(fraction) == 0, 'manager-duration-precision')
        total += numerator*scale//10**len(fraction)
    return total


def manager_properties(raw):
    require(type(raw) is bytes and 0 < len(raw) <= 16384, 'manager-raw-bound')
    fields = {}
    for line in raw.decode('ascii').splitlines():
        require('=' in line, 'manager-property-line')
        key, value = line.split('=', 1)
        require(key in MANAGER_FIELDS and key not in fields, 'manager-property-unique')
        fields[key] = value
    same(set(MANAGER_FIELDS), set(fields), 'manager-property-set')
    for key in ('MainPID', 'MemoryMax', 'MemorySwapMax', 'TasksMax'):
        text = fields[key]
        require(re.fullmatch('0|[1-9][0-9]*', text) is not None, 'manager-integer-'+key)
        fields[key] = int(text)
    for key in ('RuntimeMaxUSec', 'CPUQuotaPerSecUSec'):
        fields[key] = duration_us(fields[key])
    return fields


def manager_binding(properties, entry, unit, runtime):
    same(unit+'.service', properties.get('Id'), 'manager-unit')
    require(type(entry) is dict and set(entry) == {
        'pid', 'uid', 'uids', 'invocation', 'controlGroup', 'resources'}, 'manager-entry-fields')
    positive(entry.get('pid'), 'manager-entry-pid')
    positive(entry.get('uid'), 'manager-entry-uid')
    same([entry['uid']]*4, entry.get('uids'), 'manager-kernel-uids')
    invocation = entry.get('invocation')
    require(type(invocation) is str and re.fullmatch('[a-f0-9]{32}', invocation)
            and invocation != '0'*32, 'manager-entry-invocation')
    group = entry.get('controlGroup')
    require(type(group) is str and group.startswith('/') and group != '/'
            and chr(10) not in group and '..' not in group.split('/'), 'manager-entry-cgroup')
    resource(entry.get('resources'))
    same(entry['pid'], properties.get('MainPID'), 'manager-main-pid')
    same(invocation, properties.get('InvocationID'), 'manager-invocation')
    same(group, properties.get('ControlGroup'), 'manager-control-group')
    same('active', properties.get('ActiveState'), 'manager-active')
    same('running', properties.get('SubState'), 'manager-running')
    same(runtime*1000000, properties.get('RuntimeMaxUSec'), 'manager-runtime')
    for key, expected in {'MemoryMax':536870912, 'MemorySwapMax':0,
                          'CPUQuotaPerSecUSec':500000, 'TasksMax':64}.items():
        same(expected, properties.get(key), 'manager-resource-'+key)
