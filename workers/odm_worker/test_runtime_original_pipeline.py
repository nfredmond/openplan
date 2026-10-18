"""Original input/commit/delivery composition with actual private journals.

Application authority and effect replies are supplied fixtures. Task metadata
and output archives use actual loopback HTTP, with synthetic raster bytes.
"""
import copy
import io
import json
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch

from admission_journal import encoded
from application_delivery_authority import Authority,FORMAT as AUTHORITY_FORMAT
from application_processing_authority import Authority as CommitAuthority
from retained_source import json_bytes
from runtime_artifact_access import ArtifactAccess
from runtime_artifact_plan import ArtifactPlan
from runtime_commit import Commit
from runtime_draft import Draft
from runtime_georef import Inspection
from runtime_observation import Observer
from runtime_output_intake import Intake
from runtime_preparation import Preparation
from runtime_products import Products
from runtime_terminal_delivery import Delivery
from runtime_worker_coordinator import Coordinator
import runtime_original_pipeline as module
import test_application_draft_authority as fixtures
import test_georef as tags


# Journal fsync and loopback HTTP can exceed four seconds on shared CI runners.
# These tests check custody and replay, not four-second throughput.
FIXTURE_TIMEOUT_SECONDS = 15


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.tearDown)
        self.f.f.custody.timeout=FIXTURE_TIMEOUT_SECONDS
        self.f.f.reader.timeout=FIXTURE_TIMEOUT_SECONDS
        self.runtime=self.f.runtime;self.request=self.f.request['requestId'];self.callbacks=[];self.commits=[]
        self.status=40;self.allowed=True;self.commit_lost=False;self.callback_lost=False;self.network=[]
        image=tags.build_geotiff();buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as archive:archive.writestr('odm_orthophoto/odm_orthophoto.tif',image)
        self.archive=buffer.getvalue();fixture=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_GET(self):
                fixture.network.append(self.path);plan=fixture.f.plan()
                if self.path=='/task/'+plan['taskUuid']+'/info':
                    value={'uuid':plan['taskUuid'],'name':plan['name'],'imagesCount':len(plan['uploads']),
                        'options':copy.deepcopy(plan['options'])+[{'name':n,'value':True} for n in ('pc-ept','cog','gltf')],
                        'status':{'code':fixture.status},'progress':100 if fixture.status in (30,40,50) else 25,
                        'processingTime':1500,'dateCreated':1791869373554}
                    body=json_bytes(value)
                elif self.path=='/task/'+plan['taskUuid']+'/download/all.zip':body=fixture.archive
                else:self.send_error(404);return
                self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.daemon_threads=True
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.close)
        self.f.engine['endpoint']='http://127.0.0.1:'+str(self.server.server_port)
        # The original URL supplier captures this dictionary before preparation.
        self.f.authority.engine=copy.deepcopy(self.f.engine)
        self.observer=Observer(self.f.f.reader,lambda reference:None,self.f.attest,timeout=FIXTURE_TIMEOUT_SECONDS)
        self.plan=ArtifactPlan(Inspection(Products(Intake(self.observer,max_archive_bytes=16384,max_expanded_bytes=16384,
            max_entries=10,max_directory_bytes=4096,timeout=FIXTURE_TIMEOUT_SECONDS),timeout=FIXTURE_TIMEOUT_SECONDS),timeout=FIXTURE_TIMEOUT_SECONDS),timeout=FIXTURE_TIMEOUT_SECONDS)
        self.access=ArtifactAccess(self.plan,lambda *a,**k:self.allowed,timeout=FIXTURE_TIMEOUT_SECONDS,clock=lambda:1000)
        def authority(arguments,deadline,*,owned):
            original=self.f.f.custody.load(self.request,deadline=deadline)
            self.assertEqual(arguments['p_request'],self.request,'Delivery authority keeps original request')
            self.assertEqual(arguments['p_reference'],original['binding']['jobReference'],'Delivery authority keeps original reference')
            return json_bytes({'format':AUTHORITY_FORMAT,'installationId':arguments['p_installation'],
                'targetId':arguments['p_target'],'operation':arguments['p_operation'],'applicationJob':original['applicationJob'],
                'payloadSha256':original['payloadSha256'],'authorizedNow':self.allowed,
                'authorityObservedAt':'2026-10-14T18:00:00Z','engineTransportPermission':False})
        self.delivery=Delivery(self.observer,Authority(self.f.f.custody,authority,timeout=FIXTURE_TIMEOUT_SECONDS),self.send_callback,
            'synthetic-original-callback',access=self.access,timeout=FIXTURE_TIMEOUT_SECONDS)
        self.coordinator=Coordinator(self.observer,self.plan,self.access,self.delivery,
            public_base_url='https://worker.example',lease_seconds=100,clock=lambda:1000,timeout=FIXTURE_TIMEOUT_SECONDS)
        preparation=Preparation(self.runtime,lambda entry:self.f.draft._inputs(entry,__import__('time').monotonic()+FIXTURE_TIMEOUT_SECONDS),timeout=FIXTURE_TIMEOUT_SECONDS)
        draft=Draft(preparation,self.f.authority,self.f.send,timeout=FIXTURE_TIMEOUT_SECONDS,authorize_with_deadline=True)
        self.commit=Commit(draft,CommitAuthority(self.f.f.reader,self.f.engine,self.f.attest),self.send_commit,timeout=FIXTURE_TIMEOUT_SECONDS)
        self.pipeline=module.Pipeline(self.f.pipeline,self.commit,self.coordinator)
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join(timeout=2)
    def send_commit(self,plan,deadline,*,owned):
        self.assertTrue(owned(),'Commit transport remains owned');self.commits.append(copy.deepcopy(plan))
        if self.commit_lost:raise OSError('synthetic private commit error')
        return 200,json_bytes({'uuid':plan['taskUuid']})
    def send_callback(self,url,credential,body,deadline,*,owned):
        self.assertTrue(owned(),'Callback transport remains owned');self.callbacks.append(body)
        if self.callback_lost:raise OSError('synthetic private callback error')
        return 200,json_bytes({'ok':True,'status':json.loads(body)['status']})
    def advance(self):
        with self.runtime.owner():self.f.f.started();return self.pipeline.advance(self.request)
    def through_drafts(self):return [self.advance() for _ in range(3)]
    def job(self):
        entry=self.runtime.journal.get(self.request)
        return {'request':copy.deepcopy(entry.request),'job_reference':entry.job_reference,'state':'accepted'}
    def test_fresh_inputs_commit_products_and_original_callback(self):
        rows=self.through_drafts();result=self.advance()
        self.assertEqual([r['state'] for r in rows],['draft_pending']*3,'All original uploads precede processing')
        self.assertEqual(len(self.f.fetches),1,'Frozen original ZIP fetch occurs once')
        self.assertEqual([r[2] for r in self.f.sends],[None,*self.f.raw],'Exact original images reach original drafts')
        self.assertEqual(len(self.commits),1,'One original commit reaches transport')
        self.assertEqual(result['state'],'acknowledged','Original commit reaches retained product and callback delivery')
        callback=json.loads(self.callbacks[0]);self.assertEqual(callback['status'],'succeeded','Original completion reaches success callback')
        self.assertEqual(callback['artifacts'][0]['kind'],'orthomosaic','Original product reaches contract roster')
        self.assertEqual(len(self.network),2,'One original metadata and archive GET')
        for k,v in module.LIMITS.items():self.assertEqual(result[k],v,'Pipeline cannot promote '+k)
    def test_terminal_retry_skips_input_commit_and_engine_reads(self):
        self.through_drafts();initial=self.advance();before=list(self.network)
        failure=initial.get('localFailure') or initial.get('coordination') or {}
        if failure.get('failureSha256'):
            failure=json.loads(next(self.runtime.root.glob(f"local-stage-failures-*/{failure['failureSha256']}.json")).read_text())
        self.assertEqual(initial['state'],'acknowledged',
            f"Replay setup failed: state={initial['state']} stage={failure.get('stage')} error={failure.get('errorType')}")
        with patch.object(self.f.pipeline,'advance',side_effect=AssertionError('Terminal replay cannot reenter inputs')),patch.object(self.commit,'advance',side_effect=AssertionError('Terminal replay cannot recommit')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Saved terminal replay recovers exact acknowledgement')
        self.assertEqual(self.network,before,'Saved terminal cannot reobserve or redownload')
        self.assertEqual(len(self.callbacks),1,'Acknowledgement replay suppresses another POST')
    def test_uncertain_commit_holds_without_task_read_or_callback(self):
        self.through_drafts();self.commit_lost=True
        self.assertEqual(self.advance()['state'],'local_stage_failed','Lost commit reply remains local')
        result=self.advance()
        self.assertEqual(result['state'],'processing_held','Uncertain commit must stay held')
        self.assertEqual(len(self.commits),1,'Uncertain commit cannot send another POST')
        self.assertEqual(self.network,[],'Uncertain commit cannot read task for automatic delivery')
        self.assertEqual(self.callbacks,[],'Uncertain commit cannot send terminal callback')
    def test_revoked_commit_cannot_send_or_observe(self):
        self.through_drafts();self.f.f.receipt['authorizedNow']=False
        self.assertEqual(self.advance()['state'],'local_stage_failed','Commit refusal remains local')
        self.assertEqual(self.commits,[],'Revoked actor cannot send commit')
        self.assertEqual(self.network,[],'Revoked commit cannot observe task')
    def test_running_original_commit_stays_pending(self):
        self.status=20;self.through_drafts();result=self.advance()
        self.assertEqual(result['state'],'processing_pending','Running engine stays pending')
        self.assertEqual(len(self.commits),1,'Running task keeps one original commit')
        self.assertEqual(self.callbacks,[],'Running task cannot send terminal callback')
    def test_failed_original_skips_products_and_sets_reported30(self):
        self.status=30;self.through_drafts()
        with self.runtime.owner():
            job=self.job();self.pipeline(job)
        self.assertEqual(job['state'],'failed','Reported30 maps to local failed state')
        self.assertEqual(job['reportedEngineTerminal']['statusCode'],30,'Local failure reports original30')
        self.assertEqual(len(self.network),1,'Failed original cannot download output archive')
        self.assertNotIn('artifacts',json.loads(self.callbacks[0]),'Failed original cannot invent products')
    def test_canceled_original_sets_reported50(self):
        self.status=50;self.through_drafts()
        with self.runtime.owner():job=self.job();self.pipeline(job)
        self.assertEqual(job['state'],'canceled','Reported50 maps to local canceled state')
        self.assertEqual(job['reportedEngineTerminal']['statusCode'],50,'Canceled original keeps50')
    def test_local_product_error_cannot_set_local_engine_failure(self):
        self.through_drafts()
        with patch.object(self.plan,'advance',side_effect=OSError('private product error')),self.runtime.owner():
            job=self.job();self.pipeline(job)
        self.assertEqual(job['state'],'local_stage_failed','Local product error stays separate')
        self.assertNotIn('reportedEngineTerminal',job,'Local product error cannot release terminal queue')
        self.assertEqual(job['originalPipeline']['coordination']['reportedEngine']['reportedStatusCode'],40,'Original completion is retained')
        self.assertEqual(self.callbacks,[],'Local product error cannot invent failure callback')
    def test_lost_callback_recovers_exact_body_without_another_commit(self):
        self.through_drafts();self.callback_lost=True;self.advance();self.callback_lost=False
        self.assertEqual(self.advance()['state'],'acknowledged','Lost callback recovers original delivery')
        self.assertEqual(len(self.commits),1,'Callback retry cannot recommit processing')
        self.assertEqual(self.callbacks,[self.callbacks[0]]*2,'Callback retry keeps exact original bytes')
    def test_terminal_recovery_requires_saved_acknowledged_commit(self):
        self.through_drafts();self.advance()
        path=next(self.runtime.root.glob('preparation-*/engine/command-00003.reply.json'));path.unlink()  # Remove only the owned synthetic fixture reply.
        result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Terminal cannot hide missing original commit acknowledgement')
        self.assertEqual((result['localFailure'].get('reportedEngine') or {}).get('reportedStatusCode'),40,'Missing commit acknowledgement retains known original40')
        self.assertEqual(len(self.callbacks),1,'Missing commit acknowledgement sends no additional callback')
    def test_mismatched_commit_plan_refuses_before_commit_transport(self):
        self.through_drafts();original=self.commit.draft._effects
        def foreign(*a,**k):
            effects,root=original(*a,**k);effects.plan={**effects.plan,'name':'another task'};return effects,root
        with patch.object(self.commit.draft,'_effects',side_effect=foreign):result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Different original commit plan is refused')
        self.assertEqual(result['localFailure']['stage'],'commit_scope','Original commit scope refuses before commit delegate')
        self.assertEqual(self.commits,[],'Foreign commit plan cannot reach transport')
    def test_constructor_refuses_different_runtime_or_dispatch(self):
        with patch.object(self.coordinator,'dispatch',object()),self.assertRaisesRegex(ValueError,'one owned adapter graph'):
            module.Pipeline(self.f.pipeline,self.commit,self.coordinator)
        with self.assertRaisesRegex(ValueError,'one owned adapter graph'):module.Pipeline(None,self.commit,self.coordinator)
    def test_job_identity_is_checked_before_stages(self):
        with self.runtime.owner():
            self.f.f.started();job=self.job();job['job_reference']='another-worker-reference'
            with self.assertRaisesRegex(ValueError,'job identity differs'):self.pipeline(job)
        self.assertEqual(self.f.fetches,[],'Foreign job identity cannot start source fetch')
    def test_unowned_pipeline_refuses_before_capture(self):
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.pipeline.advance(self.request)
        self.assertEqual(self.f.f.calls,[],'Unowned original cannot capture dispatch')
    def test_actual_runtime_queue_stays_held_before_completion(self):
        self.runtime.pipeline=self.pipeline
        with self.runtime.owner():
            self.assertTrue(self.runtime.run_one(),'Owned queue begins original input preparation')
            self.assertFalse(self.runtime.run_one(),'Started draft holds next queue execution')
        self.assertEqual(self.runtime.status()['heldStarted'],1,'Draft does not release original queue custody')

    def test_owned_resume_finishes_original_start_without_restarting_admission(self):
        self.runtime.pipeline=self.pipeline
        with self.runtime.owner():
            self.assertTrue(self.runtime.run_one())
            entry=self.runtime.journal.get(self.request);context=copy.deepcopy(entry.started_context)
            self.assertTrue(self.pipeline.resume_one());self.assertTrue(self.pipeline.resume_one())
            self.assertTrue(self.pipeline.resume_one(),'Owned original resume reaches terminal delivery')
            self.assertFalse(self.pipeline.resume_one(),'Completed original is not resumed again')
        self.assertEqual(self.runtime.journal.get(self.request).started_context,context,'Original resume preserves first start context')
        self.assertEqual(self.runtime.status()['heldStarted'],0,'Acknowledged completion releases original held start')
        self.assertEqual(self.runtime.status()['localTerminal'],1,'Original reported completion is durably recorded')
        self.assertEqual(len(self.commits),1,'Repeated original resume cannot recommit')
    def test_uncertain_resume_keeps_queue_held_and_no_terminal_outcome(self):
        self.runtime.pipeline=self.pipeline;self.commit_lost=True
        with self.runtime.owner():
            self.runtime.run_one()
            for _ in range(4):self.pipeline.resume_one()
        self.assertEqual(self.runtime.status()['heldStarted'],1,'Uncertain commit remains an original held start')
        self.assertEqual(self.runtime.status()['localTerminal'],0,'Uncertain commit cannot create terminal outcome')
        self.assertEqual(len(self.commits),1,'Uncertain resumed commit sends once')
    def test_resume_requires_registered_owned_pipeline(self):
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'registered pipeline'):self.pipeline.resume_one()
        self.runtime.pipeline=self.pipeline
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.pipeline.resume_one()
        self.assertEqual(self.f.fetches,[],'Unowned recovery cannot fetch source')
    def test_busy_execution_lock_suppresses_recovery(self):
        self.runtime.pipeline=self.pipeline
        with self.runtime.owner():
            self.f.f.started();self.runtime._execution.acquire()
            try:self.assertFalse(self.pipeline.resume_one(),'Busy original execution cannot overlap recovery')
            finally:
                if self.runtime._execution.locked():self.runtime._execution.release()
        self.assertEqual(self.f.fetches,[],'Busy recovery cannot fetch source')
    def test_local_error_resume_keeps_queue_held(self):
        self.runtime.pipeline=self.pipeline
        with self.runtime.owner():
            self.runtime.run_one();self.pipeline.resume_one();self.pipeline.resume_one()
            with patch.object(self.plan,'advance',side_effect=OSError('private local error')):
                self.pipeline.resume_one()
        self.assertEqual(self.runtime.status()['heldStarted'],1,'Local product failure keeps original queue held')
        self.assertEqual(self.runtime.status()['localTerminal'],0,'Local product failure cannot create failed engine outcome')
    def test_foreign_request_refuses_before_input_transport(self):
        with self.runtime.owner():
            self.f.f.started();job=self.job();job['request']['missionTitle']='changed'
            with self.assertRaisesRegex(ValueError,'job identity differs'):self.pipeline(job)
        self.assertEqual(self.f.fetches,[],'Changed original request cannot fetch inputs')
    def test_unknown_terminal_projection_cannot_release_queue(self):
        self.through_drafts()
        with self.runtime.owner(),patch.object(self.pipeline,'advance',return_value={'state':'acknowledged',
                'coordination':{'state':'acknowledged','reportedEngine':{'reportedStatusCode':99}}}):
            with self.assertRaisesRegex(ValueError,'terminal state differs'):self.pipeline(self.job())
    def test_non_job_projection_refuses(self):
        for job in (None,[],{}, {'request':None}):
            with self.assertRaisesRegex(ValueError,'original job request'):self.pipeline(job)

    def test_existing_local_outcome_without_engine_facts_holds_before_effects(self):
        from runtime_admission import OUTCOME
        self.runtime.pipeline=self.pipeline
        with self.runtime.owner():
            entry=self.f.f.started();name=self.runtime._name(entry)
            value={'format':OUTCOME,'binding':self.runtime._binding(entry),'state':'failed',
                'reportedEngineTerminal':None,'callbackDeliveryVerification':'unassessed',
                'sourceCustodyVerification':'unassessed','engineCustodyVerification':'unassessed'}
            from retained_source import publish
            publish(self.runtime.root,name,json_bytes(value));original=(self.runtime.root/name).read_bytes()
            self.assertFalse(self.pipeline.resume_one(),'Prior local outcome requires separate bound recovery before effects')
        self.assertEqual(self.f.fetches,[],'Prior local outcome cannot fetch inputs')
        self.assertEqual(self.commits,[],'Prior local outcome cannot commit engine work')
        self.assertEqual((self.runtime.root/name).read_bytes(),original,'Prior local outcome is preserved exactly')

    def test_foreign_commit_journal_root_refuses_before_commit_delegate(self):
        self.through_drafts();original=self.commit.draft._effects
        def foreign(*a,**k):
            effects,root=original(*a,**k);foreign=root.with_name('another-preparation-root');foreign.mkdir(mode=0o700,exist_ok=True);return effects,foreign
        with patch.object(self.commit.draft,'_effects',side_effect=foreign):result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Foreign commit journal root is refused')
        self.assertEqual(result['localFailure']['stage'],'commit_scope','Foreign journal root refuses before commit delegate')
        self.assertEqual(self.commits,[],'Foreign journal root cannot commit original task')


if __name__=='__main__':unittest.main()
