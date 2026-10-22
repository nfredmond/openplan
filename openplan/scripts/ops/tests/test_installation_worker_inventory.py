"""Native private-file checks for declared worker inventory, not installed discovery."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_worker_inventory as subject


class InstallationWorkerInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='openplan-worker-inventory-')
        self.base = Path(self.temporary.name)
        self.base.chmod(0o700)
        self.repo = self.base / 'software'
        for name, (relative, _) in subject.FAMILIES.items():
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Synthetic entrypoint ' + name + '\n')
        package = self.repo / 'openplan/package.json'
        package.write_text(json.dumps({'scripts': subject.KNOWN_NPM_COMMANDS}))
        for relative in subject.LAUNCHERS.values():
            (self.repo / relative).write_text('Synthetic launcher\n')
        self.root = self.base / 'worker'
        self.root.mkdir(mode=0o700)
        self.config = self.base / 'private.env'
        self.config.write_bytes(b'SYNTHETIC_CONFIG=original\n')
        self.config.chmod(0o400)
        self.profile = {
            'format': subject.PROFILE_FORMAT, 'installationId': 'synthetic-installation',
            'roots': [{'id': 'model', 'path': str(self.root)}],
            'configuration': [{'id': 'environment', 'path': str(self.config)}],
            'workers': {name: {'state': 'unassessed', 'custody': 'unassessed', 'rootIds': [],
                               'configurationIds': [], 'notes': 'No installed-service assessment.'} for name in subject.FAMILIES},
        }
        self.profile['workers']['aequilibrae'] = {'state': 'configured', 'custody': 'local_roots',
            'rootIds': ['model'], 'configurationIds': ['environment'], 'notes': 'Synthetic explicit roots, no engine run.'}
        self.path = self.base / 'profile.json'
        self.save()
        self.destination = self.base / 'inventory'

    def tearDown(self):
        self.temporary.cleanup()

    def save(self):
        self.path.write_bytes(subject.json_bytes(self.profile))
        self.path.chmod(0o600)

    def capture(self, **options):
        return subject.capture(self.path, self.destination, writers_quiesced=True, repo=self.repo, **options)

    def validate(self):
        return subject.validate_profile(subject.json_bytes(self.profile), subject.catalogue(self.repo, subject.root_set.deadline_for(10)))

    def rewrite_receipt(self):
        receipt = self.destination / 'snapshot.json'
        record = subject.read_json(receipt.read_bytes())
        rows = subject.root.inventory(self.destination, subject.root_set.deadline_for(10))
        rows.pop('snapshot.json')
        record['entries'] = rows
        receipt.write_bytes(subject.json_bytes(record))

    def test_current_software_catalogue(self):
        result = subject.catalogue(subject.REPO, subject.root_set.deadline_for(10))
        self.assertEqual(set(result['families']), set(subject.FAMILIES))
        self.assertEqual(len(result['families']), 15)
        self.assertEqual(result['families']['planner-agent-connector']['entrypoint'], 'workers/planner_agent_connector/connector.mjs')
        self.assertEqual(sum(bool(row['npmScript']) for row in result['families'].values()), 11)
        self.assertTrue(all(len(row['sha256']) == 64 for row in result['families'].values()))
        package = json.loads((subject.REPO / 'openplan/package.json').read_text())
        for row in result['families'].values():
            self.assertEqual(row['sha256'], hashlib.sha256((subject.REPO / row['entrypoint']).read_bytes()).hexdigest())
            self.assertEqual(row['npmCommand'], package['scripts'].get(row['npmScript']))
            if row['launcher']:
                self.assertEqual(row['launcherSha256'], hashlib.sha256((subject.REPO / row['launcher']).read_bytes()).hexdigest())
        self.assertEqual(result['packageSha256'], hashlib.sha256((subject.REPO / 'openplan/package.json').read_bytes()).hexdigest())

    def test_exact_private_configuration(self):
        marker = self.base / 'must-not-execute'
        self.config.chmod(0o600)
        payload = ('SYNTHETIC=$(touch ' + str(marker) + ')\n').encode()
        self.config.write_bytes(payload)
        self.config.chmod(0o400)
        original = self.path.read_bytes()
        record = self.capture()
        self.assertEqual(subject.verify(self.destination), record)
        self.assertEqual((self.destination / 'profile.json').read_bytes(), original)
        self.assertEqual((self.destination / 'configuration/environment').read_bytes(), payload)
        self.assertEqual((self.destination / 'configuration/environment').stat().st_mode & 0o777, 0o400)
        self.assertFalse(marker.exists())
        self.assertEqual(record['installationCoverage'], 'unassessed')
        self.assertEqual(record['coverage'], 'operator_declared')
        chosen = subject.root_set.read_inventory((self.destination / 'inventory.json').read_bytes())
        self.assertEqual(chosen['roots'], self.profile['roots'])
        self.assertEqual(chosen['workerAssessments'], self.profile['workers'])

    def test_shared_and_historical_roots(self):
        self.profile['workers']['synthesis-generation'] = deepcopy(self.profile['workers']['aequilibrae'])
        self.profile['workers']['synthesis-execution'] = deepcopy(self.profile['workers']['aequilibrae'])
        self.profile['workers']['gtfs-ingestion']['state'] = 'not_deployed'
        self.profile['workers']['gtfs-ingestion']['rootIds'] = ['model']
        self.save()
        self.capture()
        chosen = subject.read_json((self.destination / 'inventory.json').read_bytes())
        self.assertEqual(len(chosen['roots']), 1)
        self.assertEqual(chosen['workerAssessments'], self.profile['workers'])

    def test_relocated_verify_without_original_paths(self):
        record = self.capture()
        relocated = self.base / 'relocated'
        shutil.copytree(self.destination, relocated)
        shutil.rmtree(self.destination)
        shutil.rmtree(self.repo)
        shutil.rmtree(self.root)
        self.config.unlink()
        self.path.unlink()
        self.assertEqual(subject.verify(relocated), record)

    def test_unknown_npm_entrypoint(self):
        package = self.repo / 'openplan/package.json'
        value = json.loads(package.read_text())
        value['scripts']['worker:unreviewed'] = 'synthetic extra'
        package.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'catalogue needs review'):
            self.capture()

    def test_unknown_python_entrypoint(self):
        path = self.repo / 'workers/unreviewed/main.py'
        path.parent.mkdir()
        path.write_text('synthetic extra')
        with self.assertRaisesRegex(ValueError, 'catalogue needs review'):
            self.capture()

    def test_retargeted_known_npm_command(self):
        path = self.repo / 'openplan/package.json'
        value = json.loads(path.read_text())
        value['scripts']['worker:document-exports'] = 'node scripts/workers/unreviewed.ts'
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'catalogue needs review'):
            self.capture()

    def test_invalid_software_scripts_diagnostic(self):
        (self.repo / 'openplan/package.json').write_text(json.dumps({'scripts': []}))
        with self.assertRaisesRegex(ValueError, 'package scripts are invalid'):
            self.capture()

    def test_non_string_software_command(self):
        path = self.repo / 'openplan/package.json'
        package = json.loads(path.read_text())
        package['scripts']['worker:aequilibrae'] = {'invalid': 'object'}
        path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'package scripts are invalid'):
            self.capture()

    def test_empty_selection_remains_unassessed(self):
        self.profile['roots'] = []
        self.profile['configuration'] = []
        self.profile['workers']['aequilibrae'] = deepcopy(self.profile['workers']['odm'])
        self.save()
        self.capture()
        chosen = subject.read_json((self.destination / 'inventory.json').read_bytes())
        self.assertEqual(chosen['roots'], [])
        self.assertEqual(len(chosen['workerAssessments']), 15)
        self.assertTrue(all(value['state'] == 'unassessed' for value in chosen['workerAssessments'].values()))
        self.assertEqual(chosen['installationCoverage'], 'unassessed')

    def test_duplicate_json_keys(self):
        payload = self.path.read_text().replace('"format":', '"format":"ignored", "format":', 1)
        with self.assertRaisesRegex(ValueError, 'duplicate keys'):
            subject.validate_profile(payload, subject.catalogue(self.repo, subject.root_set.deadline_for(10)))

    def test_nested_duplicate_json_keys(self):
        payload = self.path.read_text().replace('"custody":', '"custody":"ignored", "custody":', 1)
        with self.assertRaisesRegex(ValueError, 'duplicate keys'):
            subject.validate_profile(payload, subject.catalogue(self.repo, subject.root_set.deadline_for(10)))

    def test_profile_shape_and_id(self):
        for field, value, error in [('format', 'foreign', 'profile format differs'), ('installationId', '../escape', 'ID is unsafe')]:
            with self.subTest(field=field):
                previous = self.profile[field]
                self.profile[field] = value
                with self.assertRaisesRegex(ValueError, error):
                    self.validate()
                self.profile[field] = previous

    def test_root_selection_syntax(self):
        self.profile['roots'][0]['path'] = 'relative'
        with self.assertRaisesRegex(ValueError, 'source path is not absolute'):
            self.validate()

    def test_configuration_shape(self):
        self.profile['configuration'][0]['extra'] = True
        with self.assertRaisesRegex(ValueError, 'selection shape differs'):
            self.validate()

    def test_configuration_id(self):
        self.profile['configuration'][0]['id'] = '../escape'
        self.profile['workers']['aequilibrae']['configurationIds'] = ['../escape']
        with self.assertRaisesRegex(ValueError, 'ID is unsafe'):
            self.validate()

    def test_duplicate_configuration_ids(self):
        self.profile['configuration'].append(deepcopy(self.profile['configuration'][0]))
        with self.assertRaisesRegex(ValueError, 'IDs are duplicated'):
            self.validate()

    def test_configuration_path(self):
        self.profile['configuration'][0]['path'] = 'relative'
        with self.assertRaisesRegex(ValueError, 'path is not absolute'):
            self.validate()

    def test_every_family_assessed(self):
        del self.profile['workers']['odm']
        with self.assertRaisesRegex(ValueError, 'Every known worker family'):
            self.validate()

    def test_assessment_shape(self):
        self.profile['workers']['odm']['extra'] = True
        with self.assertRaisesRegex(ValueError, 'assessment shape differs'):
            self.validate()

    def test_assessment_state(self):
        self.profile['workers']['odm']['state'] = 'zero'
        with self.assertRaisesRegex(ValueError, 'assessment state differs'):
            self.validate()

    def test_assessment_custody(self):
        self.profile['workers']['aequilibrae']['custody'] = 'zero'
        with self.assertRaisesRegex(ValueError, 'custody assessment differs'):
            self.validate()

    def test_assessment_explanation(self):
        self.profile['workers']['odm']['notes'] = '  '
        with self.assertRaisesRegex(ValueError, 'needs an explanation'):
            self.validate()

    def test_assessment_references(self):
        self.profile['workers']['odm']['rootIds'] = ['model', 'model']
        with self.assertRaisesRegex(ValueError, 'references differ'):
            self.validate()

    def test_configured_configuration_required(self):
        self.profile['workers']['aequilibrae']['configurationIds'] = []
        self.profile['workers']['odm']['configurationIds'] = ['environment']
        with self.assertRaisesRegex(ValueError, 'needs retained configuration'):
            self.validate()

    def test_local_custody_root_required(self):
        self.profile['workers']['aequilibrae']['rootIds'] = []
        self.profile['workers']['odm']['rootIds'] = ['model']
        with self.assertRaisesRegex(ValueError, 'needs a selected root'):
            self.validate()

    def test_unassessed_custody_not_promoted(self):
        self.profile['workers']['odm']['custody'] = 'external'
        with self.assertRaisesRegex(ValueError, 'must remain unassessed'):
            self.validate()

    def test_unreferenced_selections(self):
        self.profile['roots'].append({'id': 'forgotten', 'path': str(self.base / 'forgotten')})
        with self.assertRaisesRegex(ValueError, 'no assessment reference'):
            self.validate()

    def test_configuration_list(self):
        self.profile['configuration'] = {}
        self.profile['roots'] = []
        self.profile['workers']['aequilibrae'] = deepcopy(self.profile['workers']['odm'])
        with self.assertRaisesRegex(ValueError, 'not a list'):
            self.validate()

    def test_retained_catalogue_format(self):
        catalogue = subject.catalogue(self.repo, subject.root_set.deadline_for(10))
        catalogue['format'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'catalogue format differs'):
            subject.validate_profile(self.path.read_bytes(), catalogue)

    def test_declared_quiescence(self):
        with self.assertRaisesRegex(ValueError, 'Quiesce configuration writers'):
            subject.capture(self.path, self.destination, writers_quiesced=False, repo=self.repo)

    def test_private_inputs(self):
        self.config.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'accessible to other users'):
            self.capture()

    def test_source_directory_not_configuration_file(self):
        self.profile['configuration'][0]['path'] = str(self.root)
        self.save()
        with self.assertRaisesRegex(ValueError, 'must be a private file'):
            self.capture()

    def test_selected_roots_overlap(self):
        child = self.root / 'nested'
        child.mkdir(mode=0o700)
        self.profile['roots'].append({'id': 'nested', 'path': str(child)})
        self.profile['workers']['aequilibrae']['rootIds'].append('nested')
        self.save()
        with self.assertRaisesRegex(ValueError, 'Selected worker roots overlap'):
            self.capture()

    def test_destination_overlaps_root(self):
        self.destination = self.root / 'inside'
        with self.assertRaisesRegex(ValueError, 'destination overlaps'):
            self.capture()

    def test_existing_destination_refused(self):
        self.destination.mkdir(mode=0o700)
        with self.assertRaises(FileExistsError):
            self.capture()

    def test_configuration_changes_during_capture(self):
        sync = subject.root.sync_directory
        def changing(path):
            if path.name == 'configuration':
                self.config.chmod(0o600)
                self.config.write_bytes(b'Changed configuration\n')
                self.config.chmod(0o400)
            sync(path)
        with patch.object(subject.root, 'sync_directory', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'configuration changed during capture'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_profile_changes_during_capture(self):
        write = subject.write_private
        def changing(path, payload, deadline):
            write(path, payload, deadline)
            if path.name == 'inventory.json':
                self.path.write_bytes(self.path.read_bytes() + b' ')
        with patch.object(subject, 'write_private', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'profile changed during capture'):
                self.capture()

    def test_software_changes_during_capture(self):
        write = subject.write_private
        def changing(path, payload, deadline):
            write(path, payload, deadline)
            if path.name == 'inventory.json':
                source = self.repo / subject.FAMILIES['ocr'][0]
                source.write_text('Changed software\n')
        with patch.object(subject, 'write_private', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'software catalogue changed during capture'):
                self.capture()

    def test_copied_configuration_checked(self):
        sync = subject.root.journal.sync_file
        def changing(path):
            if path.name == 'environment':
                path.chmod(0o600)
                path.write_bytes(b'Wrong copied configuration\n')
                path.chmod(0o400)
            sync(path)
        with patch.object(subject.root.journal, 'sync_file', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'configuration bytes differ'):
                self.capture()

    def test_copied_profile_checked(self):
        write = subject.write_private
        def changing(path, payload, deadline):
            write(path, payload + b' ' if path.name == 'profile.json' else payload, deadline)
        with patch.object(subject, 'write_private', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'profile bytes differ'):
                self.capture()

    def test_profile_and_configuration_precede_selection(self):
        write = subject.write_private
        def observing(path, payload, deadline):
            if path.name == 'inventory.json':
                self.assertEqual((self.destination / 'profile.json').read_bytes(), self.path.read_bytes())
                self.assertTrue((self.destination / 'configuration/environment').exists(), 'Configuration must precede root selection')
                self.assertFalse((self.destination / 'snapshot.json').exists(), 'Receipt must publish last')
            write(path, payload, deadline)
        with patch.object(subject, 'write_private', side_effect=observing):
            self.capture()

    def test_directory_sync_required(self):
        sync = subject.root.sync_directory
        with patch.object(subject.root, 'sync_directory', wraps=sync) as observed:
            self.capture()
        self.assertIn(unittest.mock.call(self.destination / 'configuration'), observed.call_args_list)
        self.assertIn(unittest.mock.call(self.destination), observed.call_args_list)

    def test_file_sync_required(self):
        sync = os.fsync
        observed = set()
        def observing(descriptor):
            observed.add(os.readlink('/proc/self/fd/' + str(descriptor)))
            sync(descriptor)
        with patch.object(os, 'fsync', side_effect=observing):
            self.capture()
        for name in ('profile.json', 'catalogue.json', 'inventory.json', 'configuration/environment'):
            self.assertIn(str(self.destination / name), observed, 'Every retained file must be synced')

    def test_publication_failure_no_receipt(self):
        with patch.object(subject.root_set, 'publish', side_effect=OSError('Synthetic sync refusal')):
            with self.assertRaisesRegex(OSError, 'Synthetic sync refusal'):
                self.capture()
        self.assertFalse((self.destination / 'snapshot.json').exists())

    def test_deadline_bounds(self):
        for value in (float('inf'), float('nan'), 0, -1):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, 'positive and finite'):
                    self.capture(timeout=value)
        with self.assertRaises(TimeoutError):
            self.capture(timeout=1e-15)

    def test_profile_size_bound(self):
        self.path.write_bytes(b' ' * (1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, 'below one MiB'):
            self.capture()

    def test_profile_directory_diagnostic(self):
        self.path = self.root
        with self.assertRaisesRegex(ValueError, 'must be a private file'):
            self.capture()

    def test_verifier_refuses_changed_bytes(self):
        self.capture()
        (self.destination / 'configuration/environment').chmod(0o600)
        (self.destination / 'configuration/environment').write_bytes(b'Changed retained bytes')
        with self.assertRaisesRegex(ValueError, 'bytes or layout differ'):
            subject.verify(self.destination)

    def test_selection_binding_even_with_rewritten_census(self):
        self.capture()
        chosen = self.destination / 'inventory.json'
        chosen.write_bytes(chosen.read_bytes() + b' ')
        self.rewrite_receipt()
        with self.assertRaisesRegex(ValueError, 'selection binding differs'):
            subject.verify(self.destination)

    def test_manifest_cannot_promote_coverage(self):
        self.capture()
        receipt = self.destination / 'snapshot.json'
        value = subject.read_json(receipt.read_bytes())
        value['installationCoverage'] = 'complete'
        receipt.write_bytes(subject.json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'manifest format differs'):
            subject.verify(self.destination)

    def test_package_layout_even_with_rewritten_census(self):
        self.capture()
        extra = self.destination / 'extra'
        extra.write_bytes(b'Unexpected artifact')
        extra.chmod(0o600)
        self.rewrite_receipt()
        with self.assertRaisesRegex(ValueError, 'package layout differs'):
            subject.verify(self.destination)

    def test_configuration_layout_even_with_rewritten_census(self):
        self.capture()
        extra = self.destination / 'configuration/extra'
        extra.write_bytes(b'Unexpected configuration')
        extra.chmod(0o600)
        self.rewrite_receipt()
        with self.assertRaisesRegex(ValueError, 'configuration layout differs'):
            subject.verify(self.destination)

    def test_cli_scope_and_diagnostics(self):
        self.capture()
        with patch.object(sys, 'argv', ['inventory', '--verify', str(self.destination), '--profile', str(self.path)]):
            with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as result:
                subject.main()
        self.assertEqual(result.exception.code, 2)
        with patch.object(sys, 'argv', ['inventory', '--verify', str(self.base / 'private-missing-marker')]):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(subject.main(), 1)
        self.assertNotIn(str(self.base), output.getvalue())
        self.assertIn('FileNotFoundError', output.getvalue())

    def test_cli_capture_arguments_required(self):
        with patch.object(sys, 'argv', ['inventory']):
            with self.assertRaises(SystemExit) as result:
                subject.main()
        self.assertEqual(result.exception.code, 2)

    def test_verifier_deadline_bounds(self):
        self.capture()
        with self.assertRaisesRegex(ValueError, 'positive and finite'):
            subject.verify(self.destination, timeout=float('inf'))
        with self.assertRaises(TimeoutError):
            subject.verify(self.destination, timeout=1e-15)


if __name__ == '__main__':
    unittest.main()
