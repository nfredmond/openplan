"""Preserve runtime command/mount/environment meaning at the supervised boundary."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from container_execution import run_supervised_execution
from runtime import build_container_command, run_activitysim_runtime, prepare_runtime_directory


class ContainerExecutionTests(unittest.TestCase):
    def setUp(self):
        with patch('runtime.shutil.which', return_value='/usr/bin/docker'):
            _, self.execution = build_container_command(bundle_dir=Path('/synthetic/bundle'),
                config_dir=Path('/synthetic/configs'), runtime_dir=Path('/synthetic/runtime'),
                image='requested:latest', memory_bytes=67108864, tasks=16)
        self.client_factory = self.enterContext(patch('container_execution.LocalDocker'))
        self.client = self.client_factory.return_value.__enter__.return_value
        self.client.daemon_id = 'synthetic-daemon'
        self.client._json.return_value = {'Id': 'sha256:' + '1' * 64,
            'Config': {'Env': ['PATH=/usr/bin', 'HOME=/root'], 'Entrypoint': []}}
        self.controller = self.enterContext(patch('container_execution.run_container_command', return_value=subprocess.CompletedProcess([], 0)))

    def run_execution(self):
        return run_supervised_execution(self.execution, socket_path='/run/docker.sock',
            records=Path('/synthetic/custody'), log_path=Path('/synthetic/log'))

    def test_image_is_pinned_and_existing_command_mounts_and_home_survive(self):
        _, metadata = self.run_execution()
        plan = self.controller.call_args.args[0]
        self.assertEqual(plan.image_id, 'sha256:' + '1' * 64)
        self.assertEqual(plan.command, tuple(self.execution['inner_command']))
        self.assertEqual(plan.mounts, tuple((m['source'], m['target'], m['read_only']) for m in self.execution['mounts']))
        self.assertEqual(plan.environment, ('PATH=/usr/bin', 'HOME=' + self.execution['container_paths']['home_dir']))
        self.assertEqual(plan.working_dir, self.execution['container_paths']['working_dir'])
        self.assertEqual(metadata['resolved_container_image'], plan.image_id)
        self.client._json.assert_called_once_with('GET', '/v1.51/images/requested%3Alatest/json')

    def test_engine_arguments_are_not_silently_discarded(self):
        self.execution['engine_command'] = ['/usr/bin/docker', '--context', 'other']
        with self.assertRaisesRegex(ValueError, 'plain local Docker'):
            self.run_execution()
        self.client_factory.assert_not_called(); self.controller.assert_not_called()

    def test_unconfirmed_image_cannot_execute(self):
        for image in ({'Id': 'tag-only', 'Config': {'Env': [], 'Entrypoint': []}},
                      {'Id': 'sha256:' + '1' * 64, 'Config': {'Env': None}}):
            self.client._json.return_value = image
            with self.subTest(image=image), self.assertRaises(ValueError):
                self.run_execution()
        self.controller.assert_not_called()

    def test_supervision_requires_explicit_limits_and_absolute_socket(self):
        with patch('runtime.resolve_bundle_paths', side_effect=AssertionError('Bundle accessed before policy')):
            for options in ({}, {'container_image': 'synthetic'},
                            {'container_image': 'synthetic', 'container_memory_bytes': 1, 'container_tasks': 1, 'container_supervision_socket': 'relative'}):
                args = {'container_supervision_socket': '/run/docker.sock', **options}
                with self.subTest(options=options), self.assertRaisesRegex(ValueError, 'Container supervision'):
                    run_activitysim_runtime(**args)

    def test_force_cannot_erase_output_linked_to_retained_custody(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); output = root / 'runtime'; output.mkdir()
            marker = output / 'retained.log'; marker.write_text('earlier command')
            (root / 'runtime.container-custody').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'Retained container custody'):
                prepare_runtime_directory(bundle_dir=root, runtime_dir=str(output), run_label=None, force=True)
            self.assertEqual(marker.read_text(), 'earlier command')
