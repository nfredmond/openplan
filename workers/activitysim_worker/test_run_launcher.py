#!/usr/bin/env python3
"""Prove the worker launcher prefers a complete ActivitySim execution venv."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


WORKER_DIR = Path(__file__).resolve().parent


class RunLauncherTests(unittest.TestCase):
    def test_complete_execution_venv_is_selected_and_configured(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            shutil.copy2(WORKER_DIR / "run.sh", root / "run.sh")
            (root / "supabase_poll.py").write_text("# launch target\n")
            bin_dir = root / ".venv-exec" / "bin"
            bin_dir.mkdir(parents=True)
            activitysim = bin_dir / "activitysim"
            activitysim.write_text("#!/bin/sh\nexit 0\n")
            activitysim.chmod(0o755)
            python = bin_dir / "python"
            python.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = \"-c\" ]; then exit 0; fi\n"
                "printf 'ACTIVITYSIM_CLI=%s\\nARGS=%s\\n' \"$ACTIVITYSIM_CLI\" \"$*\"\n"
            )
            python.chmod(0o755)

            result = subprocess.run(
                ["bash", str(root / "run.sh")],
                cwd=root,
                env={**os.environ, "PATH": os.environ.get("PATH", "")},
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Starting ActivitySim execution worker", result.stdout)
            self.assertIn(f"ACTIVITYSIM_CLI={activitysim}", result.stdout)
            self.assertIn("ARGS=-u supabase_poll.py", result.stdout)


if __name__ == "__main__":
    unittest.main()
