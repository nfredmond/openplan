"""Container limits are operator policy, separate from lifecycle supervision."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import build_container_command, run_activitysim_runtime


class ContainerLimitsTests(unittest.TestCase):
    def build(self, **limits):
        with patch("runtime.shutil.which", return_value="/usr/bin/docker"):
            return build_container_command(bundle_dir=Path("/synthetic/bundle"),
                config_dir=Path("/synthetic/bundle/configs"), runtime_dir=Path("/synthetic/runtime"),
                image="synthetic-image", **limits)

    def test_explicit_memory_has_zero_swap_and_task_limit(self):
        command, metadata = self.build(memory_bytes=67108864, tasks=16)
        for flag, value in (("--memory", "67108864"), ("--memory-swap", "67108864"), ("--pids-limit", "16")):
            position = command.index(flag)
            self.assertLess(position, command.index("synthetic-image"))
            self.assertEqual(command[position + 1], value)
        self.assertEqual(metadata["resource_limits"], {"memory_bytes": 67108864, "memory_plus_swap_bytes": 67108864, "tasks": 16})

    def test_partial_or_invalid_limits_fail(self):
        for limits in ({"memory_bytes": 1}, {"tasks": 1}, {"memory_bytes": True, "tasks": 16},
                       {"memory_bytes": 1, "tasks": 0}, {"memory_bytes": -1, "tasks": 16},
                       {"memory_bytes": 1.5, "tasks": 16}):
            with self.subTest(limits=limits), self.assertRaisesRegex(ValueError, "Container limits"):
                self.build(**limits)

    def test_limits_cannot_be_silently_used_for_host_execution(self):
        with self.assertRaisesRegex(ValueError, "Container limits require a container image"):
            run_activitysim_runtime(container_memory_bytes=67108864, container_tasks=16)
