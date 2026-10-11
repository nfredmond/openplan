"""Restore only the captured point into a fresh owned, bounded local cluster."""
import hashlib, importlib.util, json, os, shutil, subprocess, sys, time
from pathlib import Path
import guards as g

OUT = Path(__file__).parent
PROOF = OUT.parent
POINT = PROOF / 'transit-expanded-local-point-20261011-03'
APP = Path('/home/nathaniel/.local/state/openplan/gtfs-current-main-join-20261011/openplan')
TOOL = PROOF / 'worker-backup-tool-20261011/restic'
VOLUME = 'openplan_gtfs_separate_cluster_20261011_02'
record = {'state': 'prepared', 'commands': [], 'scope': 'Separate cluster on the same host and physical disk; database/roles/key phase only.'}
receipt = None


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


files = load('separate_files', PROOF / 'probe_worker_file_backup.py')
archive = load('separate_archive', APP / 'scripts/ops/full_restore.py')
sys.path.append(str(PROOF / 'transit-coordinated-restore-20261011-03'))
image = load('separate_native_image', PROOF / 'transit-coordinated-restore-20261011-03/run.py')
image.OUT = OUT


def save():
    (OUT / 'progress-private.json').write_text(json.dumps(record, indent=2) + '\n')


def command(args, label, data=None, timeout=180):
    started = time.monotonic()
    environment = {**os.environ, 'GOMAXPROCS': '1', 'GOMEMLIMIT': '512MiB'} if args[0] == str(TOOL) else None
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, env=environment)
    (OUT / (label + '-private.log')).write_bytes(result.stdout + result.stderr)
    record['commands'].append({'name': label, 'exitCode': result.returncode,
                               'wallSeconds': round(time.monotonic() - started, 3)})
    save(); result.check_returncode()
    return result.stdout


def restic(args, label):
    return command([str(TOOL), '--no-cache', '--repo', str(OUT / 'repository-private'),
                    '--password-file', str(OUT / 'password-private'), *args],
                   label, timeout=300)


def inspect():
    return json.loads(subprocess.check_output(['docker', 'inspect', receipt['id']], stderr=subprocess.PIPE))[0]


def main():
    global receipt
    os.umask(0o077); OUT.chmod(0o700)
    started = time.monotonic()
    controls = json.loads((OUT / 'guard-controls.json').read_text())
    original = json.loads((POINT / 'resumed-result.json').read_text())
    g.verify_capture(files.digest(TOOL), original, controls['sourceSha256'], files.digest(OUT / 'guards.py'))
    container_exists = subprocess.run(['docker', 'inspect', g.NAME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    volume_exists = subprocess.run(['docker', 'volume', 'inspect', VOLUME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    free = shutil.disk_usage(OUT).free
    g.verify_unused(container_exists, volume_exists, free, available)
    record['resourceHeadroom'] = {'freeDiskBytes': free, 'availableMemoryBytes': available}
    record['executionSourceSha256'] = {p.name: files.digest(p) for p in OUT.glob('*.py')}
    record['state'] = 'copying-encrypted-point'; save()
    before_repository = files.inventory(POINT / 'repository-private')
    shutil.copytree(POINT / 'repository-private', OUT / 'repository-private')
    files.equal(before_repository, files.inventory(OUT / 'repository-private'))
    shutil.copy2(POINT / 'password-private', OUT / 'password-private')
    restic(['check', '--read-data'], 'encrypted-repository-check')
    restic(['restore', g.SNAPSHOT, '--target', str(OUT / 'restored-private'), '--verify'], 'encrypted-point-restore')
    bundle = POINT / 'source-point-private'
    restored = OUT / 'restored-private' / bundle.relative_to('/')
    census = json.loads((POINT / 'point-file-inventory-private.json').read_text())
    files.equal(census, files.inventory(restored))
    files.equal(census, files.inventory(bundle))
    protected = restored / 'configuration-private'
    roles = (protected / 'roles-private.sql').read_text()
    expected_roles = json.loads((protected / 'roles-inventory-private.json').read_text())
    key = archive._keys.read_key(protected / 'pgsodium-root-private.key', private=True)
    live_key = OUT / 'mounted-root-private.key'
    archive._keys.preserve_key(live_key, key)
    # The captured key stays 0600. A read-only live file under this 0700 private
    # directory permits the container's different PostgreSQL UID to read it.
    live_key.chmod(0o444)
    preload = 'pg_stat_statements,pgaudit,plpgsql,plpgsql_check,pg_cron,pg_net,pgsodium,auto_explain,pg_tle,plan_filter,supabase_vault'
    script = "set -eu\ninstall -d -m 700 -o postgres -g postgres /var/lib/postgresql/data/proof\nif [ ! -f /var/lib/postgresql/data/proof/PG_VERSION ]; then\ngosu postgres initdb -D /var/lib/postgresql/data/proof --username=supabase_admin --encoding=UTF8 --locale-provider=icu --icu-locale=en-US --auth-local=trust --auth-host=scram-sha-256\nfi\nexec gosu postgres postgres -D /var/lib/postgresql/data/proof -c listen_addresses='*' -c shared_preload_libraries=" + preload + " -c pgsodium.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres\n"
    cmd = ['-c', script]
    command(['docker', 'volume', 'create', '--label', 'openplan.purpose=' + g.PURPOSE, VOLUME], 'create-fresh-volume')
    identity = command(['docker', 'create', '--name', g.NAME, '--network', 'none',
                        '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '128',
                        '--label', 'com.supabase.cli.project=' + g.PROJECT,
                        '--label', 'openplan.purpose=' + g.PURPOSE,
                        '--mount', 'type=volume,source=' + VOLUME + ',target=/var/lib/postgresql/data',
                        '--mount', 'type=bind,source=' + str(live_key) + ',target=' + g.KEY + ',readonly',
                        '--entrypoint', 'sh', g.IMAGE, *cmd], 'create-fresh-container').decode().strip()
    receipt = {'id': identity, 'name': g.NAME, 'imageId': g.IMAGE, 'project': g.PROJECT,
               'commandSha256': hashlib.sha256('\n'.join(cmd).encode()).hexdigest()}
    (OUT / 'container-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    g.verify_container(inspect(), receipt, VOLUME, live_key)
    command(['docker', 'start', identity], 'start-new-cluster')
    for _ in range(120):
        status = subprocess.run(['docker', 'exec', identity, 'pg_isready', '-U', g.ADMIN], capture_output=True)
        if status.returncode == 0: break
        if not inspect()['State']['Running']:
            command(['docker', 'logs', identity], 'new-cluster-startup-log')
            raise RuntimeError('New owned database stops before readiness')
        time.sleep(0.5)
    else: raise TimeoutError('New owned cluster readiness expires')
    g.verify_container(inspect(), receipt, VOLUME, live_key)
    image.CONTAINER = identity
    existing = json.loads(archive.sql(identity, 'SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles'))
    prepared = g.prepare_role_sql(roles, files.digest(protected / 'roles-private.sql'), existing, expected_roles)
    record['state'] = 'restoring-captured-roles'; save()
    command(['docker', 'exec', '-i', identity, 'psql', '-Xq', '-U', g.ADMIN, '-d', 'postgres',
             '-v', 'ON_ERROR_STOP=1', '--single-transaction'], 'restore-captured-roles', prepared.encode())
    actual_sql = command(['docker', 'exec', identity, 'pg_dumpall', '-U', g.ADMIN, '--roles-only'], 'restored-role-dump').decode()
    actual_roles = json.loads(archive.role_inventory(identity))
    g.verify_roles(expected_roles, actual_roles, roles, actual_sql)
    archive._keys.require_mounted_bytes(receipt, key)
    binding = archive._keys.inspect_binding(receipt)
    properties = json.loads((protected / 'database-properties-private.json').read_text())
    properties_binding = json.loads((protected / 'properties-binding-private.json').read_text())['target']
    target = properties_binding['target']
    properties_command = (protected / 'target-properties-private.sql').read_bytes()
    g.verify_property_command(target, properties_command, properties_binding)
    g.verify_database_bootstrap(json.loads(archive.sql(identity, 'SELECT json_agg(datname ORDER BY datname) FROM pg_database')))
    args = ['docker', 'exec', identity, 'createdb', '-U', g.ADMIN, '-T', 'template0',
            '--owner', properties['owner'], '--encoding', properties['encoding'],
            '--lc-collate', properties['collate'], '--lc-ctype', properties['ctype'],
            '--locale-provider', 'icu', '--icu-locale', properties['locale'], target]
    command(args, 'create-empty-captured-database')
    record['state'] = 'restoring-captured-database'; save()
    command(['docker', 'exec', '-i', identity, 'pg_restore', '-U', g.ADMIN, '-d', target,
             '--exit-on-error', '--single-transaction'], 'restore-captured-database', (restored / 'postgres.dump').read_bytes())
    command(['docker', 'exec', '-i', identity, 'psql', '-Xq', '-U', g.ADMIN, '-d', 'template1',
             '-v', 'ON_ERROR_STOP=1', '--single-transaction'], 'restore-captured-properties',
            properties_command)
    actual = image.inventory(target, 'fresh-cluster-restored')
    baseline = json.loads((POINT / 'original-before-inventory-private.json').read_text())
    for label, container, database in [('captured-original', 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce', 'openplan_recovered_2553c3e83129432e86c97cf3aef72aee'), ('fresh-target', identity, target)]:
        command(['docker', 'exec', container, 'pg_dump', '-U', g.ADMIN, '-d', database, '--schema-only'], label+'-schema')
    image.equal_image(baseline, actual)
    expected_properties = properties
    actual_properties = archive.database_properties(identity, target)
    g.verify_properties(expected_properties, actual_properties)
    g.verify_roles(expected_roles, json.loads(archive.role_inventory(identity)), roles,
                   command(['docker', 'exec', identity, 'pg_dumpall', '-U', g.ADMIN, '--roles-only'], 'final-role-dump').decode())
    archive._keys.require_mounted_bytes(receipt, key)
    files.equal(census, files.inventory(restored)); files.equal(census, files.inventory(bundle))
    files.equal(before_repository, files.inventory(POINT / 'repository-private'))
    record.update(state='passed-native-database-phase', wallSeconds=round(time.monotonic()-started, 3),
                  snapshotId=g.SNAPSHOT, targetDatabase=target, containerId=identity,
                  capturedFiles=len(census), capturedBytes=sum(row['bytes'] for row in census.values()),
                  tables=len(actual['tables']), sequences=len(actual['sequences']),
                  roles=len(actual_roles['roles']), memberships=len(actual_roles['memberships']),
                  roleAttributesPasswordsAndGrantsEqual=True, independentlyMountedKeyBytesEqual=True,
                  keyRuntimeMode=binding['mode'], keyParentMode=0o700,
                  historicalVaultRows=0, historicalDecryption='not established',
                  physicalStorageAndWorkerFilesByteEqual=True, nativeApiAndCliRecovery='pending',
                  originalCapturedPointUnchanged=True)
    save(); (OUT / 'database-result.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'state': record['state'], 'wallSeconds': record['wallSeconds']}), flush=True)


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        record.update(state='failed', errorType=type(error).__name__)
        save()
        if receipt:
            try:
                g.verify_container(inspect(), receipt, VOLUME, OUT / 'mounted-root-private.key')
                command(['docker', 'logs', receipt['id']], 'failure-native-database-log')
                command(['docker', 'stop', '--time', '10', receipt['id']], 'stop-exact-failed-database')
            except BaseException as cleanup:
                record['cleanupErrorType'] = type(cleanup).__name__; save()
        raise
