"""Pure refusal rules. Observations must come from the fixed native transport.

These checks constrain a trusted same-user parent. They do not authenticate a
hostile local owner or turn caller-authored JSON into native evidence.
"""
import re

CONTAINER = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
PROJECT = 'openplan-restore-target-2026091050'
NETWORK = 'supabase_network_openplan-restore-target-2026091050'
NETWORK_ID = 'a095943e3f3c26f3c41fb1df0054bf455c210eafc17a5f650e48e35b2bd2b154'
SOURCE = 'f8a571bb0a18b8b6501870acb5ef1e760d487e1c'
TREE = 'd577a9cd955018b3253f42b3d9af2a96a9a10b53'
PATH = 'search_path=pg_catalog, public, pg_temp'
FINISH = 'public.finish_assistant_provider_turn(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.jsonb,pg_catalog.jsonb,pg_catalog.text)'
VALIDATOR = 'public.valid_assistant_native_limit_receipt(pg_catalog.jsonb,public.assistant_provider_turns)'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def same(expected, actual, reason):
    require(type(expected) is type(actual) and expected == actual, reason)


def target(value, excluded):
    require(isinstance(value, str) and re.fullmatch(r'openplan_a0_limit_[a-f0-9]{24}', value) is not None, 'target-name')
    require(value not in excluded, 'target-protected')


def container(value):
    for key, expected in {'Id': CONTAINER, 'Image': IMAGE, 'Name': '/supabase_db_'+PROJECT,
                          'Project': PROJECT, 'NetworkID': NETWORK_ID,
                          'Running': True, 'Paused': False, 'Restarting': False}.items():
        same(expected, value.get(key), 'container-'+key)


def native(value, database, system=None, oid=None):
    same(database, value.get('database'), 'native-database')
    same('supabase_admin', value.get('sessionRole'), 'native-session')
    same('supabase_admin', value.get('currentRole'), 'native-current')
    same(True, value.get('adminSuperuser'), 'native-admin')
    same(False, value.get('postgresSuperuser'), 'native-postgres')
    same(True, value.get('serviceBypassRLS'), 'native-service')
    require(type(value.get('oid')) is int and value['oid'] > 0, 'native-oid')
    require(isinstance(value.get('systemIdentifier'), str) and re.fullmatch('[0-9]{10,30}', value['systemIdentifier']) is not None, 'native-system')
    require(type(value.get('pid')) is int and value['pid'] > 0, 'native-pid')
    same('a0-limit-wrapper', value.get('applicationName'), 'native-application')
    if system is not None:
        same(system, value.get('systemIdentifier'), 'native-system-pin')
    if oid is not None:
        same(oid, value.get('oid'), 'native-oid-pin')


def history(value, expected):
    same(expected, value.get('versions'), 'history-versions')
    same(len(expected), value.get('count'), 'history-count')
    same(expected[-1], value.get('latest'), 'history-latest')


def installed(value, expected):
    same(sorted(expected), sorted(value), 'definition-set')
    for name, pin in expected.items():
        row = value[name]
        same(pin['sha256'], row.get('sha256'), 'definition-sha-'+name)
        same(pin['owner'], row.get('owner'), 'definition-owner-'+name)
        same(pin['definer'], row.get('definer'), 'definition-security-'+name)
        same(pin['volatility'], row.get('volatility'), 'definition-volatility-'+name)
        same(pin['config'], row.get('config'), 'definition-config-'+name)
        same(pin['acl'], row.get('acl'), 'definition-acl-'+name)


def admission(value, stage, package_sha, plan_sha, predecessor_sha):
    for key, expected in {'stage': stage, 'packageSHA256': package_sha,
                          'planSHA256': plan_sha, 'predecessorSHA256': predecessor_sha,
                          'sourceCommit': SOURCE, 'appTree': TREE,
                          'memoryBytes': 1073741824, 'swapBytes': 0, 'cpuPercent': 50}.items():
        same(expected, value.get(key), 'admission-'+key)
    require(isinstance(value.get('independentReviewSHA256'), str) and re.fullmatch('[a-f0-9]{64}', value['independentReviewSHA256']) is not None, 'admission-review')


def predecessor(value, stage):
    same(stage, value.get('stage'), 'predecessor-stage')
    same('complete', value.get('status'), 'predecessor-completion')


def resource(value):
    same(1073741824, value.get('memoryMax'), 'resource-memory')
    same(0, value.get('swapMax'), 'resource-swap')
    same('50000 100000', value.get('cpuMax'), 'resource-cpu')


def private(value, directory=False):
    same(False, value.get('symlink'), 'private-symlink')
    same(0o700 if directory else 0o600, value.get('mode'), 'private-mode')
    same(True, value.get('owned'), 'private-owner')


def case_result(expected, actual):
    same(expected, actual, 'case-result')


def blocking(a, b, observed):
    require(type(a) is int and type(b) is int and a != b and a > 0 and b > 0, 'race-distinct-sessions')
    require(a in observed, 'race-production-blocker')


def unchanged(before, after):
    same(before, after, 'rollback-state')


def command(argv, database, allocating=False):
    target(database, [])
    prefix = ['/usr/bin/docker', 'exec', '-i', CONTAINER]
    require(argv[:4] == prefix, 'command-container')
    tail = argv[4:]
    if allocating:
        same(['createdb', '-h', '/var/run/postgresql', '-p', '5432', '-w', '-U', 'supabase_admin', '-T', 'template0', '--owner', 'postgres',
              '--encoding', 'UTF8', '--lc-collate', 'en_US.UTF-8', '--lc-ctype', 'en_US.UTF-8',
              '--locale-provider', 'icu', '--icu-locale', 'en-US', database], tail, 'command-create')
    elif tail and tail[0] == 'pg_restore':
        same(['pg_restore', '-h', '/var/run/postgresql', '-p', '5432', '-w', '-U', 'supabase_admin', '-d', database, '--jobs=1', '--exit-on-error', '--single-transaction'], tail, 'command-restore')
    else:
        same(['psql', '-XqAt', '-h', '/var/run/postgresql', '-p', '5432', '-w', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], tail, 'command-sql')
