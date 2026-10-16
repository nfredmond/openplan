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
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/home/nathaniel', 'LANG': 'C.UTF-8'}


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
    for key, value in {'schema': 1, 'stage': stage, 'source': SOURCE, 'app': APP,
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
    require(database in ('postgres', TARGET), 'command-database')
    common = ['-h', '/var/run/postgresql', '-p', '5432', '-w', '-U', 'supabase_admin']
    if kind == 'sql':
        return PREFIX+['psql', '-XqAt']+common+['-d', database, '-v', 'ON_ERROR_STOP=1']
    if kind == 'allocate':
        same(TARGET, database, 'command-allocation-target')
        return PREFIX+['createdb']+common+['-T', 'template0', '--owner', 'postgres',
            '--encoding', 'UTF8', '--lc-collate', 'en_US.UTF-8', '--lc-ctype', 'en_US.UTF-8',
            '--locale-provider', 'icu', '--icu-locale', 'en-US', TARGET]
    if kind == 'render419':
        # No database argument: rendering reads only the exact admitted archive.
        return PREFIX+['pg_restore', '--file=-', '--single-transaction', '--exit-on-error']
    raise ValueError('command-kind')
