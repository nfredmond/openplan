"""Pure identity checks. Inputs contain observations, never approval claims."""
import hashlib
import json
import re

HEAD = 'b4dbcac21a58f61bd480ccade4dec69383dacbc7'
DB_ID = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
DB_NAME = 'supabase_db_openplan-restore-target-2026091050'
DB_IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
SOURCE = 'openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up'
NETWORK = 'supabase_network_openplan-restore-target-2026091050'
NETWORK_ID = 'a095943e3f3c26f3c41fb1df0054bf455c210eafc17a5f650e48e35b2bd2b154'
HOST = '127.74.19.10'
API = 'http://' + HOST + ':29948'
WEB = 'http://' + HOST + ':3585'
PURPOSE = 'project-combined-preview-configured-20261015'
ROOT = '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/' + PURPOSE
CONFIG_SOURCE = '/home/nathaniel/.local/state/openplan/project-map-integration-20261015/openplan/.env.local'
OPTIONAL_KEYS = frozenset(['CENSUS_API_KEY', 'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN', 'OPENPLAN_INTEGRATION_KEY_SECRET'])
SOURCE_ANCHOR = '82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547'
IMAGES = {
    'rest': 'sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326',
    'auth': 'sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd',
    'storage': 'sha256:a4846b3329f3afd52cd2ae31b89a0c1ae841221e9d3a22d55db65f9dca2a72b6',
    'gateway': 'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d',
}
PORTS = {'rest': 3000, 'auth': 9999, 'storage': 5000, 'gateway': 8000}
URI_KEYS = {'rest': 'PGRST_DB_URI', 'auth': 'GOTRUE_DB_DATABASE_URL', 'storage': 'DATABASE_URL'}
ROLES = {'rest': 'authenticator', 'auth': 'supabase_auth_admin', 'storage': 'supabase_storage_admin'}
LIMIT = 512 * 1024**2


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def exact(expected, actual, scope):
    """Require typed values; unrelated observation notes may survive."""
    for key, wanted in expected.items():
        if key not in actual or type(actual[key]) is not type(wanted) or actual[key] != wanted:
            raise ValueError(scope + ':' + key)


def target_name(value):
    exact({'valid': True}, {'valid': isinstance(value, str) and re.fullmatch(r'openplan_project_combined_preview_[0-9a-f]{24}', value) is not None}, 'target')


def database(info):
    exact({'Id': DB_ID, 'Name': '/' + DB_NAME, 'Image': DB_IMAGE,
           'running': True, 'project': 'openplan-restore-target-2026091050',
           'networkId': NETWORK_ID}, info, 'database')


def source(info):
    exact({'database': SOURCE, 'readonly': 'on', 'historyCount': 419,
           'latest': '20261017000016', 'foreignTables': 0, 'subscriptions': 0,
           'cron': False, 'databaseSettings': 0, 'delegatedGrantors': 0}, info, 'source')


def service(expected, actual):
    # Observations include exact IDs, effective environment, all mounts/networks,
    # port publications, privilege flags, and running state.
    exact(expected, actual, 'service')


def files(expected, actual):
    exact(expected, actual, 'files')
    exact({'keys': sorted(expected)}, {'keys': sorted(actual)}, 'file-set')


def launch(expected, actual):
    exact(expected, actual, 'launch')


def safe_parent_command(argv, target):
    """Permit only create, target restore/SQL, and readonly source dump."""
    target_name(target)
    prefix = ['docker', 'exec', DB_ID]
    allowed = (
        argv[:5] == ['docker', 'exec', '-i', DB_ID, 'pg_restore']
        and argv[5:] == ['-U', 'supabase_admin', '-d', target, '--jobs=1', '--exit-on-error', '--single-transaction']
    ) or (
        argv[:4] == prefix + ['createdb'] and argv[-1] == target
        and '-T' in argv and argv[argv.index('-T') + 1] == 'template0'
    )
    exact({'allowed': True}, {'allowed': allowed}, 'command')


def source_dump_args():
    return ['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on',DB_ID,
        'pg_dump','-U','supabase_admin','-Fc','--compress=3','--serializable-deferrable','-d',SOURCE]


def dump_command(argv):
    exact({'argv':source_dump_args()},{'argv':argv},'source-dump')


def config_observations(plan, envs, kong, app):
    from urllib.parse import parse_qs, urlsplit
    endpoints={}
    for kind,key in URI_KEYS.items():
        u=urlsplit(envs[kind][key])
        endpoints[kind]=dict(scheme=u.scheme,host=u.hostname,port=u.port,role=u.username,
            database=u.path[1:],query=parse_qs(u.query),password=bool(u.password))
    secrets=[envs['rest'].get('PGRST_JWT_SECRET'),envs['auth'].get('GOTRUE_JWT_SECRET'),envs['storage'].get('AUTH_JWT_SECRET')]
    return dict(endpoints=endpoints,jwtShared=bool(secrets[0]) and len(secrets[0])>=64 and len(set(secrets))==1,
        appKeysMatch=app['NEXT_PUBLIC_SUPABASE_ANON_KEY']==envs['storage']['ANON_KEY'] and app['SUPABASE_SERVICE_ROLE_KEY']==envs['storage']['SERVICE_KEY'],
        rest=[envs['rest'].get(k) for k in ['PGRST_DB_CONFIG','PGRST_OPENAPI_MODE','PGRST_DB_POOL']],
        auth=[envs['auth'].get(k) for k in ['GOTRUE_SITE_URL','GOTRUE_URI_ALLOW_LIST','API_EXTERNAL_URL','GOTRUE_JWT_ISSUER','GOTRUE_DISABLE_SIGNUP','GOTRUE_MAILER_AUTOCONFIRM','GOTRUE_DB_MAX_POOL_SIZE']],
        mailAbsent=not any('SMTP' in k or 'HOOK' in k or k.startswith('GOTRUE_EXTERNAL_') and k!='GOTRUE_EXTERNAL_EMAIL_ENABLED' for k in envs['auth']),
        cloudAbsent=not any(any(word in k for word in ['OPENAI','ANTHROPIC','OPENROUTER','RESEND','AWS_','AZURE_','GOOGLE_']) for e in [*envs.values(),app] for k in e),
        optionalHelpersAbsent=not any(key in OPTIONAL_KEYS for env in envs.values() for key in env),
        storage=[envs['storage'].get(k) for k in ['STORAGE_BACKEND','FILE_STORAGE_BACKEND_PATH','S3_PROTOCOL_ENABLED','VECTOR_ENABLED','ENABLE_IMAGE_TRANSFORMATION','DB_POOL_MAX']],
        cors=[x['config']['origins'] for x in kong['plugins'] if x['name']=='cors'],
        upstreams={s['name']:s['url'] for s in kong['services']},
        appSet=sorted(app),appOrigin=app['NEXT_PUBLIC_SUPABASE_URL'],webOrigin=app['NEXT_PUBLIC_APP_URL'],
        appHead=app['OPENPLAN_COMMIT_SHA'],gtfs=app['OPENPLAN_GTFS_MANAGED_INGESTION'])


def configuration(plan, envs, kong, app, optional=None):
    optional = {} if optional is None else optional
    optional_values(optional)
    endpoints={kind:dict(scheme='postgresql',host=DB_NAME,port=5432,role=ROLES[kind],database=plan['target'],
        query={'options':['-c search_path='+('auth,public,extensions' if kind=='auth' else 'storage,public,extensions' if kind=='storage' else 'public,extensions')]},password=True) for kind in URI_KEYS}
    upstreams={kind:'http://'+plan['names'][kind]+':'+str(PORTS[kind])+'/' for kind in ['rest','auth','storage']}
    upstreams['storage-signed-read']='http://'+plan['names']['storage']+':5000/object/sign/'
    expected=dict(endpoints=endpoints,jwtShared=True,appKeysMatch=True,rest=['false','disabled','2'],
        auth=[WEB,WEB+'/**',API,API+'/auth/v1','true','true','3'],mailAbsent=True,cloudAbsent=True,optionalHelpersAbsent=True,
        storage=['file','/mnt','false','false','false','3'],cors=[[WEB]],upstreams=upstreams,
        appSet=sorted(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
            'NEXT_PUBLIC_APP_URL','OPENPLAN_COMMIT_SHA','OPENPLAN_GTFS_MANAGED_INGESTION','OPENPLAN_GTFS_PARSER_BUILD', *optional]),
        appOrigin=API,webOrigin=WEB,appHead=HEAD,gtfs='0')
    exact(expected,config_observations(plan,envs,kong,app),'configuration')
    exact({'values':optional}, {'values':{key:app[key] for key in OPTIONAL_KEYS if key in app}}, 'optional-app')


def optional_values(values):
    """Retain only existing nonempty text values from the three-key allowlist."""
    exact({'allowed':True}, {'allowed':type(values) is dict and set(values)<=OPTIONAL_KEYS}, 'optional-allowlist')
    exact({'valid':True}, {'valid':all(type(value) is str and bool(value) and not any(c in value for c in '\r\n\x00$`') for value in values.values())}, 'optional-values')


def selected_values(data):
    """Parse only the authorized dotenv keys without shell evaluation or expansion."""
    values={}
    for line in data.decode('utf-8').splitlines():
        line=line.strip()
        if line.startswith('export '):line=line[7:].lstrip()
        key,sep,value=line.partition('=');key=key.strip()
        if not sep or key not in OPTIONAL_KEYS:continue
        exact({'unique':True}, {'unique':key not in values}, 'optional-source')
        value=value.strip()
        if value.startswith('"'):
            try:value=json.loads(value)
            except (ValueError,TypeError):raise ValueError('optional-source:syntax') from None
        elif value.startswith("'"):
            if not value.endswith("'") or "'" in value[1:-1]:raise ValueError('optional-source:syntax')
            value=value[1:-1]
        else:
            value=re.split(r'\s+#',value,maxsplit=1)[0].rstrip()
        values[key]=value
    optional_values(values)
    return values


def configured_source(binding, data, app):
    """Bind the complete private source bytes and exact optional-key custody."""
    exact({'path':CONFIG_SOURCE}, binding, 'optional-source')
    exact({'sha256':binding['sha256']}, {'sha256':hashlib.sha256(data).hexdigest()}, 'optional-source-hash')
    optional_values(binding['values'])
    values=selected_values(data)
    exact({'values':binding['values']}, {'values':values}, 'optional-source-values')
    exact({'values':values}, {'values':{key:app[key] for key in OPTIONAL_KEYS if key in app}}, 'optional-app')
    return values


def source_fingerprint(frozen, current):
    exact({'sha256':SOURCE_ANCHOR}, frozen, 'source-anchor')
    exact({'sha256':SOURCE_ANCHOR}, {'sha256':digest(current)}, 'source-fingerprint')


def created_service(expected, actual):
    # Docker may assign NetworkID at startup. Before startup require the exact
    # network name/config and permit only unassigned or the pinned network ID.
    exact({'networkIdValid':True},{'networkIdValid':actual.get('network') in [[''],[NETWORK_ID]]},'created-service')
    expected={**expected,'running':False,'network':actual['network']}
    service(expected,actual)
