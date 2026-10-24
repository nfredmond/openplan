"""Real local transactions and process boundaries; injected database transport.

These checks do not prove native claim locking, filesystem ownership, engine
execution or continuation authorization.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

import model_attempt_invocation as invocation
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, receipt, IDS, URL, STAMP
from test_model_command_ownership import snapshot


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'
        self.cmd = command()
        self.handler = Mock(return_value='completed synthetic handler')
        self.post = Mock(return_value=Mock(status_code=200, json=Mock(return_value=receipt(self.cmd))))
        self.get = Mock(return_value=Mock(status_code=200, json=Mock(return_value=[snapshot()])))

    def invoke(self):
        return invocation._invoke_fresh_claim(self.directory, self.cmd, workspace_id=IDS[4],
            base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
            handler=self.handler, post=self.post, get=self.get)

    def entered(self):
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection:
            return connection.execute('SELECT entered FROM execution_admissions').fetchall()

    def test_claim_and_admission_precede_transport_and_callback(self):
        def post(*args, **kwargs):
            self.assertEqual(self.entered(), [(0,)])
            self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)
            return Mock(status_code=200, json=Mock(return_value=receipt(self.cmd)))
        self.post.side_effect = post
        def handler(context):
            self.assertEqual(self.entered(), [(1,)])
            self.assertEqual(context, invocation.AttemptContext(self.cmd['destination'], IDS[4],
                             IDS[1], IDS[2], IDS[3], IDS[0]))
            return 'completed synthetic handler'
        self.handler.side_effect = handler
        self.assertEqual(self.invoke(), 'completed synthetic handler')
        self.handler.assert_called_once()
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.post.assert_called_once()
        self.get.assert_called_once()
        self.handler.assert_called_once()

    def test_lost_claim_recovery_never_admits_handler(self):
        self.post.side_effect = TimeoutError('synthetic-secret')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.invoke()
        self.assertEqual(self.entered(), [(0,)])
        self.get.assert_not_called()
        self.handler.assert_not_called()
        # The existing delivery client may recover the exact receipt. Admission
        # must remain closed even after that recovery makes the journal resolved.
        client.deliver(self.directory, self.cmd, base_url=URL, deployment_id='synthetic',
            service_key='synthetic-secret', post=Mock(return_value=Mock(status_code=200,
            json=Mock(return_value=receipt(self.cmd)))))
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.handler.assert_not_called()
        self.post.assert_called_once()

    def test_existing_command_without_admission_cannot_be_promoted(self):
        journal.prepare(self.directory, self.cmd)
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.post.assert_not_called()
        self.handler.assert_not_called()

    def test_declined_claim_has_no_ownership_read_or_execution(self):
        self.post.return_value.json.return_value = {**receipt(self.cmd), 'outcome': 'not_claimed', 'attempt_id': None}
        self.assertIsNone(self.invoke())
        self.get.assert_not_called()
        self.handler.assert_not_called()
        self.assertEqual(self.entered(), [(0,)])

    def test_revoked_or_unconfirmed_ownership_never_runs_or_writes_failure(self):
        revoked = snapshot()
        revoked['active_attempt_id'] = None
        self.get.return_value.json.return_value = [revoked]
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.handler.assert_not_called()
        self.post.assert_called_once()
        self.assertEqual(self.entered(), [(0,)])
        self.directory = Path(self.temp.name) / 'unconfirmed'
        self.get.side_effect = TimeoutError('synthetic-secret')
        with self.assertRaises(client.OwnershipUnconfirmed):
            self.invoke()
        self.handler.assert_not_called()
        self.assertEqual(self.entered(), [(0,)])

    def test_handler_process_loss_leaves_consumed_admission_for_fresh_process(self):
        self.handler.side_effect = SystemExit('synthetic process loss')
        with self.assertRaises(SystemExit):
            self.invoke()
        self.assertEqual(self.entered(), [(1,)])
        program = '''
import json,sys
from pathlib import Path
from unittest.mock import Mock
import model_attempt_invocation as m
cmd=json.loads(sys.argv[2])
transport=Mock(side_effect=AssertionError('replayed transport'))
handler=Mock(side_effect=AssertionError('replayed computation'))
try:
 m._invoke_fresh_claim(Path(sys.argv[1]),cmd,workspace_id=sys.argv[3],base_url=sys.argv[4],deployment_id='synthetic',service_key='synthetic-secret',handler=handler,post=transport,get=transport)
except m.ReconciliationRequired:
 transport.assert_not_called();handler.assert_not_called()
else:
 raise AssertionError('Fresh process admitted saved claim')
'''
        result = subprocess.run([sys.executable, '-B', '-c', program, str(self.directory),
            json.dumps(self.cmd), IDS[4], URL], cwd=Path(__file__).parent, text=True,
            capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.post.assert_called_once()

    def test_competing_local_invocations_have_one_transport_and_handler(self):
        def compete():
            try:
                return self.invoke()
            except invocation.ReconciliationRequired:
                return 'refused'
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: compete(), range(2)))
        self.assertCountEqual(results, ['completed synthetic handler', 'refused'])
        self.post.assert_called_once()
        self.handler.assert_called_once()
        self.assertEqual(self.entered(), [(1,)])

    def test_invalid_destination_refuses_without_local_or_remote_changes(self):
        self.cmd['destination'] = client.destination(URL, 'different-installation')
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertFalse(self.directory.exists())
        self.post.assert_not_called()
        self.handler.assert_not_called()

    def test_new_attempt_never_reuses_retained_claim_identity(self):
        journal.prepare(self.directory, self.cmd)
        journal.resolve(self.directory, self.cmd, receipt(self.cmd))
        requests = []
        def post(*args, **kwargs):
            request_id = kwargs['json']['p_request_id']
            requests.append(request_id)
            return Mock(status_code=200, json=Mock(return_value={
                'request_id': request_id, 'run_id': IDS[1], 'stage_id': IDS[2],
                'outcome': 'not_claimed', 'attempt_id': None}))
        for _ in range(2):
            self.assertIsNone(invocation.invoke_new_attempt(self.directory, run_id=IDS[1],
                stage_id=IDS[2], worker_id='synthetic-worker', workspace_id=IDS[4],
                base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
                handler=self.handler, post=post, get=self.get))
        self.assertEqual(len(set(requests)), 2)
        self.assertNotIn(self.cmd['request_id'], requests)
        self.get.assert_not_called()
        self.handler.assert_not_called()




class QueuedDispatchTests(unittest.TestCase):
    """Production admission join with real local journal and injected transport."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name) / 'commands'
        self.stage = {'id': IDS[2], 'run_id': IDS[1], 'stage_name': 'Synthetic owned stage', 'updated_at': STAMP}
        self.command = command()
        running = snapshot()
        self.queued = {**running, 'stage_name': self.stage['stage_name'], 'status': 'queued', 'updated_at': STAMP,
                       'active_attempt_id': None, 'model_runs': {**running['model_runs'], 'status': 'queued'}}
        self.get = Mock(side_effect=lambda *args, **kwargs: Mock(status_code=200,
            json=lambda: self.queued and ([self.queued] if 'stage_name' in kwargs.get('params', {}).get('select', '') else [running])))
        self.post = Mock(return_value=Mock(status_code=200, json=lambda: receipt(self.command)))
        self.handler = Mock(side_effect=self.bound_handler)

    def bound_handler(self, stage):
        import model_attempt_writer as managed
        writer = managed.current()
        self.assertIsNotNone(writer)
        self.actual_directory = writer.directory
        self.assertEqual(stage, self.stage)
        self.assertEqual(writer.context.attempt_id, IDS[3])
        self.assertEqual(writer.context.workspace_id, IDS[4])
        writer.require_open()
        return True

    def invoke(self, request_id=None):
        from unittest.mock import patch
        with patch.object(invocation.uuid, 'uuid4', return_value=request_id or self.command['request_id']):
            return invocation.dispatch_queued_stage(self.directory, self.stage, base_url=URL,
                deployment_id='synthetic', service_key='synthetic-secret', worker_id='synthetic-worker',
                handler=self.handler, get=self.get, post=self.post)

    def test_production_join_reads_scope_then_claims_and_binds_consumed_admission(self):
        self.assertTrue(self.invoke())
        self.handler.assert_called_once()
        projection = self.get.call_args_list[0].kwargs['params']
        self.assertEqual(projection['id'], 'eq.' + IDS[2])
        self.assertEqual(projection['run_id'], 'eq.' + IDS[1])
        self.assertEqual(projection['select'], 'id,run_id,stage_name,status,updated_at,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)')
        import model_attempt_writer as managed
        self.assertIsNone(managed.current())
        self.assertEqual(journal.pending(self.actual_directory, self.command['destination']), [])

    def test_changed_or_unreadable_scope_never_claims(self):
        for change in ({'stage_name': 'Wrong producer'}, {'attempt_managed': False}, {'run_id': IDS[4]}):
            with self.subTest(change=change):
                original = dict(self.queued)
                self.queued.update(change)
                with self.assertRaises(invocation.ReconciliationRequired): self.invoke()
                self.queued.clear(); self.queued.update(original)
        self.post.assert_not_called(); self.handler.assert_not_called()

    def test_stale_queued_version_never_claims(self):
        self.queued['updated_at'] = '2026-10-08T20:00:00+00:00'
        self.assertIsNone(self.invoke())
        self.post.assert_not_called(); self.handler.assert_not_called()

    def test_changed_active_stage_never_claims(self):
        self.queued['active_attempt_id'] = IDS[3]
        self.assertIsNone(self.invoke())
        self.post.assert_not_called(); self.handler.assert_not_called()

    def test_unknown_claim_blocks_fresh_claim_and_computation(self):
        self.post.side_effect = TimeoutError('synthetic transport loss')
        with self.assertRaises(client.DeliveryUnconfirmed): self.invoke()
        self.post.reset_mock()
        with self.assertRaisesRegex(invocation.ReconciliationRequired, 'Saved uncertain'):
            self.invoke('00000009-1111-4111-8111-111111111111')
        self.post.assert_not_called(); self.handler.assert_not_called()



class AequilibraeStageJoinTests(unittest.TestCase):
    """Execute the existing entry body with synthetic handlers, never an engine."""
    def setUp(self):
        import ast
        import datetime
        import os
        import threading
        import time
        from types import SimpleNamespace
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = temporary.name
        tree = ast.parse(Path(__file__).with_name('main.py').read_text())
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {'process_stage', '_claim_and_run_stage', 'sb_get_run_artifacts', 'stage_claim_placeholder'}], type_ignores=[])
        self.writer = Mock(context=SimpleNamespace(stage_id=IDS[2], run_id=IDS[1], workspace_id=IDS[4]))
        self.stage = {'id': IDS[2], 'run_id': IDS[1], 'stage_name': 'AequilibraE Setup', 'attempt_managed': True}
        self.env = {'os': os, 'time': time, 'datetime': datetime.datetime, 'timezone': datetime.timezone,
            '_STAGE_EXECUTION_LOCK': threading.Lock(), '_CUSTODY': Mock(), 'RUN_WORK_ROOT': self.root,
            'SUPABASE_URL': URL, 'SUPABASE_KEY': 'synthetic-secret', 'requests': Mock(),
            'HEADERS': {}, 'uuid': __import__('uuid'), 'WorkerStateWriteUnconfirmed': invocation.ReconciliationRequired,
            'run_work_directory': Mock(return_value=self.root),
            'sb_get_run': Mock(return_value={}), 'ensure_dynamic_package': Mock(return_value={'package_dir': self.root+'/package','bbox':[0,0,1,1]}),
            'stage_setup': Mock(return_value={'log':'Synthetic setup complete'}), 'write_run_state': Mock(), 'sb_patch_stage': Mock(),
            'sb_claim_stage': Mock(side_effect=AssertionError('Legacy claim forbidden')), 'sb_patch_run': Mock(side_effect=AssertionError('Parent PATCH forbidden'))}
        exec(compile(selected, str(Path(__file__).with_name('main.py')), 'exec'), self.env)

    def test_normal_managed_entry_invokes_inside_serialization_without_legacy_fallback(self):
        from unittest.mock import patch
        def dispatch(directory, stage, **kwargs):
            self.assertTrue(self.env['_STAGE_EXECUTION_LOCK'].locked())
            self.assertEqual(stage, self.stage)
            self.assertIs(kwargs['handler'], self.env['_claim_and_run_stage'])
            self.assertEqual(directory.parts[-2:], ('attempt-commands', IDS[2]))
            return True
        with patch.object(invocation, 'dispatch_queued_stage', side_effect=dispatch) as join:
            self.assertTrue(self.env['process_stage'](self.stage))
        join.assert_called_once(); self.env['sb_claim_stage'].assert_not_called()
        self.env['_CUSTODY'].release.assert_called_once()
        with patch.object(invocation, 'dispatch_queued_stage', side_effect=RuntimeError('Synthetic uncertain claim')):
            with self.assertRaisesRegex(invocation.ReconciliationRequired, 'no legacy claim fallback'):
                self.env['process_stage'](self.stage)
        self.env['sb_claim_stage'].assert_not_called()

    def test_admitted_setup_retains_handoff_without_legacy_claim_or_parent_patch(self):
        from unittest.mock import patch
        import model_attempt_writer as managed
        with patch.object(managed, 'current', return_value=self.writer):
            self.assertTrue(self.env['_claim_and_run_stage'](self.stage))
        self.writer.read_run.assert_called_once_with(IDS[1], expected_stage_name='AequilibraE Setup')
        self.writer.retain_package.assert_called_once_with(self.root+'/package')
        self.writer.retain_project.assert_called_once_with(self.root+'/aeq_project')
        self.env['write_run_state'].assert_called_once()
        self.env['sb_claim_stage'].assert_not_called(); self.env['sb_patch_run'].assert_not_called()
        self.env['requests'].get.assert_not_called()
        self.assertEqual(self.env['sb_patch_stage'].call_args.args[1]['status'], 'succeeded')

    def test_worker_predecessors_select_native_current_ids_before_table_cap(self):
        from unittest.mock import patch
        import model_attempt_writer as managed
        row = {'id': IDS[0], 'run_id': IDS[1], 'attempt_id': IDS[3], 'artifact_type': 'link_volumes'}
        native = {'run_id': IDS[1], 'run_status': 'running', 'outputs': [
            {'kind': 'artifact', 'ownership_state': 'retained_inactive', 'record': {**row, 'id': IDS[4]}},
            {'kind': 'artifact', 'ownership_state': 'current_completed', 'record': row}]}
        self.env['requests'].post.return_value = Mock(status_code=200, json=lambda: native)
        self.env['requests'].get.return_value = Mock(status_code=200, json=lambda: [row])
        with patch.object(managed, 'current', return_value=self.writer):
            self.assertEqual(self.env['sb_get_run_artifacts'](IDS[1]), [row])
        self.assertIn('&id=in.('+IDS[0]+')', self.env['requests'].get.call_args.args[0])
        self.assertEqual(self.env['requests'].post.call_args.kwargs['json'], {'p_run_id': IDS[1], 'p_workspace_id': IDS[4]})
        self.env['requests'].get.return_value = Mock(status_code=200, json=lambda: [])
        with patch.object(managed, 'current', return_value=self.writer):
            with self.assertRaisesRegex(invocation.ReconciliationRequired, 'requires reconciliation'):
                self.env['sb_get_run_artifacts'](IDS[1])

    def test_assignment_and_extraction_use_real_writer_working_state_then_one_handoff(self):
        import ast
        import model_attempt_writer as managed
        from test_model_attempt_writer import WorkingStateTests
        from unittest.mock import patch
        source = ast.parse(Path(__file__).with_name('main.py').read_text())
        self.env['json'] = json
        real_functions = {'run_work_directory', 'write_run_state', 'sb_get_run', 'sb_patch_stage'}
        exec(compile(ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in real_functions], type_ignores=[]),
                     str(Path(__file__).with_name('main.py')), 'exec'), self.env)
        for stage_name in ('Network Assignment', 'Artifact Extraction'):
            with self.subTest(stage=stage_name):
                fixture = WorkingStateTests('runTest')
                fixture.setUp()
                try:
                    row = fixture.get.return_value.json.return_value[0]
                    row['stage_name'] = stage_name
                    row['model_runs'].update({field: None for field in managed.RUN_CONFIGURATION_FIELDS})
                    row['model_runs']['input_snapshot_json'] = {}
                    stage = {**self.stage, 'stage_name': stage_name}
                    self.env['RUN_WORK_ROOT'] = str(fixture.directory / 'work')
                    def prepare(**kwargs):
                        self.assertTrue(kwargs['include_project'])
                        self.assertEqual(kwargs['include_outputs'], stage_name == 'Artifact Extraction')
                        mapped, original, mapping = fixture.retained_inputs(fixture.writer.files.path,
                            assignment={'handoff_step': 'original-synthetic-assignment'} if stage_name == 'Artifact Extraction' else None)
                        self.original_input = original
                        self.original_mapping = mapping
                        return {'package_mapped_state': mapped}
                    completed = []
                    def assignment(*args):
                        completed.append(stage_name)
                        return {'log': 'Synthetic assignment complete', 'handoff_step': 'new-synthetic-assignment'}
                    def extraction(*args):
                        completed.append(stage_name)
                        return 'Synthetic extraction complete'
                    self.env.update(retain_managed_state_and_package=prepare, stage_assignment=assignment, stage_artifacts=extraction,
                        project_work_directory=lambda work: str(Path(work) / 'project'), output_work_directory=lambda work: str(Path(work) / 'outputs'))
                    with managed.bind(fixture.writer), patch.object(fixture.writer, 'retain_package'), \
                            patch.object(fixture.writer, 'retain_project'), patch.object(fixture.writer, 'retain_assignment_outputs'):
                        try:
                            self.assertTrue(self.env['_claim_and_run_stage'](stage))
                        except invocation.ReconciliationRequired as error:
                            if isinstance(error.__context__, FileExistsError):
                                self.assertEqual(completed, [stage_name])
                                raise error.__context__
                            raise
                    self.assertEqual(completed, [stage_name])
                    path = fixture.writer.files.path
                    retained = json.loads((path / 'predecessor_state.json').read_bytes())
                    self.assertIn('assignment', retained)
                    self.assertEqual((path / 'predecessor_state_input.json').read_bytes(), self.original_input)
                    self.assertEqual((path / 'input_mapping.json').read_bytes(), self.original_mapping)
                    outgoing = [call for call in fixture.post.call_args_list if call.kwargs.get('json', {}).get('p_payload', {}).get('artifact_type') == 'model_predecessor_state']
                    self.assertEqual(len(outgoing), 1)
                    self.assertTrue(fixture.writer.stopped)
                    self.assertEqual(fixture.post.call_args.kwargs['json']['p_status'], 'succeeded')
                    self.env['sb_claim_stage'].assert_not_called(); self.env['sb_patch_run'].assert_not_called()
                finally:
                    fixture.doCleanups()

if __name__ == '__main__':
    unittest.main()
