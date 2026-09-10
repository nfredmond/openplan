"""Run the actual shell entry point with isolated tools and an existing container."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

OPS = Path(__file__).resolve().parents[1]


class RestoreDrillOwnershipTests(unittest.TestCase):
    def exercise(self, args=()):
        with tempfile.TemporaryDirectory(prefix='restore-entry-test-') as directory:
            root = Path(directory)
            app = root/'app'
            (app/'scripts/ops').mkdir(parents=True)
            (app/'supabase/migrations').mkdir(parents=True)
            (app/'supabase/config.toml').write_text('[api]\nport = 54321\n')
            (app/'supabase/migrations/fixture.sql').write_text('SELECT 1;')
            shutil.copyfile(OPS/'disposable-restore-drill.sh', app/'scripts/ops/disposable-restore-drill.sh')
            shutil.copyfile(OPS/'restore_ports.py', app/'scripts/ops/restore_ports.py')
            binaries = root/'bin'
            binaries.mkdir()
            log = root/'calls.txt'
            log.write_text('')
            for name, code in {
                'docker': 'printf "docker %s\\n" "$*" >> "$PROBE_LOG"\n[ "$1" = inspect ] && exit 0\nexit 98\n',
                'npm': 'printf "npm %s\\n" "$*" >> "$PROBE_LOG"\nexit 99\n',
            }.items():
                script = binaries/name
                script.write_text('#!/bin/sh\n'+code)
                script.chmod(0o700)
            result = subprocess.run(['bash', str(app/'scripts/ops/disposable-restore-drill.sh'), *args], cwd=root,
                                    env={**os.environ, 'PATH': str(binaries)+os.pathsep+os.environ['PATH'],
                                         'PROBE_LOG': str(log), 'TMPDIR': str(root), 'OPENPLAN_RESTORE_KEEP': '0'}, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            return result, log.read_text(), list(root.glob('openplan-restore-drill.*'))

    def test_existing_project_is_neither_started_nor_cleaned_up(self):
        result, calls, leftovers = self.exercise()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refused an existing project', result.stdout)
        self.assertIn('docker inspect supabase_db_openplan-restore-source-', calls)
        self.assertNotIn('npm ', calls, 'An existing project reached start or cleanup')
        self.assertFalse(leftovers)

    def test_unknown_argument_is_refused_before_tools(self):
        result, calls, leftovers = self.exercise(('--unknown',))
        self.assertEqual(result.returncode, 2)
        self.assertIn('Usage:', result.stdout)
        self.assertEqual(calls, '')
        self.assertFalse(leftovers)


if __name__ == '__main__':
    unittest.main()
