"""Separate original-outcome repair with real journals and fixture authority."""
import json
import time
from contextlib import contextmanager
import unittest
from unittest.mock import patch

from retained_source import json_bytes, publish
from runtime_admission import OUTCOME
import runtime_outcome_recovery as module
import test_application_dispatch_reader as dispatch_fixture
import test_runtime_original_pipeline as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks()
        with patch.object(dispatch_fixture,'Runtime',module.Runtime):self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.runtime=self.f.runtime;self.runtime.pipeline=self.f.pipeline
        self.recovery=module.Recovery(self.f.pipeline,timeout=4)
    def legacy(self,*,terminal=True):
        self.f.through_drafts()
        if terminal:self.f.advance()
        with self.runtime.owner():
            entry=self.runtime.journal.get(self.f.request)
            value={'format':OUTCOME,'binding':self.runtime._binding(entry),'state':'failed',
                'reportedEngineTerminal':None,'callbackDeliveryVerification':'unassessed',
                'sourceCustodyVerification':'unassessed','engineCustodyVerification':'unassessed'}
            publish(self.runtime.root,self.runtime._name(entry),json_bytes(value))
        self.entry=entry;self.path=self.runtime.root/self.runtime._name(entry)
        return self.path.read_bytes()
    def saved(self):return self.recovery.folder(self.f.request)/'record.json'
    def resume(self):
        with self.runtime.owner():return self.recovery.resume_one()
    def retained_failure_facts(self):
        root=self.runtime.root/('local-stage-failures-'+module.checksum(self.f.request.encode()))
        records=[json.loads(p.read_bytes()) for p in root.glob('*.json')]
        failures=[value for value in records if value['stage']=='outcome_recovery']
        self.assertEqual(len(failures),1,'Recovery failure must retain one original stage receipt')
        context=json.loads((self.f.delivery.folder(self.f.request)/'context.json').read_bytes())
        expected={'originalTaskUuid':self.f.f.plan()['taskUuid'],
            'observationSha256':context['observationSha256'],'reportedStatusCode':40,'reportedState':'completed'}
        self.assertEqual(failures[0]['reportedEngine'],expected,'Recovery failure must preserve all known original engine facts')
    def test_acknowledged_repair_preserves_original_and_releases_hold(self):
        original=self.legacy();inode=self.path.stat().st_ino;network=list(self.f.network)
        self.assertTrue(self.resume(),'Acknowledged original delivery repairs one held outcome')
        self.assertEqual(self.path.read_bytes(),original,'Recovery preserves exact original outcome bytes')
        self.assertEqual(self.path.stat().st_ino,inode,'Recovery preserves original inode')
        with self.runtime.owner():
            result=self.runtime._outcome(self.entry)
            self.assertEqual(result['state'],'succeeded','Recovered outcome follows reported engine state')
            self.assertEqual(result['reportedEngineTerminal']['statusCode'],40,'Recovery retains original reported completion')
            self.assertEqual(self.runtime.status()['heldStarted'],0,'Acknowledged repair releases original local hold')
        self.assertEqual(self.f.network,network,'Repair cannot reobserve or download engine outputs')
        self.assertEqual(len(self.f.callbacks),1,'Acknowledged repair cannot POST again')
        self.assertFalse(self.resume(),'Recovered local outcome cannot repair again')
    def test_missing_terminal_command_refuses_before_effects(self):
        self.legacy(terminal=False);before=list(self.f.commits)
        with patch.object(self.f.delivery,'_load',side_effect=AssertionError('Missing original terminal command cannot reach reader')):
            with self.assertRaisesRegex(ValueError,'saved original terminal command'):self.resume()
        self.assertEqual(self.f.commits,before,'Factless local failure cannot start processing during repair')
        self.assertEqual(self.f.callbacks,[],'Missing terminal command cannot send callback')
    def test_pending_original_delivery_retains_hold_without_recovery_record(self):
        self.f.callback_lost=True;self.legacy();body=self.f.callbacks[0]
        self.assertTrue(self.resume(),'Uncertain original delivery remains resumable')
        self.assertFalse(self.saved().exists(),'Unacknowledged delivery cannot publish recovery')
        self.assertEqual(self.f.callbacks,[body,body],'Repair retries exact original terminal body')
        with self.runtime.owner():self.assertEqual(self.runtime.status()['heldStarted'],1,'Uncertain delivery keeps local hold')
        self.retained_failure_facts()
    def test_historical_acknowledgement_repairs_after_actor_revocation_without_transport(self):
        original=self.legacy();self.f.allowed=False
        with patch.object(self.f.pipeline,'advance',side_effect=AssertionError('Acknowledged bookkeeping cannot request current send authority')):
            self.assertTrue(self.resume(),'Historical acknowledged outcome can repair private bookkeeping')
        self.assertTrue(self.saved().exists(),'Historical acknowledgement must publish private outcome repair')
        with self.runtime.owner():self.assertEqual(self.runtime.status()['heldStarted'],0,'Historical repair releases only the acknowledged hold')
        self.assertEqual(self.path.read_bytes(),original,'Historical repair keeps old local bytes')
        self.assertEqual(len(self.f.callbacks),1,'Historical repair cannot send a revoked callback')
    def test_pending_delivery_requires_current_actor_and_keeps_hold(self):
        self.f.callback_lost=True;original=self.legacy();self.f.allowed=False
        self.assertTrue(self.resume(),'Current refusal keeps pending original recovery held')
        self.assertFalse(self.saved().exists(),'Current refusal cannot publish an acknowledged recovery')
        self.assertEqual(len(self.f.callbacks),1,'Revoked pending repair cannot retry callback')
        self.assertEqual(self.path.read_bytes(),original,'Current refusal preserves old local outcome')
        self.retained_failure_facts()
    def test_missing_command_after_evidence_cannot_fall_back_to_inputs(self):
        self.f.callback_lost=True;self.legacy();before=list(self.f.network);real=self.recovery._evidence
        def remove(*args,**kwargs):
            result=real(*args,**kwargs)
            if not kwargs['acknowledged']:(self.f.delivery.folder(self.f.request)/'command.json').unlink()
            return result
        with patch.object(self.recovery,'_evidence',side_effect=remove),patch.object(self.f.pipeline,'advance',side_effect=AssertionError('Missing original command cannot enter general pipeline')):
            self.resume()
        self.assertEqual(len(self.f.callbacks),1,'Missing original command cannot issue another callback')
        self.assertEqual(self.f.network,before,'Missing original command cannot reobserve or fetch outputs')
        self.assertFalse(self.saved().exists(),'Missing original command cannot publish recovery')
        self.retained_failure_facts()
    def test_changed_command_after_evidence_refuses_before_new_attempt(self):
        with patch.object(self.f.delivery,'advance',side_effect=OSError('Before first intent')):self.legacy()
        real=self.recovery._evidence
        def replace(*args,**kwargs):
            result=real(*args,**kwargs)
            if not kwargs['acknowledged']:
                path=self.f.delivery.folder(self.f.request)/'command.json';command=json.loads(path.read_bytes())
                body=json.loads(command['bodyText']);body['callbackId']='replacement-original-event'
                raw=json_bytes(body);command.update(bodyText=raw.decode(),bodyBytes=len(raw),bodySha256=module.checksum(raw),callbackId=body['callbackId'])
                path.write_bytes(json_bytes(command))
            return result
        with patch.object(self.recovery,'_evidence',side_effect=replace),self.assertRaisesRegex(ValueError,'original command changed before attempt'):
            self.resume()
        self.assertEqual(self.f.callbacks,[],'Changed original command cannot POST before pin verification')
    def test_invalid_expected_command_hash_refuses_before_current_access(self):
        with patch.object(self.f.delivery,'_access',side_effect=AssertionError('Invalid command pin cannot read current access')):
            for value in (True,'','a'*63,'A'*64):
                with self.subTest(value=value),self.assertRaisesRegex(ValueError,'expected original command hash'):
                    self.f.delivery.advance(self.f.request,expected_command_sha256=value)
    def test_legacy_bytes_change_invalidates_recovery(self):
        self.legacy();self.resume();value=json.loads(self.path.read_bytes());value['state']='canceled'
        self.path.write_bytes(json_bytes(value))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'original evidence'):
            self.runtime._outcome(self.entry)
    def test_changed_recovery_outcome_refuses(self):
        self.legacy();self.resume();value=json.loads(self.saved().read_bytes());value['recoveredOutcome']['state']='failed'
        self.saved().write_bytes(json_bytes(value))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'original evidence'):
            self.runtime._outcome(self.entry)
    def test_reported_failure_and_cancellation_remain_distinct(self):
        for code,state in ((30,'failed'),(50,'canceled')):
            with self.subTest(code=code):
                other=Checks();other.setUp()
                try:
                    other.f.status=code;other.legacy();other.resume()
                    with other.runtime.owner():value=other.runtime._outcome(other.entry)
                    self.assertEqual(value['state'],state,'Recovery cannot relabel reported failure or cancellation')
                    self.assertEqual(value['reportedEngineTerminal']['statusCode'],code,'Recovery retains separate original status code')
                finally:other.doCleanups()
    def test_recovery_without_registered_adapter_refuses(self):
        self.legacy();self.resume();self.runtime.recovery=None
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'registered original adapter'):
            self.runtime._outcome(self.entry)
    def test_interrupted_recovery_publication_resumes_without_reissue(self):
        original=self.legacy();real=module.publish
        def lose(root,name,body):
            real(root,name,body)
            raise InterruptedError('Recovery receipt saved before acknowledgement')
        with patch.object(module,'publish',side_effect=lose),self.assertRaises(InterruptedError):self.resume()
        saved=self.saved().read_bytes()
        self.assertFalse(self.resume(),'Published recovery needs no further attempt')
        self.assertEqual(self.saved().read_bytes(),saved,'Recovery reply loss preserves saved receipt')
        self.assertEqual(self.path.read_bytes(),original,'Recovery reply loss preserves old record')
        self.assertEqual(len(self.f.callbacks),1,'Recovery reply loss cannot reissue callback')
    def test_unowned_recovery_refuses_before_effects(self):
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.recovery.resume_one()
        self.assertEqual(self.f.commits,[],'Unowned recovery cannot issue commit')
    def test_unowned_status_refuses_before_database_reads(self):
        with patch.object(self.runtime.journal,'connection',side_effect=AssertionError('Unowned status cannot read admissions')):
            with self.assertRaisesRegex(ValueError,'status requires its lifetime owner'):self.runtime.status()
    def test_unowned_outcome_refuses_before_private_record(self):
        entry=self.runtime.journal.get(self.f.request)
        with patch.object(module.Admissions,'_outcome',side_effect=AssertionError('Unowned recovery cannot read original outcome')):
            with self.assertRaisesRegex(ValueError,'reads require its lifetime owner'):self.runtime._outcome(entry)
    def test_constructor_requires_typed_original_pipeline(self):
        with self.assertRaisesRegex(ValueError,'original runtime and pipeline'):module.Recovery(object())
        with self.assertRaisesRegex(ValueError,'original runtime and pipeline'):module.Recovery(self.f.pipeline)
    def test_nonfinite_timeout_refuses(self):
        for value in (True,0,float('nan'),float('inf')):
            self.runtime.recovery=None
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'finite positive'):
                module.Recovery(self.f.pipeline,timeout=value)
    def test_known_original_outcome_cannot_be_reclassified(self):
        self.legacy();value=json.loads(self.path.read_bytes());value['state']='succeeded'
        value['reportedEngineTerminal']={'taskUuid':self.f.f.plan()['taskUuid'],'statusCode':40}
        self.path.write_bytes(json_bytes(value))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'unresolved original local outcome'):
            self.recovery._legacy(self.entry,value,time.monotonic()+4)
    def test_stale_original_snapshot_refuses_before_binding(self):
        self.legacy();original=json.loads(self.path.read_bytes());changed={**original,'state':'canceled'}
        self.path.write_bytes(json_bytes(changed))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'changes during recovery'):
            self.recovery._legacy(self.entry,original,time.monotonic()+4)
    def test_unacknowledged_evidence_cannot_supply_recovery_receipt(self):
        self.f.callback_lost=True;self.legacy();original=json.loads(self.path.read_bytes())
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'acknowledged original delivery'):
            self.recovery._evidence(self.entry,original,time.monotonic()+4,acknowledged=True)
    def test_oversized_original_outcome_refuses_before_stream_read(self):
        self.legacy();value=json.loads(self.path.read_bytes());self.path.write_bytes(b' '*(module.BOUND+1))
        real=module.reader
        @contextmanager
        def guarded(root,name):
            with real(root,name) as (stream,info):
                with patch.object(stream,'read',side_effect=AssertionError('Oversized original outcome cannot allocate stream bytes')):
                    yield stream,info
        with self.runtime.owner(),patch.object(module,'reader',side_effect=guarded),self.assertRaisesRegex(ValueError,'exceeds recovery bound'):
            self.recovery._legacy(self.entry,value,time.monotonic()+4)
    def test_oversized_recovery_receipt_refuses_before_stream_read(self):
        self.legacy();self.resume();original=json.loads(self.path.read_bytes());self.saved().write_bytes(b' '*(module.BOUND+1))
        real=module.reader
        @contextmanager
        def guarded(root,name):
            with real(root,name) as (stream,info):
                with patch.object(stream,'read',side_effect=AssertionError('Oversized recovery receipt cannot allocate stream bytes')):
                    yield stream,info
        with self.runtime.owner(),patch.object(module,'reader',side_effect=guarded),self.assertRaisesRegex(ValueError,'receipt exceeds bound'):
            self.recovery.load(self.entry,original)
    def test_short_original_read_cannot_bind_recovery(self):
        self.legacy();original=json.loads(self.path.read_bytes());raw=self.path.read_bytes();real=module.reader
        @contextmanager
        def short(root,name):
            with real(root,name) as (stream,info):
                with patch.object(stream,'read',return_value=raw[:-1]):yield stream,info
        with self.runtime.owner(),patch.object(module,'reader',side_effect=short),self.assertRaisesRegex(ValueError,'changes during recovery'):
            self.recovery._legacy(self.entry,original,time.monotonic()+4)
    def test_short_recovery_receipt_cannot_release_hold(self):
        self.legacy();self.resume();original=json.loads(self.path.read_bytes());raw=self.saved().read_bytes();real=module.reader
        @contextmanager
        def short(root,name):
            with real(root,name) as (stream,info):
                if name=='record.json':
                    with patch.object(stream,'read',return_value=raw[:-1]):yield stream,info
                else:yield stream,info
        with self.runtime.owner(),patch.object(module,'reader',side_effect=short),self.assertRaisesRegex(ValueError,'receipt length differs'):
            self.recovery.load(self.entry,original)
    def test_busy_execution_refuses_before_recovery_effects(self):
        self.legacy();self.runtime._execution.acquire()
        try:self.assertFalse(self.resume(),'Busy original execution prevents outcome repair')
        finally:self.runtime._execution.release()
    def test_replaced_pipeline_refuses_before_original_journal_read(self):
        self.runtime.pipeline=lambda job:None
        with patch.object(self.runtime.journal,'started',side_effect=AssertionError('Replaced pipeline cannot read original starts')):
            with self.assertRaisesRegex(ValueError,'registered original pipeline'):self.resume()
    def test_original_without_local_failure_stays_with_original_pipeline(self):
        self.f.through_drafts()
        self.assertFalse(self.resume(),'Missing local outcome cannot create a repair')
        self.assertEqual(self.f.commits,[],'Repair cannot commit a merely prepared original')
    def test_unknown_recovery_records_refuse_before_publication(self):
        self.legacy();root=self.recovery.folder(self.f.request);root.mkdir(mode=0o700)
        foreign=root/'foreign.json';foreign.write_bytes(b'{}');foreign.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'unknown pre-receipt records'):self.resume()
        self.assertFalse(self.saved().exists(),'Unknown namespace cannot publish outcome repair')
    def test_original_bytes_change_between_evidence_reads_refuses_publication(self):
        self.legacy();real=self.recovery._evidence
        def change(*args,**kwargs):
            if kwargs['acknowledged']:self.path.write_bytes(self.path.read_bytes()+b'\n')
            return real(*args,**kwargs)
        with patch.object(self.recovery,'_evidence',side_effect=change),self.assertRaisesRegex(ValueError,'changes before recovery publication'):
            self.resume()
        self.assertFalse(self.saved().exists(),'Changed original bytes cannot publish recovery')
    def test_original_bytes_change_at_publication_refuses_saved_recovery(self):
        self.legacy();real=self.recovery._evidence
        def change(*args,**kwargs):
            result=real(*args,**kwargs)
            if kwargs['acknowledged']:self.path.write_bytes(self.path.read_bytes()+b'\n')
            return result
        with patch.object(self.recovery,'_evidence',side_effect=change),self.assertRaisesRegex(ValueError,'changes at recovery publication'):
            self.resume()
        self.assertFalse(self.saved().exists(),'Late changed original bytes cannot publish recovery')


if __name__=='__main__':unittest.main()
