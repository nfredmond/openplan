"""Operator configuration custody with real private files and admission journals."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from retained_source import json_bytes
from runtime_outcome_recovery import Runtime
import runtime_configuration as module
from test_worker_http import zip_request


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.root=self.base/'runtime';self.root.mkdir(mode=0o700)
        self.runtime=Runtime(self.root,'original-installation',max_queued=4,pipeline=lambda _:None)
        self.value={'format':module.FORMAT,'installationId':'original-installation','targetId':'original-target',
            'applicationEndpoint':'https://application.example/rest/v1','applicationCredentialReference':'application-original',
            'allowApplicationHttp':False,'engine':{'instanceId':'original-engine','endpoint':'http://127.0.0.1:8001',
                'api':'nodeodm-2.2.4-draft','version':'2.2.4','imageId':'sha256:'+'a'*64,
                'configurationSha256':'b'*64,'credentialReference':'engine-original'},
            'sourceRoot':str(self.base/'sources'),'publicBaseUrl':'https://worker.example',
            'callbackCredentialReference':'callback-original','daemonSocket':str(self.base/'daemon.sock'),'daemonUid':1000,
            'sourcePolicy':{'allowedNetworks':[],'allowedPorts':[80,443],'maxRedirects':5},
            'callbackPolicy':{'allowedNetworks':[],'allowedPorts':[80,443],'maxRedirects':0},
            'bounds':{'sourceMaxBytes':4096,'archiveMaxBytes':16384,'expandedMaxBytes':16384,
                'archiveMaxEntries':10,'archiveMaxDirectoryBytes':4096,'timeoutSeconds':4,'leaseSeconds':100,'pollSeconds':1}}
        self.binding=module.Binding(self.runtime,self.value)
    def test_exact_seal_replays_and_owned_check_preserves_inode(self):
        expected=module.configuration(self.value);self.assertEqual(self.binding.establish(),expected,'Original settings replay without replacement')
        path=self.root/module.NAME;inode=path.stat().st_ino;raw=path.read_bytes()
        self.assertEqual(self.binding.establish(),expected,'Original settings replay without replacement')
        with self.runtime.owner():self.assertEqual(self.binding.check(),expected,'Owned reads retain exact configuration')
        self.assertEqual(path.stat().st_ino,inode,'Configuration seal cannot replace its original inode')
        self.assertEqual(path.read_bytes(),raw,'Configuration seal retains exact original bytes')
        self.assertEqual(self.binding.sha256,hashlib.sha256(raw).hexdigest(),'Configuration digest binds exact original bytes')
    def test_changed_target_cannot_reuse_original_seal(self):
        self.binding.establish();changed={**self.value,'targetId':'another-target'}
        with self.assertRaisesRegex(ValueError,'Saved operator configuration differs'):module.Binding(self.runtime,changed).establish()
    def test_changed_engine_cannot_reuse_original_seal(self):
        self.binding.establish();changed=copy.deepcopy(self.value);changed['engine']['imageId']='sha256:'+'c'*64
        with self.assertRaisesRegex(ValueError,'Saved operator configuration differs'):module.Binding(self.runtime,changed).establish()
    def test_installation_mismatch_refuses_before_publication(self):
        changed={**self.value,'installationId':'another-installation'}
        with self.assertRaisesRegex(ValueError,'installation differs'):module.Binding(self.runtime,changed)
        self.assertFalse((self.root/module.NAME).exists(),'Wrong installation cannot publish configuration')
    def test_existing_admission_requires_adoption(self):
        self.runtime.submit(zip_request('original-pending-admission'))
        with self.assertRaisesRegex(ValueError,'admissions require explicit'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Original admissions cannot acquire inferred settings')
    def test_existing_private_record_requires_adoption(self):
        path=self.root/'original-retained-record.json';path.write_bytes(b'Original private record');path.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'retained records require explicit'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Retained records cannot acquire inferred settings')
    def test_owned_establish_refuses_before_writer(self):
        with self.runtime.owner(),patch.object(module,'writer',side_effect=AssertionError('Owned establish cannot reacquire runtime writer')):
            with self.assertRaisesRegex(ValueError,'precedes lifetime ownership'):self.binding.establish()
    def test_unowned_check_refuses_before_record_read(self):
        with patch.object(self.binding,'_read',side_effect=AssertionError('Unowned configuration cannot read private record')):
            with self.assertRaisesRegex(ValueError,'reads require lifetime'):self.binding.check()
    def test_oversized_saved_record_refuses_before_read(self):
        self.binding.establish();original=module.reader
        from contextlib import contextmanager
        @contextmanager
        def large(*args):
            with original(*args) as (stream,info):
                fake=type('Info',(),{'st_size':module.BOUND+1})()
                with patch.object(stream,'read',side_effect=AssertionError('Oversized configuration cannot allocate record bytes')):yield stream,fake
        with self.runtime.owner(),patch.object(module,'reader',large):
            with self.assertRaisesRegex(ValueError,'exceeds its bound'):self.binding.check()
    def test_short_saved_read_refuses(self):
        self.binding.establish();original=module.reader
        from contextlib import contextmanager
        @contextmanager
        def short(*args):
            with original(*args) as (stream,info):
                raw=stream.read();fake=type('Info',(),{'st_size':len(raw)+1})()
                from io import BytesIO
                yield BytesIO(raw),fake
        with self.runtime.owner(),patch.object(module,'reader',short):
            with self.assertRaisesRegex(ValueError,'length differs'):self.binding.check()
    def test_noncanonical_saved_record_refuses(self):
        self.binding.establish();p=self.root/module.NAME;p.write_bytes(p.read_bytes()+b'\n')
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'Saved operator configuration differs'):self.binding.check()
    def test_unknown_config_field_refuses(self):
        with self.assertRaisesRegex(ValueError,'fields differ'):module.configuration({**self.value,'apiKey':'unexpected-secret-field'})
    def test_reference_fields_refuse_empty_values(self):
        for key in ['installationId','targetId','applicationCredentialReference','callbackCredentialReference']:
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'references differ'):module.configuration({**self.value,key:''})
    def test_application_http_requires_explicit_opt_in(self):
        changed={**self.value,'applicationEndpoint':'http://127.0.0.1:8002'}
        with self.assertRaisesRegex(ValueError,'endpoint differs'):module.configuration(changed)
    def test_public_prefix_refuses_before_binding(self):
        with self.assertRaisesRegex(ValueError,'base URL'):module.configuration({**self.value,'publicBaseUrl':'https://worker.example/prefix'})
    def test_daemon_uid_refuses_boolean_and_negative(self):
        for value in [True,-1]:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'daemon owner differs'):module.configuration({**self.value,'daemonUid':value})
    def test_bounds_projection_refuses_extra_and_missing_fields(self):
        for bounds in [{**self.value['bounds'],'extra':1},{k:v for k,v in self.value['bounds'].items() if k!='pollSeconds'}]:
            with self.subTest(bounds=bounds),self.assertRaisesRegex(ValueError,'bounds fields differ'):module.configuration({**self.value,'bounds':bounds})
    def test_deadlines_refuse_nonfinite_and_boolean(self):
        for value in [True,0,float('inf'),float('nan')]:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'finite and positive'):module.configuration({**self.value,'bounds':{**self.value['bounds'],'timeoutSeconds':value}})
    def test_byte_and_entry_limits_refuse_boolean_and_zero(self):
        for value in [True,0]:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'positive integers'):module.configuration({**self.value,'bounds':{**self.value['bounds'],'sourceMaxBytes':value}})
    def test_runtime_type_refuses_before_configuration_reads(self):
        from types import SimpleNamespace
        foreign=SimpleNamespace(root=self.root,journal=self.runtime.journal)
        with patch.object(module,'configuration',side_effect=AssertionError('Foreign runtime cannot parse operator settings')):
            with self.assertRaisesRegex(ValueError,'original runtime'):module.Binding(foreign,self.value)
    def test_binding_timeout_refuses_nonfinite_before_configuration(self):
        with patch.object(module,'configuration',side_effect=AssertionError('Invalid binding deadline cannot parse operator settings')):
            with self.assertRaisesRegex(ValueError,'finite and positive'):module.Binding(self.runtime,self.value,timeout=float('inf'))
    def test_overlapping_roots_refuse_before_publication(self):
        for path in [self.root,self.root/'source-child',self.base]:
            with self.subTest(path=path),self.assertRaisesRegex(ValueError,'must not overlap'):module.Binding(self.runtime,{**self.value,'sourceRoot':str(path)})
    def test_canonical_configuration_is_detached_from_caller(self):
        original=copy.deepcopy(self.binding.value);self.value['engine']['instanceId']='caller-replacement'
        self.assertEqual(self.binding.value,original,'Caller mutations cannot alter the bound configuration')

    def test_mutated_bound_value_refuses_before_private_read(self):
        self.binding.establish();self.binding.value['targetId']='changed-after-binding'
        with self.runtime.owner(),patch.object(module,'reader',side_effect=AssertionError('Changed bound settings cannot read private record')):
            with self.assertRaisesRegex(ValueError,'Bound operator configuration changed'):self.binding.check()
    def test_new_configuration_size_limit_refuses(self):
        changed=copy.deepcopy(self.value);changed['engine']['instanceId']='a'*module.BOUND
        with patch.object(module,'parse',side_effect=AssertionError('Oversized new configuration cannot parse record bytes')):
            with self.assertRaisesRegex(ValueError,'configuration exceeds its bound'):module.configuration(changed)
    def test_configuration_publication_holds_admission_writer(self):
        import sqlite3
        from contextlib import closing
        from admission_journal import FILENAME
        original=module.publish;observed=[]
        def held(*args,**kwargs):
            database=self.runtime.journal.root/FILENAME
            with closing(sqlite3.connect(database,timeout=0,isolation_level=None)) as connection:
                with self.assertRaisesRegex(sqlite3.OperationalError,'locked',msg='Configuration publication must retain admission transaction'):
                    connection.execute('BEGIN IMMEDIATE')
                observed.append(True)
            return original(*args,**kwargs)
        with patch.object(module,'publish',held):self.binding.establish()
        self.assertEqual(observed,[True],'Admission lock probe must reach configuration publication')
    def test_interrupted_after_publication_replays_exact_settings(self):
        original=module.publish
        def interrupted(*args,**kwargs):
            original(*args,**kwargs);raise OSError('Simulated interruption after durable publication')
        with patch.object(module,'publish',interrupted),self.assertRaisesRegex(OSError,'Simulated interruption'):self.binding.establish()
        p=self.root/module.NAME;before=(p.stat().st_ino,p.read_bytes())
        self.assertEqual(self.binding.establish(),module.configuration(self.value),'Interrupted original seal resumes exact settings')
        self.assertEqual((p.stat().st_ino,p.read_bytes()),before,'Interrupted seal cannot replace retained original')

    def test_mutated_fresh_value_refuses_before_writer_and_publication(self):
        self.binding.value['targetId']='changed-before-first-seal'
        with patch.object(module,'writer',side_effect=AssertionError('Changed fresh settings cannot acquire runtime writer')):
            with self.assertRaisesRegex(ValueError,'Bound operator configuration changed'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Changed fresh settings cannot become original seal')
    def test_value_change_during_establishment_refuses_before_publication(self):
        from contextlib import contextmanager
        original=self.runtime.journal.connection
        @contextmanager
        def changed():
            with original() as connection:
                self.binding.value['targetId']='changed-during-establishment'
                yield connection
        with patch.object(self.runtime.journal,'connection',changed),patch.object(module,'publish',side_effect=AssertionError('Changed locked settings cannot publish original seal')):
            with self.assertRaisesRegex(ValueError,'Bound operator configuration changed'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Changed locked settings cannot become original seal')

    def test_prepublication_interruption_recovers_safe_temporary(self):
        from pathlib import Path
        rename=Path.rename
        def interrupted(path,target):
            if path.name.startswith('.partial-') and target.name==module.NAME:
                raise OSError('Simulated interruption before configuration rename')
            return rename(path,target)
        with patch.object(Path,'rename',interrupted),self.assertRaisesRegex(OSError,'before configuration rename'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Prepublication interruption has no durable seal')
        partials=list(self.root.glob('.partial-*'));self.assertEqual(len(partials),1,'Interruption fixture retains one actual publisher temporary')
        self.assertEqual(self.binding.establish(),module.configuration(self.value),'Safe unpublished configuration resumes original settings')
        self.assertFalse(partials[0].exists(),'Resumed configuration removes unpublished temporary')
    def unsafe_temporary(self,kind):
        import os
        target=self.base/'private-target';target.write_bytes(b'Original target');target.chmod(0o600)
        p=self.root/('.partial-other' if kind=='unknown' else '.partial-'+'a'*32)
        if kind=='symlink':p.symlink_to(target)
        elif kind=='hardlink':os.link(target,p)
        else:p.write_bytes(b'Unknown temporary');p.chmod(0o600)
        with patch.object(module,'publish',side_effect=AssertionError('Unsafe temporary cannot publish configuration')):
            with self.assertRaises((ValueError,OSError)):self.binding.establish()
        self.assertTrue(p.exists() or p.is_symlink(),'Unsafe temporary remains for explicit diagnosis')
        self.assertEqual(target.read_bytes(),b'Original target','Temporary refusal preserves external target')
        self.assertFalse((self.root/module.NAME).exists(),'Unsafe temporary cannot become original configuration')
    def test_unknown_temporary_refuses_before_publication(self):self.unsafe_temporary('unknown')
    def test_symlink_temporary_refuses_before_publication(self):self.unsafe_temporary('symlink')
    def test_hardlink_temporary_refuses_before_publication(self):self.unsafe_temporary('hardlink')
    def test_replaced_runtime_refuses_before_foreign_writer(self):
        root=self.base/'foreign-runtime';root.mkdir(mode=0o700)
        foreign=Runtime(root,'original-installation',max_queued=4,pipeline=lambda _:None)
        self.binding.runtime=foreign
        with patch.object(module,'writer',side_effect=AssertionError('Replaced runtime cannot acquire foreign writer')):
            with self.assertRaisesRegex(ValueError,'original runtime changed'):self.binding.establish()
        self.assertFalse((root/module.NAME).exists(),'Replaced runtime cannot publish configuration in foreign root')

    def test_replaced_runtime_root_refuses_before_writer(self):
        with patch.object(self.runtime,'root',self.base/'foreign-root'),patch.object(module,'writer',side_effect=AssertionError('Changed runtime root cannot acquire foreign writer')):
            with self.assertRaisesRegex(ValueError,'original runtime changed'):self.binding.establish()
    def test_replaced_runtime_journal_refuses_before_writer(self):
        with patch.object(self.runtime,'journal',object()),patch.object(module,'writer',side_effect=AssertionError('Changed runtime journal cannot acquire writer')):
            with self.assertRaisesRegex(ValueError,'original runtime changed'):self.binding.establish()

    def test_replaced_journal_root_cannot_bypass_original_admission(self):
        from admission_journal import Journal
        self.runtime.submit(zip_request('original-admission-before-root-replacement'))
        alternate=Journal(self.base/'alternate-admissions');alternate.accepted()
        with patch.object(self.runtime.journal,'root',alternate.root),patch.object(module,'writer',side_effect=AssertionError('Changed admission root cannot acquire writer')):
            with self.assertRaisesRegex(ValueError,'original runtime changed'):self.binding.establish()
        self.assertFalse((self.root/module.NAME).exists(),'Original admission cannot receive an inferred seal through another database')
    def test_constructor_refuses_unjoined_admission_root_before_configuration(self):
        from admission_journal import Journal
        alternate=Journal(self.base/'alternate-admissions');alternate.accepted()
        with patch.object(self.runtime.journal,'root',alternate.root),patch.object(module,'configuration',side_effect=AssertionError('Foreign admission root cannot parse operator settings')):
            with self.assertRaisesRegex(ValueError,'admission root differs'):module.Binding(self.runtime,self.value)

    def test_network_policy_refuses_extra_fields(self):
        value=copy.deepcopy(self.value);value['sourcePolicy']['extra']=True
        with self.assertRaisesRegex(ValueError,'network policy fields differ'):module.configuration(value)
    def test_callback_policy_refuses_redirect_permission(self):
        value=copy.deepcopy(self.value);value['callbackPolicy']['maxRedirects']=1
        with self.assertRaisesRegex(ValueError,'cannot permit redirects'):module.configuration(value)
    def test_network_policy_replay_refuses_changed_allowlist(self):
        self.binding.establish();value=copy.deepcopy(self.value);value['sourcePolicy']['allowedNetworks']=['127.0.0.0/8']
        with self.assertRaisesRegex(ValueError,'Saved operator configuration differs'):module.Binding(self.runtime,value).establish()
