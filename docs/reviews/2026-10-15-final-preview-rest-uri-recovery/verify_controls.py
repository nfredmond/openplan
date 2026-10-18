"""Serial recovery controls. All command runners are blocked before any mutation."""
import ast
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
sys.path.insert(0, str(ROOT))
import rest_uri_recovery_01_launcher as l
import rest_uri_recovery_01_controller as c
p = l.p
ROWS = []
TRIAL = PRIVATE / ('controls-' + sys.argv[1])


class Failure(AssertionError):
    pass


def demand(ok, reason):
    if not ok:
        raise Failure(reason)


def survives(label, fn):
    fn(); ROWS.append({'control': label, 'outcome': 'survived'})


def refuses(label, reason, fn):
    try:
        fn()
    except ValueError as error:
        demand(str(error) == reason, label + ':unexpected-refusal:' + str(error))
        ROWS.append({'control': label, 'outcome': 'intended_refusal', 'reason': reason})
    else:
        raise Failure(label + ':missing-refusal:' + reason)


def blocked(*args, **kwargs):
    raise Failure('unexpected-command-or-socket')


READ = l.read
ORIGINAL = READ('envs-private.json')
ACTIVE = READ('rest-uri-recovery-01/envs-v1-private.json')
RECEIPTS = READ('service-receipts-private.json')
PLAN = READ('plan-private.json')


def pinned_campaign():
    survives('pinned-baseline', l.pinned_files)
    binding = READ('rest-uri-recovery-01/template-binding-v1.json')
    with patch.object(l, 'read', side_effect=lambda name: dict(reversed(list(binding.items()))) if name == 'rest-uri-recovery-01/template-binding-v1.json' else READ(name)):
        survives('pinned-harmless-template-order', l.pinned_files)
    with patch.object(l, 'read', side_effect=lambda name: {k: v for k, v in binding.items() if k != 'rest_uri_recovery_01_policy.py'} if name == 'rest-uri-recovery-01/template-binding-v1.json' else READ(name)):
        refuses('pinned-missing-template', 'recovery-templates:names', l.pinned_files)
    with patch.object(l, 'read', side_effect=lambda name: copy.deepcopy(ACTIVE) if name == 'rest-uri-recovery-01/envs-v1-private.json' else READ(name)):
        survives('pinned-harmless-copy', l.pinned_files)
    lower = copy.deepcopy(ACTIVE)
    lower['rest']['PGRST_DB_URI'] = lower['rest']['PGRST_DB_URI'].replace('%3D', '%3d').replace('%2C', '%2c')
    # Filesystem hash acquisition remains at its explicitly rebound baseline here.
    # These trials exercise the downstream consumers, not physical hash changes.
    with patch.object(l, 'read', side_effect=lambda name: lower if name == 'rest-uri-recovery-01/envs-v1-private.json' else READ(name)):
        survives('pinned-harmless-hex-case', l.pinned_files)
    variants = []
    for label, value, reason in [
        ('literal-plus', ORIGINAL['rest']['PGRST_DB_URI'], 'native-rest-uri:value'),
        ('encoded-plus', ACTIVE['rest']['PGRST_DB_URI'].replace('%20', '%2B'), 'native-rest-uri:value'),
        ('target', ACTIVE['rest']['PGRST_DB_URI'].replace(PLAN['target'], p.SOURCE), 'recovery-inputs:envs'),
        ('role', ACTIVE['rest']['PGRST_DB_URI'].replace('authenticator:', 'supabase_admin:'), 'recovery-inputs:envs'),
        ('malformed-percent', ACTIVE['rest']['PGRST_DB_URI'].replace('%20', '%2G'), 'native-rest-uri:syntax')]:
        envs = copy.deepcopy(ACTIVE); envs['rest']['PGRST_DB_URI'] = value
        variants.append((label, envs, reason))
    for kind, key, value in [('rest', 'PGRST_DB_POOL', '3'), ('auth', 'GOTRUE_DISABLE_SIGNUP', 'false'), ('storage', 'DB_POOL_MAX', '4')]:
        envs = copy.deepcopy(ACTIVE); envs[kind][key] = value
        variants.append(('config-' + kind, envs, 'recovery-inputs:envs'))
    for label, envs, reason in variants:
        with patch.object(l, 'read', side_effect=lambda name: envs if name == 'rest-uri-recovery-01/envs-v1-private.json' else READ(name)):
            refuses('pinned-' + label, reason, l.pinned_files)
    sha = l.sha
    for name in ['rest_uri_recovery_01_policy.py', 'rest-uri-recovery-01/rest-v1-private.env', 'service-receipts-private.json', 'target-identity.json']:
        with patch.object(l, 'sha', side_effect=lambda path, n=name: 'changed' if str(path.relative_to(ROOT)) == n else sha(path)):
            refuses('pinned-hash-' + name, 'files:' + name, l.pinned_files)
    with patch.object(l, 'sha', side_effect=lambda path: 'changed' if path == l.RECOVERY / 'input-binding-v1.json' else sha(path)):
        refuses('pinned-input-manifest-hash', 'recovery-input-manifest:sha256', l.pinned_files)
    survives('pinned-exact-restoration', l.pinned_files)


def receipt_fixture(label, fault=None):
    directory = TRIAL / label
    directory.mkdir()
    identity = 'a' * 64
    created = {**RECEIPTS['rest'], 'id': identity}
    active = {**RECEIPTS, 'rest': copy.deepcopy(created)}
    values = {'replacement-receipt-private.json': created,
              'replacement-started-private.json': {'id': identity, 'running': True},
              'active-service-receipts-private.json': active,
              'active-binding-private.json': {'id': identity, 'receiptSha256': 'active-service-receipts-private.json',
                  'createdSha256': 'replacement-receipt-private.json', 'startedSha256': 'replacement-started-private.json'}}
    values = copy.deepcopy(values)
    if fault:
        fault(values)
    for name in values:
        (directory / name).write_text('{}')
    def read(name):
        if name.startswith('rest-uri-recovery-01/') and name.split('/')[-1] in values:
            return copy.deepcopy(values[name.split('/')[-1]])
        return READ(name)
    stack = ExitStack()
    stack.enter_context(patch.object(l, 'RECOVERY', directory))
    stack.enter_context(patch.object(l, 'read', side_effect=read))
    stack.enter_context(patch.object(l, 'sha', side_effect=lambda path: path.name))
    return stack, values


def receipt_campaign():
    with receipt_fixture('receipt-baseline')[0]:
        survives('active-receipt-baseline', l.active_receipts)
    with receipt_fixture('receipt-harmless', lambda v: v['replacement-started-private.json'].update(note='Harmless'))[0]:
        survives('active-receipt-harmless-note', l.active_receipts)
    trials = [
        ('old-id', lambda v: v['replacement-receipt-private.json'].update(id=c.OLD_ID), 'replacement-id:valid'),
        ('foreign-auth', lambda v: v['active-service-receipts-private.json']['auth'].update(id='b' * 64), 'files:auth'),
        ('old-active-rest', lambda v: v['active-service-receipts-private.json']['rest'].update(id=c.OLD_ID), 'files:rest'),
        ('target', lambda v: v['active-service-receipts-private.json']['rest'].update(database=p.SOURCE), 'files:rest'),
        ('receipt-hash', lambda v: v['active-binding-private.json'].update(receiptSha256='old-receipt'), 'active-binding:receiptSha256'),
        ('premature-running', lambda v: v['replacement-started-private.json'].update(running=False), 'replacement-started:running'),
        ('premature-missing-start', lambda v: v.pop('replacement-started-private.json'), 'recovery-state:complete')]
    for label, fault, reason in trials:
        with receipt_fixture('receipt-' + label, fault)[0]:
            refuses('active-receipt-' + label, reason, l.active_receipts)
    with receipt_fixture('receipt-restore')[0]:
        survives('active-receipt-exact-restoration', l.active_receipts)
    refuses('actual-premature-state', 'recovery-state:complete', l.active_receipts)


def command_campaign():
    receipt = RECEIPTS['rest']
    allowed = [['docker', 'stop', '--time', '10', c.OLD_ID], ['docker', 'rename', c.OLD_ID, c.RETAINED_NAME], c.create_args(receipt)]
    for index, argv in enumerate(allowed):
        survives('argv-baseline-' + str(index), lambda a=argv: c.allowed_command(a, receipt))
    survives('argv-start-baseline', lambda: c.allowed_command(['docker', 'start', 'a' * 64], receipt, 'a' * 64))
    for label, argv, identity in [
        ('global-role', ['docker', 'exec', p.DB_ID, 'psql', '-c', 'ALTER ROLE postgres SUPERUSER'], None),
        ('remove', ['docker', 'rm', c.OLD_ID], None),
        ('old-start-id', ['docker', 'start', c.OLD_ID], c.OLD_ID),
        ('foreign-stop', ['docker', 'stop', '--time', '10', 'b' * 64], None),
        ('name-stop', ['docker', 'stop', '--time', '10', receipt['name']], None),
        ('wrong-image', c.create_args(receipt)[:-1] + ['foreign'], None),
        ('extra-publication', c.create_args(receipt) + ['--publish', '3000:3000'], None)]:
        refuses('argv-' + label, 'recovery-command:allowed', lambda a=argv, i=identity: c.allowed_command(a, receipt, i))
    for name in ['clone', 'services', 'checkout']:
        refuses('disabled-' + name, 'recovery-disabled:' + name, getattr(l, name))
        with patch.object(l.sys, 'argv', [l.__file__, name]):
            refuses('disabled-cli-' + name, 'unknown-operation', l.main)
    with patch.object(p, 'ROOT', '/unassigned-root'), patch.object(l.sys, 'argv', [l.__file__, 'active-check']):
        refuses('launcher-wrong-root', 'launcher-root:root', l.main)
    with patch.object(c, 'names', return_value={receipt['name']: c.OLD_ID}):
        survives('names-baseline', lambda: c.collision_check(original_present=True))
    with patch.object(c, 'names', return_value={receipt['name']: c.OLD_ID, c.RETAINED_NAME: 'b' * 64}):
        refuses('names-retained-collision', 'recovery-names:retained', lambda: c.collision_check(original_present=True))
    with patch.object(c, 'names', return_value={receipt['name']: 'b' * 64}):
        refuses('names-original-collision', 'recovery-names:original', lambda: c.collision_check(original_present=True))
    with patch.object(l, 'target_identity', return_value={**READ('target-identity.json'), 'oid': 'foreign'}):
        refuses('target-oid', 'target-identity:oid', l.target_check)


def transition_probe(label, *, lose=None, fault=None):
    """Actual controller, real exclusive files, simulated Docker command boundary."""
    directory = TRIAL / label
    directory.mkdir()
    events = []; checks = []; new_id = 'a' * 64
    raw = {kind: copy.deepcopy(READ('rest-uri-recovery-01/' + ('old-rest' if kind == 'rest' else kind) + '-inspect-private.json')) for kind in RECEIPTS}
    original_raw = copy.deepcopy(raw)
    phase = {'running': True, 'renamed': False, 'created': False}
    if fault:
        fault(raw)
    real_write = l.write
    def read(name):
        if name.startswith('rest-uri-recovery-01/') and (directory / name.split('/')[-1]).exists():
            return json.loads((directory / name.split('/')[-1]).read_text())
        return READ(name)
    def inspect(identity):
        if identity == new_id:
            demand(phase['created'], 'inspect-before-create')
            result = copy.deepcopy(original_raw['rest'])
            result.update(Id=new_id, Name='/' + RECEIPTS['rest']['name'])
            env = dict(row.split('=', 1) for row in result['Config']['Env'])
            env.update(ACTIVE['rest'])
            result['Config']['Env'] = [k + '=' + v for k, v in env.items()]
            result['State']['Running'] = phase['new_running']
            return result
        kind = next(k for k, v in RECEIPTS.items() if v['id'] == identity)
        return copy.deepcopy(raw[kind])
    def runner(argv, **kwargs):
        events.append(argv)
        if argv[:3] == ['docker', 'image', 'inspect']:
            kind = next(k for k, v in p.IMAGES.items() if v == argv[3])
            # Use real bound image defaults from an inspect captured once below.
            return json.dumps([IMAGE_DEFAULTS[kind]]).encode()
        if argv[:3] == ['docker', 'container', 'ls']:
            found = [{'Names': RECEIPTS[k]['name'], 'ID': v['Id']} for k, v in raw.items() if k != 'rest']
            found.append({'Names': c.RETAINED_NAME if phase['renamed'] else RECEIPTS['rest']['name'], 'ID': c.OLD_ID})
            if phase['created']:
                found.append({'Names': RECEIPTS['rest']['name'], 'ID': new_id})
            return ('\n'.join(json.dumps(row) for row in found)).encode()
        stage = argv[1]
        demand((directory / 'transition-intent-private.json').is_file(), 'mutation-without-transition-intent')
        demand((directory / (stage + '-intent-private.json')).is_file(), 'mutation-without-step-intent')
        target_minimum = {'stop': 2, 'create': 3, 'start': 4}.get(stage)
        if target_minimum:
            demand(checks.count('target_check') >= target_minimum, 'target-check-before-' + stage)
        if stage == 'stop':
            demand(argv == ['docker', 'stop', '--time', '10', c.OLD_ID], 'stop-argv')
            phase['running'] = False; raw['rest']['State']['Running'] = False
        elif stage == 'rename':
            demand(argv == ['docker', 'rename', c.OLD_ID, c.RETAINED_NAME] and not phase['running'], 'rename-argv')
            phase['renamed'] = True; raw['rest']['Name'] = '/' + c.RETAINED_NAME
        elif stage == 'create':
            demand(argv == c.create_args(RECEIPTS['rest']) and phase['renamed'] and not phase['created'], 'create-argv')
            phase['created'] = True; phase['new_running'] = False
        elif stage == 'start':
            demand(argv == ['docker', 'start', new_id], 'start-exact-id')
            demand((directory / 'replacement-receipt-private.json').is_file(), 'start-before-id-custody')
            demand(json.loads((directory / 'replacement-receipt-private.json').read_text())['id'] == new_id, 'start-before-id-custody')
            phase['new_running'] = True
        else:
            raise Failure('unexpected-mutating-command')
        if stage == lose:
            raise RuntimeError('simulated-lost-ack-' + stage)
        return (new_id if stage == 'create' else 'ack').encode()
    with ExitStack() as stack:
        for obj, name, value in [(l, 'RECOVERY', directory), (l, 'ACTIVE_RECEIPTS', directory / 'active-service-receipts-private.json'),
                                 (l, 'read', read), (l, 'run', runner), (l, 'inspect', inspect)]:
            stack.enter_context(patch.object(obj, name, value))
        # Nonmutating source/target checks have separate retained/live boundaries.
        for name in ['pinned_files', 'db_check', 'target_check', 'source_check', 'unchanged_inputs']:
            def check(n=name): checks.append(n); return PLAN
            stack.enter_context(patch.object(l, name, side_effect=check))
        try:
            c.transition()
        except (ValueError, RuntimeError) as error:
            return {'events': events, 'error': str(error), 'phase': phase, 'directory': directory}
        first = copy.deepcopy(events)
        # A same-state duplicate invocation must hit real O_EXCL before commands.
        with patch.object(c, 'preflight', return_value=RECEIPTS['rest']):
            try: c.transition()
            except FileExistsError: pass
            else: raise Failure('duplicate-transition-survived')
        demand(events == first, 'duplicate-issued-command')
        return {'events': events, 'phase': phase, 'directory': directory}


IMAGE_DEFAULTS = {}


def transition_campaign(prefix='transition'):
    baseline = transition_probe(prefix + '-baseline')
    demand('error' not in baseline, 'transition-baseline:' + baseline.get('error', ''))
    demand([v[1] for v in baseline['events'] if v[1] in ['stop', 'rename', 'create', 'start']] == ['stop', 'rename', 'create', 'start'], 'transition-order')
    ROWS.append({'control': prefix + '-baseline-and-exclusive-retry', 'outcome': 'survived'})
    for stage in ['stop', 'rename', 'create', 'start']:
        result = transition_probe(prefix + '-lost-' + stage, lose=stage)
        demand(result.get('error') == 'simulated-lost-ack-' + stage, 'lost-ack-reason:' + stage)
        demand((result['directory'] / (stage + '-intent-private.json')).exists(), 'lost-ack-intent:' + stage)
        demand(not (result['directory'] / 'active-binding-private.json').exists(), 'lost-ack-active:' + stage)
        # The exclusive transition marker independently blocks any blind retry.
        with patch.object(l, 'RECOVERY', result['directory']):
            try: l.write('transition-intent-private.json', {})
            except FileExistsError: pass
            else: raise Failure('lost-ack-duplicate:' + stage)
        ROWS.append({'control': prefix + '-lost-' + stage, 'outcome': 'intended_refusal', 'reason': result['error']})
    for label, fault, reason in [
        ('old-id', lambda raw: raw['rest'].update(Id='b' * 64), 'retained-rest:Id'),
        ('old-config', lambda raw: raw['rest']['Config']['Env'].append('PGRST_DB_POOL=3'), 'retained-rest:Config'),
        ('old-running', lambda raw: raw['rest']['State'].update(Running=False), 'retained-rest-state:Running'),
        ('auth-config', lambda raw: raw['auth']['Config']['Env'].append('UNEXPECTED=1'), 'service:environment')]:
        result = transition_probe(prefix + '-' + label, fault=fault)
        demand(result.get('error') == reason, 'transition-fault:' + label + ':' + result.get('error', 'accepted'))
        demand(not any(v[1] in ['stop', 'rename', 'create', 'start'] for v in result['events']), 'fault-issued-mutation:' + label)
        ROWS.append({'control': prefix + '-' + label, 'outcome': 'intended_refusal', 'reason': reason})


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def historical_campaign():
    # Aliases are confined to this test process. Runtime launchers use static imports.
    sys.modules['policy'] = p; sys.modules['launcher'] = l
    controls = load('controls', PUBLIC / 'historical_controls.py')
    mutations = load('mutation_controls', PUBLIC / 'historical_mutations.py')
    result = mutations.run()
    demand(len(result['controls']['controls']) == 607, 'historical-count')
    return result


def app_consumer_campaign():
    """Execute build/start Python consumers with npm, exec and sockets replaced."""
    directory = TRIAL / 'app-consumer'
    app = directory / 'app'; (app / '.next').mkdir(parents=True)
    (app / '.env.local').write_text('synthetic')
    (app / '.next/BUILD_ID').write_text('synthetic-build')
    active = directory / 'active-service-receipts-private.json'
    active.write_text('{"rest":"synthetic-new-id"}')
    expected_hash = l.sha(active)
    saved = {}; commands = []; binds = []; execs = []
    resources = {'memory.max': str(10 * 1024**3), 'memory.swap.max': '0',
                 'memory.events': 'oom 0\noom_kill 0\noom_group_kill 0\n'}
    def write(name, value): saved[name] = copy.deepcopy(value)
    def read(name):
        if name in ['rest-uri-recovery-01/build-result.json', 'rest-uri-recovery-01/build-files.json']:
            return copy.deepcopy(saved[name.split('/')[-1]])
        return READ(name)
    def npm(argv, **kwargs):
        demand(argv == ['npm', 'run', 'build'] and kwargs['cwd'] == app, 'build-command')
        commands.append(argv)
        return type('Result', (), {'returncode': 0, 'stdout': b'simulated', 'stderr': b''})()
    class Socket:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def bind(self, address): binds.append(address)
    class ExecStopped(Exception): pass
    def execute(path, argv, env):
        execs.append((path, argv))
        raise ExecStopped()
    actual_path = l.Path
    class MemInfo:
        def read_text(self): return 'MemAvailable: 15000000 kB\n'
    with ExitStack() as stack:
        for obj, name, value in [(l, 'APP', app), (l, 'RECOVERY', directory), (l, 'ACTIVE_RECEIPTS', active),
                (l, 'app_check', lambda: (PLAN, READ('app-env-private.json'))), (l, 'source_check', lambda: None),
                (l, 'unchanged_inputs', lambda: None), (l, 'write', write), (l, 'read', read),
                (l, 'cgroup', lambda: dict(resources)), (l, 'inventory', lambda path: {}),
                (l, 'Path', lambda path: MemInfo() if str(path) == '/proc/meminfo' else actual_path(path)),
                (l.shutil, 'disk_usage', lambda path: type('Usage', (), {'free': 9 * 1024**3})()),
                (l.subprocess, 'run', npm), (l.socket, 'socket', Socket),
                (l.os, 'execve', execute), (l.os, 'chdir', lambda path: demand(path == app, 'start-cwd'))]:
            stack.enter_context(patch.object(obj, name, value))
        l.build()
        demand(saved['build-result.json']['serviceReceiptHash'] == expected_hash, 'build-active-receipt-hash')
        resources['memory.max'] = str(p.LIMIT)
        try: l.start()
        except ExecStopped: pass
        else: raise Failure('start-exec-not-reached')
        demand(saved['preview-start.json']['observed']['receiptHash'] == expected_hash, 'start-active-receipt-hash')
        demand(binds == [(p.HOST, 3585)], 'start-web-only-bind')
        demand(execs == [('/usr/bin/npm', ['npm', 'run', 'start', '--', '--hostname', p.HOST, '--port', '3585'])], 'start-command')
        saved['build-result.json']['serviceReceiptHash'] = 'old-receipt-hash'
        refuses('start-rejects-old-build-receipt', 'launch:receiptHash', l.start)
        demand(len(execs) == 1, 'refused-start-exec')
    ROWS.append({'control': 'build-start-active-receipt-consumers', 'outcome': 'survived'})


def replacement(module, name, before, after):
    source = Path(module.__file__).read_text()
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == name)
    body = ast.get_source_segment(source, node)
    demand(body.count(before) == 1, 'mutation-anchor:' + name)
    namespace = {}
    exec(compile(body.replace(before, after), '<recovery-mutation>', 'exec'), module.__dict__, namespace)
    return namespace[name]


def mutation_campaign():
    global TRIAL
    original_trial = TRIAL
    results = []
    tests = [
        ('harmless-comment', p, 'native_rest_uri', 'query = urlsplit(uri).query',
         '# Harmless wording.\n    query = urlsplit(uri).query', pinned_campaign, None),
        ('form-decoding-regression', p, 'native_rest_uri', "unquote(value, errors='strict')",
         "unquote(value.replace('+', ' '), errors='strict')", pinned_campaign,
         'pinned-literal-plus:unexpected-refusal:recovery-inputs:envs'),
        ('skip-native-consumer', l, 'pinned_files', "p.native_rest_uri(envs['rest']['PGRST_DB_URI'])", 'pass', pinned_campaign,
         'pinned-literal-plus:unexpected-refusal:recovery-inputs:envs'),
        ('skip-input-equivalence', l, 'recovery_inputs', "p.exact({'envs':expected},{'envs':observed},'recovery-inputs')", 'pass', pinned_campaign,
         'pinned-target:unexpected-refusal:configuration:endpoints'),
        ('skip-input-manifest', l, 'pinned_files', "p.exact({'sha256':INPUT_MANIFEST_SHA256},{'sha256':sha(RECOVERY/'input-binding-v1.json')},'recovery-input-manifest')", 'pass', pinned_campaign,
         'pinned-input-manifest-hash:missing-refusal:recovery-input-manifest:sha256'),
        ('skip-template-set', l, 'templates', "p.exact({'names':['rest_uri_recovery_01_controller.py','rest_uri_recovery_01_launcher.py','rest_uri_recovery_01_policy.py']},\n            {'names':sorted(expected)},'recovery-templates')", 'pass', pinned_campaign,
         'pinned-missing-template:missing-refusal:recovery-templates:names'),
        ('skip-active-hash', l, 'active_receipts', "'receiptSha256':sha(ACTIVE_RECEIPTS)", "'receiptSha256':binding['receiptSha256']", receipt_campaign,
         'active-receipt-receipt-hash:missing-refusal:active-binding:receiptSha256'),
        ('skip-premature-state', l, 'active_receipts', "{'id':identity,'running':True},started", "{'id':identity},started", receipt_campaign,
         'active-receipt-premature-running:missing-refusal:replacement-started:running'),
        ('allow-global-command', c, 'allowed_command', "{'allowed': allowed}", "{'allowed': True}", command_campaign,
         'argv-global-role:missing-refusal:recovery-command:allowed'),
        ('skip-name-collision', c, 'collision_check', "p.exact({'retained': OLD_ID if not original_present else None,\n             'original': OLD_ID if original_present else None},\n            {'retained': found.get(RETAINED_NAME), 'original': found.get(original)}, 'recovery-names')", 'pass', command_campaign,
         'names-retained-collision:missing-refusal:recovery-names:retained'),
        ('skip-target-before-stop', c, 'transition', 'l.pinned_files(); l.target_check(); old_check(running=True, renamed=False)',
         'l.pinned_files(); old_check(running=True, renamed=False)', transition_campaign, 'target-check-before-stop'),
        ('skip-old-identity', c, 'old_check', "p.exact(expected, projection(actual), 'retained-rest')", 'pass', transition_campaign,
         'transition-fault:old-id:service:id'),
        ('skip-id-custody', c, 'transition', "l.write('replacement-receipt-private.json', replacement)", 'pass', transition_campaign,
         'start-before-id-custody'),
        ('overwrite-intent', l, 'write', "path.open('x')", "path.open('w')", transition_campaign,
         'retained-rest:Name'),
        ('build-old-receipt', l, 'build', 'serviceReceiptHash=sha(ACTIVE_RECEIPTS)', "serviceReceiptHash=sha(OUT/'service-receipts-private.json')", app_consumer_campaign,
         'build-active-receipt-hash'),
        ('start-old-receipt', l, 'start', "'receiptHash':sha(ACTIVE_RECEIPTS)", "'receiptHash':sha(OUT/'service-receipts-private.json')", app_consumer_campaign,
         'launch:receiptHash'),
    ]
    identities = {(module, name): getattr(module, name) for _, module, name, *_ in tests}
    for label, module, name, before, after, campaign, wanted in tests:
        TRIAL = original_trial / ('mutation-' + label); TRIAL.mkdir()
        try:
            with patch.object(module, name, replacement(module, name, before, after)):
                try: campaign()
                except (Failure, ValueError) as error:
                    demand(wanted is not None and str(error) == wanted,
                           'mutation-unexpected:' + label + ':' + str(error))
                    results.append({'mutation': label, 'outcome': 'killed', 'reason': str(error)})
                else:
                    demand(wanted is None, 'mutation-survived:' + label)
                    results.append({'mutation': label, 'outcome': 'survived'})
        finally:
            demand(all(getattr(m, n) is f for (m, n), f in identities.items()), 'mutation-function-restoration')
        TRIAL = original_trial / ('restored-' + label); TRIAL.mkdir()
        campaign()
        results.append({'mutation': label + ':exact-restoration', 'outcome': 'survived'})
    TRIAL = original_trial
    return results


def main():
    os.umask(0o077); TRIAL.mkdir(mode=0o700)
    # These are cached read-only Docker image observations, captured by prepare.py.
    for kind in p.IMAGES:
        IMAGE_DEFAULTS[kind] = READ('rest-uri-recovery-01/' + kind + '-image-inspect-private.json')
    hashes = {name: l.sha(ROOT / name) for name in ['rest_uri_recovery_01_launcher.py', 'rest_uri_recovery_01_policy.py', 'rest_uri_recovery_01_controller.py']}
    with patch.object(l.subprocess, 'run', side_effect=blocked), patch.object(l.socket, 'socket', side_effect=blocked):
        pinned_campaign(); receipt_campaign(); command_campaign(); transition_campaign(); app_consumer_campaign()
        historical = historical_campaign()
        mutations = mutation_campaign()
    demand(hashes == {name: l.sha(ROOT / name) for name in hashes}, 'template-byte-restoration')
    report = {'controls': ROWS, 'mutations': mutations, 'historical': historical,
              'templateHashes': hashes, 'commandRunnerReplacedBeforeMutation': True,
              'restoration': {'templateBytes': True, 'functions': True},
              'blindCategories': ['Simulated Docker transitions do not prove daemon, DNS or schema-cache behavior.',
                  'Pinned input replay does not prove live HTTP health or source logical preservation.',
                  'Readiness requires actual REST 200 after parent replacement.']}
    with (TRIAL / 'result-private.json').open('x') as stream: json.dump(report, stream, indent=2)
    with (PUBLIC / 'evidence' / ('controls-' + sys.argv[1] + '.json')).open('x') as stream: json.dump(report, stream, indent=2)
    print(json.dumps({'controls': len(ROWS), 'historical': 607, 'mutations': mutations}))


if __name__ == '__main__':
    main()
