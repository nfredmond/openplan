"""Check operator configuration reaches the actual pipeline runtime boundary."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/activitysim_worker'))
sys.path.insert(0, str(ROOT / 'scripts/modeling'))
sys.path.insert(0, str(ROOT / 'scripts/modeling/tests'))
with patch.dict(os.environ, {"SUPABASE_URL": "http://supabase.test", "SUPABASE_SERVICE_ROLE_KEY": "synthetic-test-key"}):
    import supabase_poll
import run_behavioral_demand_prototype as pipeline
from test_run_behavioral_demand_prototype import build_screening_run

POLICY = {'host_memory_bytes': 134217728, 'host_tasks': 32,
          'container_memory_bytes': 67108864, 'container_tasks': 16,
          'container_supervision_socket': '/run/operator-docker.sock'}


class PipelineSupervisionTests(unittest.TestCase):
    def test_operator_policy_reaches_runtime_without_substitution(self):
        # Exercise host and container separately; selecting both is invalid.
        for keys in (('host_memory_bytes', 'host_tasks'),
                     ('container_memory_bytes', 'container_tasks', 'container_supervision_socket')):
            selected = {key: POLICY[key] for key in keys}
            env = {f'ACTIVITYSIM_{key.upper()}': str(value) for key, value in selected.items()}
            with self.subTest(keys=keys), tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, env, clear=True):
                config = supabase_poll._activitysim_exec_config()
                for key in POLICY:
                    self.assertEqual(config[key], selected.get(key))
                screening = build_screening_run(Path(directory))
                with patch.object(pipeline, 'run_activitysim_runtime', side_effect=RuntimeError('runtime boundary reached')) as runtime:
                    with self.assertRaisesRegex(RuntimeError, 'runtime boundary reached'):
                        pipeline.run_behavioral_demand_prototype(screening_run_dir=str(screening), **config)
                for key in POLICY:
                    self.assertEqual(runtime.call_args.kwargs[key], selected.get(key))

    def test_cli_policy_reaches_pipeline(self):
        argv = ['pipeline', '--screening-run-dir', '/synthetic']
        for key, value in POLICY.items():
            argv.extend(['--' + key.replace('_', '-'), str(value)])
        with patch.object(sys, 'argv', argv), patch.object(pipeline, 'run_behavioral_demand_prototype', side_effect=RuntimeError('pipeline boundary reached')) as invoke:
            with self.assertRaisesRegex(RuntimeError, 'pipeline boundary reached'):
                pipeline.main()
        for key, value in POLICY.items():
            self.assertEqual(invoke.call_args.kwargs[key], value)

    def test_malformed_operator_limit_refuses_configuration(self):
        for key in ('host_memory_bytes', 'host_tasks', 'container_memory_bytes', 'container_tasks'):
            with self.subTest(key=key), patch.dict(os.environ, {f'ACTIVITYSIM_{key.upper()}': 'invalid'}, clear=True):
                with self.assertRaises(ValueError):
                    supabase_poll._activitysim_exec_config()
