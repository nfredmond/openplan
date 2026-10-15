"""Parent-operated application packet. Preparation does not authorize execution."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import source_binding
import journal as j
import subprocess
import sys
import time

APP_HEAD = 'f0cbeddff5ae3fc37e0dd8b91c02601429d977a6'
HELPER_HEAD = APP_HEAD
RECOVERY_PRODUCER = APP_HEAD
SOURCE_ANCHOR = '82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547'
ROOT = Path('/dev/shm/openplan-pr330-preview-20261015')
FROZEN = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
SOURCE_REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-d8a9134b')
DEPS_REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan')
DEPS = DEPS_REPO / 'node_modules'
CANDIDATE = ROOT / 'candidate'
APP = CANDIDATE / 'openplan'
RUN = ROOT / 'execution'
HOST = '127.74.19.13'
API = 'http://' + HOST + ':29952'
WEB = 'http://' + HOST + ':3587'
HELPERS = {'helper.py': '7a65cfff843c03a9837b85d7bea128c2e4b46db843f657542ed8c0b8351c89d3', 'policy.py': 'e73d914bed7c6a9b72f5c6c23e29641308051467c31abd7359b069b167186091'}
GiB = 1024**3


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            result.update(block)
    return result.hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def private_file(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o777 == 0o600,
            'private-file:' + path.name)


def write_once(path, value):
    j.record(str(path.relative_to(ROOT)),value)
    # Persist working copy only after durable receipt publication.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command(argv, *, cwd=None, timeout=120, mutation=None):
    environment = {'PATH': '/usr/bin:/bin', 'HOME': str(ROOT/'tmp'),
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
        'XDG_RUNTIME_DIR': '/run/user/'+str(os.getuid())}
    result = j.execute(mutation,argv,cwd=cwd,env=environment,timeout=timeout) if mutation else subprocess.run(argv,cwd=cwd,env=environment,capture_output=True,timeout=timeout)
    require(result.returncode == 0, 'command:' + Path(argv[0]).name)
    return result.stdout


def load_recovery():
    # Only the new sealed helper module is imported. No old launcher is invoked.
    for name,expected in HELPERS.items():
        private_file(ROOT/name);require(sha(ROOT/name)==expected,'helper-sha:'+name)
    require('helper' not in sys.modules or Path(sys.modules['helper'].__file__)==ROOT/'helper.py','helper-module-root')
    sys.path.insert(0,str(ROOT))
    try:r=importlib.import_module('helper')
    finally:sys.path.pop(0)
    require(Path(r.__file__)==ROOT/'helper.py' and Path(r.p.__file__)==ROOT/'policy.py' and r.OUT==ROOT and
        r.p.HEAD==APP_HEAD and r.p.SOURCE_ANCHOR==SOURCE_ANCHOR and r.p.API==API and r.p.WEB==WEB,'helper-root-head')
    return r


def bindings():
    require(Path(__file__).resolve() == ROOT/'app_binding_v1.py' and ROOT.resolve() == ROOT,
            'launcher-root')
    private_file(ROOT/'binding-private.json')
    binding = read(ROOT/'binding-private.json')
    require(set(binding) == {'schema', 'appHead', 'helperHead', 'producer', 'sourceAnchor', 'files'}, 'binding-schema')
    require((binding['schema'], binding['appHead'], binding['helperHead'], binding['producer'], binding['sourceAnchor']) ==
        (1, APP_HEAD, HELPER_HEAD, RECOVERY_PRODUCER, SOURCE_ANCHOR), 'binding-identity')
    expected = {'app_binding_v1.py', 'app-env-private.json', 'app-v1.env', 'migrations.json', 'dependency-binding.json', 'upgrade-expectations.json', 'attest_start_v1.py', 'memory_storage.py', 'source_binding.py', 'source-files.json', 'journal.py'}
    require(set(binding['files']) == expected, 'binding-file-set')
    for name, expected_sha in binding['files'].items():
        private_file(ROOT/name)
        require(sha(ROOT/name) == expected_sha, 'binding-sha:' + name)
    require(ROOT.stat().st_mode & 0o777 == 0o700 and RUN.is_dir() and not RUN.is_symlink() and
            RUN.resolve() == RUN and RUN.stat().st_mode & 0o777 == 0o700, 'private-root')
    return binding


def app_values(r):
    r.pinned_files()
    values=read(ROOT/'app-env-private.json')
    require(values==r.read('app-env-private.json') and values['OPENPLAN_COMMIT_SHA']==APP_HEAD,'app-env-delta')
    encoded=''.join(key+'='+json.dumps(value)+'\n' for key,value in values.items()).encode()
    require((ROOT/'app-v1.env').read_bytes()==encoded,'app-env-encoding')
    require(values['NEXT_PUBLIC_SUPABASE_URL']==API and values['NEXT_PUBLIC_APP_URL']==WEB and
        values['OPENPLAN_GTFS_MANAGED_INGESTION']=='0','app-env-endpoints')
    return values


def acquire(r):
    r.pinned_files();r.target_check();r.upgrade_ready()
    active=r.verify_services();r.source_check();r.unchanged_inputs()
    require(active==r.read('service-receipts-private.json'),'active-race')
    require(r.read('clone-ready.json')['sourceSha256']==SOURCE_ANCHOR,'source-anchor')
    identity=r.read('target-identity.json')
    require(identity['database']==r.TARGET and identity['owner']=='postgres','target-binding')
    return {'activeReceiptSha256':sha(ROOT/'service-receipts-private.json'),'sourceAnchor':SOURCE_ANCHOR,
        'helperHead':APP_HEAD,'producer':APP_HEAD,'clusterId':r.p.DB_ID,'target':identity,'images':r.p.IMAGES,
        'upgradeReceiptSHA256':sha(ROOT/'upgrade-ready.json')}


def migrations():
    expected=read(ROOT/'migrations.json')
    baseline=read(FROZEN/'candidate-migrations.json')
    require(len(expected)==420 and expected=={**baseline,
        'openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql':
        'b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b'},'migration-baseline')
    actual={str(f.relative_to(CANDIDATE)):sha(f) for f in sorted((APP/'supabase/migrations').glob('*.sql'))
        if f.is_file() and not f.is_symlink()}
    require(actual==expected,'migration-bytes')
    return digest(actual)


def dependencies():
    b = read(ROOT/'dependency-binding.json')
    require(str(DEPS) == b['path'] and DEPS.resolve() == DEPS, 'deps-root')
    paths = {'candidateLock': APP/'package-lock.json', 'candidateManifest': APP/'package.json',
             'donorLock': DEPS_REPO/'package-lock.json', 'installedLock': DEPS/'.package-lock.json'}
    require({name: sha(path) for name, path in paths.items()} == b['hashes'], 'deps-input-hash')
    lock = read(paths['candidateLock']); donor = read(paths['donorLock'])
    require(len(lock['packages']) == 1144 and {k:v for k,v in lock['packages'].items() if k} ==
            {k:v for k,v in donor['packages'].items() if k}, 'deps-graph')
    a = json.loads(json.dumps(lock['packages']['']))
    require(a['dependencies'].pop('@xmldom/xmldom') == '0.8.15' and a == donor['packages'][''], 'deps-root-delta')
    manifest = read(paths['candidateManifest'])
    require(manifest['dependencies'] == lock['packages']['']['dependencies'] and
            manifest['devDependencies'] == lock['packages']['']['devDependencies'], 'deps-manifest')
    installed = read(paths['installedLock'])['packages']
    require(len(installed) == b['installedEntries'] and all(
        entry == lock['packages'].get(name) for name, entry in installed.items()), 'installed-graph')
    observed = {}
    for name in sorted(installed):
        f = DEPS_REPO/name/'package.json'
        require(f.is_file() and not f.is_symlink(), 'installed-package-file')
        data = read(f)
        require(data['version'] == installed[name]['version'], 'installed-version')
        observed[name] = sha(f)
    require(digest(observed) == b['installedManifestDigest'], 'installed-metadata')
    require(read(DEPS/'@xmldom/xmldom/package.json')['version'] == '0.8.15', 'parser-version')
    return digest(b)


def app_check(r):
    values = app_values(r)
    require(CANDIDATE.resolve() == CANDIDATE and APP.resolve() == APP and CANDIDATE.is_dir(), 'app-root')
    head = command(['/usr/bin/git', '-C', str(CANDIDATE), 'rev-parse', 'HEAD']).decode().strip()
    require(head == APP_HEAD, 'app-head')
    require(command(['/usr/bin/git','-C',str(CANDIDATE),'rev-parse','HEAD:openplan']).decode().strip() == 'a13c491da3ad3ba5b237ca5fa8802b236c4ef27b', 'app-tree')
    require(not command(['/usr/bin/git', '-C', str(CANDIDATE), 'status', '--porcelain', '--untracked-files=all']).strip(), 'app-dirty')
    private_file(APP/'.env.local')
    require((APP/'.env.local').read_bytes() == (ROOT/'app-v1.env').read_bytes(), 'app-env-file')
    require({f.name for f in APP.glob('.env*')} <= {'.env.local', '.env.example'}, 'unowned-env')
    require((APP/'node_modules').is_symlink() and (APP/'node_modules').resolve() == DEPS, 'deps-link')
    return {'head': head, 'environmentSha256': sha(APP/'.env.local'), 'migrationDigest': migrations(),
            'dependencyBindingSha256': dependencies(),
            'sourceInventoryDigest': source_binding.check(CANDIDATE, read(ROOT/'source-files.json'))}, values


def cgroup():
    rows = Path('/proc/self/cgroup').read_text().splitlines()
    require(len(rows) == 1 and rows[0].startswith('0::/'), 'cgroup-v2')
    path = Path('/sys/fs/cgroup')/rows[0][4:]
    return {name: (path/name).read_text().strip() for name in
        ['memory.max', 'memory.swap.max', 'memory.events', 'cpu.max', 'memory.peak', 'memory.swap.current']}


def budget(observed, phase):
    require(observed['memory.max'] == str(10*GiB if phase == 'build' else 512*1024**2) and
            observed['memory.swap.max'] == '0' and observed['memory.swap.current'] == '0', 'cgroup-memory')
    words = observed['cpu.max'].split()
    require(len(words) == 2 and all(re.fullmatch(r'[0-9]+', x) for x in words), 'cgroup-cpu-format')
    quota, period = map(int, words)
    require(period > 0 and 0 < quota <= period//2, 'cgroup-cpu-bound')
    rows = [line.split() for line in observed['memory.events'].splitlines()]
    require(all(len(row) == 2 for row in rows) and len({x[0] for x in rows}) == len(rows), 'cgroup-events-format')
    events = dict(rows)
    require(all(events.get(key) == '0' for key in ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']), 'cgroup-events')
    require(observed['memory.peak'].isdigit() and int(observed['memory.peak']) <= int(observed['memory.max']), 'cgroup-peak')
    return observed


def headroom():
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:')))*1024
    free = shutil.disk_usage(ROOT).free
    require(available >= 10*GiB and free >= 8*GiB, 'build-headroom')
    import memory_storage
    total = memory_storage.observe_capacity()
    return {'availableMemory': available, 'freeDisk': free, 'memoryStorage': total}


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'inventory-root')
    result = {}
    for f in sorted(root.rglob('*')):
        require(not f.is_symlink(), 'inventory-symlink')
        if f.is_file():
            result[str(f.relative_to(root))] = {'bytes': f.stat().st_size, 'sha256': sha(f)}
    require(bool(result), 'inventory-empty')
    return result


def environment(values, phase):
    # Explicit environment only. npm uses private HOME, tmp and cache paths.
    return {**values, 'PATH': '/usr/bin:/bin', 'HOME': str(RUN/'home'), 'TMPDIR': '/tmp',
            'npm_config_cache': str(RUN/'npm-cache'), 'npm_config_logs_dir': str(RUN/'npm-cache/_logs'), 'XDG_CACHE_HOME': str(RUN/'cache'),
            'NODE_OPTIONS': '--max-old-space-size='+('6144' if phase == 'build' else '320'),
            'NEXT_TELEMETRY_DISABLED': '1', 'NODE_ENV': 'production', 'LANG': 'C.UTF-8',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}


def confined_argv(phase):
    # Host is RO, candidate/RUN/tmp are owned writable mounts, dependencies and env RO.
    # /run is hidden, so npm cannot reach the host Docker socket. This does not
    # constrain Docker API calls made by the outer original checker.
    args = ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc',
            '--unshare-uts', '--unshare-cgroup', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
            '--tmpfs', '/run', '--dir', '/dev/shm', '--ro-bind', str(ROOT), str(ROOT), '--bind', str(CANDIDATE), str(CANDIDATE),
            '--bind', str(RUN), str(RUN), '--bind', str(RUN/'tmp'), '/tmp',
            '--ro-bind', str(DEPS), str(DEPS),
            '--ro-bind', str(APP/'.env.local'), str(APP/'.env.local'), '--chdir', str(APP)]
    if phase == 'build':
        args += ['--unshare-net']
    return args + ['/usr/bin/npm', 'run', phase if phase == 'build' else 'start'] + (
        [] if phase == 'build' else ['--', '--hostname', HOST, '--port', '3587'])


def execution_dirs():
    for name in ['home', 'npm-cache', 'cache', 'tmp']:
        path = RUN/name
        require(not path.exists(), 'execution-dir-exists')
        path.mkdir(mode=0o700)


def checkout():
    bindings(); r = load_recovery(); app_values(r); active = acquire(r)
    require(not CANDIDATE.exists() and not CANDIDATE.is_symlink(), 'checkout-exists')
    require(command(['/usr/bin/git', '-C', str(SOURCE_REPO), 'rev-parse', APP_HEAD+'^{commit}']).decode().strip() == APP_HEAD,
            'local-commit')
    write_once(RUN/'checkout-intent.json', {'appHead': APP_HEAD, 'source': str(SOURCE_REPO), 'target': str(CANDIDATE), **active})
    # Local object reuse mutates only the new repository, never the source gitdir.
    command(['/usr/bin/git', 'clone', '--shared', '--no-checkout', str(SOURCE_REPO), str(CANDIDATE)], timeout=300, mutation='source-clone')
    command(['/usr/bin/git', '-C', str(CANDIDATE), 'checkout', '--detach', APP_HEAD], timeout=300, mutation='source-checkout')
    # A lost acknowledgement leaves intent/partial checkout in place and refuses retry.
    require(command(['/usr/bin/git', '-C', str(CANDIDATE), 'rev-parse', 'HEAD']).decode().strip() == APP_HEAD, 'app-head')
    fd = os.open(APP/'.env.local', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write((ROOT/'app-v1.env').read_bytes()); stream.flush(); os.fsync(stream.fileno())
    (APP/'node_modules').symlink_to(DEPS, target_is_directory=True)
    observed, _ = app_check(r)
    require(acquire(r) == active, 'checkout-active-change')
    write_once(RUN/'checkout-ready.json', observed)


def build():
    bindings(); r = load_recovery(); app, values = app_check(r); active = acquire(r)
    resources = budget(cgroup(), 'build'); space = headroom()
    require(read(RUN/'checkout-ready.json') == app, 'checkout-receipt')
    require(not (APP/'.next').exists(), 'old-next')
    write_once(RUN/'build-intent.json', {'app': app, 'active': active, 'resources': resources, 'headroom': space})
    execution_dirs()
    started = time.monotonic()
    # Actual bubblewrap command, not a symlink-only promise. Build is serial.
    result = j.execute('webpack-build',confined_argv('build'),cwd=APP,env=environment(values,'build'),timeout=1800,combined=True,return_output=False)
    with (j.DURABLE/'journal/webpack-build/stdout.bin').open('rb') as source, (RUN/'build-private.log').open('xb') as log:
        shutil.copyfileobj(source,log)
    end_resources = cgroup()
    write_once(RUN/'build-exit.json', {'returncode': result.returncode, 'resources': end_resources,
                                     'seconds': time.monotonic()-started})
    require(result.returncode == 0, 'build-exit')
    budget(end_resources, 'build')
    require(app_check(r)[0] == app and acquire(r) == active, 'build-inputs-changed')
    files = inventory(APP/'.next')
    build_id = (APP/'.next/BUILD_ID').read_text().strip()
    require(bool(build_id), 'build-id')
    write_once(RUN/'build-files.json', files)
    write_once(RUN/'build-result.json', {'schema': 1, 'app': app, 'active': active,
        'resourcesBefore': resources, 'resourcesAfter': end_resources, 'returncode': 0,
        'buildId': build_id, 'buildFilesSha256': sha(RUN/'build-files.json'),
        'buildInventoryDigest': digest(files), 'launcherSha256': sha(ROOT/'app_binding_v1.py'),
        'bindingSha256': sha(ROOT/'binding-private.json'),
        'executables': {name: sha(Path(name)) for name in ['/usr/bin/node', '/usr/bin/npm', '/usr/bin/bwrap']}})


def start():
    bindings(); r = load_recovery(); app, values = app_check(r); active = acquire(r)
    resources = budget(cgroup(), 'start')
    report = read(RUN/'build-result.json')
    require(set(report) == {'schema','app','active','resourcesBefore','resourcesAfter','returncode','buildId',
        'buildFilesSha256','buildInventoryDigest','launcherSha256','bindingSha256','executables'}, 'build-receipt-schema')
    require(report['schema'] == 1 and report['app'] == app and report['active'] == active and
        report['returncode'] == 0, 'build-receipt-binding')
    budget(report['resourcesBefore'], 'build'); budget(report['resourcesAfter'], 'build')
    require(report['bindingSha256'] == sha(ROOT/'binding-private.json') and
            report['launcherSha256'] == sha(ROOT/'app_binding_v1.py'), 'build-code')
    require(report['executables'] == {name: sha(Path(name)) for name in ['/usr/bin/node', '/usr/bin/npm', '/usr/bin/bwrap']}, 'build-tools')
    require(report['buildFilesSha256'] == sha(RUN/'build-files.json') and
        report['buildInventoryDigest'] == digest(read(RUN/'build-files.json')) and
        report['buildInventoryDigest'] == digest(inventory(APP/'.next')) and
        report['buildId'] == (APP/'.next/BUILD_ID').read_text().strip() and bool(report['buildId']), 'build-inventory')
    import memory_storage
    admitted_archive = memory_storage.startup_archive()
    # The API is already occupied by the verified gateway. Probe only the web port.
    with socket.socket() as probe:
        probe.bind((HOST, 3587))
    write_once(RUN/'start-intent.json', {'app': app, 'active': active, 'resources': resources,
        'buildResultSha256': sha(RUN/'build-result.json'), 'buildId': report['buildId'],
        'environmentSha256': sha(APP/'.env.local'), 'argv': confined_argv('start'), 'admittedArchive': admitted_archive})
    # Intent persists on exec failure or lost acknowledgement. No automatic retry.
    ticket=j.begin('npm-start-exec',{'argv':confined_argv('start'),'admittedArchive':admitted_archive,'buildResultSha256':sha(RUN/'build-result.json')})
    try:
        os.execve('/usr/bin/bwrap', confined_argv('start'), environment(values, 'start'))
    except BaseException as error:
        j.failure(ticket,error)
        raise


def main():
    os.umask(0o077)
    # The outer checker uses the default local Docker socket with a private HOME.
    os.environ.clear()
    os.environ.update(PATH='/usr/bin:/bin', HOME=str(ROOT/'tmp'), PYTHONDONTWRITEBYTECODE='1')
    require(len(sys.argv) == 2 and sys.argv[1] in {'checkout','build','start','active-check'}, 'operation')
    try:
        if sys.argv[1] == 'active-check':
            bindings(); r = load_recovery(); app_values(r); acquire(r)
        else:
            {'checkout': checkout, 'build': build, 'start': start}[sys.argv[1]]()
    except BaseException as error:
        # Never print credential-bearing native exceptions or subprocess output.
        print('REFUSED '+sys.argv[1]+': '+(str(error) if type(error) is ValueError else type(error).__name__), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
