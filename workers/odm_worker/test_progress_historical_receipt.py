"""Read private original receiver facts without rechecking or granting access."""
import copy
import json
import unittest
from unittest.mock import patch

from retained_source import json_bytes
from runtime_progress_delivery import FORMAT
import test_runtime_progress_delivery as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
    def prepare(self):self.f.prepare()
    def read(self):
        with self.f.f.runtime.owner():return self.f.delivery.historical_receiver_receipt(self.f.request_id,self.f.event)
    def mutate(self,name,change):
        path=self.f.root/name;value=json.loads(path.read_bytes());change(value);path.write_bytes(json_bytes(value))
    def test_saved_acknowledgement_is_historical_without_access_or_transport(self):
        self.prepare();self.f.advance();self.f.f.receipt['authorizedNow']=False
        with patch.object(self.f.delivery,'_access',side_effect=AssertionError('Historical receipt cannot request current permission')):
            result=self.read()
        self.assertEqual(result['historicalReceiverOutcome'],'acknowledged','Historical original acknowledgement remains readable')
        self.assertEqual(len(self.f.calls),1,'Reading history cannot send another callback')
        self.assertIs(result['transportPermission'],False,'Historical receipt grants no transport permission')
        self.assertEqual(result['currentAccess'],'unassessed','History does not claim current actor access')
        self.assertEqual(result['applicationAcceptanceVerification'],'unassessed','History does not promote application acceptance')
    def test_no_saved_reply_is_explicit(self):
        self.prepare();result=self.read()
        self.assertEqual(result['historicalReceiverOutcome'],'no_retained_reply','Missing reply remains distinct from acknowledgement')
    def test_refused_reply_remains_historical_refusal(self):
        self.f.replies=[(403,b'Denied')];self.prepare();self.f.advance()
        self.assertEqual(self.read()['historicalReceiverOutcome'],'refused','Historical explicit refusal stays refused')
    def test_uncertain_reply_then_ack_keeps_original_sequence(self):
        self.f.replies=[OSError('Synthetic lost acknowledgement'),(200,b'{"ok":true}')];self.prepare()
        with self.assertRaises(OSError):self.f.advance()
        self.assertEqual(self.read()['historicalReceiverOutcome'],'no_retained_reply','Unanswered intent remains uncertain')
        self.f.advance();result=self.read()
        self.assertEqual(result['historicalReceiverOutcome'],'acknowledged','Later exact acknowledgement is selected')
        self.assertEqual(result['attempt'],1,'Historical receipt keeps original acknowledged attempt')
    def test_orphan_reply_without_attempt_refuses(self):
        self.prepare();self.f.advance();(self.f.root/'attempt-000000.json').unlink()
        with self.assertRaisesRegex(ValueError,'reply requires its original attempt'):self.read()
    def test_attempt_sequence_gap_refuses(self):
        self.prepare();self.f.advance();(self.f.root/'attempt-000000.json').rename(self.f.root/'attempt-000002.json')
        with self.assertRaisesRegex(ValueError,'attempt sequence differs'):self.read()
    def test_changed_attempt_binding_refuses(self):
        self.prepare();self.f.advance();self.mutate('attempt-000000.json',lambda x:x.update(commandSha256='a'*64))
        with self.assertRaisesRegex(ValueError,'attempt binding differs'):self.read()
    def test_changed_reply_binding_refuses(self):
        self.prepare();self.f.advance();self.mutate('reply-000000.json',lambda x:x.update(commandSha256='a'*64))
        with self.assertRaisesRegex(ValueError,'reply binding differs'):self.read()
    def test_invalid_reply_bytes_refuse(self):
        self.prepare();self.f.advance();self.mutate('reply-000000.json',lambda x:x.update(bodyBase64='!'))
        with self.assertRaisesRegex(ValueError,'reply bytes differ'):self.read()
    def test_foreign_command_cannot_reuse_receipts(self):
        self.prepare();self.f.advance();self.mutate('command.json',lambda x:x['binding'].update(eventKey='another-event'))
        with self.assertRaisesRegex(ValueError,'original command differs'):self.read()
    def test_unowned_history_refuses(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.f.delivery.historical_receiver_receipt(self.f.request_id,self.f.event)

    def test_foreign_command_without_attempts_refuses(self):
        self.prepare();self.mutate('command.json',lambda x:x['binding'].update(eventKey='another-event'))
        with self.assertRaisesRegex(ValueError,'original command differs'):self.read()


if __name__=='__main__':unittest.main()
