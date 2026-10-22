"""Original progress before real input journals, with supplied receiver facts."""
import copy
import json
import unittest
from unittest.mock import patch

import runtime_running_pipeline as module
from runtime_progress_delivery import Delivery
from retained_source import json_bytes
import test_runtime_original_pipeline as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.calls=[];self.replies=[(200,b'{"ok":true,"status":"running"}')]*8
        def send(url,reference,body,deadline,*,owned):
            self.assertTrue(owned(),'Initial running event remains owned');self.calls.append(body)
            reply=self.replies.pop(0)
            if isinstance(reply,BaseException):raise reply
            return reply
        self.progress=module.RunningDelivery(self.f.observer.reader,send,'original-progress-credential',timeout=4)
        self.pipeline=module.Pipeline(self.f.f.pipeline,self.f.commit,self.f.coordinator,self.progress)
        self.f.pipeline=self.pipeline
    def advance(self):return self.f.advance()
    def command(self):return self.progress.folder(self.f.request,module.EVENT)/'command.json'
    def test_initial_running_event_precedes_source_fetch_and_engine_commands(self):
        original=self.f.f.fetch
        def fetch(*args):
            self.assertTrue(self.command().exists(),'Exact initial event must precede input fetch')
            self.assertEqual(len(self.calls),1,'Initial event reaches receiver before input fetch')
            return original(*args)
        self.f.f.intake.fetch=fetch
        result=self.advance()
        self.assertEqual(result['state'],'draft_pending','Acknowledged running event allows original draft step')
        self.assertEqual(len(self.f.f.sends),1,'One original engine command follows initial acknowledgement')
        body=json.loads(self.calls[0]);self.assertEqual(body['status'],'running','Initial callback is running')
        self.assertNotIn('progress',body,'Initial event cannot invent an engine percentage')
        self.assertNotIn('artifacts',body,'Initial event cannot invent products')
    def test_initial_publisher_temporary_recovers_before_progress(self):
        root=self.progress.folder(self.f.request,module.EVENT);root.mkdir(mode=0o700)
        pending=root/('.partial-'+'a'*32);pending.write_bytes(b'Interrupted command bytes');pending.chmod(0o600)
        result=self.advance()
        self.assertEqual(result['state'],'draft_pending','Owned publisher temporary must recover initial progress')
        self.assertFalse(pending.exists(),'Recovered publisher temporary is removed')
        self.assertEqual(len(self.calls),1,'Recovered initial command posts once')
    def test_unsafe_publisher_temporaries_hold_before_progress(self):
        root=self.progress.folder(self.f.request,module.EVENT);root.mkdir(mode=0o700)
        import os
        target=root.parent/'private-temporary-target';target.write_bytes(b'Private target');target.chmod(0o600)
        for kind in ('unknown','symlink','hardlink'):
            with self.subTest(kind=kind):
                pending=root/('.partial-other' if kind=='unknown' else '.partial-'+'b'*32)
                if kind=='symlink':pending.symlink_to(target)
                elif kind=='hardlink':os.link(target,pending)
                else:pending.write_bytes(b'Unknown');pending.chmod(0o600)
                try:
                    self.assertEqual(self.advance()['state'],'local_stage_failed','Unsafe progress temporaries cannot begin work')
                    self.assertEqual(self.calls,[],'Unsafe temporary cannot POST initial progress')
                    self.assertEqual(self.f.f.fetches,[],'Unsafe temporary cannot fetch input')
                finally:
                    if pending.exists() or pending.is_symlink():pending.unlink()
        self.assertEqual(target.read_bytes(),b'Private target','Temporary cleanup preserves external target')

    def test_pending_progress_holds_before_any_source_or_engine_work(self):
        self.replies=[(503,b'Unavailable')]
        result=self.advance()
        self.assertEqual(result['state'],'progress_pending','Unconfirmed running event remains pending')
        self.assertEqual(self.f.f.fetches,[],'Unconfirmed running event cannot fetch inputs')
        self.assertEqual(self.f.f.sends,[],'Unconfirmed running event cannot send engine commands')
    def test_refused_progress_stops_retries_and_computation(self):
        self.replies=[(403,b'Denied')]
        first=self.advance()
        with patch.object(self.progress,'advance',side_effect=AssertionError('Historical refusal cannot reenter progress delivery')):
            second=self.advance()
        self.assertEqual(first['state'],'progress_refused','Explicit running refusal is retained')
        self.assertEqual(second['state'],'progress_refused','Historical refusal remains held')
        self.assertEqual(len(self.calls),1,'Explicit running refusal cannot POST again')
        self.assertEqual(self.f.f.fetches,[],'Running refusal cannot fetch inputs')
    def test_lost_reply_replays_exact_body_before_input(self):
        self.replies=[OSError('private acknowledgement loss'),(200,b'{"ok":true,"status":"running"}')]
        self.assertEqual(self.advance()['state'],'local_stage_failed','Lost running reply remains local')
        saved=self.command().read_bytes()
        with patch.object(module.contract,'build_callback',side_effect=AssertionError('Running retry cannot rebuild event')):
            result=self.advance()
        self.assertEqual(result['state'],'draft_pending','Exact acknowledged retry allows original input')
        self.assertEqual(self.command().read_bytes(),saved,'Running retry keeps original command bytes')
        self.assertEqual(self.calls,[self.calls[0]]*2,'Running retry keeps exact POST body')
    def test_saved_acknowledgement_suppresses_second_progress_post(self):
        self.advance()
        with patch.object(module.contract,'build_callback',side_effect=AssertionError('Acknowledged event cannot rebuild')),patch.object(self.progress,'advance',side_effect=AssertionError('Historical acknowledgement cannot reenter progress delivery')):
            self.advance()
        self.assertEqual(len(self.calls),1,'Saved running acknowledgement sends no second POST')
        self.assertEqual(len(self.f.f.sends),2,'Next original upload may proceed')
    def test_revoked_actor_after_cached_ack_cannot_start_next_input_step(self):
        self.advance();self.f.f.f.receipt['authorizedNow']=False
        before=len(self.f.f.sends)
        with patch.object(self.pipeline.inputs,'advance',side_effect=AssertionError('Cached progress cannot advance without current access')):
            result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Cached running reply grants no current permission')
        self.assertEqual(len(self.f.f.sends),before,'Revoked cached progress cannot send next command')
        self.assertEqual(len(self.calls),1,'Revocation cannot renew the initial event')
    def test_completed_terminal_replay_skips_active_progress_authority(self):
        self.f.through_drafts();self.advance()
        with patch.object(self.progress,'_access',side_effect=AssertionError('Terminal replay cannot reenter active progress')):
            result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Terminal replay retains original completed acknowledgement')
        self.assertEqual(len(self.calls),1,'Terminal replay creates no progress event')
    def test_foreign_progress_reader_refuses_at_constructor(self):
        with patch.object(self.progress,'reader',object()),self.assertRaisesRegex(ValueError,'original progress reader'):
            module.Pipeline(self.f.f.pipeline,self.f.commit,self.f.coordinator,self.progress)
        with self.assertRaisesRegex(ValueError,'original progress reader'):
            module.Pipeline(self.f.f.pipeline,self.f.commit,self.f.coordinator,self.f.delivery)
    def test_progress_record_tampering_refuses_before_next_effect(self):
        self.advance();value=json.loads(self.command().read_bytes());value['bodyText']=value['bodyText'].replace('running','accepted')
        self.command().write_bytes(json_bytes(value));before=len(self.f.f.sends)
        result=self.advance()
        self.assertEqual(result['state'],'local_stage_failed','Changed original progress command remains held')
        self.assertEqual(len(self.f.f.sends),before,'Changed progress cannot obtain next effect')
    def test_original_dispatch_capture_precedes_running_record(self):
        self.advance()
        command=json.loads(self.command().read_bytes())
        receipt=json.loads((self.f.f.f.custody.folder(self.f.request)/'receipt.json').read_bytes())
        self.assertEqual(command['binding']['originalDispatchSha256'],receipt['payloadSha256'],'Running record binds exact dispatch before any source')
        self.assertEqual(command['binding']['originalApplicationJob'],receipt['applicationJob'],'Running record keeps original actor and workspace')
    def test_unowned_bridge_refuses_before_dispatch_or_progress(self):
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.pipeline.advance(self.f.request)
        self.assertEqual(self.calls,[],'Unowned bridge cannot deliver progress')
        self.assertEqual(self.f.f.f.calls,[],'Unowned bridge cannot capture dispatch')

    def reserved(self,changes):
        import contract
        with self.f.runtime.owner():
            entry=self.f.f.f.started();self.pipeline.inputs.capture_original(self.f.request)
            body=contract.build_callback(entry.request['schemaVersion'],self.f.request,entry.job_reference,'running',message=module.MESSAGE)
            body.update(changes);self.progress.prepare(self.f.request,module.EVENT,json_bytes(body))
            result=self.pipeline.advance(self.f.request)
        self.assertEqual(result['state'],'local_stage_failed','Reserved event cannot accept another progress projection')
        self.assertEqual(self.f.f.fetches,[],'Foreign progress projection cannot fetch inputs')
        self.assertEqual(self.calls,[],'Foreign projection cannot send initial running event')
    def test_reserved_event_refuses_accepted_projection(self):self.reserved({'status':'accepted'})
    def test_reserved_event_refuses_invented_percentage(self):self.reserved({'progress':37})
    def test_reserved_event_refuses_another_message(self):self.reserved({'message':'another message'})

    def test_ignored_running_reply_holds_and_never_retries(self):
        self.replies=[(200,b'{"ok":true,"ignored":"superseded"}')]
        first=self.advance();second=self.advance()
        self.assertEqual(first['state'],'progress_ignored','Ignored running event cannot authorize work')
        self.assertEqual(second['state'],'progress_ignored','Historical ignored event remains held')
        self.assertEqual(self.f.f.fetches,[],'Ignored running event cannot fetch inputs')
        self.assertEqual(len(self.calls),1,'Ignored running event cannot POST again')
    def test_wrong_status_reply_stays_pending_before_input(self):
        self.replies=[(200,b'{"ok":true,"status":"accepted"}')]
        result=self.advance()
        self.assertEqual(result['state'],'progress_pending','Wrong running acknowledgement stays pending')
        self.assertEqual(self.f.f.fetches,[],'Wrong status cannot fetch inputs')
    def test_missing_status_reply_stays_pending(self):
        self.replies=[(200,b'{"ok":true}')]
        self.assertEqual(self.advance()['state'],'progress_pending','Missing running acknowledgement stays pending')
        self.assertEqual(self.f.f.sends,[],'Missing status cannot send engine command')
    def test_known_completed_fact_survives_later_progress_refusal(self):
        self.f.through_drafts()
        with patch.object(self.f.access,'prepare',side_effect=OSError('local lease interruption')):self.advance()
        self.f.f.f.receipt['authorizedNow']=False
        with patch.object(self.f.observer,'observe',side_effect=AssertionError('Local progress refusal cannot query engine')):
            result=self.advance()
        self.assertEqual((result['localFailure'].get('reportedEngine') or {}).get('reportedStatusCode'),40,
            'Progress refusal preserves known original completion')
        self.assertEqual(self.f.callbacks,[],'Progress refusal cannot fabricate terminal delivery')


if __name__=='__main__':unittest.main()
