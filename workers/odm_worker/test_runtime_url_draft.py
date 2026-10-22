"""Frozen source/preparation/draft composition with controlled supplied adapters."""
import copy
from dataclasses import replace
import hashlib
import json
import shutil
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import runtime_url_draft as module
from runtime_url_draft import Pipeline
from runtime_admission import Runtime
from runtime_url_intake import Intake
import test_runtime_url_intake as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixture.Checks();self.f.setUp();self.runtime=self.f.runtime;self.request=self.f.request
        self.calls=[];self.permissions=[];self.jobs=[]
        self.pipeline=Pipeline(self.f.intake,self.allow,self.send,timeout=4)
        def run(job):self.jobs.append(job);self.pipeline(job)
        self.runtime.pipeline=run

    def tearDown(self):self.f.tearDown()

    def allow(self,plan,operation,command):self.permissions.append((copy.deepcopy(plan),operation,copy.deepcopy(command)));return True

    def send(self,engine,command,stream,deadline):
        self.assertFalse(command['path'].startswith('/task/new/commit/'),'URL pipeline must not send a processing commit')
        raw=stream.read() if stream is not None else None
        self.calls.append({'engine':copy.deepcopy(engine),'command':copy.deepcopy(command),'bytes':raw,'deadline':deadline})
        return 200,json.dumps({'uuid':command['headers']['set-uuid']}).encode() if stream is None else b'{ "success": true }\n'

    def advance(self):
        with self.runtime.owner():self.f.start();return self.pipeline.advance(self.request['requestId'])

    def test_current_authorization_shares_the_outer_deadline(self):
        observed=[]
        def authorize(plan,operation,command,*,deadline=None):observed.append(deadline);return True
        self.pipeline.authorize=authorize;self.pipeline.authorize_with_deadline=True
        self.advance()
        self.assertEqual(observed,[self.calls[0]['deadline']], 'Current authorization must receive the actual shared URL deadline')

    def test_authorization_deadline_selection_requires_boolean(self):
        for value in (1,None,'yes'):
            with self.assertRaisesRegex(ValueError,'URL draft authorization deadline selection must be boolean'):
                Pipeline(self.f.intake,self.allow,self.send,authorize_with_deadline=value)

    def test_owned_queue_advances_one_original_init_and_keeps_start_held(self):
        later=copy.deepcopy(self.request);later['requestId']='synthetic-url-draft-later';self.runtime.submit(later)
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True);self.assertIs(self.runtime.run_one(),False,'URL draft start must keep the next job held')
        self.assertEqual(len(self.calls),1,'One owned pipeline call must advance only one command')
        job=self.jobs[0];result=job['url_draft']
        self.assertEqual(job['state'],'draft_pending');self.assertEqual(job['draft']['operation'],'init')
        self.assertEqual(job['draft']['taskUuid'],self.f.read(self.f.fixture.folder/'engine/plan.json')['taskUuid'],'Reported draft task must be original')
        self.assertEqual(result['authorityVerification'],'unassessed','URL draft cannot promote supplied authority')
        self.assertIs(result['commitPermission'],False,'URL draft cannot grant processing commit')
        self.assertIs(result['preparation']['engineTransportPermission'],False)
        self.assertEqual(self.permissions[0][0]['binding']['originalContext']['originalActorId'],'synthetic-original-actor')

    def test_original_settings_bytes_and_order_survive_changed_supplier(self):
        first=self.advance();task=first['draft']['taskUuid'];original=copy.deepcopy(self.f.spec)
        self.f.intake.supply=lambda entry:(_ for _ in ()).throw(AssertionError('Draft preparation called changed supplier'))
        self.f.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Draft preparation refetched complete bytes'))
        self.f.spec['engine']['instanceId']='changed';self.f.spec['options'][0]['value']=False
        with self.runtime.owner():results=[self.pipeline.advance(self.request['requestId']) for _ in range(3)]
        self.assertEqual([first['draft']['operation'],*[row['draft']['operation'] for row in results]],['init','upload:0','upload:1',None],'Original command order must remain')
        self.assertEqual(results[-1]['draft']['state'],'draft_complete_commit_held')
        self.assertEqual([row['bytes'] for row in self.calls],[None,*self.f.raw],'Original image bytes must reach draft transport')
        self.assertTrue(all(row['engine']==original['engine'] for row in self.calls),'Original engine settings must reach transport')
        self.assertTrue(all(plan['options']==original['options'] for plan,operation,command in self.permissions))
        self.assertTrue(all(row['draft']['taskUuid']==task for row in results),'Original task must survive every advance')
        self.assertFalse((self.f.fixture.folder/'engine/command-00003.intent.json').exists(),'Commit must stay unissued')
        self.assertEqual(len(self.f.supplied),1,'Original supplier may run only before first intake')

    def test_denied_permission_cannot_issue_intent_or_send(self):
        with self.runtime.owner():
            self.f.start()
            for decision in (False,None,1):
                self.pipeline.authorize=lambda *args:decision
                with self.subTest(decision=decision),self.assertRaisesRegex(PermissionError,'^Explicit draft permission was not confirmed$'):self.pipeline.advance(self.request['requestId'])
                self.assertFalse((self.f.fixture.folder/'engine/command-00000.intent.json').exists(),'Denied URL draft cannot issue intent')
                self.assertEqual(self.calls,[])

    def test_lost_reply_keeps_intent_and_prevents_reissue_or_later_upload(self):
        self.advance();send=self.pipeline.transport
        def lose(*args):send(*args);raise OSError('Synthetic URL draft lost reply')
        self.pipeline.transport=lose
        with self.runtime.owner():
            with self.assertRaisesRegex(OSError,'Synthetic URL draft lost reply'):self.pipeline.advance(self.request['requestId'])
            self.pipeline.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Uncertain URL draft retried transport'))
            self.pipeline.authorize=lambda *args:(_ for _ in ()).throw(AssertionError('Uncertain URL draft requested another permission'))
            result=self.pipeline.advance(self.request['requestId'])
        self.assertEqual(result['draft']['state'],'held_uncertain');self.assertEqual(len(self.calls),2)
        self.assertTrue((self.f.fixture.folder/'engine/command-00001.intent.json').exists())
        self.assertFalse((self.f.fixture.folder/'engine/command-00001.reply.json').exists())
        self.assertFalse((self.f.fixture.folder/'engine/command-00002.intent.json').exists(),'Uncertain original prefix must block later upload')

    def test_relocated_runtime_advances_original_upload_without_download_root(self):
        original=self.advance();restored=self.f.fixture.base/'restored-url-draft-runtime';shutil.copytree(self.runtime.root,restored)
        runtime=Runtime(restored,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
        missing=self.f.fixture.base/'missing-source'
        intake=Intake(runtime,missing,'synthetic-local-target',lambda *args:(_ for _ in ()).throw(AssertionError('Restored draft resupplied')),
            lambda *args:(_ for _ in ()).throw(AssertionError('Restored draft refetched')),timeout=4)
        pipeline=Pipeline(intake,self.allow,self.send,timeout=4)
        with runtime.owner():result=pipeline.advance(self.request['requestId'])
        self.assertEqual(result['draft']['operation'],'upload:0');self.assertEqual(self.calls[-1]['bytes'],self.f.raw[0])
        self.assertEqual(result['draft']['taskUuid'],original['draft']['taskUuid'],'Relocation must preserve the original task')
        self.assertFalse(missing.exists())

    def test_partial_intake_finishes_only_missing_source_before_first_command(self):
        fetch=self.f.intake.fetch
        def partial(url,output,remaining,deadline):
            if url.endswith('b.jpg'):output.write(b'x');raise OSError('Synthetic interrupted URL draft source')
            return fetch(url,output,remaining,deadline)
        self.f.intake.fetch=partial
        with self.runtime.owner():
            self.f.start()
            with self.assertRaisesRegex(OSError,'Synthetic interrupted URL draft source'):self.pipeline.advance(self.request['requestId'])
            self.assertEqual(self.calls,[],'Incomplete source intake must not issue an engine command')
            self.f.intake.supply=lambda *args:(_ for _ in ()).throw(AssertionError('Partial draft resupplied settings'))
            self.f.intake.fetch=fetch;self.f.calls.clear();result=self.pipeline.advance(self.request['requestId'])
        self.assertEqual(self.f.calls,[self.request['imagery']['photos'][1]['url']]);self.assertEqual(result['draft']['operation'],'init')

    def test_invalid_constructor_adapters_and_deadline(self):
        for changes in ({'intake':None},{'authorize':None},{'transport':None},{'timeout':True},{'timeout':0},{'timeout':float('nan')}):
            args={'intake':self.f.intake,'authorize':self.allow,'transport':self.send,'timeout':4,**changes}
            with self.subTest(changes=changes),self.assertRaises(ValueError):Pipeline(**args)

    def test_original_owner_and_pre_cancelled_signal_refuse_before_intake(self):
        with self.runtime.owner():self.f.start()
        with self.assertRaisesRegex(ValueError,'requires its lifetime owner'):self.pipeline.advance(self.request['requestId'])
        self.f.intake.cancelled=lambda:True
        with self.runtime.owner(),self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):self.pipeline.advance(self.request['requestId'])
        self.assertEqual(self.calls,[]);self.assertEqual(self.f.supplied,[])

    def test_pipeline_job_identity_refuses_before_fetch_or_permission(self):
        job={'request':{**self.request,'missionTitle':'changed'},'job_reference':self.f.fixture.entry.job_reference,'accepted_callback':self.f.fixture.entry.admission,'state':'accepted'}
        with self.runtime.owner():
            self.f.start()
            with self.assertRaisesRegex(ValueError,'Pipeline URL intake identity differs'):self.pipeline(job)
        self.assertEqual(self.f.calls,[]);self.assertEqual(self.permissions,[])

    def test_saved_input_adapter_requires_original_admission(self):
        self.f.resume();entry=replace(self.runtime.journal.get(self.request['requestId']),job_reference='changed')
        with self.runtime.owner(),patch('runtime_url_draft.read_json',side_effect=AssertionError('Changed admission read saved draft inputs')):
            with self.assertRaisesRegex(ValueError,'^Original URL draft preparation admission differs$'):self.pipeline._inputs(entry,time.monotonic()+4)

    def test_saved_settings_shape_and_version_refuse_before_validation(self):
        self.f.resume();path=self.f.root/'plan.json';raw=path.read_bytes();saved=json.loads(raw)
        try:
            for changed in ([],{**saved,'extra':True},{**saved,'format':'changed'}):
                self.f.restore(path,module.json_bytes(changed))
                with self.subTest(value=changed),self.runtime.owner(),patch.object(self.f.intake,'_settings',side_effect=AssertionError('Malformed draft settings reached validation')):
                    with self.assertRaisesRegex(ValueError,'^Original URL draft settings plan differs$'):self.pipeline._inputs(self.runtime.journal.get(self.request['requestId']),time.monotonic()+4)
        finally:self.f.restore(path,raw)

    def test_saved_settings_original_binding_refuses_before_mapping(self):
        self.f.resume();path=self.f.root/'plan.json';raw=path.read_bytes();saved=json.loads(raw);saved['binding']['originalContext']['originalActorId']='changed'
        self.f.restore(path,module.json_bytes(saved))
        try:
            with self.runtime.owner(),patch.object(self.f.intake,'_mapping',side_effect=AssertionError('Changed draft binding reached mapping')):
                with self.assertRaisesRegex(ValueError,'^Original URL draft settings binding differs$'):self.pipeline._inputs(self.runtime.journal.get(self.request['requestId']),time.monotonic()+4)
        finally:self.f.restore(path,raw)

    def test_saved_mapping_settings_hash_refuses(self):
        self.f.resume();path=self.f.root/'sources.json';raw=path.read_bytes();mapping=json.loads(raw);mapping['intakePlanSha256']='a'*64
        self.f.restore(path,module.json_bytes(mapping))
        try:
            with self.runtime.owner(),self.assertRaisesRegex(ValueError,'^Original runtime URL source mapping differs$'):self.pipeline._inputs(self.runtime.journal.get(self.request['requestId']),time.monotonic()+4)
        finally:self.f.restore(path,raw)

    def test_cancellation_in_permission_refuses_before_intent(self):
        def cancel(*args):self.f.intake.cancelled=lambda:True;return True
        self.pipeline.authorize=cancel
        with self.runtime.owner():
            self.f.start()
            with self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):self.pipeline.advance(self.request['requestId'])
        self.assertFalse((self.f.fixture.folder/'engine/command-00000.intent.json').exists(),'Cancelled permission cannot issue an intent')
        self.assertEqual(self.calls,[])

    def test_cancellation_during_transport_leaves_original_intent_unresolved(self):
        send=self.pipeline.transport
        def cancel(*args):result=send(*args);self.f.intake.cancelled=lambda:True;return result
        self.pipeline.transport=cancel
        with self.runtime.owner():
            self.f.start()
            with self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):self.pipeline.advance(self.request['requestId'])
        self.assertTrue((self.f.fixture.folder/'engine/command-00000.intent.json').exists())
        self.assertFalse((self.f.fixture.folder/'engine/command-00000.reply.json').exists(),'Cancelled transport cannot save a reply')

    def test_source_stage_shares_total_deadline_without_mutating_original_adapter(self):
        # Exercise real delegates with distinct budgets, then inspect the
        # forwarded boundaries instead of requiring fixture fsyncs within1s.
        self.f.intake.timeout=120
        original=module.Intake;draft=module.Draft;timeouts=[];timeout=self.f.intake.timeout;clocks=[]
        def observed_clock():
            current=time.monotonic();clocks.append(current);return current
        def construct(*args,**kwargs):timeouts.append(kwargs['timeout']);return original(*args,**kwargs)
        def extended(preparation,authorize,transport,**kwargs):
            def send(engine,command,stream,deadline):return transport(engine,command,stream,deadline+1)
            return draft(preparation,authorize,send,**kwargs)
        self.pipeline.timeout=30
        with patch('runtime_url_draft.Intake',side_effect=construct),patch('runtime_url_draft.Draft',side_effect=extended),patch.object(module,'time',SimpleNamespace(monotonic=observed_clock)):self.advance()
        self.assertTrue(timeouts);self.assertLessEqual(timeouts[0],self.pipeline.timeout,'Intake cannot receive more than the whole pipeline deadline')
        self.assertEqual(self.f.intake.timeout,timeout,'Pipeline cannot mutate the original intake timeout')
        self.assertTrue(clocks,'Pipeline must establish its original deadline')
        self.assertLessEqual(self.calls[0]['deadline'],clocks[0]+self.pipeline.timeout,'Engine transport cannot extend the pipeline deadline')

    def test_expired_permission_cannot_issue_intent(self):
        expired=[False]
        def expire(*args):expired[0]=True;return True
        clock=SimpleNamespace(monotonic=lambda:1e12 if expired[0] else time.monotonic())
        self.pipeline.authorize=expire;self.pipeline.timeout=30;self.f.intake.timeout=30
        with self.runtime.owner(),patch('runtime_url_intake.time',clock):
            self.f.start()
            with self.assertRaisesRegex(TimeoutError,'^Original runtime URL intake deadline exceeded$'):self.pipeline.advance(self.request['requestId'])
        self.assertFalse((self.f.fixture.folder/'engine/command-00000.intent.json').exists(),'Expired URL draft cannot issue an intent')

    def test_cancellation_changed_during_source_write_reaches_cloned_stage(self):
        fetch=self.f.intake.fetch
        def cancel(url,output,remaining,deadline):self.f.intake.cancelled=lambda:True;return fetch(url,output,remaining,deadline)
        self.f.intake.fetch=cancel
        with self.runtime.owner():
            self.f.start()
            with self.assertRaisesRegex(InterruptedError,'Original runtime URL intake cancelled'):self.pipeline.advance(self.request['requestId'])
        pack=self.f.source_root/('request-'+hashlib.sha256(self.request['requestId'].encode()).hexdigest())
        self.assertFalse((pack/'source-00000.complete.json').exists(),'Cloned intake must see the current cancellation signal')
        self.assertEqual(self.calls,[])

    def test_late_draft_cancellation_cannot_report_success(self):
        advance=module.Draft.advance
        def cancel(draft,request_id):result=advance(draft,request_id);self.f.intake.cancelled=lambda:True;return result
        with self.runtime.owner():
            self.f.start()
            with patch.object(module.Draft,'advance',cancel),self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):
                self.pipeline.advance(self.request['requestId'])

    def test_saved_mapping_cancellation_cannot_return_inputs(self):
        self.f.resume();mapping=self.f.intake._mapping
        def cancel(*args):result=mapping(*args);self.f.intake.cancelled=lambda:True;return result
        with self.runtime.owner(),patch.object(self.f.intake,'_mapping',cancel),self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):
            self.pipeline._inputs(self.runtime.journal.get(self.request['requestId']),time.monotonic()+4)


if __name__=='__main__':unittest.main()
