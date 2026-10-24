"""Check step attribution and a bounded child-only memory stop."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import monitor


class MonitorTests(unittest.TestCase):
    def test_generic_chunk_preserves_named_step(self):
        with tempfile.TemporaryDirectory() as tmp:
            state={}
            code='import os,time; print(f"[00:00.00] {os.getpid()} MainProcess INFO: #run_model running step school_location",flush=True); print(f"[00:00.01] {os.getpid()} MainProcess DEBUG: Running chunk 1 of 1",flush=True); time.sleep(1.1)'
            result=monitor.run_stage([sys.executable,'-u','-c',code],dict(__import__('os').environ),Path(tmp)/'stage',state)
            self.assertEqual(result['exit_code'],0)
            self.assertEqual(state['engine_step'],'#run_model running step school_location')
            rows=[json.loads(x) for x in (Path(tmp)/'stage/memory.jsonl').read_text().splitlines()]
            self.assertTrue(any(p['step'].endswith('school_location') for r in rows for p in r['processes'].values()))

    def test_engine_failure_is_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError,'exit 7'):
                monitor.run_stage([sys.executable,'-c','raise SystemExit(7)'],dict(__import__('os').environ),Path(tmp)/'stage',{})

    def test_memory_headroom_stops_owned_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            state={}
            with patch.object(monitor,'counters',return_value={'memory.max':'100','memory.current':'97','memory.peak':'97'}):
                with self.assertRaisesRegex(RuntimeError,'headroom guard'):
                    monitor.run_stage([sys.executable,'-c','import time; time.sleep(1.2)'],dict(__import__('os').environ),Path(tmp)/'stage',state)
            self.assertNotIn('active_pid',state)


if __name__=='__main__':unittest.main()
