"""Native known-root and populated-journal controls. No server or engine is called."""
import ast
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

import worker_root as root_helper

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
import model_legacy_kpi_command as kpi
import model_stage_computation as stage

SOURCE = Path(root_helper.__file__)
SCOPE = {'base_url': 'http://127.0.0.1:49191', 'deployment_id': 'synthetic-root-controls-only'}
RUN = 'c6a9497f-1551-45dd-9b49-eab6a7f25e6b'
STAGE = 'd68fb2cb-3353-4dd8-9acd-cb3d6ec8c8eb'
WORKSPACE = 'ead5db80-7bde-44f4-a156-8cde0f00b7ae'


def refused(function, reason):
    try:
        function()
    except ValueError as error:
        if str(error) == reason:
            return
        raise AssertionError('Wrong root refusal: ' + str(error)) from error
    raise AssertionError('Missing root refusal: ' + reason)


def main(out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    root = out / 'worker-before'
    root.mkdir(mode=0o700)
    for name in ('inputs', 'outputs', 'scratch/empty', 'commands', 'stages'):
        (root / name).mkdir(mode=0o700, parents=True)
    (root / 'state.json').write_text(json.dumps({'synthetic': True, 'scientificAcceptance': 'unassessed'}) + '\n')
    (root / 'inputs/source.bin').write_bytes(bytes(range(256)))
    (root / 'outputs/result.json').write_bytes(b'{"synthetic":true,"model_resumed":false}\n')
    (root / 'commands/model-commands.sqlite3-notes.json').write_bytes(b'{"synthetic_note":true}\n')
    keepers = []
    records = []
    original = SOURCE.read_bytes()
    def check(name, function):
        function()
        records.append({'case': name, 'passed': True})
    try:
        for name in ('commands', 'stages'):
            directory = root / name
            keeper = journal.connect(directory)
            keeper.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            keeper.execute('PRAGMA wal_autocheckpoint=0')
            keepers.append(keeper)
            payload = {'run_id': RUN, 'stage_id': STAGE, 'kpi_name': 'fixture',
                       'kpi_label': 'Synthetic local journal control', 'kpi_category': 'general',
                       'value': 0, 'unit': 'fixture', 'geometry_ref': None, 'breakdown_json': None}
            kpi.prepare(directory, WORKSPACE, payload, name='pending', **SCOPE)
            resolved = kpi.prepare(directory, WORKSPACE, payload, name='resolved', **SCOPE)
            # This is explicitly a local journal fixture, never server acceptance.
            journal.resolve(directory, resolved, {'synthetic_local_receipt': True})
            args = {**SCOPE, 'run_id': RUN, 'stage_id': STAGE, 'inputs': {'synthetic': True}}
            stage.compute_once(directory, **args, name='completed', compute=lambda: {'fixture': True})
            def interrupted():
                raise RuntimeError('Synthetic interrupted callback')
            try:
                stage.compute_once(directory, **args, name='interrupted', compute=interrupted)
            except RuntimeError as error:
                if str(error) != 'Synthetic interrupted callback':
                    raise
        logical = {name: root_helper.sqlite_image(root / name / 'model-commands.sqlite3')
                   for name in ('commands', 'stages')}
        for name in logical:
            root_helper.equal_journal(json.loads(json.dumps(logical[name])), logical[name])
        snapshots = out / 'journal-snapshots'
        snapshots.mkdir(mode=0o700)
        for name in logical:
            result = subprocess.run([sys.executable, '-B', str(REPO / 'openplan/scripts/ops/worker_journal_snapshot.py'),
                                     '--source', str(root / name / 'model-commands.sqlite3'),
                                     '--destination', str(snapshots / name), '--writers-quiesced'],
                                    capture_output=True, timeout=10)
            (out / (name + '-snapshot.log')).write_bytes(result.stdout + result.stderr)
            result.check_returncode()
            root_helper.equal_journal(logical[name], root_helper.sqlite_image(snapshots / name / 'model-commands.sqlite3'))
        captured = out / 'worker-captured'
        def omit_sidecars(directory, names):
            if Path(directory) in {root / 'commands', root / 'stages'}:
                return [name for name in names if name in {'model-commands.sqlite3', 'model-commands.sqlite3-wal', 'model-commands.sqlite3-shm'}]
            return []
        shutil.copytree(root, captured, ignore=omit_sidecars)
        for name in logical:
            shutil.copy2(snapshots / name / 'model-commands.sqlite3', captured / name / 'model-commands.sqlite3')
        expected = root_helper.inventory(captured)
        assert {name for name, row in expected.items() if row['kind'] == 'directory'} == {'.', 'inputs', 'outputs', 'scratch', 'scratch/empty', 'commands', 'stages'}, 'Known empty-directory census differs'
        assert {name for name, row in expected.items() if row['kind'] == 'file'} == {'state.json', 'inputs/source.bin', 'outputs/result.json', 'commands/model-commands.sqlite3', 'stages/model-commands.sqlite3', 'commands/model-commands.sqlite3-notes.json'}, 'Known file census differs'
        restored = out / 'worker-restored'
        shutil.copytree(captured, restored)
        check('baseline', lambda: root_helper.equal_root(expected, root_helper.inventory(restored)))
        check('harmless-serialization', lambda: root_helper.equal_root(json.loads(json.dumps(expected, indent=4, sort_keys=True)), root_helper.inventory(restored)))
        for name, relative in [('missing-input', 'inputs/source.bin'), ('missing-output', 'outputs/result.json')]:
            path = restored / relative
            data = path.read_bytes()
            try:
                path.unlink()
                check(name, lambda: refused(lambda: root_helper.equal_root(expected, root_helper.inventory(restored)), 'model-point-worker-root-differs'))
            finally:
                path.write_bytes(data)
        empty = restored / 'scratch/empty'
        try:
            empty.rmdir()
            check('missing-empty-directory', lambda: refused(lambda: root_helper.equal_root(expected, root_helper.inventory(restored)), 'model-point-worker-root-differs'))
        finally:
            empty.mkdir(mode=0o700)
        for name, relative, mode in [('changed-file-mode', 'inputs/source.bin', 0o400), ('changed-directory-mode', 'scratch/empty', 0o500)]:
            path = restored / relative
            before = path.stat().st_mode & 0o777
            try:
                path.chmod(mode)
                check(name, lambda: refused(lambda: root_helper.equal_root(expected, root_helper.inventory(restored)), 'model-point-worker-root-differs'))
            finally:
                path.chmod(before)
        for name, query in [('missing-command-receipt', 'UPDATE commands SET response_json=NULL'),
                            ('missing-interrupted-start', 'DELETE FROM stage_computations WHERE result_json IS NULL'),
                            ('changed-installation', "UPDATE commands SET destination='foreign'")]:
            path = restored / 'commands/model-commands.sqlite3'
            before = path.read_bytes()
            try:
                with closing(sqlite3.connect(path)) as connection, connection:
                    connection.execute(query)
                check(name, lambda: refused(lambda: root_helper.equal_journal(logical['commands'], root_helper.sqlite_image(path)), 'model-point-journal-records-differ'))
            finally:
                path.write_bytes(before)
        path = restored / 'commands/model-commands.sqlite3'
        before = path.read_bytes()
        try:
            shutil.copyfile(root / 'commands/model-commands.sqlite3', path)
            check('main-file-copy-loses-wal', lambda: refused(lambda: root_helper.equal_journal(logical['commands'], root_helper.sqlite_image(path)), 'model-point-journal-records-differ'))
        finally:
            path.write_bytes(before)
            # The deliberately copied WAL-mode main file creates these on its
            # read. They are absent from the restored DELETE-mode baseline.
            for suffix in ('-wal', '-shm'):
                path.with_name(path.name + suffix).unlink(missing_ok=True)
        corrupt = out / 'corrupt.sqlite3'
        with closing(sqlite3.connect(corrupt)) as connection, connection:
            connection.executescript('CREATE TABLE probe(a INTEGER); CREATE INDEX probe_index ON probe(a); INSERT INTO probe VALUES(7);')
            page = connection.execute("SELECT rootpage FROM sqlite_schema WHERE name='probe_index'").fetchone()[0]
            size = connection.execute('PRAGMA page_size').fetchone()[0]
        data = bytearray(corrupt.read_bytes())
        offset = (page - 1) * size
        cell = int.from_bytes(data[offset + 8:offset + 10], 'big')
        assert data[offset + cell:offset + cell + 5] == b'\x04\x03\x01\x09\x07', 'Native index fixture differs'
        data[offset + cell + 4] = 8
        corrupt.write_bytes(data)
        check('corrupt-native-index', lambda: refused(lambda: root_helper.sqlite_image(corrupt), 'model-point-journal-integrity'))
        with tempfile.TemporaryDirectory(dir=out, prefix='root-mutant-') as temporary:
            copied = Path(temporary) / 'worker_root.py'
            for name, target in [('omit-root-comparison', 'model-point-worker-root-differs'),
                                 ('omit-record-comparison', 'model-point-journal-records-differ'),
                                 ('omit-integrity', 'model-point-journal-integrity')]:
                tree = ast.parse(original.decode())
                guards = [node for node in ast.walk(tree) if isinstance(node, ast.If)
                          and any(isinstance(child, ast.Raise) and isinstance(child.exc, ast.Call)
                                  and child.exc.args and isinstance(child.exc.args[0], ast.Constant)
                                  and child.exc.args[0].value == target for child in node.body)]
                assert len(guards) == 1
                guards[0].test = ast.Constant(False)
                text = ast.unparse(ast.fix_missing_locations(tree))
                copied.write_text(text)
                namespace = {'__file__': str(SOURCE)}
                exec(compile(text, str(copied), 'exec'), namespace)
                if name == 'omit-root-comparison':
                    probe = lambda: namespace['equal_root'](expected, {})
                elif name == 'omit-record-comparison':
                    probe = lambda: namespace['equal_journal'](logical['commands'], {})
                else:
                    probe = lambda: namespace['sqlite_image'](corrupt)
                try:
                    refused(probe, target)
                except AssertionError as error:
                    if str(error) != 'Missing root refusal: ' + target:
                        raise
                    records.append({'case': name, 'intendedAssertion': str(error)})
                else:
                    raise AssertionError('Broken root guard survived: ' + name)
                finally:
                    copied.write_bytes(original)
            text = original.decode()
            assignment = "result[key] = {'kind': 'directory', 'mode': stat.S_IMODE(info.st_mode)}"
            assert text.count(assignment) == 1
            text = text.replace(assignment, 'pass')
            copied.write_text(text)
            namespace = {'__file__': str(SOURCE)}
            exec(compile(text, str(copied), 'exec'), namespace)
            try:
                refused(lambda: root_helper.equal_root(expected, namespace['inventory'](restored)), 'model-point-worker-root-differs')
                records.append({'case': 'omit-directory-census', 'intendedAssertion': 'model-point-worker-root-differs'})
            finally:
                copied.write_bytes(original)
            for name, before, after in [
                ('omit-schema-json-shape', "[list(row) for row in connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')]", "connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()"),
                ('omit-row-json-shape', "[list(row) for row in connection.execute('SELECT * FROM ' + quoted)]", "connection.execute('SELECT * FROM ' + quoted).fetchall()"),
            ]:
                text = original.decode()
                assert text.count(before) == 1
                text = text.replace(before, after)
                copied.write_text(text)
                namespace = {'__file__': str(SOURCE)}
                exec(compile(text, str(copied), 'exec'), namespace)
                try:
                    actual = namespace['sqlite_image'](restored / 'commands/model-commands.sqlite3')
                    refused(lambda: root_helper.equal_journal(json.loads(json.dumps(actual)), actual), 'model-point-journal-records-differ')
                    records.append({'case': name, 'intendedAssertion': 'model-point-journal-records-differ'})
                finally:
                    copied.write_bytes(original)
        root_helper.equal_root(expected, root_helper.inventory(restored))
        for name in logical:
            root_helper.equal_journal(logical[name], root_helper.sqlite_image(restored / name / 'model-commands.sqlite3'))
        check('restored', lambda: root_helper.equal_root(expected, root_helper.inventory(captured)))
        (out / 'root-inventory-private.json').write_text(json.dumps(expected, indent=2) + '\n')
        result = {'state': 'passed-native-root-controls', 'cases': records,
                  'files': sum(row['kind'] == 'file' for row in expected.values()),
                  'directories': sum(row['kind'] == 'directory' for row in expected.values()),
                  'populatedJournals': len(logical), 'journalSnapshotMapping': {name + '/model-commands.sqlite3': name for name in logical},
                  'localFixtureReceipt': 'synthetic, no server checked',
                  'sourceSha256': hashlib.sha256(original).hexdigest(),
                  'driverSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'limits': 'Known local root only, including empty directories and private modes. SQLite page bytes are normalized by the actual snapshot CLI; logical rows match. No concurrent writers, hostile path race, server custody, coordinated database point, engine or physical-host acceptance.'}
        (out / 'root-controls.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({key: result[key] for key in ('state', 'files', 'directories', 'populatedJournals')}))
    finally:
        for keeper in keepers:
            keeper.close()
        if SOURCE.read_bytes() != original:
            raise AssertionError('Worker root source changed')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
