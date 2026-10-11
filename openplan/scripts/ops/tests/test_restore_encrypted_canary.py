"""Execute the drill's canary block. PostgreSQL remains a native boundary."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

OPS = Path(__file__).resolve().parents[1]


class EncryptedCanaryTests(unittest.TestCase):
    def test_actual_shell_block_checks_one_decrypted_record(self):
        source = (OPS/'disposable-restore-drill.sh').read_text()
        marker = '  ENCRYPTED_CANARY=$(docker exec'
        self.assertIn(marker, source)
        start = source.index(marker)
        end = source.index('  if [[ -n "${OPENPLAN_RESTORE_EVIDENCE_DIR:-}"', start)
        block = source[start:end]
        self.assertIn('python3 "$APP_ROOT/scripts/ops/full_restore.py"', source[:start].split('if $FULL_ARCHIVE; then')[-1])
        for answer, status, passing in [('1',0,True),('0',0,False),('2',0,False),('',0,False),('1',7,False)]:
            with self.subTest(answer=answer,status=status), tempfile.TemporaryDirectory() as root:
                directory = Path(root); docker = directory/'docker'; log = directory/'arguments.json'
                docker.write_text('#!/usr/bin/env python3\nimport json,os,sys\nfrom pathlib import Path\nPath(os.environ["CANARY_LOG"]).write_text(json.dumps(sys.argv[1:]))\nprint(os.environ["CANARY_ANSWER"])\nsys.exit(int(os.environ["CANARY_STATUS"]))\n')
                docker.chmod(0o700)
                result = subprocess.run(['bash','-euo','pipefail','-c',block],env={**os.environ,'PATH':root+os.pathsep+os.environ['PATH'],'TARGET_DB':'supabase_db_openplan-restore-target-555','CANARY_LOG':str(log),'CANARY_ANSWER':answer,'CANARY_STATUS':str(status)},capture_output=True,text=True)
                self.assertEqual(result.returncode==0,passing, 'Canary accepted a missing, duplicate or failed decryption')
                args=json.loads(log.read_text())
                self.assertEqual(args[:3], ['exec','supabase_db_openplan-restore-target-555','psql'])
                self.assertIn('ON_ERROR_STOP=1',args)
                self.assertIn("SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'openplan_recovery_canary' AND decrypted_secret = 'OpenPlan synthetic encrypted recovery fixture'",args)


if __name__ == '__main__': unittest.main()
