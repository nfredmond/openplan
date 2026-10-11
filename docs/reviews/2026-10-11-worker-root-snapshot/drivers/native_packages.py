"""Run the supported root CLI on five retained roots without starting services."""
import hashlib, importlib.util, json, os, shutil, subprocess, sys, time
from pathlib import Path
OUT = Path(__file__).parent
BASE = OUT.parents[1]
REPO = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
SOURCE = BASE / 'managed-stage-point-20261011-01/source-seed-03'
BUNDLE = SOURCE / 'point-private'
ROOTS = ['managed-stage-worker-private', 'model-worker-private', 'gtfs-configured', 'gtfs-replacement', 'gtfs-capacity']

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    os.umask(0o077)
    started = time.monotonic()
    helper = BASE / 'probe_worker_file_backup.py'
    root_path = REPO / 'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py'
    operator = REPO / 'openplan/scripts/ops/worker_root_snapshot.py'
    journal_operator = operator.with_name('worker_journal_snapshot.py')
    files = load('package_files', helper)
    root = load('package_root', root_path)
    dependencies = [Path(__file__), helper, root_path, operator, journal_operator]
    binding = {str(path): files.digest(path) for path in dependencies}
    (OUT / 'pre-execution-source-private.json').write_text(json.dumps(binding, indent=2) + '\n')
    archive = OUT / 'executed-source-private'
    archive.mkdir(mode=0o700)
    for index, path in enumerate(dependencies):
        (archive / (str(index) + '-' + path.name)).write_bytes(path.read_bytes())
    expected = json.loads((SOURCE / 'point-file-inventory-private.json').read_text())
    files.equal(expected, files.inventory(BUNDLE))
    root_before = {name: root.inventory(BUNDLE / name) for name in ROOTS}
    logical = {name: {path: root.sqlite_image(BUNDLE / name / path) for path, row in rows.items() if row['kind'] == 'file' and Path(path).name == 'model-commands.sqlite3'} for name, rows in root_before.items()}
    packages = OUT / 'packages-private'
    packages.mkdir(mode=0o700)
    records = []
    for name in ROOTS:
        destination = packages / name
        summaries = []
        for label, arguments in [('capture', ['--source', str(BUNDLE / name), '--writers-quiesced']), ('verify', ['--verify'])]:
            result = subprocess.run([sys.executable, '-B', str(operator), '--destination', str(destination), '--timeout', '120', *arguments], cwd=REPO / 'openplan', capture_output=True, timeout=150)
            (OUT / (name + '-' + label + '-private.log')).write_bytes(result.stdout + result.stderr)
            result.check_returncode()
            summaries.append(json.loads(result.stdout))
        retained = root.inventory(destination / 'root')
        # Native backup can normalize SQLite page metadata. Every path, mode
        # and ordinary byte remains exact, while every SQLite row is compared.
        original_paths = {path: dict(row) for path, row in root_before[name].items()}
        retained_paths = {path: dict(row) for path, row in retained.items()}
        for path in logical[name]:
            for path_rows in (original_paths, retained_paths):
                path_rows[path].pop('bytes')
                path_rows[path].pop('sha256')
        root.equal_root(original_paths, retained_paths)
        for relative, image in logical[name].items():
            root.equal_journal(image, root.sqlite_image(destination / 'root' / relative))
        record = json.loads((destination / 'snapshot.json').read_text())
        records.append({'root': name, 'files': sum(row['kind']=='file' for row in retained.values()), 'directories': sum(row['kind']=='directory' for row in retained.values()), 'bytes': sum(row.get('bytes', 0) for row in retained.values()), 'sqliteCopies': len(record['sqliteCopies']), 'manifestSha256': files.digest(destination / 'snapshot.json'), 'cliSummaries': summaries, 'completeCensusAndAllLogicalRecordsEqual': True})
    files.equal(expected, files.inventory(BUNDLE))
    for name in ROOTS:
        root.equal_root(root_before[name], root.inventory(BUNDLE / name))
    files.equal(binding, {str(path): files.digest(path) for path in dependencies})
    runtime = OUT / 'runtime-point-private'
    shutil.copytree(BUNDLE, runtime)
    for name in ROOTS:
        # Runtime can mutate only fresh copies. Immutable packages remain intact.
        shutil.rmtree(runtime / name)
        shutil.copytree(packages / name / 'root', runtime / name)
    runtime_inventory = files.inventory(runtime)
    allowed = {name + '/' + path for name in ROOTS for path in logical[name]}
    ordinary_expected = {path: row for path, row in expected.items() if path not in allowed}
    ordinary_actual = {path: row for path, row in runtime_inventory.items() if path not in allowed}
    files.equal(ordinary_expected, ordinary_actual)
    for name in ROOTS:
        root.equal_root(root.inventory(packages / name / 'root'), root.inventory(runtime / name))
        for path, image in logical[name].items():
            root.equal_journal(image, root.sqlite_image(runtime / name / path))
    (OUT / 'runtime-before-private.json').write_text(json.dumps(files.inventory(runtime), indent=2) + '\n')
    (OUT / 'packages-before-private.json').write_text(json.dumps(files.inventory(packages), indent=2) + '\n')
    result = {'state': 'passed-supported-root-packaging', 'roots': records, 'sourcePointFiles': len(expected), 'sourcePointUnchanged': True, 'allDependenciesUnchanged': True, 'freshRuntimeMatchesPackagesAndOrdinaryPointBytes': True, 'wallSeconds': round(time.monotonic()-started, 3), 'scope': 'Five known retained roots on this host. Source model journals were already normalized by the accepted coordinated point; populated/crashed WAL coverage is in native unit tests. Does not discover all installation roots, fence workers, repeat coordinated capture, resume models or prove host-loss/scientific/hosted acceptance.'}
    (OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ('state', 'sourcePointFiles', 'sourcePointUnchanged', 'freshRuntimeMatchesPackagesAndOrdinaryPointBytes', 'wallSeconds')}))

if __name__ == '__main__':
    main()
