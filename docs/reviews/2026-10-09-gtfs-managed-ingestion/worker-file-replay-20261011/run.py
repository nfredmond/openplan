"""Fresh-process replay of copied, encrypted-backup-restored worker files."""
import copy, datetime, hashlib, importlib.util, json, os, shutil, subprocess, time
from pathlib import Path

OUT = Path(__file__).parent
PROOF = OUT.parent
APP = Path('/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan')
HEAD = 'bf1f6ffa710b11b7f36747a676943edab667a4ae'
CONTAINER = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
DATABASE = 'openplan_recovered_2553c3e83129432e86c97cf3aef72aee'
API = 'http://127.74.9.10:29941'
SOURCE = PROOF / 'capacity-20261011-01/worker-private'
BACKUP = PROOF / 'worker-backup-tool-20261011/native-01'
RESTORED = BACKUP / 'restored-private' / SOURCE.relative_to('/')

def require(value, reason):
    if not value:
        raise ValueError(reason)

def scope(head, dirty, settings, container, active, queued):
    require(head == HEAD and not dirty, 'replay-source-scope')
    require(settings['database'] == DATABASE and settings['api_url'] == API, 'replay-target-scope')
    require(container['Id'] == CONTAINER and container['Name'] == '/supabase_db_openplan-restore-target-2026091050', 'replay-container-scope')
    require(container['Config']['Labels'].get('com.supabase.cli.project') == 'openplan-restore-target-2026091050' and container['State']['Running'], 'replay-container-project')
    require(not active, 'replay-original-writer-active')
    require(queued == 0, 'replay-other-work-pending')

def sql(query):
    raw = subprocess.check_output(['docker', 'exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', DATABASE, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', query], text=True)
    return json.loads(raw)

def native():
    tables = sql("SELECT coalesce(json_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname='openplan_gtfs' OR (schemaname='public' AND tablename LIKE 'gtfs_%')")
    result = []
    for table in tables:
        require(all(c.isalnum() or c in '._' for c in table), 'replay-native-table-name')
        value = sql("SELECT json_build_object('count',count(*),'sha256',encode(digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex')) FROM " + table + ' t')
        result.append({'table': table, **value})
    return result

def main():
    os.umask(0o077)
    settings = json.loads((PROOF/'browser-full-restore-02/fresh-services-private.json').read_text())
    info = json.loads(subprocess.check_output(['docker', 'inspect', CONTAINER]))[0]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=APP, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=APP, text=True).strip()
    active = subprocess.check_output(['systemctl', '--user', 'show', 'openplan-gtfs-cta-capacity-20261011-01.service', '-p', 'ActiveState', '--value'], text=True).strip() in ('active', 'activating')
    # Container identity is checked before the first SQL read.
    scope(head, dirty, settings, info, active, 0)
    queued = sql("SELECT to_json(count(*)) FROM openplan_gtfs.executions WHERE state NOT IN ('ready','failed','cancelled')")
    scope(head, dirty, settings, info, active, queued)
    require(RESTORED.resolve() == RESTORED and not RESTORED.stat().st_mode & 0o077, 'replay-restored-root')
    spec = importlib.util.spec_from_file_location('file_probe', PROOF/'probe_worker_file_backup.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    census = json.loads((BACKUP/'source-inventory-private.json').read_text())
    module.equal(census, module.inventory(SOURCE)); module.equal(census, module.inventory(RESTORED))
    before = native(); (OUT/'native-before-private.json').write_text(json.dumps(before, indent=2)+'\n')
    fixture = json.loads((PROOF/'capacity-20261011-01/capacity-native.json').read_text())
    root = OUT/'restored-worker-private'; shutil.copytree(RESTORED, root); root.chmod(0o700)
    candidates = list(root.glob('*/version-'+fixture['versionId']+'/attempt-*/commands'))
    require(len(candidates) == 1, 'replay-command-census')
    commands = candidates[0]; artifact = commands.parent/'artifact'; terminal = commands/'command-terminal/pending.json'
    original = terminal.read_bytes(); expected = json.loads(original)
    require(expected['resolved'] and expected['payload']['operation'] == 'complete', 'replay-original-completion')
    config = {'commands': str(commands), 'artifact': str(artifact), 'target': API, 'versionId': fixture['versionId'], 'feedId': fixture['feedId'], **fixture['expectedBinding'], 'expectedTerminal': expected}
    environment = {k:json.loads(v) for k,v in (line.split('=',1) for line in (PROOF/'browser-full-restore-02/app-runtime-private.env').read_text().splitlines())}
    require(environment['NEXT_PUBLIC_SUPABASE_URL'] == API, 'replay-environment-target')
    environment['NODE_OPTIONS'] = '--max-old-space-size=768'
    effective = {**os.environ, **environment}
    records = []
    def run(label, mode='cached', changed=None, refusal=None):
        path = OUT/(label+'-configuration-private.json'); path.write_text(json.dumps(changed or config))
        started = time.monotonic()
        result = subprocess.run(['/usr/bin/node', '--conditions=react-server', '--import', str(APP/'node_modules/tsx/dist/loader.mjs'), str(OUT/'replay.mts'), str(path), mode], cwd=APP, env=effective, capture_output=True, text=True, timeout=60)
        (OUT/(label+'-private.log')).write_text(result.stdout+result.stderr)
        rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        require(len(rows) == 1, 'replay-child-observation'); row = rows[0]
        if refusal:
            require(result.returncode == 2 and row.get('reason') == refusal, 'replay-intended-refusal')
        else:
            require(result.returncode == 0 and row.get('state') == 'recovered_terminal', 'replay-child-success')
        records.append({'case': label, 'exitCode': result.returncode, 'wallSeconds': round(time.monotonic()-started,3), **row})
        require(native() == before, 'replay-native-records-changed')
        module.equal(census, module.inventory(SOURCE)); module.equal(census, module.inventory(RESTORED))
    run('cached')
    harmless = copy.deepcopy(config); harmless['reviewerNote'] = 'Unrelated recovery note'; run('harmless', changed=harmless)
    try:
        uncertain = copy.deepcopy(expected); uncertain.update(resolved=False, receipt=None); terminal.write_text(json.dumps(uncertain)); terminal.chmod(0o600)
        run('uncertain-native-reply', mode='uncertain')
        require(json.loads(terminal.read_text()) == expected, 'replay-native-receipt-differs')
    finally: terminal.write_bytes(original)
    run('wrong-installation', mode='wrong-installation', refusal='GTFS journal attempt scope differs')
    run('wrong-target', mode='wrong-target', refusal='GTFS journal attempt scope differs')
    wrong_actor = copy.deepcopy(config); wrong_actor['actorId'] = '00000000-0000-4000-8000-000000000000'; run('wrong-original-actor', changed=wrong_actor, refusal='replay-original-actor')
    try:
        foreign = copy.deepcopy(expected); foreign['payload']['arguments']['context']['actorId'] = '00000000-0000-4000-8000-000000000000'; terminal.write_text(json.dumps(foreign)); terminal.chmod(0o600)
        run('foreign-terminal-context', refusal='GTFS retained terminal context differs')
    finally: terminal.write_bytes(original)
    archive = artifact/'archive.zip'
    with archive.open('rb') as f: first = f.read(1)
    try:
        with archive.open('r+b') as f: f.write(bytes([first[0]^255]))
        run('changed-restored-archive', refusal='replay-file-bytes')
    finally:
        with archive.open('r+b') as f: f.write(first)
    run('restored')
    require(native() == before, 'replay-final-native-records-changed')
    module.equal(census, module.inventory(SOURCE)); module.equal(census, module.inventory(RESTORED))
    result = {'sourceHead': HEAD, 'backupSourceHead': fixture['sourceHead'], 'snapshotId': json.loads((BACKUP/'result.json').read_text())['snapshotId'], 'records': records, 'nativeTableCount': len(before), 'nativeBeforeAfterEqual': True, 'originalFilesUnchanged': True, 'backupRestorationUnchanged': True, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'limits': ['Fresh processes use relocated copies of an encrypted-backup restoration on the same physical host.', 'Native server is the original isolated recovered installation, not a database restored together with these files.', 'No physical-host independence, coordinated whole-installation point, SQLite/WAL, new parsing, model computation or agency acceptance.']}
    (OUT/'result.json').write_text(json.dumps(result, indent=2)+'\n');print(json.dumps({'passed': True, 'cases': len(records), 'nativeTablesUnchanged': len(before)}), flush=True)

if __name__ == '__main__': main()
