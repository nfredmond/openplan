"""Original scheduling with real journals and supplied engine/receiver fixtures."""
import unittest
from unittest.mock import patch

from retained_source import json_bytes,publish
from runtime_admission import OUTCOME
from runtime_outcome_recovery import Runtime,Recovery
import runtime_execution as module
import test_application_dispatch_reader as dispatch_fixture
import test_runtime_running_pipeline as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks()
        with patch.object(dispatch_fixture,'Runtime',Runtime):self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.pipeline=self.f.pipeline;self.runtime=self.pipeline.runtime
        self.runtime.pipeline=self.pipeline;self.recovery=Recovery(self.pipeline,timeout=4)
        self.execution=module.Execution(self.pipeline,self.recovery)
    def step(self):
        with self.runtime.owner():return self.execution.step()
    def legacy(self):
        self.f.f.through_drafts();self.f.f.advance()
        with self.runtime.owner():
            entry=self.runtime.journal.get(self.f.f.request)
            record={'format':OUTCOME,'binding':self.runtime._binding(entry),'state':'failed',
                'reportedEngineTerminal':None,'callbackDeliveryVerification':'unassessed',
                'sourceCustodyVerification':'unassessed','engineCustodyVerification':'unassessed'}
            publish(self.runtime.root,self.runtime._name(entry),json_bytes(record))
        return self.runtime.root/self.runtime._name(entry)
    def test_outcome_recovery_precedes_every_other_stage(self):
        with patch.object(self.recovery,'resume_one',return_value=True),patch.object(self.pipeline,'resume_one',side_effect=AssertionError('Outcome repair cannot enter original recovery')),patch.object(self.runtime,'run_one',side_effect=AssertionError('Outcome repair cannot start another admission')):
            self.assertEqual(self.step()['state'],'outcome_recovery_attempted','Outcome recovery has priority')
    def test_original_recovery_precedes_new_admission(self):
        calls=[]
        def old():calls.append('outcome');return False
        def original():calls.append('original');return True
        with patch.object(self.recovery,'resume_one',side_effect=old),patch.object(self.pipeline,'resume_one',side_effect=original),patch.object(self.runtime,'run_one',side_effect=AssertionError('Original recovery cannot start another admission')):
            self.assertEqual(self.step()['state'],'original_recovery_attempted','Original recovery has priority')
        self.assertEqual(calls,['outcome','original'],'Recovery stages retain their order')
    def test_new_admission_follows_both_false_recoveries(self):
        calls=[]
        def decision(name,value):
            def attempt():calls.append(name);return value
            return attempt
        with patch.object(self.recovery,'resume_one',side_effect=decision('outcome',False)),patch.object(self.pipeline,'resume_one',side_effect=decision('original',False)),patch.object(self.runtime,'run_one',side_effect=decision('admission',True)):
            self.assertEqual(self.step()['state'],'admission_started','New admission follows recovery')
        self.assertEqual(calls,['outcome','original','admission'],'New admission cannot reorder recovery')
    def test_idle_requires_three_false_results(self):
        with patch.object(self.recovery,'resume_one',return_value=False),patch.object(self.pipeline,'resume_one',return_value=False),patch.object(self.runtime,'run_one',return_value=False):
            self.assertEqual(self.step()['state'],'idle','Idle needs every stage to decline')
    def test_nonboolean_stage_refuses_before_later_effects(self):
        for value in (None,0,1,'true',{}):
            with self.subTest(value=value),patch.object(self.recovery,'resume_one',return_value=value),patch.object(self.pipeline,'resume_one',side_effect=AssertionError('Malformed stage cannot advance original recovery')):
                with self.assertRaisesRegex(ValueError,'stage must return a boolean'):self.step()
    def test_unowned_step_refuses_before_recovery(self):
        with patch.object(self.recovery,'resume_one',side_effect=AssertionError('Unowned step cannot read recovery')):
            with self.assertRaisesRegex(ValueError,'lifetime owner'):self.execution.step()
    def test_owner_loss_after_stage_refuses_before_next_stage(self):
        def stop():self.runtime._owned=False;return True
        with patch.object(self.recovery,'resume_one',side_effect=stop),patch.object(self.pipeline,'resume_one',side_effect=AssertionError('Ended owner cannot advance original recovery')):
            with self.assertRaisesRegex(ValueError,'lifetime owner'):self.step()
    def test_replaced_registration_refuses_before_recovery(self):
        for attribute in ('pipeline','recovery'):
            old=getattr(self.runtime,attribute)
            try:
                setattr(self.runtime,attribute,object())
                with patch.object(self.recovery,'resume_one',side_effect=AssertionError('Replaced registration cannot read recovery')):
                    with self.assertRaisesRegex(ValueError,'registered adapter graph'):self.step()
            finally:setattr(self.runtime,attribute,old)
    def test_changed_graph_refuses_before_recovery(self):
        with patch.object(self.recovery,'pipeline',object()),patch.object(self.recovery,'resume_one',side_effect=AssertionError('Changed graph cannot read recovery')):
            with self.assertRaisesRegex(ValueError,'adapter graph changed'):self.step()
    def test_same_runtime_foreign_components_refuse_before_stages(self):
        from runtime_running_pipeline import RunningDelivery
        old=self.pipeline.progress
        other=RunningDelivery(old.reader,old.transport,old.credential_reference,timeout=4)
        with patch.object(self.pipeline,'progress',other),patch.object(self.recovery,'resume_one',side_effect=AssertionError('Foreign same-runtime component cannot read recovery')):
            with self.assertRaisesRegex(ValueError,'pinned components changed'):self.step()
    def test_constructor_revalidates_already_changed_joins(self):
        from runtime_dispatch_custody import Custody
        other=Custody(self.runtime,self.pipeline.inputs.dispatch.target,timeout=4)
        with patch.object(self.pipeline.inputs,'dispatch',other):
            with self.assertRaisesRegex(ValueError,'one owned adapter graph'):module.Execution(self.pipeline,self.recovery)
    def test_constructor_revalidates_delivery_authority_join(self):
        from runtime_dispatch_custody import Custody
        other=Custody(self.runtime,self.pipeline.inputs.dispatch.target,timeout=4)
        with patch.object(self.pipeline.coordinator.delivery.authority,'dispatch',other):
            with self.assertRaisesRegex(ValueError,'one original observation and scoped authority'):module.Execution(self.pipeline,self.recovery)
    def test_corrupt_nested_component_refuses_before_stage(self):
        with patch.object(self.pipeline.coordinator.plan,'inspection',object()),patch.object(self.recovery,'resume_one',side_effect=AssertionError('Corrupt nested component cannot read recovery')):
            with self.assertRaisesRegex(ValueError,'component graph differs'):self.step()
    def test_constructor_refuses_existing_foreign_delivery_reader(self):
        from application_dispatch_reader import Reader
        original=self.pipeline.coordinator.observer.reader
        other=Reader(original.dispatch,original.transport,timeout=4)
        with patch.object(self.pipeline.coordinator.delivery,'reader',other):
            with self.assertRaisesRegex(ValueError,'existing reader join differs'):module.Execution(self.pipeline,self.recovery)
    def test_compatible_internal_input_replacement_refuses_before_stage(self):
        import copy
        other=copy.copy(self.pipeline.inputs.pipeline)
        with patch.object(self.pipeline.inputs,'pipeline',other),patch.object(self.recovery,'resume_one',side_effect=AssertionError('Foreign internal input cannot read recovery')):
            with self.assertRaisesRegex(ValueError,'pinned components changed'):self.step()
    def test_constructor_revalidates_internal_input_target(self):
        with patch.object(self.pipeline.inputs.pipeline.intake,'target','foreign-original-target'):
            with self.assertRaisesRegex(ValueError,'dispatch pipeline adapters differ'):module.Execution(self.pipeline,self.recovery)
    def test_constructor_requires_typed_graph(self):
        with self.assertRaisesRegex(ValueError,'one running pipeline and outcome recovery'):module.Execution(self.pipeline,object())
    def test_constructor_requires_current_registration(self):
        with patch.object(self.runtime,'pipeline',object()):
            with self.assertRaisesRegex(ValueError,'registered adapter graph'):module.Execution(self.pipeline,self.recovery)
    def test_actual_new_job_then_original_recovery_keeps_one_start(self):
        self.assertEqual(self.step()['state'],'admission_started','First job uses new admission once')
        original=self.runtime.journal.get(self.f.f.request)
        for _ in range(3):self.assertEqual(self.step()['state'],'original_recovery_attempted','Started work resumes before another admission')
        entry=self.runtime.journal.get(self.f.f.request)
        self.assertEqual(entry.started_context,original.started_context,'Recovery preserves original start context')
        self.assertEqual(entry.job_reference,original.job_reference,'Recovery preserves original job reference')
        with self.runtime.owner():
            result=self.runtime._outcome(entry)
            self.assertEqual(result['reportedEngineTerminal']['statusCode'],40,'Actual recovery retains original completion')
            self.assertEqual(self.runtime.status()['heldStarted'],0,'Acknowledged original delivery releases its hold')
        self.assertEqual(self.step()['state'],'idle','Completed original job cannot start again')
        self.assertEqual(len(self.f.calls),1,'Original recovery cannot repeat initial running event')
        self.assertEqual(len(self.f.f.commits),1,'Original recovery cannot repeat engine commit')
    def test_actual_legacy_repair_preserves_original_before_idle(self):
        path=self.legacy();raw=path.read_bytes();inode=path.stat().st_ino
        self.assertEqual(self.step()['state'],'outcome_recovery_attempted','Actual old outcome is repaired first')
        self.assertEqual(path.read_bytes(),raw,'Scheduler preserves immutable old outcome bytes')
        self.assertEqual(path.stat().st_ino,inode,'Scheduler preserves immutable old outcome inode')
        self.assertEqual(self.step()['state'],'idle','Repaired original outcome cannot start again')
    def test_pending_legacy_delivery_cannot_start_next_job(self):
        self.f.f.callback_lost=True;self.legacy()
        with patch.object(self.pipeline,'resume_one',side_effect=AssertionError('Pending legacy callback cannot enter original recovery')),patch.object(self.runtime,'run_one',side_effect=AssertionError('Pending legacy callback cannot start another admission')):
            self.assertEqual(self.step()['state'],'outcome_recovery_attempted','Pending repair still ends its scheduling step')
        with self.runtime.owner():self.assertEqual(self.runtime.status()['heldStarted'],1,'Pending original repair keeps queue held')
