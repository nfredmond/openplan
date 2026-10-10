"""Atomic run handoff publication and its actual normal-stage call sites."""
import ast
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_run_state as subject
from worker_import_for_tests import import_worker_main
main = import_worker_main()


class RunStateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.path = self.root / 'state.json'
        self.path.write_text('{"previous":true}')

    def test_complete_replacement_flushes_file_then_directory(self):
        original_fsync = subject.os.fsync; original_replace = subject.os.replace
        events = []
        def sync(descriptor):
            events.append('sync'); return original_fsync(descriptor)
        def replace(source, destination):
            self.assertEqual(json.loads(self.path.read_text()), {'previous': True})
            self.assertEqual(json.loads(Path(source).read_text()), {'assignment': {'value': 4}})
            events.append('replace'); return original_replace(source, destination)
        with patch.object(subject.os, 'fsync', side_effect=sync), patch.object(subject.os, 'replace', side_effect=replace):
            main.write_run_state(str(self.root), {'assignment': {'value': 4}})
        self.assertEqual(events, ['sync', 'replace', 'sync'])
        self.assertEqual(json.loads(self.path.read_text()), {'assignment': {'value': 4}})
        self.assertEqual([p.name for p in self.root.iterdir()], ['state.json'])

    def test_failures_before_publication_preserve_old_state(self):
        for field in ('fsync', 'replace'):
            with self.subTest(field=field), patch.object(subject.os, field, side_effect=OSError('private detail')):
                with self.assertRaises(main.WorkerStateWriteUnconfirmed) as error:
                    main.write_run_state(str(self.root), {'new': True})
                self.assertNotIn('private detail', str(error.exception))
            self.assertEqual(self.path.read_text(), '{"previous":true}')
            self.assertEqual([p.name for p in self.root.iterdir()], ['state.json'])
        for invalid in ([], {'bad': float('nan')}):
            with self.assertRaises(main.WorkerStateWriteUnconfirmed): main.write_run_state(str(self.root), invalid)
            self.assertEqual(self.path.read_text(), '{"previous":true}')

    def test_directory_sync_failure_reports_uncertainty_after_complete_replace(self):
        with patch.object(subject.os, 'fsync', side_effect=[None, OSError('directory sync failed')]):
            with self.assertRaises(main.WorkerStateWriteUnconfirmed): main.write_run_state(str(self.root), {'new': True})
        self.assertEqual(json.loads(self.path.read_text()), {'new': True})
        self.assertEqual([p.name for p in self.root.iterdir()], ['state.json'])

    def test_fresh_process_loss_exposes_only_complete_old_or_new_state(self):
        import subprocess
        import sys
        for boundary, expected in [('replace', {'previous': True}), ('directory-sync', {'new': True})]:
            with self.subTest(boundary=boundary):
                self.path.write_text('{"previous":true}')
                code = """import os,sys
import model_run_state as state
root,boundary=sys.argv[1:]
original=state.os.fsync
calls=0
def sync(fd):
 global calls
 calls+=1
 if boundary=='directory-sync' and calls==2: os._exit(19)
 original(fd)
state.os.fsync=sync
if boundary=='replace': state.os.replace=lambda *_:os._exit(19)
state.publish(root,{'new':True})
"""
                run = subprocess.run([sys.executable, '-B', '-c', code, str(self.root), boundary],
                    cwd=Path(__file__).parent, capture_output=True, text=True, timeout=15)
                self.assertEqual(run.returncode, 19, run.stderr)
                self.assertEqual(json.loads(self.path.read_text()), expected)

    def test_all_three_actual_stage_calls_publish_complete_records(self):
        tree = ast.parse(Path(main.__file__).read_text())
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Expr)
                 and isinstance(node.value, ast.Call) and getattr(node.value.func, 'id', None) == 'write_run_state']
        self.assertEqual(len(calls), 3)
        for node in calls:
            scope = dict(vars(main), work_dir=str(self.root), result={'engine': 'synthetic'},
                package_meta={'source': 'synthetic'}, state={'setup': {}, 'assignment': {'value': 8}})
            code = compile(ast.Module(body=[node], type_ignores=[]), main.__file__, 'exec')
            exec(code, scope)
            expected = {'setup': scope['result'], 'package': scope['package_meta']} if isinstance(node.value.args[1], ast.Dict) else scope['state']
            self.assertEqual(json.loads(self.path.read_text()), expected)
            with patch.object(subject.os, 'replace', side_effect=OSError('interrupted')):
                with self.assertRaises(main.WorkerStateWriteUnconfirmed): exec(code, scope)
            self.assertEqual(json.loads(self.path.read_text()), expected)

if __name__ == '__main__': unittest.main()
