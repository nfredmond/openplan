"""Managed startup declares private retained state separately from scratch.

These path checks do not establish a persistent mount or host recovery.
"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import main


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='odm-state-root-');self.base=Path(self.temporary.name)
        self.state=self.base/'state';self.scratch=self.base/'scratch'
    def tearDown(self):self.temporary.cleanup()
    def config(self,**values):
        with patch.dict(os.environ,{'ODM_WORKER_MANAGED_ADMISSION':'1','ODM_WORKER_WORK_DIR':str(self.scratch),**values},clear=True):
            return main.config()

    def test_managed_mode_requires_declared_state(self):
        for values in ({},{'ODM_WORKER_MANAGED_STATE_DIR':''},{'ODM_WORKER_MANAGED_STATE_DIR':' '}):
            with self.assertRaisesRegex(ValueError,'STATE_DIR is required'):self.config(**values)
    def test_root_value_requires_nonempty_string(self):
        for value in (None,True,0,Path('/synthetic-state'),'',' '):
            with self.assertRaisesRegex(ValueError,'STATE_DIR is required'):main.managed_state_directory(value,str(self.scratch))
    def test_relative_state_refuses(self):
        for value in ('state','./state','../state','~/state'):
            with self.assertRaisesRegex(ValueError,'must be absolute'):main.managed_state_directory(value,str(self.scratch))
    def test_state_and_scratch_trees_do_not_overlap(self):
        for root in (self.scratch,self.scratch/'child',self.base):
            with self.assertRaisesRegex(ValueError,'must not overlap'):main.managed_state_directory(str(root),str(self.scratch))
    def test_alias_and_normalized_scratch_refuse(self):
        self.scratch.mkdir(mode=0o700);alias=self.base/'alias';alias.symlink_to(self.scratch,target_is_directory=True)
        for root in (alias,self.state/'..'/'scratch'):
            with self.assertRaisesRegex(ValueError,'must not overlap'):main.managed_state_directory(str(root),str(self.scratch))
    def test_default_scratch_is_not_a_managed_state_root(self):
        for root in (Path('/tmp/odm_worker_jobs'),Path('/tmp/odm_worker_jobs/state')):
            with self.assertRaisesRegex(ValueError,'default scratch'):main.managed_state_directory(str(root),str(self.scratch))
        with patch.object(main.tempfile,'gettempdir',return_value=str(self.base/'synthetic-system-temp')):
            with self.assertRaisesRegex(ValueError,'default scratch'):
                main.managed_state_directory(str(self.base/'synthetic-system-temp/odm_worker_jobs'),str(self.scratch))
    def test_explicit_state_keeps_scratch_separate_without_creating_it(self):
        value=self.config(ODM_WORKER_MANAGED_STATE_DIR=str(self.state/'..'/'state'))
        self.assertEqual(value['managed_state_dir'],str(self.state.resolve()),'Configuration must retain the declared managed state root')
        self.assertEqual(value['work_dir'],str(self.scratch),'Scratch must remain a separate location')
        self.assertFalse(self.state.exists());self.assertFalse(self.scratch.exists())
    def test_unmanaged_mode_keeps_existing_scratch_default(self):
        with patch.dict(os.environ,{'ODM_WORKER_MANAGED_ADMISSION':'0'},clear=True):value=main.config()
        self.assertIs(value['managed_admission'],False);self.assertEqual(value['managed_state_dir'],'')
        self.assertEqual(value['work_dir'],str(Path(tempfile.gettempdir())/'odm_worker_jobs'),'Unmanaged scratch default must remain compatible')
    def test_startup_rechecks_before_runtime_and_scratch(self):
        for root in ('',str(self.scratch)):
            with patch.dict(main.CONFIG,{'managed_admission':True,'managed_state_dir':root,'work_dir':str(self.scratch),
                'worker_token':'synthetic-worker','callback_token':'synthetic-callback','installation_id':'synthetic-installation'}),patch.object(main.os,'makedirs',side_effect=AssertionError('Invalid managed state reached scratch creation')),patch('runtime_admission.Runtime',side_effect=AssertionError('Invalid managed state reached runtime')):
                with self.assertRaises(ValueError):main.main()
    def test_missing_state_refuses_without_creating_root_or_scratch(self):
        with patch.dict(main.CONFIG,{'managed_admission':True,'managed_state_dir':str(self.state),'work_dir':str(self.scratch),
            'worker_token':'synthetic-worker','callback_token':'synthetic-callback','installation_id':'synthetic-installation'}):
            with self.assertRaises(FileNotFoundError):main.main()
        self.assertFalse(self.state.exists(),'Missing original state must not become a new root')
        self.assertFalse(self.scratch.exists(),'Missing retained state must refuse before scratch creation')


if __name__=='__main__':unittest.main()
