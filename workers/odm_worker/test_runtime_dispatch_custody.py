"""Exact supplied dispatch custody inside the original owned URL draft pipeline."""
import copy
from contextlib import contextmanager
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import runtime_dispatch_custody as module
from retained_source import json_bytes
from runtime_dispatch_custody import Custody, Pipeline
from runtime_admission import Runtime
from runtime_url_intake import Intake
from runtime_url_draft import Pipeline as UrlDraft
import test_runtime_url_draft as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.Checks();self.fixture.setUp()
        self.runtime = self.fixture.runtime;self.request = self.fixture.request
        self.intake = self.fixture.f.intake;self.original = self.fixture.pipeline
        self.row = {**self.fixture.f.spec['applicationJob'], 'project_id': None}
        self.payload = (json.dumps(self.request, ensure_ascii=False, indent=2)+'\n').encode()
        self.custody = Custody(self.runtime, self.intake.target, timeout=4)
        self.captures = []
        def capture(entry): self.captures.append(entry);return self.payload, self.row
        self.pipeline = Pipeline(self.original, self.custody, capture)
        self.runtime.pipeline = self.pipeline
        self.folder = self.custody.folder(self.request['requestId'])

    def tearDown(self): self.fixture.tearDown()

    def start(self): return self.fixture.f.start()

    def save(self):
        self.start();return self.custody.save(self.request['requestId'], self.payload, self.row)

    def read(self): return json.loads((self.folder/'receipt.json').read_bytes())

    def write(self, value):
        path = self.folder/'receipt.json';path.write_bytes(json_bytes(value));path.chmod(0o600)

    def advance(self):
        with self.runtime.owner():self.start();return self.pipeline.advance(self.request['requestId'])

    def test_selected_current_authorization_deadline_survives_dispatch_clone(self):
        observed=[]
        def authorize(plan,operation,command,*,deadline=None):observed.append(deadline);return True
        self.original.authorize=authorize;self.original.authorize_with_deadline=True
        self.advance()
        self.assertEqual(observed,[self.fixture.calls[0]['deadline']], 'Original dispatch must forward the actual authorization deadline')

    def test_actual_queue_preserves_exact_bytes_actor_project_and_admission(self):
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(), True)
            self.assertIs(self.runtime.run_one(), False)
        receipt = self.read()
        self.assertEqual(receipt['payloadText'].encode(), self.payload, 'Preserve the exact supplied bytes, including whitespace')
        self.assertEqual(receipt['payloadSha256'], hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(receipt['payloadBytes'], len(self.payload))
        self.assertEqual(receipt['applicationJob'], self.row, 'Preserve the explicit nullable project and original actor')
        self.assertEqual(receipt['binding']['admission'], self.fixture.f.fixture.entry.admission)
        self.assertEqual(receipt['authorityVerification'], 'unassessed', 'Supplied dispatch cannot promote live authority')
        self.assertIs(receipt['engineTransportPermission'], False, 'Dispatch capture cannot permit engine transport')

    def test_receipt_precedes_source_fetch_and_detaches_supplied_aliases(self):
        fetch = self.intake.fetch
        def inspect(*args):
            self.assertTrue((self.folder/'receipt.json').exists(), 'Original dispatch must precede source fetching')
            self.row['created_by'] = 'Changed after capture'
            return fetch(*args)
        self.intake.fetch = inspect;self.advance()
        self.assertEqual(self.read()['applicationJob']['created_by'], 'synthetic-original-actor')

    def test_original_publication_uses_its_expanded_receipt_bound(self):
        original = module.publish
        def publication(*args, **kwargs):
            with patch('retained_source.JSON_LIMIT', 1):
                return original(*args, **kwargs)
        with patch.object(module, 'publish', side_effect=publication):
            with self.runtime.owner():
                self.start();saved = self.custody.save(self.request['requestId'], self.payload, self.row)
        self.assertEqual(saved['payloadText'].encode(), self.payload, 'Original publication must use its expanded receipt bound')

    def test_network_capture_receives_the_actual_shared_deadline(self):
        readings, deadlines = [], []
        original_clock = time.monotonic
        def clock():
            value = original_clock();readings.append(value);return value
        def capture(entry, *, deadline=None):
            deadlines.append(deadline);return self.payload, self.row
        self.pipeline = Pipeline(self.original, self.custody, capture, capture_with_deadline=True)
        self.original.timeout = 1
        with patch.object(module, 'time', SimpleNamespace(monotonic=clock)):
            self.advance()
        self.assertEqual(deadlines, [readings[0] + 1], 'Network capture must receive the actual shared pipeline deadline')

    def test_capture_deadline_selection_requires_a_boolean(self):
        for value in (None, 0, 1, 'yes'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^Original dispatch capture deadline selection must be boolean$'):
                Pipeline(self.original, self.custody, self.pipeline.capture, capture_with_deadline=value)

    def test_original_capture_never_requeries_on_complete_or_uncertain_replay(self):
        self.advance()
        self.pipeline.capture = lambda entry: (_ for _ in ()).throw(AssertionError('Original dispatch was recaptured'))
        self.intake.supply = lambda entry: (_ for _ in ()).throw(AssertionError('Original settings were resupplied'))
        with self.runtime.owner():
            result = self.pipeline.advance(self.request['requestId'])
            self.assertEqual(result['originalDispatchSha256'], hashlib.sha256(self.payload).hexdigest())
            self.assertEqual(result['originalProjectId'], None)

    def test_constructor_and_pipeline_require_matching_runtime_target_adapters(self):
        for runtime, target, timeout in [(None,'target',1),(self.runtime,'',1)]:
            with self.assertRaises(ValueError): Custody(runtime,target,timeout=timeout)
        for timeout in (False,float('nan'),0):
            with self.assertRaisesRegex(ValueError,'^Original dispatch deadline must be positive and finite$'):Custody(self.runtime,'t',timeout=timeout)
        other = Custody(self.runtime,'other')
        for arguments in [(None,self.custody,lambda e:None),(self.original,other,lambda e:None),(self.original,self.custody,None)]:
            with self.assertRaisesRegex(ValueError,'^Original dispatch pipeline adapters differ$'): Pipeline(*arguments)

    def test_unowned_or_unstarted_capture_refuses_before_record_reads(self):
        with patch.object(self.custody,'_read',side_effect=AssertionError('Unowned dispatch read')):
            with self.assertRaisesRegex(ValueError,'^Runtime preparation requires its lifetime owner$'):self.custody.load(self.request['requestId'])
        with self.runtime.owner():
            with self.assertRaisesRegex(ValueError,'^Original owned start is required before preparation$'):self.custody.save(self.request['requestId'],self.payload,self.row)

    def test_expired_or_nonfinite_deadline_refuses_before_capture_io(self):
        with self.runtime.owner():
            self.start()
            for deadline in (time.monotonic()-1,float('nan'),True):
                with patch.object(self.custody,'_record',side_effect=AssertionError('Invalid deadline reached dispatch validation')):
                    with self.assertRaises((ValueError,TimeoutError)):self.custody.save(self.request['requestId'],self.payload,self.row,deadline=deadline)

    def test_payload_requires_bounded_actual_bytes(self):
        with self.runtime.owner():
            self.start()
            for payload in (self.payload,'text',bytearray(self.payload),b''):
                limit = len(self.payload)-1
                with patch.object(module,'MAX_BYTES',limit):
                    with self.assertRaisesRegex(ValueError,'^Original dispatch byte count differs$'):self.custody.save(self.request['requestId'],payload,self.row)

    def test_ambiguous_nonfinite_and_invalid_utf8_json_refuse(self):
        payloads=[b'\xff',b'{"requestId":"a","requestId":"b"}',self.payload.replace(b'"balanced"',b'NaN'),self.payload.replace(b'"system": "openplan"',b'"system": "openplan", "system": "openplan"')]
        with self.runtime.owner():
            self.start()
            for payload in payloads:
                with self.assertRaisesRegex(ValueError,'^Original dispatch JSON differs$'):self.custody.save(self.request['requestId'],payload,self.row)

    def test_contract_invalid_even_when_admission_matches_refuses(self):
        invalid={**self.request,'schemaVersion':'unsupported'}
        entry=replace(self.start(),request=invalid)
        with self.runtime.owner(),patch.object(self.custody.validation,'_entry',return_value=entry):
            with self.assertRaisesRegex(ValueError,'^Original dispatch contract differs$'):self.custody.save(self.request['requestId'],json_bytes(invalid),self.row)

    def test_changed_title_callback_notes_and_imagery_cannot_rebind_admission(self):
        variants=[{**self.request,'missionTitle':'Changed title'}, {**self.request,'callbackUrl':'https://changed.invalid/callback'}, {**self.request,'notes':'Changed'}, copy.deepcopy(self.request)]
        variants[-1]['imagery']['photos'][0]['url']='https://changed.invalid/a.jpg'
        with self.runtime.owner():
            self.start()
            for request in variants:
                with self.assertRaisesRegex(ValueError,'^Original dispatch differs from admitted request$'):self.custody.save(self.request['requestId'],json_bytes(request),self.row)

    def test_project_projection_required_and_matches_full_original_request(self):
        with self.runtime.owner():
            self.start()
            for row in ({key:value for key,value in self.row.items() if key!='project_id'},{**self.row,'project_id':True},{**self.row,'project_id':''},{**self.row,'extra':True}):
                with self.assertRaisesRegex(ValueError,'^Original dispatch project projection is required$'):self.custody.save(self.request['requestId'],self.payload,row)
            with self.assertRaisesRegex(ValueError,'^Original dispatch project scope differs$'):self.custody.save(self.request['requestId'],self.payload,{**self.row,'project_id':'another-project'})

    def test_non_openplan_system_refuses_even_with_matching_admission(self):
        changed=copy.deepcopy(self.request);changed['externalRef']['system']='other'
        entry=replace(self.start(),request=changed)
        with self.runtime.owner(),patch.object(self.custody.validation,'_entry',return_value=entry):
            with self.assertRaisesRegex(ValueError,'^Original dispatch project scope differs$'):self.custody.save(self.request['requestId'],json_bytes(changed),self.row)

    def test_original_actor_and_workspace_must_match_supplied_scope(self):
        with self.runtime.owner():
            self.start()
            for row in ({**self.row,'created_by':None},{**self.row,'workspace_id':'another-workspace'}):
                with self.assertRaisesRegex(ValueError,'^Original application job'):self.custody.save(self.request['requestId'],self.payload,row)

    def test_existing_receipt_cannot_change_actor_or_exact_encoding(self):
        with self.runtime.owner():
            receipt=self.save()
            for payload,row in [(json_bytes(self.request),self.row),(self.payload,{**self.row,'created_by':'another-actor'})]:
                with self.assertRaises(ValueError):self.custody.save(self.request['requestId'],payload,row)
            self.assertEqual(self.custody.load(self.request['requestId']),receipt)

    def test_missing_receipt_after_intake_refuses_before_recapture(self):
        self.advance();(self.folder/'receipt.json').unlink()
        self.pipeline.capture=lambda entry:(_ for _ in ()).throw(AssertionError('Lost dispatch was recaptured'))
        with self.runtime.owner():
            with self.assertRaisesRegex(ValueError,'^Started input work requires its original dispatch receipt$'):self.pipeline.advance(self.request['requestId'])
            with self.assertRaisesRegex(ValueError,'^Started input work requires its original dispatch receipt$'):self.custody.save(self.request['requestId'],self.payload,self.row)

    def test_corrupt_receipt_hash_scope_binding_and_flags_refuse(self):
        with self.runtime.owner():
            receipt=self.save()
            variants=[{**receipt,'payloadSha256':'a'*64},{**receipt,'applicationRecordSha256':'a'*64},{**receipt,'requestSha256':'a'*64},{**receipt,'payloadBytes':1},{**receipt,'authorityVerification':'verified'},{**receipt,'engineTransportPermission':True},{**receipt,'extra':True},{**receipt,'binding':{**receipt['binding'],'targetId':'different'}}]
            try:
                for value in variants:
                    self.write(value)
                    with self.assertRaisesRegex(ValueError,'^Original dispatch receipt differs$'):self.custody.load(self.request['requestId'])
            finally:self.write(receipt)

    def test_receipt_bound_checked_before_open_descriptor_read(self):
        with self.runtime.owner():
            self.save()
            class Stream:
                def read(self,*args):raise AssertionError('Oversized receipt must refuse before allocating its bytes')
            @contextmanager
            def oversized(*args):yield Stream(),SimpleNamespace(st_size=6*module.MAX_BYTES+1024*1024+1)
            with patch.object(module,'reader',oversized):
                with self.assertRaisesRegex(ValueError,'^Original dispatch receipt exceeds its bound$'):self.custody.load(self.request['requestId'])

    def test_receipt_length_change_refuses_after_same_descriptor_read(self):
        with self.runtime.owner():
            self.save();original=module.reader
            @contextmanager
            def changed(*args):
                with original(*args) as (stream,info):yield stream,SimpleNamespace(st_size=info.st_size+1)
            with patch.object(module,'reader',changed):
                with self.assertRaisesRegex(ValueError,'^Original dispatch receipt changed during read$'):self.custody.load(self.request['requestId'])

    def test_invalid_saved_json_refuses_with_static_diagnostic(self):
        with self.runtime.owner():
            self.save();path=self.folder/'receipt.json';path.write_bytes(b'{')
            with self.assertRaisesRegex(ValueError,'^Original dispatch receipt JSON differs$'):self.custody.load(self.request['requestId'])

    def test_late_return_cannot_report_success_after_dispatch_check(self):
        self.advance();original=module.UrlDraft._advance
        def expire(owner,*args,**kwargs):
            result=original(owner,*args,**kwargs);self.custody.load=lambda *a,**kw:(_ for _ in ()).throw(TimeoutError('Original dispatch deadline exceeded'));return result
        with self.runtime.owner(),patch.object(module.UrlDraft,'_advance',expire):
            with self.assertRaisesRegex(TimeoutError,'^Original dispatch deadline exceeded$'):self.pipeline.advance(self.request['requestId'])

    def test_zip_dispatch_preserves_v1_exact_original_archive_request(self):
        request=copy.deepcopy(self.request);request['requestId']='synthetic-original-zip-request';request['schemaVersion']='natford-aerial-processing.v1'
        request['imagery']={'type':'zip_url','url':'http://127.0.0.1:1/original.zip','sizeBytes':100}
        row={**self.row,'request_id':request['requestId'],'imagery_type':'zip_url'};entry,_=self.runtime.submit(request)
        with self.runtime.owner():
            self.runtime.journal.start(request['requestId'],entry.job_reference,self.runtime.context)
            receipt=self.custody.save(request['requestId'],json_bytes(request),row)
        self.assertEqual(json.loads(receipt['payloadText'])['imagery'],request['imagery'],'ZIP dispatch must retain its original archive metadata')

    def test_nonobject_or_missing_text_receipts_refuse(self):
        with self.runtime.owner():
            receipt=self.save()
            for value in ([],{}, {**receipt,'payloadText':None}):
                self.write(value)
                with self.assertRaisesRegex(ValueError,'^Original dispatch receipt differs$'):self.custody.load(self.request['requestId'])

    def test_aliased_receipt_refuses_without_recapture(self):
        self.advance();path=self.folder/'receipt.json';other=self.folder/'alias.json';os.link(path,other)
        with self.runtime.owner():
            with self.assertRaisesRegex(ValueError,'private and owned without aliases'):self.pipeline.advance(self.request['requestId'])

    def test_changed_fresh_or_saved_input_actor_refuses_before_fetch_or_command(self):
        fetch=self.intake.fetch
        self.intake.supply=lambda entry:{**self.fixture.f.spec,'applicationJob':{**self.fixture.f.spec['applicationJob'],'created_by':'changed'}}
        self.intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Changed settings reached source'))
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(ValueError,'^Original dispatch and input settings differ$'):self.pipeline.advance(self.request['requestId'])
        self.assertEqual(self.fixture.calls,[],'Mismatched settings must precede every source request')
        self.intake.supply=self.fixture.f.supply;self.intake.fetch=fetch;self.advance()
        path=self.fixture.f.root/'plan.json';value=json.loads(path.read_bytes());value['settings']['applicationJob']['created_by']='changed';path.write_bytes(json_bytes(value))
        with self.runtime.owner(),patch.object(self.intake,'fetch',side_effect=AssertionError('Changed settings reached source')):
            with self.assertRaisesRegex(ValueError,'^Original dispatch and input settings differ$'):self.pipeline.advance(self.request['requestId'])

    def test_capture_shape_and_late_deadline_refuse_before_input_work(self):
        for capture in (lambda entry:[self.payload,self.row], lambda entry:(self.payload,)):
            self.pipeline.capture=capture
            with self.runtime.owner():
                self.start()
                with self.assertRaisesRegex(ValueError,'^Exact original dispatch capture is required$'):self.pipeline.advance(self.request['requestId'])
        def late(entry):time.sleep(.02);return self.payload,self.row
        self.pipeline.capture=late;self.custody.timeout=.01
        with self.runtime.owner():
            with self.assertRaisesRegex(TimeoutError,'^Original dispatch deadline exceeded$'):self.pipeline.advance(self.request['requestId'])
        self.assertEqual(self.fixture.calls,[])

    def test_engine_plan_binding_checked_before_permission(self):
        self.advance()
        self.original.authorize=lambda *args:(_ for _ in ()).throw(AssertionError('Changed engine context reached permission'))
        def inspect(owner,request_id,job=None):
            plan={'binding':{'originalRequest':self.request,'originalContext':{}}}
            return owner.authorize(plan,'upload:0',{})
        with self.runtime.owner(),patch.object(module.UrlDraft,'_advance',inspect):
            with self.assertRaisesRegex(ValueError,'^Original dispatch engine binding differs$'):self.pipeline.advance(self.request['requestId'])

    def test_pre_cancelled_pipeline_refuses_before_capture(self):
        self.intake.cancelled=lambda:True
        self.pipeline.capture=lambda entry:(_ for _ in ()).throw(AssertionError('Cancelled pipeline reached dispatch capture'))
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):self.pipeline.advance(self.request['requestId'])

    def test_dispatch_clone_observes_replaced_cancellation_callback(self):
        def cancel(url,output,remaining,deadline):
            self.intake.cancelled=lambda:True
            raw=self.fixture.f.raw[0] if url.endswith('a.jpg') else self.fixture.f.raw[1]
            output.write(raw);return len(raw)
        self.intake.fetch=cancel
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(InterruptedError,'^Original runtime URL intake cancelled$'):self.pipeline.advance(self.request['requestId'])

    def test_linked_project_is_explicit_and_original(self):
        request=copy.deepcopy(self.request);request['requestId']='synthetic-project-request'
        request['externalRef']['projectId']='synthetic-project'
        row={**self.row,'request_id':request['requestId'],'project_id':'synthetic-project'}
        admitted,_=self.runtime.submit(request)
        with self.runtime.owner():
            self.runtime.journal.start(request['requestId'],admitted.job_reference,self.runtime.context)
            receipt=self.custody.save(request['requestId'],json_bytes(request),row)
        self.assertEqual(receipt['applicationJob']['project_id'],'synthetic-project','Linked project must remain explicit')
        self.assertEqual(json.loads(receipt['payloadText'])['externalRef']['projectId'],'synthetic-project')

    def test_copied_runtime_preserves_dispatch_without_capture_or_source_root(self):
        self.advance();copied=self.fixture.f.fixture.base/'copied-runtime';shutil.copytree(self.runtime.root,copied)
        runtime=Runtime(copied,self.runtime.installation['installationId'],max_queued=2,pipeline=lambda job:None)
        intake=Intake(runtime,self.intake.source_root.parent/'missing-root',self.intake.target,
            lambda entry:(_ for _ in ()).throw(AssertionError('Copied settings queried')),lambda *args:(_ for _ in ()).throw(AssertionError('Copied source fetched')),timeout=4)
        original=UrlDraft(intake,self.original.authorize,self.original.transport,timeout=4)
        pipeline=Pipeline(original,Custody(runtime,intake.target),lambda entry:(_ for _ in ()).throw(AssertionError('Copied dispatch queried')))
        with runtime.owner():result=pipeline.advance(self.request['requestId'])
        self.assertEqual(result['originalDispatchSha256'],hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(result['draft']['operation'],'upload:0')


if __name__ == '__main__': unittest.main()
