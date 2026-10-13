"""Actual original runtime/source/journal sequencing with controlled adapters."""
import copy
from contextlib import contextmanager
import json
from types import SimpleNamespace
import time
import unittest
from unittest.mock import patch

from engine_effects import Effects
import runtime_draft as module
import test_runtime_preparation as fixture


class Checks(unittest.TestCase):
    setUp=fixture.Checks.setUp
    tearDown=fixture.Checks.tearDown
    start=fixture.Checks.start
    read=fixture.Checks.read

    def draft(self, authorize=None, transport=None, timeout=4):
        if not hasattr(self,'calls'):self.calls=[]
        def permitted(plan,operation,command):return True
        def send(engine,command,stream,deadline):
            if command['path'].startswith('/task/new/commit/'):
                raise AssertionError('Unexpected commit reached transport')
            raw=stream.read() if stream is not None else None
            self.calls.append({'engine':engine,'command':command,'bytes':raw,'deadline':deadline})
            body=json.dumps({'uuid':command['headers']['set-uuid']}).encode() if stream is None else b'{ "success": true }\n'
            return 200,body
        return module.Draft(self.preparation,authorize or permitted,transport or send,timeout=timeout)

    def test_authorization_receives_actual_shared_deadline_when_selected(self):
        observed=[]
        def authorize(plan,operation,command,*,deadline=None):observed.append(deadline);return True
        draft=self.draft(authorize=authorize)
        draft.authorize_with_deadline=True
        with self.runtime.owner():self.start();draft.advance(self.request['requestId'])
        self.assertEqual(observed,[self.calls[0]['deadline']], 'Authorization must receive the exact draft deadline')

    def test_authorization_deadline_selection_requires_boolean(self):
        for value in (1,None,'yes'):
            with self.assertRaisesRegex(ValueError,'Draft authorization deadline selection must be boolean'):
                module.Draft(self.preparation,lambda *args:True,lambda *args:None,authorize_with_deadline=value)

    def test_actual_runtime_initializes_one_original_task_and_holds_next_job(self):
        draft=self.draft();self.runtime.pipeline=draft
        second=copy.deepcopy(self.request);second['requestId']='synthetic-pending-request';self.runtime.submit(second)
        with self.runtime.owner():
            self.assertIs(self.runtime.run_one(),True)
            self.assertEqual(len(self.calls),1,'owned pipeline must send exactly one initial command')
            original=self.read('engine/plan.json')
            self.assertEqual(self.calls[0]['command']['headers'],{'set-uuid':original['taskUuid']},'transport must initialize original planned UUID')
            self.assertIs(self.runtime.run_one(),False,'draft-pending original start must hold later admission')
            self.assertEqual(self.runtime.status()['accepted'],1)
        self.assertEqual(self.read('engine/command-00000.reply.json')['bodyBytes'],len(json.dumps({'uuid':original['taskUuid']}).encode()))

    def test_original_order_upload_bytes_and_exact_replies_before_commit_hold(self):
        draft=self.draft()
        with self.runtime.owner():
            self.start();results=[draft.advance(self.request['requestId']) for _ in range(4)]
            self.assertEqual([r['operation'] for r in results],['init','upload:0','upload:1',None],'draft commands must follow original journal order')
            self.assertEqual(results[-1]['state'],'draft_complete_commit_held')
            self.assertEqual([r['bytes'] for r in self.calls],[None,*self.raw],'transport must read exact original image slots')
            self.assertEqual([r['command'].get('multipart',{}).get('filename') for r in self.calls[1:]],self.spec['filenames'])
            self.assertEqual(len(self.calls),3,'completed draft cannot transport commit')
            self.assertFalse((self.folder/'engine/command-00003.intent.json').exists(),'processing commit must stay unissued')
            self.assertEqual(self.read('engine/command-00001.reply.json')['bodyBase64'],'eyAic3VjY2VzcyI6IHRydWUgfQo=','exact upload reply bytes must remain')
            for result in results:
                self.assertFalse(result['commitPermission'],'draft does not permit commit')
                for name in ('engineCustodyVerification','callbackDeliveryVerification'):
                    self.assertEqual(result[name],'unassessed','draft cannot promote '+name)

    def test_permission_requires_exact_true_before_intent_or_transport(self):
        with self.runtime.owner():
            self.start()
            for decision in (False,None,1,{'allowed':True}):
                draft=self.draft(authorize=lambda *args:decision,transport=lambda *args:(_ for _ in ()).throw(AssertionError('Denied permission reached transport')))
                with self.subTest(decision=decision),self.assertRaisesRegex(PermissionError,'^Explicit draft permission was not confirmed$'):draft.advance(self.request['requestId'])
                self.assertFalse((self.folder/'engine/command-00000.intent.json').exists(),'denied permission cannot issue original intent')

    def test_adapters_receive_detached_original_plan_and_command(self):
        observed=[]
        def authorize(plan,operation,command):
            observed.append(copy.deepcopy(plan));plan['taskUuid']='changed';command['path']='/changed';return True
        def transport(engine,command,stream,deadline):
            task=command['headers']['set-uuid'];engine['instanceId']='changed';command['path']='/changed';return 200,json.dumps({'uuid':task}).encode()
        draft=self.draft(authorize=authorize,transport=transport)
        with self.runtime.owner():self.start();draft.advance(self.request['requestId'])
        original=self.read('engine/plan.json')
        self.assertEqual(original,observed[0],'adapters cannot replace original engine plan through aliases')
        self.assertEqual(self.read('engine/command-00000.intent.json')['command']['path'],'/task/new/init','adapter cannot replace original durable command')

    def test_lost_acknowledgment_holds_without_second_transport_or_later_issue(self):
        calls=[]
        def interrupted(*args):calls.append(args[1]);raise RuntimeError('Synthetic lost acknowledgment')
        draft=self.draft(transport=interrupted)
        with self.runtime.owner():
            self.start()
            with self.assertRaisesRegex(RuntimeError,'Synthetic lost acknowledgment'):draft.advance(self.request['requestId'])
            draft.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Uncertain effect attempted another transport'))
            result=draft.advance(self.request['requestId'])
            self.assertEqual(result['state'],'held_uncertain','unresolved effect must hold the draft')
            self.assertEqual(len(calls),1,'uncertain init cannot send again')
            self.assertFalse((self.folder/'engine/command-00001.intent.json').exists(),'unresolved prefix cannot issue later upload')

    def test_invalid_response_preserves_unresolved_intent(self):
        for response in ([200,b'{}'],(200,b'{}',None)):
            # Use separate request directories so failed response fixtures cannot
            # hide a later invalid-shape probe behind the original unresolved hold.
            request=copy.deepcopy(self.request);request['requestId']='synthetic-shape-'+str(len(response))
            self.spec['applicationJob']['request_id']=request['requestId'];self.runtime.submit(request)
            draft=self.draft(transport=lambda *args:response)
            with self.runtime.owner():
                entry=self.runtime.journal.get(request['requestId']);self.runtime.journal.start(request['requestId'],entry.job_reference,self.runtime.context)
                with patch.object(module.Effects,'save_reply',side_effect=AssertionError('Invalid transport response reached reply journal')):
                    with self.subTest(response=response),self.assertRaisesRegex(ValueError,'^Exact draft transport status and body are required$'):draft.advance(request['requestId'])
                self.assertEqual(draft.advance(request['requestId'])['state'],'held_uncertain')

    def test_invalid_engine_reply_is_not_an_acknowledgment(self):
        draft=self.draft(transport=lambda *args:(200,b'{"uuid":"another"}'))
        with self.runtime.owner():
            self.start()
            with self.assertRaises(ValueError):draft.advance(self.request['requestId'])
            self.assertEqual(draft.advance(self.request['requestId'])['state'],'held_uncertain')
        self.assertFalse((self.folder/'engine/command-00000.reply.json').exists(),'invalid engine reply cannot be saved as acknowledgment')

    def test_out_of_order_acknowledged_upload_refuses_transport(self):
        draft=self.draft(transport=lambda *args:(_ for _ in ()).throw(AssertionError('Out-of-order journal reached transport')))
        with self.runtime.owner():
            self.start();effects,_=draft._effects(self.request['requestId'],time.monotonic()+4)
            effects.issue('upload:0');effects.save_reply('upload:0',200,b'{"success":true}')
            with self.assertRaisesRegex(ValueError,'^Original draft command order differs$'):draft.advance(self.request['requestId'])

    def test_existing_commit_intent_holds_without_draft_transport(self):
        draft=self.draft(transport=lambda *args:(_ for _ in ()).throw(AssertionError('Prior commit reached draft transport')))
        with self.runtime.owner():
            self.start();effects,_=draft._effects(self.request['requestId'],time.monotonic()+4);effects.issue('commit')
            self.assertEqual(draft.advance(self.request['requestId'])['state'],'held_prior_commit','prior commit requires separate processing reconciliation')

    def test_constructor_requires_explicit_adapters_and_finite_timeout(self):
        for preparation,authorize,transport,timeout in ((None,lambda *a:True,lambda *a:None,1),(self.preparation,None,lambda *a:None,1),(self.preparation,lambda *a:True,None,1),(self.preparation,lambda *a:True,lambda *a:None,True),(self.preparation,lambda *a:True,lambda *a:None,0)):
            with self.subTest(timeout=timeout),self.assertRaises(ValueError):module.Draft(preparation,authorize,transport,timeout=timeout)

    def test_changed_seal_refuses_before_permission_adapter(self):
        draft=self.draft(authorize=lambda *args:(_ for _ in ()).throw(AssertionError('Changed installation reached permission adapter')))
        with self.runtime.owner():
            self.start();path=self.root/'runtime-installation.json';original=path.read_bytes();value=json.loads(original);value['installationId']='another'
            try:
                path.write_bytes(fixture.json_bytes(value))
                with self.assertRaisesRegex(ValueError,'^Saved ODM installation identity differs$'):draft.advance(self.request['requestId'])
            finally:path.write_bytes(original)

    def test_existing_issue_flag_never_reaches_transport(self):
        draft=self.draft(transport=lambda *args:(_ for _ in ()).throw(AssertionError('Existing issue flag reached transport')))
        actual=Effects.issue
        def already_issued(effects,operation):
            intent,_=actual(effects,operation);return intent,False
        with self.runtime.owner():
            self.start()
            with patch.object(module.Effects,'issue',already_issued):
                self.assertEqual(draft.advance(self.request['requestId'])['state'],'held_uncertain')

    def test_durable_intent_precedes_transport_and_reply_precedes_next_command(self):
        draft=self.draft()
        def transport(engine,command,stream,deadline):
            self.assertTrue((self.folder/'engine/command-00000.intent.json').exists(),'original intent must precede transport')
            self.assertFalse((self.folder/'engine/command-00001.intent.json').exists(),'later command cannot precede original reply')
            return 200,json.dumps({'uuid':command['headers']['set-uuid']}).encode()
        draft.transport=transport
        with self.runtime.owner():self.start();draft.advance(self.request['requestId'])
        self.assertTrue((self.folder/'engine/command-00000.reply.json').exists(),'original checked reply must be saved before advancing')

    def test_partial_image_consumption_refuses_acknowledgment(self):
        draft=self.draft()
        with self.runtime.owner():
            self.start();draft.advance(self.request['requestId'])
            draft.transport=lambda engine,command,stream,deadline:(stream.read(1), (200,b'{"success":true}'))[1]
            with self.assertRaisesRegex(ValueError,'^Draft transport did not consume the original image$'):draft.advance(self.request['requestId'])
            self.assertFalse((self.folder/'engine/command-00001.reply.json').exists(),'partial image consumption cannot acknowledge upload')

    def test_changed_image_at_transport_boundary_refuses_before_send(self):
        draft=self.draft();actual=Effects.issue
        with self.runtime.owner():
            self.start();draft.advance(self.request['requestId'])
            path=self.folder/'retained/objects/source-00000.bin';raw=path.read_bytes()
            def change_after_intent(effects,operation):
                result=actual(effects,operation);path.write_bytes(b'X'*len(raw));return result
            try:
                draft.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Changed image reached transport'))
                with patch.object(module.Effects,'issue',change_after_intent):
                    with self.assertRaisesRegex(ValueError,'^Original draft upload hash differs$'):draft.advance(self.request['requestId'])
            finally:path.write_bytes(raw)

    def test_changed_image_size_at_transport_boundary_refuses_before_send(self):
        draft=self.draft();actual=Effects.issue;actual_reader=module.reader
        @contextmanager
        def guarded_reader(root,name):
            with actual_reader(root,name) as (stream,info):
                def read(_size):raise AssertionError('Changed image size reached source reading')
                yield SimpleNamespace(read=read,seek=stream.seek,tell=stream.tell),info
        with self.runtime.owner():
            self.start();draft.advance(self.request['requestId']);path=self.folder/'retained/objects/source-00000.bin';raw=path.read_bytes()
            def change_after_intent(effects,operation):
                result=actual(effects,operation);path.write_bytes(raw+b'X');return result
            try:
                draft.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Changed image size reached transport'))
                with patch.object(module.Effects,'issue',change_after_intent),patch.object(module,'reader',guarded_reader):
                    with self.assertRaisesRegex(ValueError,'^Original draft upload size differs$'):draft.advance(self.request['requestId'])
            finally:path.write_bytes(raw)

    def test_late_transport_reply_remains_unresolved(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);draft=self.draft()
        def late(engine,command,stream,deadline):
            offset[0]=10;return 200,json.dumps({'uuid':command['headers']['set-uuid']}).encode()
        draft.transport=late
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock):
                with self.assertRaisesRegex(TimeoutError,'^Runtime draft deadline exceeded$'):draft.advance(self.request['requestId'])
            self.assertFalse((self.folder/'engine/command-00000.reply.json').exists(),'late reply cannot acknowledge original effect')

    def test_expired_permission_does_not_issue_or_send(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);draft=self.draft()
        def late(*args):offset[0]=10;return True
        draft.authorize=late;draft.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Expired permission reached transport'))
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock):
                with self.assertRaisesRegex(TimeoutError,'^Runtime draft deadline exceeded$'):draft.advance(self.request['requestId'])
            self.assertFalse((self.folder/'engine/command-00000.intent.json').exists(),'expired permission cannot issue intent')

    def test_expired_preparation_does_not_reach_permission(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);draft=self.draft(authorize=lambda *args:(_ for _ in ()).throw(AssertionError('Expired preparation reached permission')))
        actual=self.preparation.resume
        def late(request_id, *, deadline=None):result=actual(request_id, deadline=deadline);offset[0]=10;return result
        with self.runtime.owner():
            self.start()
            with patch.object(module,'time',clock),patch.object(self.preparation,'resume',side_effect=late),patch.object(module,'Effects',side_effect=AssertionError('Expired preparation reached engine journal')):
                with self.assertRaisesRegex(TimeoutError,'^Runtime draft deadline exceeded$'):draft.advance(self.request['requestId'])

    def test_deadline_during_original_image_read_stops_before_transport(self):
        offset=[0];clock=SimpleNamespace(monotonic=lambda:time.monotonic()+offset[0]);draft=self.draft();actual=module.reader
        @contextmanager
        def delayed_reader(root,name):
            with actual(root,name) as (stream,info):
                def read(size):raw=stream.read(size);offset[0]=10;return raw
                yield SimpleNamespace(read=read,seek=stream.seek,tell=stream.tell),info
        with self.runtime.owner():
            self.start();draft.advance(self.request['requestId'])
            draft.transport=lambda *args:(_ for _ in ()).throw(AssertionError('Expired image read reached transport'))
            with patch.object(module,'time',clock),patch.object(module,'reader',delayed_reader):
                with self.assertRaisesRegex(TimeoutError,'^Runtime draft deadline exceeded$'):draft.advance(self.request['requestId'])



if __name__=='__main__':unittest.main()
