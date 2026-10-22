"""Original journal composition with supplied authority and receiver fixtures."""
import copy
import json
import shutil
import time
import unittest
from unittest.mock import patch

from retained_source import json_bytes
import runtime_worker_coordinator as module
import test_runtime_terminal_delivery as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.coordinator=module.Coordinator(self.f.observer,self.f.f.access.plan,self.f.f.access,self.f.delivery,
            public_base_url='https://worker.example',lease_seconds=50,timeout=4,clock=lambda:1050)
    def advance(self,hash=None):
        with self.f.runtime.owner():return self.coordinator.advance(self.f.request,hash)
    def clear_selected_outputs(self):
        for name in ('output-intake','output-archive','private-products','private-raster-inspection','private-artifact-plan','private-artifact-access'):
            path=self.f.f.root/name
            if path.exists():shutil.rmtree(path)
    def test_completed_original_keeps_engine_facts_and_exact_delivery(self):
        result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'acknowledged','Original completed task reaches its exact terminal delivery')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],40,'Engine completion remains a reported fact')
        self.assertEqual(len(self.f.calls),1,'Original terminal callback is sent once')
        for key,value in module.LIMITS.items():self.assertEqual(result[key],value,'Coordinator cannot promote '+key)
    def test_saved_terminal_replay_never_reobserves_or_rebuilds(self):
        first=self.advance(self.f.observation)
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Saved terminal cannot query engine')),patch.object(self.coordinator.plan,'advance',side_effect=AssertionError('Saved terminal cannot rebuild products')):
            replay=self.advance()
        self.assertEqual(replay,first,'Saved terminal replay keeps exact original result')
        self.assertEqual(len(self.f.calls),1,'Saved acknowledgement suppresses another terminal POST')
    def test_local_product_failure_does_not_invent_engine_failure(self):
        with patch.object(self.coordinator.plan,'advance',side_effect=OSError('private source token secret')):
            result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'local_stage_failed','Product failure remains a local stage outcome')
        self.assertEqual(result['stage'],'products','Local failure keeps its actual stage')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],40,'Product failure cannot turn reported40 into30')
        self.assertEqual(self.f.calls,[],'Local product failure cannot send fabricated failure callback')
        record=next(self.f.runtime.root.glob('local-stage-failures-*/*.json')).read_text()
        self.assertNotIn('private source token secret',record,'Private error messages never enter durable stage records')
    def test_local_failure_replay_keeps_original_record_inode(self):
        with patch.object(self.coordinator.plan,'advance',side_effect=OSError('same local refusal')):
            first=self.advance(self.f.observation);path=next(self.f.runtime.root.glob('local-stage-failures-*/*.json'));inode=path.stat().st_ino
            second=self.advance(self.f.observation)
        self.assertEqual(second,first,'Same local failure replay keeps original fact')
        self.assertEqual(path.stat().st_ino,inode,'Local failure replay cannot replace its original record')
    def test_existing_lease_is_not_renewed_from_new_clock(self):
        original=(self.f.f.pack/'lease.json').read_bytes();self.coordinator.clock=lambda:1060
        result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'acknowledged','Changing clock cannot prevent original lease recovery')
        self.assertEqual((self.f.f.pack/'lease.json').read_bytes(),original,'Coordinator cannot renew the saved original lease')
    def test_reported_engine_failure_skips_product_and_lease_stages(self):
        self.clear_selected_outputs()
        self.f.reported(30);self.f.replies=[(200,b'{"ok":true,"status":"failed"}')]
        with patch.object(self.coordinator.plan,'advance',side_effect=AssertionError('Reported failure cannot prepare products')),patch.object(self.coordinator.access,'resume',side_effect=AssertionError('Reported failure cannot grant artifacts')):
            result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'acknowledged','Reported original engine failure has its own terminal callback')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],30,'Original failure remains reported30')
        self.assertNotIn('artifacts',json.loads(self.f.calls[0][2]),'Reported failure cannot invent product URLs')
    def test_changed_terminal_observation_refuses_new_delivery(self):
        self.advance(self.f.observation)
        result=self.advance('a'*64)
        self.assertEqual(result['state'],'local_stage_failed','Changed terminal observation remains a local refusal')
        self.assertEqual(len(self.f.calls),1,'Changed observation cannot send another callback')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],40,'Terminal refusal retains already known original completion')
    def test_interrupted_terminal_delivery_replays_original_body(self):
        self.f.replies=[OSError('uncertain original transport'),(200,b'{"ok":true,"status":"succeeded"}')]
        first=self.advance(self.f.observation)
        self.assertEqual(first['state'],'local_stage_failed','Uncertain delivery remains a separate local fact')
        self.assertEqual(first['reportedEngine']['reportedStatusCode'],40,'Uncertain delivery keeps original reported completion')
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Uncertain terminal cannot reobserve engine')):
            restored=self.advance()
        self.assertEqual(restored['state'],'acknowledged','Original uncertain terminal can recover its exact acknowledgement')
        self.assertEqual([call[2] for call in self.f.calls],[self.f.calls[0][2]]*2,'Uncertain callback retry preserves exact body bytes')
    def test_processing_observation_stays_pending_without_products_or_callback(self):
        self.clear_selected_outputs()
        self.f.reported(20)
        with patch.object(self.coordinator.plan,'advance',side_effect=AssertionError('Running task cannot prepare products')):
            result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'processing_pending','Running original task remains pending')
        self.assertEqual(self.f.calls,[],'Running task cannot send a terminal callback')
    def test_revoked_current_terminal_actor_preserves_original_completed_fact(self):
        self.f.allowed=False
        result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'local_stage_failed','Current authority refusal stays local')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],40,'Authority refusal cannot relabel engine completion')
        self.assertEqual(self.f.calls,[],'Revoked actor cannot send a terminal callback')
    def test_product_failure_can_recover_without_replacing_its_record(self):
        with patch.object(self.coordinator.plan,'advance',side_effect=OSError('temporary local product refusal')):
            self.advance(self.f.observation)
        path=next(self.f.runtime.root.glob('local-stage-failures-*/*.json'));before=path.read_bytes()
        result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'acknowledged','Local product recovery can finish original terminal delivery')
        self.assertEqual(path.read_bytes(),before,'Successful recovery preserves its prior local failure fact')
    def test_constructor_refuses_foreign_graph_and_invalid_bounds(self):
        args=[self.f.observer,self.coordinator.plan,self.coordinator.access,self.f.delivery]
        for changes in ({'lease_seconds':0},{'lease_seconds':True},{'timeout':0},{'clock':False}):
            with self.assertRaisesRegex(ValueError,'finite positive bounds'):
                module.Coordinator(*args,**{'public_base_url':'https://worker.example','lease_seconds':50,**changes})
        args[0]=object()
        with self.assertRaisesRegex(ValueError,'one original adapter graph'):
            module.Coordinator(*args,public_base_url='https://worker.example',lease_seconds=50)
    def test_foreign_observer_graph_refuses_before_coordinator_use(self):
        foreign=copy.copy(self.f.observer)
        with self.assertRaisesRegex(ValueError,'one original adapter graph'):
            module.Coordinator(foreign,self.coordinator.plan,self.coordinator.access,self.f.delivery,
                public_base_url='https://worker.example',lease_seconds=50)
    def test_initial_completed_observation_prepares_new_lease_and_delivery(self):
        self.clear_selected_outputs()
        with patch.object(self.f.observer,'observe',wraps=self.f.observer.observe) as observe:
            result=self.advance()
        self.assertEqual(observe.call_count,1,'Unselected original task uses one actual supplied engine observation')
        self.assertEqual(result['state'],'acknowledged','Initial original completion prepares products, lease and terminal delivery')
        lease=json.loads((self.f.f.pack/'lease.json').read_text())
        self.assertEqual(lease['expiresAt'],1100,'Initial lease uses its bounded operator clock')
        self.assertEqual(lease['publicBaseUrl'],'https://worker.example','Initial lease uses the explicit original worker base')
    def test_precommand_context_recovers_original_selection_without_engine_get(self):
        import runtime_terminal_delivery
        original=runtime_terminal_delivery.publish
        def interrupt(root,name,raw):
            if name=='command.json':raise InterruptedError('Original context already retained')
            return original(root,name,raw)
        with patch.object(runtime_terminal_delivery,'publish',side_effect=interrupt):first=self.advance(self.f.observation)
        self.assertEqual(first['state'],'local_stage_failed')
        self.assertTrue((self.f.root/'context.json').exists(),'Interrupted terminal retains its original selection')
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Precommand context cannot reobserve engine')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Precommand context resumes original terminal preparation')
    def test_earliest_intake_plan_recovers_without_reobserving(self):
        for name in ('output-archive','private-products','private-raster-inspection','private-artifact-plan','private-artifact-access'):
            shutil.rmtree(self.f.f.root/name)
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Saved intake cannot reobserve engine')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Original intake plan resumes all later stages')
        self.assertEqual(result['reportedEngine']['observationSha256'],self.f.observation,'Earliest saved stage fixes the original observation')
    def test_partial_manifest_completes_original_receipt_without_new_observation(self):
        shutil.rmtree(self.f.f.pack);(self.f.f.root/'private-artifact-plan/receipt.json').unlink()
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Partial manifest cannot reobserve engine')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Partial manifest recovers its original observation and receipt')
    def test_partial_lease_completes_original_receipt_without_renewal(self):
        original=(self.f.f.pack/'lease.json').read_bytes();(self.f.f.pack/'receipt.json').unlink()
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Partial lease cannot reobserve engine')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Partial lease recovers its original completion')
        self.assertEqual((self.f.f.pack/'lease.json').read_bytes(),original,'Partial lease recovery keeps exact token and expiry')
    def test_conflicting_saved_selections_refuse_before_new_observation(self):
        path=self.f.f.root/'private-artifact-plan/manifest.json';saved=json.loads(path.read_text());saved['binding']['observationSha256']='a'*64;path.write_bytes(json_bytes(saved))
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'saved observation selections conflict'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
        self.assertEqual(self.f.calls,[],'Conflicting saved selections send no callback')
    def test_changed_intake_limits_refuse_selection(self):
        path=self.f.f.root/'output-intake/plan.json';saved=json.loads(path.read_text());saved['maxAttemptObjects']=3;path.write_bytes(json_bytes(saved))
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'original intake selection limits differ'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_noncanonical_terminal_selection_shape_refuses(self):
        self.f.root.mkdir(mode=0o700)
        (self.f.root/'context.json').write_bytes(json_bytes({'observationSha256':self.f.observation,'extra':True}));(self.f.root/'context.json').chmod(0o600)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'terminal selection differs'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_invalid_saved_selection_hash_refuses(self):
        self.f.root.mkdir(mode=0o700)
        (self.f.root/'context.json').write_bytes(json_bytes({'observationSha256':'invalid'}));(self.f.root/'context.json').chmod(0o600)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'saved observation hash differs'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_foreign_output_engine_plan_refuses_selection(self):
        path=self.f.f.root/'output-intake/plan.json';saved=json.loads(path.read_text());saved['enginePlan']['taskUuid']='00000000-0000-4000-8000-000000000001';path.write_bytes(json_bytes(saved))
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'saved output selection identity differs'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_foreign_artifact_binding_refuses_selection(self):
        path=self.f.f.root/'private-artifact-plan/manifest.json';saved=json.loads(path.read_text());saved['binding']['targetId']='other-target';path.write_bytes(json_bytes(saved))
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'saved artifact selection identity differs'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_explicit_new_hash_cannot_replace_saved_stage_selection(self):
        result=self.advance('a'*64)
        self.assertEqual(result['state'],'local_stage_failed','Explicit changed hash cannot replace saved original selection')
        self.assertEqual(result['stage'],'observation_selection','Changed hash refuses before product or engine work')
        self.assertEqual(result['reportedEngine']['reportedStatusCode'],40,'Saved stage refusal keeps original engine completion')
    def test_nonfinite_clock_refuses_before_new_lease_preparation(self):
        shutil.rmtree(self.f.f.pack);self.coordinator.clock=lambda:float('nan')
        with patch.object(self.coordinator.access,'prepare',side_effect=AssertionError('Nonfinite clock cannot reach lease preparation')):
            result=self.advance(self.f.observation)
        self.assertEqual(result['state'],'local_stage_failed','Nonfinite operator clock remains local refusal')
    def incompatible_intake(self,code):
        path=self.f.f.root/'output-intake/plan.json';saved=json.loads(path.read_text())
        self.clear_selected_outputs();self.f.reported(code)
        path.parent.mkdir(mode=0o700);saved['observationSha256']=self.f.observation;path.write_bytes(json_bytes(saved));path.chmod(0o600)
    def test_output_selection_cannot_bind_reported_failure(self):
        self.incompatible_intake(30)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'output selection requires reported completion'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
        self.assertEqual(self.f.calls,[],'Invalid producer selection sends no callback')
    def test_output_selection_cannot_bind_running_task(self):
        self.incompatible_intake(20)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'output selection requires reported completion'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_terminal_context_cannot_bind_running_task(self):
        self.clear_selected_outputs();self.f.reported(20);self.f.root.mkdir(mode=0o700)
        (self.f.root/'context.json').write_bytes(json_bytes({'observationSha256':self.f.observation}));(self.f.root/'context.json').chmod(0o600)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'terminal selection requires reported terminal state'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_orphan_intake_receipt_refuses_before_engine_get(self):
        for name in ('output-archive','private-products','private-raster-inspection','private-artifact-plan','private-artifact-access'):
            shutil.rmtree(self.f.f.root/name)
        (self.f.f.root/'output-intake/plan.json').unlink()
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Orphan stage cannot reobserve engine')):
            result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Missing original selector is a local refusal')
        self.assertEqual(result['stage'],'observation_selection','Orphan receipt refuses before another engine GET')
    def test_harmless_partial_and_lock_without_plan_allow_initial_observation(self):
        self.clear_selected_outputs();path=self.f.f.root/'output-intake';path.mkdir(mode=0o700)
        for name in ('.partial-'+'a'*32,'writer.lock'):
            p=path/name;p.write_bytes(b'');p.chmod(0o600)
        with patch.object(self.f.observer,'observe',wraps=self.f.observer.observe) as observe:
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Harmless interrupted publication can finish its initial task')
        self.assertEqual(observe.call_count,1,'Harmless markers do not invent a saved selection')
    def test_unknown_partial_marker_refuses_before_engine_get(self):
        self.clear_selected_outputs();path=self.f.f.root/'output-intake';path.mkdir(mode=0o700)
        bad=path/'.partial-unknown';bad.write_bytes(b'');bad.chmod(0o600)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'stage records require their original selection'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_isolated_inspection_plan_needs_upstream_selection(self):
        inspection=(self.f.f.root/'private-raster-inspection/plan.json').read_bytes();self.clear_selected_outputs()
        path=self.f.f.root/'private-raster-inspection';path.mkdir(mode=0o700);(path/'plan.json').write_bytes(inspection);(path/'plan.json').chmod(0o600)
        with self.f.runtime.owner(),self.assertRaisesRegex(ValueError,'derived records require original observation selection'):
            self.coordinator._selection(self.f.request,time.monotonic()+4)
    def test_failure_record_cannot_substitute_reported_engine_facts(self):
        with self.f.runtime.owner():
            _,engine,observed=self.f.delivery._observation(self.f.request,self.f.observation,__import__('time').monotonic()+4)
            reported=self.coordinator.reported(observed,engine);reported['reportedStatusCode']=30
            with self.assertRaisesRegex(ValueError,'retain original reported facts'):
                self.coordinator._failure(self.f.request,'products',OSError(),reported)
        self.assertEqual(list(self.f.runtime.root.glob('local-stage-failures-*/*.json')),[],'Changed facts cannot create a local failure record')


if __name__=='__main__':unittest.main()
