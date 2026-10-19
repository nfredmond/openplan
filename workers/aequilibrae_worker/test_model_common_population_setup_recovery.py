"""Actual files/journals, supplied HTTP only. Root runs these, never this child.

Blind categories: native SQL/RLS fencing, distributed legacy exclusion, Census
origin, engine execution, host restoration and scientific acceptance.
"""
import copy
import csv
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import unittest
from unittest.mock import Mock, patch

import model_command_client as client
import model_command_journal as journal
import model_common_population_handoff as handoff
import model_common_population_package as package
import model_common_population_setup_recovery as recovery
import model_attempt_writer as managed
from model_attempt_invocation import AttemptContext, ReconciliationRequired
import model_legacy_artifact_command as legacy
import model_stage_computation as computation
import test_model_common_population_handoff as supplied

DEPLOYMENT = 'supplied-population-recovery'


class SetupRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.f = supplied.PopulationHandoffTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.f.use_stage_snapshot()
        self.reader = self.f.writer
        self.directory = recovery.checkpoint_directory(self.reader, self.f.consumer_dir)
        self.destination = dict(base_url=self.reader.base_url, deployment_id=DEPLOYMENT)
        self.posts = []
        self.lose = None
        self.before_commit = False
        self.prepared = None
        self.generated = Mock(side_effect=self.generate_files)

    def prepare(self):
        self.prepared = handoff.prepare_population_input(self.reader, destination=self.f.destination,
                                                         zone_attributes=self.f.zone_payload(self.f.consumer_id))
        self.inputs = recovery.setup_inputs(self.reader, self.prepared, bbox=(0.0, 0.0, 1.0, 1.0),
            corridor_geojson=self.f.geometry, zone_geography='tract', zone_attributes=self.f.zone_payload(self.f.consumer_id))

    def generate_files(self):
        common = package.population_library()
        target = self.reader.files.path / 'package'
        target.mkdir()
        population = self.prepared['population']
        common.copy_retained_population(population, target / 'common_population')
        totals = common.aequilibrae_zone_totals(population)
        rows = [{**row, **totals[row['zone_id']]} for row in self.f.zones]
        with (target / 'zone_attributes.csv').open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        (target / 'od_trip_matrix.csv').write_text('zone_id,7\n7,0\n')
        manifest = {'version': 'dynamic-v1', 'bbox': [0, 0, 1, 1], 'zone_geography': 'tract',
            'files': {'zone_attributes': 'zone_attributes.csv', 'od_trip_matrix': 'od_trip_matrix.csv'},
            'common_population': {'directory': 'common_population', 'manifest': population['manifest'],
                'custody': self.prepared['custody'], **package.identity(population), 'origin': self.prepared['source']}}
        (target / 'manifest.json').write_text(json.dumps(manifest))
        return manifest

    def retain(self):
        return recovery.retain_package(self.reader, self.directory, self.inputs, self.generated, **self.destination)

    def build(self):
        self.prepare()
        self.metadata = self.retain()
        self.inputs, self.result = recovery.read_checkpoint(self.reader, self.directory, **self.destination)

    def post(self, url, **kwargs):
        self.assertEqual(url, self.reader.base_url + '/rest/v1/rpc/record_legacy_model_artifact')
        payload = copy.deepcopy(kwargs['json']['p_payload'])
        self.assertEqual(kwargs['json']['p_workspace'], self.f.workspace)
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['timeout'], (5, 30))
        self.posts.append(payload)
        pending = journal.pending(self.directory, client.destination(**self.destination))
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]['command']['arguments']['payload'], payload)
        lose = self.lose == payload['artifact_type']
        if lose:
            self.lose = None
        if lose and self.before_commit:
            raise TimeoutError('supplied loss before commit')
        rows = self.f.tables['model_run_artifacts']
        selected = [row for row in rows if row['id'] == payload['id']]
        receipt = {**payload, 'attempt_id': None}
        if selected:
            self.assertEqual(selected, [receipt])
        else:
            rows.append(receipt)
        if lose:
            raise TimeoutError('supplied loss after commit')
        return supplied.response(receipt)

    def reconcile(self, reader=None):
        return recovery.reconcile_publication(reader or self.reader, self.directory, **self.destination,
            service_key='fixture-only', post=self.post)

    def inventory_bytes(self):
        target = self.reader.files.path / 'package'
        return {name: (target / name).read_bytes() for name in package.package_inventory(target)}

    def test_completed_checkpoint_reuses_exact_files_without_second_generation(self):
        self.build()
        before = self.inventory_bytes()
        self.assertEqual(self.retain(), self.metadata)
        self.assertEqual(self.inventory_bytes(), before)
        self.generated.assert_called_once()
        self.assertFalse((self.reader.files.path / 'state.json').exists())

    def assert_precreation_refusal(self, message):
        with patch.object(computation, 'compute_once', wraps=computation.compute_once) as compute:
            with self.assertRaisesRegex(ValueError, '^' + message + '$'):
                self.retain()
            compute.assert_not_called()
        self.generated.assert_not_called()
        self.assertFalse(os.path.lexists(self.reader.files.path / 'package'))

    def test_fresh_legacy_commands_directory_alias_refuses_before_any_write(self):
        self.prepare()
        external = self.f.root / 'external-empty'
        external.mkdir(mode=0o755)
        before = external.stat()
        self.directory.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, '^Population checkpoint directory cannot use aliases or non-directories$'):
            recovery.read_checkpoint(self.reader, self.directory, **self.destination, optional=True)
        self.assert_precreation_refusal('Population checkpoint directory cannot use aliases or non-directories')
        after = external.stat()
        self.assertEqual((after.st_mode, after.st_mtime_ns, after.st_ctime_ns),
                         (before.st_mode, before.st_mtime_ns, before.st_ctime_ns))
        self.assertEqual(list(external.iterdir()), [])
        self.assertEqual(self.directory.readlink(), external)

    def test_dangling_journal_link_refuses_before_any_write(self):
        self.prepare()
        external = self.f.root / 'external-empty'
        external.mkdir(mode=0o755)
        before = external.stat()
        external_file = external / 'never-created.sqlite3'
        self.directory.mkdir(mode=0o700)
        path = self.directory / 'model-commands.sqlite3'
        path.symlink_to(external_file)
        with self.assertRaisesRegex(ValueError, '^Population checkpoint journal must be a private unaliased regular file$'):
            recovery.read_checkpoint(self.reader, self.directory, **self.destination, optional=True)
        self.assert_precreation_refusal('Population checkpoint journal must be a private unaliased regular file')
        after = external.stat()
        self.assertEqual((after.st_mode, after.st_mtime_ns, after.st_ctime_ns),
                         (before.st_mode, before.st_mtime_ns, before.st_ctime_ns))
        self.assertEqual(list(external.iterdir()), [])
        self.assertFalse(os.path.lexists(external_file))
        self.assertEqual(path.readlink(), external_file)

    def test_missing_commands_directory_below_aliased_ancestor_refuses(self):
        self.prepare()
        external = self.f.root / 'external-empty'
        external.mkdir(mode=0o755)
        ancestor = self.reader.files.path / 'aliased-parent'
        ancestor.symlink_to(external, target_is_directory=True)
        self.directory = ancestor / 'missing-commands'
        self.assert_precreation_refusal('Population checkpoint directory cannot use aliases or non-directories')
        self.assertEqual(list(external.iterdir()), [])

    def test_alias_introduced_after_optional_read_refuses_before_compute(self):
        self.prepare()
        external = self.f.root / 'external-empty'
        external.mkdir(mode=0o755)
        original_read = recovery.read_checkpoint
        def read_then_alias(*args, **kwargs):
            result = original_read(*args, **kwargs)
            self.directory.symlink_to(external, target_is_directory=True)
            return result
        # Run the actual optional validator, then inject a changed pathname.
        with patch.object(recovery, 'read_checkpoint', side_effect=read_then_alias) as inspected:
            self.assert_precreation_refusal('Population checkpoint directory cannot use aliases or non-directories')
        inspected.assert_called_once()
        self.assertEqual(list(external.iterdir()), [])
        self.assertEqual(self.directory.readlink(), external)

    def test_legitimate_fresh_journal_directory_can_be_created(self):
        self.prepare()
        self.assertFalse(self.directory.exists())
        self.assertIsNone(recovery.read_checkpoint(self.reader, self.directory, **self.destination, optional=True))
        self.assertFalse(self.directory.exists())
        self.retain()
        info = (self.directory / 'model-commands.sqlite3').lstat()
        self.assertTrue(stat.S_ISREG(info.st_mode))
        self.assertEqual(info.st_nlink, 1)
        self.assertEqual(stat.S_IMODE(info.st_mode) & 0o077, 0)
        self.assertFalse(self.directory.is_symlink())
        self.generated.assert_called_once()

    def test_existing_checkpoint_journal_with_shared_permissions_refuses(self):
        self.build()
        path = self.directory / 'model-commands.sqlite3'
        path.chmod(0o640)
        with self.assertRaisesRegex(ValueError, '^Population checkpoint journal must be a private unaliased regular file$'):
            recovery.read_checkpoint(self.reader, self.directory, **self.destination, optional=True)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
        self.generated.assert_called_once()

    def test_existing_checkpoint_journal_with_another_link_refuses(self):
        self.build()
        path = self.directory / 'model-commands.sqlite3'
        os.link(path, self.f.root / 'linked-checkpoint.sqlite3')
        with self.assertRaisesRegex(ValueError, '^Population checkpoint journal must be a private unaliased regular file$'):
            recovery.read_checkpoint(self.reader, self.directory, **self.destination, optional=True)
        self.assertEqual(path.stat().st_nlink, 2)
        self.generated.assert_called_once()

    def test_nonregular_journal_entry_refuses_before_creation(self):
        self.prepare()
        self.directory.mkdir(mode=0o700)
        path = self.directory / 'model-commands.sqlite3'
        path.mkdir(mode=0o700)
        self.assert_precreation_refusal('Population checkpoint journal must be a private unaliased regular file')
        self.assertTrue(path.is_dir())

    def test_uncheckpointed_package_refuses_before_generation_or_journal_creation(self):
        self.prepare()
        self.generate_files()
        with self.assertRaisesRegex(computation.ComputationUnconfirmed, '^Uncheckpointed population package cannot be adopted$'):
            self.retain()
        self.generated.assert_not_called()
        self.assertFalse(self.directory.exists())

    def test_interrupted_computation_never_repeats_generation(self):
        self.prepare()
        self.generated.side_effect = RuntimeError('supplied interrupted package')
        with self.assertRaisesRegex(RuntimeError, '^supplied interrupted package$'):
            self.retain()
        with self.assertRaisesRegex(computation.ComputationUnconfirmed, '^Population package started without a completed checkpoint$'):
            self.retain()
        self.generated.assert_called_once()

    def test_changed_inputs_refuse_without_second_fit(self):
        self.build()
        self.inputs['bbox'][0] = -1
        with self.assertRaisesRegex(computation.ComputationUnconfirmed, '^Computation inputs changed; reconcile retained records$'):
            self.retain()
        self.generated.assert_called_once()

    def test_checkpoint_bytes_cannot_be_substituted_even_when_csv_remains_valid(self):
        self.build()
        path = self.reader.files.path / 'package' / 'od_trip_matrix.csv'
        path.write_text('zone_id,7\n7,1\n')
        with self.assertRaisesRegex(ValueError, '^Population package bytes differ from completed checkpoint$'):
            self.retain()
        self.generated.assert_called_once()

    def test_missing_package_file_does_not_enter_ordinary_cache_rebuild(self):
        self.build()
        (self.reader.files.path / 'package' / 'od_trip_matrix.csv').unlink()
        with self.assertRaises(FileNotFoundError):
            self.retain()
        self.generated.assert_called_once()

    def test_partial_copy_keeps_existing_inodes_and_fills_only_missing_files(self):
        original = handoff.copy_registered
        copies = []
        def interrupted(*args, **kwargs):
            if len(copies) == 3:
                raise OSError('supplied copy interruption')
            copies.append(Path(args[3]).name)
            return original(*args, **kwargs)
        with patch.object(handoff, 'copy_registered', side_effect=interrupted):
            with self.assertRaisesRegex(OSError, '^supplied copy interruption$'):
                self.prepare()
        survivors = {path.name: (path.stat().st_ino, path.read_bytes()) for path in self.f.destination.iterdir()}
        # A new stage reader supplies only the same still-running DATA custody.
        self.reader = recovery.recovery_reader(self.f.root, self.directory, **self.destination,
            workspace_id=self.f.workspace, run_id=self.f.consumer_id, stage_id=self.f.consumer_stage,
            custody='legacy_stage_snapshot', service_key='fixture-only', get=self.f.get, post=self.f.post)
        with patch.object(handoff, 'copy_registered', wraps=original) as filled:
            self.prepare()
        self.assertEqual(filled.call_count, 4)
        for name, survivor in survivors.items():
            path = self.f.destination / name
            self.assertEqual((path.stat().st_ino, path.read_bytes()), survivor)

    def test_exact_existing_copy_reuses_files_without_copying(self):
        self.prepare()
        before = {path.name: (path.stat().st_ino, path.read_bytes()) for path in self.f.destination.iterdir()}
        with patch.object(handoff, 'copy_registered', wraps=handoff.copy_registered) as copied:
            self.prepare()
        copied.assert_not_called()
        self.assertEqual({path.name: (path.stat().st_ino, path.read_bytes()) for path in self.f.destination.iterdir()}, before)

    def test_same_size_partial_copy_byte_drift_refuses_before_filling_a_gap(self):
        self.f.destination.mkdir()
        original = (self.f.source_dir / 'persons.csv').read_bytes()
        changed = bytes([original[0] ^ 1]) + original[1:]
        (self.f.destination / 'persons.csv').write_bytes(changed)
        with patch.object(handoff, 'copy_registered', wraps=handoff.copy_registered) as copied:
            with self.assertRaisesRegex(ValueError, '^Retained file identity mismatch: persons.csv$'):
                self.prepare()
        copied.assert_not_called()
        self.assertEqual((self.f.destination / 'persons.csv').read_bytes(), changed)

    def test_changed_partial_copy_refuses_before_filling_a_gap(self):
        self.f.destination.mkdir()
        (self.f.destination / 'persons.csv').write_bytes(b'changed')
        with patch.object(handoff, 'copy_registered', wraps=handoff.copy_registered) as copied:
            with self.assertRaisesRegex(ValueError, '^Retained file identity mismatch: persons.csv$'):
                self.prepare()
        copied.assert_not_called()
        self.assertEqual((self.f.destination / 'persons.csv').read_bytes(), b'changed')

    def test_unexplained_copy_file_refuses(self):
        self.f.destination.mkdir()
        (self.f.destination / 'foreign').write_bytes(b'untouched')
        with self.assertRaisesRegex(ValueError, '^Population copy contains unexplained files$'):
            self.prepare()
        self.assertEqual((self.f.destination / 'foreign').read_bytes(), b'untouched')

    def test_linked_copy_refuses_before_copying(self):
        self.f.destination.mkdir()
        private = self.f.root / 'private-persons.csv'
        private.write_bytes((self.f.source_dir / 'persons.csv').read_bytes())
        os.link(private, self.f.destination / 'persons.csv')
        with patch.object(handoff, 'copy_registered', wraps=handoff.copy_registered) as copied:
            with self.assertRaisesRegex(ValueError, '^Population copy must contain private regular files$'):
                self.prepare()
        copied.assert_not_called()

    def test_matching_copy_still_rechecks_source_private_files(self):
        self.prepare()
        os.link(self.f.source_dir / 'persons.csv', self.f.root / 'linked-source-persons.csv')
        with self.assertRaisesRegex(ValueError, '^Population source must contain private regular files$'):
            self.prepare()

    def test_matching_copy_does_not_adopt_registered_source_outside_declared_run(self):
        self.prepare()
        moved = self.f.root / 'foreign-source'
        self.f.source_dir.rename(moved)
        for row in self.f.tables['model_run_artifacts']:
            row['file_url'] = 'local://' + str(moved / Path(row['file_url'][8:]).name)
        with self.assertRaisesRegex(ValueError, '^Population source manifest path or size is unsupported$'):
            self.prepare()

    def test_package_directory_alias_is_not_a_completed_package(self):
        self.build()
        target = self.reader.files.path / 'package'
        renamed = target.with_name('renamed-package')
        target.rename(renamed)
        target.symlink_to(renamed, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, '^Population package cannot use path aliases$'):
            self.retain()
        self.generated.assert_called_once()

    def test_exact_seven_receipts_reconcile_without_status_or_state_write(self):
        self.build()
        stages = copy.deepcopy(self.f.tables['model_run_stages'])
        before = self.inventory_bytes()
        result = self.reconcile()
        self.assertEqual(len(result['artifact_ids']), 7)
        self.assertEqual(len(set(result['artifact_ids'])), 7)
        self.assertEqual(len(self.posts), 7)
        self.assertEqual(self.reconcile(), result)
        self.assertEqual(len(self.posts), 7)
        self.assertEqual(self.f.tables['model_run_stages'], stages)
        self.assertEqual(self.inventory_bytes(), before)
        self.assertFalse(result['model_resumed'])
        self.assertFalse(result['stage_status_changed'])
        self.assertFalse(result['execution_admission_created'])
        self.assertFalse((self.reader.files.path / 'state.json').exists())

    def test_third_commit_lost_reply_retains_identity_and_finishes_missing_members(self):
        self.build()
        names = list(self.result['publication'])
        self.lose = names[2]
        with self.assertRaisesRegex(client.DeliveryUnconfirmed, '^Model RPC transport did not confirm a receipt$'):
            self.reconcile()
        pending = journal.pending(self.directory, client.destination(**self.destination))
        self.assertEqual(len(pending), 1)
        frozen = pending[0]['command']
        self.assertEqual(len(self.posts), 3)
        self.reconcile()
        self.assertEqual(self.posts[2], self.posts[3])
        saved = journal.read_existing(self.directory, frozen['destination'], frozen['request_id'])
        self.assertEqual(saved[0]['command'], frozen)
        self.assertTrue(saved[0]['resolved'])
        self.assertEqual(len([row for row in self.f.tables['model_run_artifacts'] if row['run_id'] == self.f.consumer_id]), 7)

    def test_loss_before_commit_and_malformed_reply_stay_pending(self):
        self.build()
        name = next(iter(self.result['publication']))
        self.lose, self.before_commit = name, True
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.reconcile()
        frozen = journal.pending(self.directory, client.destination(**self.destination))[0]['command']
        malformed = Mock(return_value=supplied.response({'id': supplied.identity(90)}))
        with self.assertRaisesRegex(client.DeliveryUnconfirmed, '^Legacy artifact receipt does not match the prepared command$'):
            recovery.reconcile_publication(self.reader, self.directory, **self.destination,
                service_key='fixture-only', post=malformed)
        self.assertEqual(journal.pending(self.directory, frozen['destination'])[0]['command'], frozen)
        self.reconcile()
        self.assertEqual(len(self.posts), 8)

    def test_resolved_journal_without_database_output_refuses_before_new_delivery(self):
        self.build()
        self.reconcile()
        rows = self.f.tables['model_run_artifacts']
        rows[:] = [row for row in rows if row['run_id'] != self.f.consumer_id]
        with self.assertRaisesRegex(ValueError, '^Population authority read is incomplete or not unique$'):
            self.reconcile()
        self.assertEqual(len(self.posts), 7)

    def test_changed_saved_request_refuses(self):
        self.build()
        name, payload = next(iter(self.result['publication'].items()))
        cmd = recovery.artifact_command(self.reader, name, payload, **self.destination)
        cmd['arguments']['payload']['metadata_json']['origin'] = None
        journal.prepare(self.directory, cmd)
        with self.assertRaisesRegex(ValueError, '^Saved population artifact command differs$'):
            self.reconcile()
        self.assertEqual(self.posts, [])

    def test_unrelated_pending_command_refuses_before_delivery(self):
        self.build()
        name, payload = next(iter(self.result['publication'].items()))
        cmd = recovery.artifact_command(self.reader, name + '_unrelated', payload, **self.destination)
        journal.prepare(self.directory, cmd)
        with self.assertRaisesRegex(ValueError, '^Unrelated pending command requires reconciliation$'):
            self.reconcile()
        self.assertEqual(self.posts, [])

    def test_changed_deployment_cannot_adopt_existing_checkpoint(self):
        self.build()
        with self.assertRaisesRegex(computation.ComputationUnconfirmed, '^Completed population package checkpoint required$'):
            recovery.reconcile_publication(self.reader, self.directory, base_url=self.reader.base_url,
                deployment_id='other-installation', service_key='fixture-only', post=self.post)
        self.assertEqual(self.posts, [])

    def test_missing_hosted_mirror_is_not_bypassed_by_receipt_recovery(self):
        self.build()
        with patch.dict(os.environ, {'OPENPLAN_HOSTED_ARTIFACT_MIRROR': '1'}):
            with self.assertRaisesRegex(ValueError, '^Hosted population mirror requires its existing recovery before registration$'):
                self.reconcile()
        self.assertEqual(self.posts, [])

    def test_supplied_failed_502_state_refuses_publication_and_preserves_records(self):
        """Failed-state DATA refusal only, without a Setup controller invocation."""
        self.build()
        run = self.f.tables['model_runs'][1]
        stage = self.f.tables['model_run_stages'][1]
        run['status'] = stage['status'] = 'failed'
        stage['error_message'] = 'Overpass HTTP 502 server at capacity'
        for index, name in enumerate(('Network Assignment', 'Artifact Extraction')):
            self.f.tables['model_run_stages'].append({'id': supplied.identity(96 + index),
                'run_id': self.f.consumer_id, 'stage_name': name, 'status': 'skipped',
                'error_message': 'Blocked by prior failed Setup'})
        stages = copy.deepcopy(self.f.tables['model_run_stages'])
        artifacts = copy.deepcopy(self.f.tables['model_run_artifacts'])
        before = self.inventory_bytes()
        with self.assertRaisesRegex(ValueError, '^Population consumer ownership differs from its explicit custody$'):
            self.reconcile()
        self.assertEqual(self.posts, [])
        self.assertEqual(stage['error_message'], 'Overpass HTTP 502 server at capacity')
        self.assertEqual(run['status'], 'failed')
        self.assertEqual(self.f.tables['model_run_stages'], stages)
        self.assertEqual(self.f.tables['model_run_artifacts'], artifacts)
        self.assertEqual(self.inventory_bytes(), before)
        self.assertFalse((self.reader.files.path / 'state.json').exists())

    def test_legacy_stage_receipt_eligibility_is_not_inferred_from_valid_files(self):
        self.build()
        self.f.stage_eligible = False
        with self.assertRaisesRegex(ValueError, '^Fresh receipt-backed population stage custody is unconfirmed$'):
            self.reconcile()
        self.assertEqual(self.posts, [])

    def test_failed_source_baseline_is_not_reused_despite_its_retained_files(self):
        self.f.tables['model_runs'][0]['status'] = 'failed'
        with self.assertRaisesRegex(ValueError, '^Population source must be the completed baseline in this project, study and zone geography$'):
            self.prepare()
        self.assertFalse(self.f.destination.exists())

    def test_command_identity_matches_existing_legacy_named_builder(self):
        self.build()
        for name, payload in self.result['publication'].items():
            self.assertEqual(recovery.artifact_command(self.reader, name, payload, **self.destination),
                legacy.prepare_named(self.directory, self.f.workspace, payload, name=name, **self.destination))

    def test_main_package_helper_reuses_checkpoint_and_refuses_byte_drift(self):
        """Package helper behavior only; this does not establish controller ordering."""
        with patch('dotenv.load_dotenv'), patch.dict(os.environ, {
                'SUPABASE_URL': 'https://bound.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-only'}):
            import main
        import model_attempt_writer
        self.build()
        run = self.f.tables['model_runs'][1]
        # Use the actual source inputs that produced this checkpoint.
        with patch.object(main, 'RUN_WORK_ROOT', str(self.f.root)), \
             patch.object(main, 'SUPABASE_URL', self.reader.base_url), \
             patch.object(main, 'SUPABASE_KEY', 'fixture-only'), \
             patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': DEPLOYMENT}), \
             patch.object(model_attempt_writer, 'current', return_value=None), \
             patch.object(main, 'resolve_zone_attributes', return_value=(self.f.zone_payload(self.f.consumer_id), {})), \
             patch.object(main, 'generate_package', side_effect=AssertionError('second fit forbidden')) as fit, \
             patch.object(main.requests, 'get', side_effect=self.f.get), \
             patch.object(main.requests, 'post', side_effect=self.f.post):
            self.assertEqual(main.ensure_dynamic_package(self.f.consumer_id, str(self.f.consumer_dir),
                run_row=run, stage_id=self.f.consumer_stage), self.metadata)
            (self.reader.files.path / 'package' / 'od_trip_matrix.csv').write_text('changed')
            with self.assertRaisesRegex(main.WorkerStateWriteUnconfirmed, '^Guided package requires reconciliation; no refit or stage restart$') as caught:
                main.ensure_dynamic_package(self.f.consumer_id, str(self.f.consumer_dir), run_row=run, stage_id=self.f.consumer_stage)
            self.assertRegex(str(caught.exception.__cause__), '^Population package bytes differ from completed checkpoint$')
            fit.assert_not_called()

    def test_normal_publication_stops_on_pending_member_until_explicit_reconciliation(self):
        with patch('dotenv.load_dotenv'), patch.dict(os.environ, {
                'SUPABASE_URL': 'https://bound.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture-only'}):
            import main
        import model_attempt_writer
        self.build()
        self.lose = list(self.result['publication'])[2]
        def post(url, **kwargs):
            if url.endswith('/record_legacy_model_artifact'):
                return self.post(url, **kwargs)
            return self.f.post(url, **kwargs)
        with patch.object(main, 'RUN_WORK_ROOT', str(self.f.root)), \
             patch.object(main, 'SUPABASE_URL', self.reader.base_url), \
             patch.object(main, 'SUPABASE_KEY', 'fixture-only'), \
             patch.dict(os.environ, {'OPENPLAN_DEPLOYMENT_ID': DEPLOYMENT, 'OPENPLAN_HOSTED_ARTIFACT_MIRROR': '0'}), \
             patch.object(model_attempt_writer, 'current', return_value=None), \
             patch.object(main, 'sb_get_run', return_value=self.f.tables['model_runs'][1]), \
             patch.object(main.requests, 'get', side_effect=self.f.get), \
             patch.object(main.requests, 'post', side_effect=post):
            with self.assertRaisesRegex(main.WorkerStateWriteUnconfirmed, '^Population publication requires reconciliation; no stage restart$'):
                main.publish_common_population(self.f.consumer_id, self.f.consumer_stage,
                    str(self.reader.files.path / 'package'), self.metadata)
            self.assertEqual(len(self.posts), 3)
            with self.assertRaises(main.WorkerStateWriteUnconfirmed) as caught:
                main.publish_common_population(self.f.consumer_id, self.f.consumer_stage,
                    str(self.reader.files.path / 'package'), self.metadata)
            self.assertEqual(str(caught.exception.__cause__), 'Pending population publication requires explicit receipt reconciliation')
            self.assertEqual(len(self.posts), 3)
        self.reconcile()
        self.assertEqual(len(self.posts), 8)


class ManagedSetupRecoveryTests(unittest.TestCase):
    prepare = SetupRecoveryTests.prepare
    generate_files = SetupRecoveryTests.generate_files
    retain = SetupRecoveryTests.retain
    build = SetupRecoveryTests.build
    inventory_bytes = SetupRecoveryTests.inventory_bytes

    def setUp(self):
        self.f = supplied.PopulationHandoffTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.directory = self.f.root / 'managed-journal'
        self.destination = dict(base_url=self.f.writer.base_url, deployment_id=DEPLOYMENT)
        bound = client.destination(**self.destination)
        self.context = AttemptContext(bound, self.f.workspace, self.f.consumer_id,
            self.f.consumer_stage, self.f.consumer_attempt, supplied.identity(70))
        self.claim = {'request_id': self.context.claim_request_id, 'destination': bound,
            'operation': 'claim_model_stage_attempt', 'arguments': {'run_id': self.f.consumer_id,
                'stage_id': self.f.consumer_stage, 'worker_id': 'supplied-worker'}}
        journal.prepare(self.directory, self.claim)
        self.claim_receipt = {'request_id': self.context.claim_request_id, 'run_id': self.f.consumer_id,
            'stage_id': self.f.consumer_stage, 'attempt_id': self.f.consumer_attempt, 'outcome': 'claimed'}
        journal.resolve(self.directory, self.claim, client.checked_receipt(self.claim, self.claim_receipt))
        with sqlite3.connect(self.directory / 'model-commands.sqlite3') as connection:
            connection.execute('CREATE TABLE execution_admissions (request_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, entered INTEGER NOT NULL)')
            connection.execute('INSERT INTO execution_admissions VALUES(?,?,1)', (self.context.claim_request_id, self.f.workspace))
        work = self.f.root / 'runs' / self.f.consumer_id / 'attempts' / hashlib.sha256(bound.encode()).hexdigest() / self.f.consumer_stage / self.f.consumer_attempt
        work.mkdir(parents=True)
        owner = os.open(work / 'attempt_owner.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(owner, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(journal.canonical({'schema': 'openplan.attempt-workspace.v1', **asdict(self.context)}) + '\n')
        self.f.consumer_dir = work
        self.f.destination = work / 'population-source'
        self.f.tables['model_runs'][1]['run_title'] = 'Supplied managed population'
        self.native_receipts, self.posts = {}, []
        self.lose = None
        self.reader = managed.AttemptWriter(self.directory, self.context, **self.destination,
            service_key='fixture-only', get=self.get, post=self.post)
        self.reader.files = recovery._RecoveredFiles(self.f.root, self.context)
        self.generated = Mock(side_effect=self.generate_files)

    def get(self, url, **kwargs):
        select = kwargs['params']['select']
        if 'model_runs!inner' in select:
            self.assertEqual(kwargs['params']['id'], 'eq.' + self.f.consumer_stage)
            self.assertEqual(kwargs['params']['run_id'], 'eq.' + self.f.consumer_id)
            self.assertEqual(kwargs['params']['model_runs.workspace_id'], 'eq.' + self.f.workspace)
            self.assertIn(select, (
                'id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)',
                'stage_name,id,run_id,status,attempt_managed,active_attempt_id,log_tail,error_message,model_runs!inner(id,workspace_id,status,attempt_managed,scenario_entry_id,corridor_geojson,query_text,engine_key,run_title,input_snapshot_json)'))
            return supplied.response([{**self.f.tables['model_run_stages'][1], 'log_tail': '',
                'error_message': None, 'model_runs': self.f.tables['model_runs'][1]}])
        return self.f.get(url, **kwargs)

    def post(self, url, **kwargs):
        if not url.endswith('/write_model_attempt_artifact'):
            return self.f.post(url, **kwargs)
        arguments = kwargs['json']
        self.assertEqual(arguments['p_attempt_id'], self.f.consumer_attempt)
        pending = journal.pending(self.directory, self.context.destination)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]['command']['request_id'], arguments['p_request_id'])
        self.assertEqual(pending[0]['command']['arguments']['payload'], arguments['p_payload'])
        self.posts.append(copy.deepcopy(arguments))
        identity = arguments['p_request_id']
        if identity not in self.native_receipts:
            receipt = {'id': supplied.identity(80 + len(self.native_receipts)), 'run_id': self.f.consumer_id,
                'stage_id': self.f.consumer_stage, 'attempt_id': self.f.consumer_attempt, **arguments['p_payload']}
            self.native_receipts[identity] = receipt
            self.f.tables['model_run_artifacts'].append(receipt)
        if self.lose == arguments['p_payload']['artifact_type']:
            self.lose = None
            raise TimeoutError('supplied managed reply loss')
        return supplied.response(self.native_receipts[identity])

    def recovered_reader(self):
        return recovery.recovery_reader(self.f.root, self.directory, **self.destination,
            workspace_id=self.f.workspace, run_id=self.f.consumer_id, stage_id=self.f.consumer_stage,
            custody='managed_attempt', claim_request_id=self.context.claim_request_id,
            service_key='fixture-only', get=self.get, post=self.post)

    def reconcile(self):
        return recovery.reconcile_publication(self.recovered_reader(), self.directory, **self.destination,
            service_key='fixture-only', post=self.post)

    def admissions(self):
        with sqlite3.connect(self.directory / 'model-commands.sqlite3') as connection:
            return connection.execute('SELECT * FROM execution_admissions').fetchall()

    def interrupt(self):
        self.build()
        names = list(self.result['publication'])
        self.lose = names[2]
        for name in names[:2]:
            self.reader.record_artifact(self.result['publication'][name], workspace_id=self.f.workspace, logical_name=name)
        with self.assertRaisesRegex(client.DeliveryUnconfirmed, '^Model RPC transport did not confirm a receipt$'):
            self.reader.record_artifact(self.result['publication'][names[2]], workspace_id=self.f.workspace, logical_name=names[2])

    def test_managed_pending_receipt_recovery_never_reopens_writer_or_admission(self):
        self.interrupt()
        before = self.admissions()
        frozen = journal.pending(self.directory, self.context.destination)[0]['command']
        result = self.reconcile()
        self.assertEqual(len(result['artifact_ids']), 7)
        self.assertEqual(self.posts[2], self.posts[3])
        self.assertEqual(self.admissions(), before)
        self.assertTrue(self.reader.stopped)
        with self.assertRaises(ReconciliationRequired):
            self.reader.require_open()
        retained = journal.read_existing(self.directory, self.context.destination, frozen['request_id'])
        self.assertTrue(retained[0]['resolved'])
        self.assertEqual(retained[0]['command'], frozen)
        self.assertFalse(result['model_resumed'])
        self.assertFalse((self.reader.files.path / 'state.json').exists())

    def test_native_and_recovery_managed_commands_share_exact_logical_identity(self):
        self.build()
        for name, payload in self.result['publication'].items():
            self.reader.record_artifact(payload, workspace_id=self.f.workspace, logical_name=name)
            expected = recovery.artifact_command(self.reader, name, payload, **self.destination)
            actual = journal.read_existing(self.directory, self.context.destination, expected['request_id'])
            self.assertEqual(len(actual), 1, 'Normal writer and recovery must share one command identity')
            self.assertEqual(actual[0]['command'], expected)
        self.assertEqual(len(self.posts), 7)

    def test_revoked_managed_attempt_refuses_before_receipt_transport(self):
        self.interrupt()
        self.f.tables['model_run_stages'][1]['active_attempt_id'] = None
        with self.assertRaisesRegex(client.OwnershipUnconfirmed, '^Original population attempt no longer owns publication$'):
            self.reconcile()
        self.assertEqual(len(self.posts), 3)
        self.assertTrue(self.reader.stopped)

    def test_missing_consumed_admission_is_not_recreated(self):
        self.interrupt()
        with sqlite3.connect(self.directory / 'model-commands.sqlite3') as connection:
            connection.execute('UPDATE execution_admissions SET entered=0')
        with self.assertRaisesRegex(ValueError, '^Consumed original population admission required$'):
            self.reconcile()
        self.assertEqual(self.admissions()[0][2], 0)
        self.assertEqual(len(self.posts), 3)

    def test_changed_attempt_owner_refuses_without_legacy_fallback(self):
        self.interrupt()
        path = self.reader.files.path / 'attempt_owner.json'
        owner = json.loads(path.read_bytes())
        owner['attempt_id'] = supplied.identity(95)
        path.write_text(json.dumps(owner))
        with self.assertRaisesRegex(ValueError, '^Population recovery attempt owner differs$'):
            self.reconcile()
        self.assertEqual(len(self.posts), 3)
        with self.assertRaisesRegex(ValueError, '^Legacy population recovery cannot carry a managed claim$'):
            recovery.recovery_reader(self.f.root, self.directory, **self.destination,
                workspace_id=self.f.workspace, run_id=self.f.consumer_id, stage_id=self.f.consumer_stage,
                custody='legacy_stage_snapshot', claim_request_id=self.context.claim_request_id, service_key='fixture-only')


if __name__ == '__main__':
    unittest.main()
