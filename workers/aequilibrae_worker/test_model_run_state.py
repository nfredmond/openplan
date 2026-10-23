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

    def test_all_actual_stage_calls_publish_complete_records(self):
        tree = ast.parse(Path(main.__file__).read_text())
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Expr)
                 and isinstance(node.value, ast.Call) and getattr(node.value.func, 'id', None) == 'write_run_state']
        stages = {}
        for node in calls:
            ancestors = []
            parent = parents.get(node)
            while parent is not None:
                ancestors.append(parent)
                parent = parents.get(parent)
            self.assertEqual(next(parent.name for parent in ancestors if isinstance(parent, ast.FunctionDef)),
                             '_claim_and_run_stage')
            stage = next((parent.test.comparators[0].value for parent in ancestors
                          if isinstance(parent, ast.If) and isinstance(parent.test, ast.Compare)
                          and isinstance(parent.test.left, ast.Name) and parent.test.left.id == 'stage_name'
                          and len(parent.test.ops) == 1 and isinstance(parent.test.ops[0], ast.Eq)
                          and len(parent.test.comparators) == 1
                          and isinstance(parent.test.comparators[0], ast.Constant)), None)
            self.assertNotIn(stage, stages, f'Duplicate state publication in {stage}')
            stages[stage] = node
            if stage == 'Artifact Extraction':
                managed_guard = ast.dump(ast.parse('admitted is not None', mode='eval').body)
                self.assertTrue(any(isinstance(parent, ast.If) and ast.dump(parent.test) == managed_guard
                                    for parent in ancestors),
                                'Artifact Extraction publication must stay managed-only')
        self.assertCountEqual(stages, ['AequilibraE Setup', 'Network Assignment',
                                      'Artifact Extraction', 'ActivitySim Network Assignment'],
                              'Exact run-state stage publication census differs')
        for stage, node in stages.items():
            scope = dict(vars(main), work_dir=str(self.root), result={'engine': 'synthetic'},
                package_meta={'source': 'synthetic'}, state={'setup': {'engine': 'setup'},
                'package': {'source': 'retained'}, 'assignment': {'value': 8},
                'activitysim_assignment': {'value': 11}})
            code = compile(ast.Module(body=[node], type_ignores=[]), main.__file__, 'exec')
            exec(code, scope)
            expected = {'setup': scope['result'], 'package': scope['package_meta']} if stage == 'AequilibraE Setup' else scope['state']
            self.assertEqual(json.loads(self.path.read_text()), expected, f'Complete retained state differs for {stage}')
            with patch.object(subject.os, 'replace', side_effect=OSError('interrupted')):
                with self.assertRaises(main.WorkerStateWriteUnconfirmed): exec(code, scope)
            self.assertEqual(json.loads(self.path.read_text()), expected)

if __name__ == '__main__': unittest.main()
