"""Synthetic command and stop checks; these do not establish model completion."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('controller',Path(__file__).with_name('run.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class ControllerTests(unittest.TestCase):
    def test_limits_and_no_trace(self):
        cmd=m.command('current-prefix',Path('/config'),Path('/output'),Path('/stock'))
        self.assertIn('MemoryMax=16G',cmd)
        self.assertIn('MemorySwapMax=0',cmd)
        self.assertIn('activitysim',cmd)
        self.assertFalse(any('profile-engine' in x for x in cmd))
        self.assertIn(str(m.PRIOR/'inputs-full'),cmd)
    def test_order(self):
        calls=[]; records=[{'arm':a} for a in ['current','semcog']]
        with patch.object(m,'save'):
            m.execute(records,lambda arm,part:calls.append((arm,part)))
        self.assertEqual(calls,[('current','prefix'),('current','suffix'),('semcog','prefix'),('semcog','suffix')])
    def test_stop(self):
        calls=[]; records=[{'arm':a,'status':'not_run'} for a in ['current','semcog']]
        def fail(arm,part):
            calls.append((arm,part)); raise RuntimeError('fixture engine failure')
        with patch.object(m,'save'),self.assertRaisesRegex(RuntimeError,'fixture engine failure'):
            m.execute(records,fail)
        self.assertEqual(calls,[('current','prefix')])
        self.assertEqual(records[0]['status'],'failed')
        self.assertEqual(records[1]['status'],'not_run')

if __name__=='__main__': unittest.main()
