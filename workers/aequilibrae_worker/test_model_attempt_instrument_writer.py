"""Attempt-bound instrument delivery; real journals, synthetic HTTP receipts."""
import copy
import unittest
from unittest.mock import Mock

import model_attempt_invocation as invocation
import model_command_client as client
import model_command_journal as journal
import test_model_attempt_writer as writers
from test_model_command_client import IDS
from test_model_command_instrument import instrument


class InstrumentWriterTests(unittest.TestCase):
    setUp=writers.WriterTests.setUp

    def response(self,url,**kwargs):
        if not url.endswith('/record_model_attempt_instrument'):
            return writers.WriterTests.response(self,url,**kwargs)
        args=kwargs['json']
        saved=journal.pending(self.directory,self.cmd['destination'])
        self.assertEqual(len(saved),1)
        command=saved[0]['command']
        self.assertEqual(command['request_id'],args['p_request_id'])
        self.assertEqual(command['arguments'],{'workspace_id':IDS[4],'run_id':IDS[1],
            'stage_id':IDS[2],'attempt_id':IDS[3],'payload':args['p_payload']})
        self.assertEqual(args,{'p_request_id':command['request_id'],'p_attempt_id':IDS[3],'p_payload':command['arguments']['payload']})
        return Mock(status_code=200,json=Mock(return_value={'id':IDS[0],'workspace_id':IDS[4],
            'model_run_id':IDS[1],'stage_id':IDS[2],'attempt_id':IDS[3],**args['p_payload']}))

    def test_methods_and_exact_receipts_remain_separate(self):
        for method in ('aequilibrae','activitysim'):
            payload=instrument(method)['arguments']['payload']
            before=copy.deepcopy(payload)
            first=self.writer.record_instrument(payload,logical_name=method,workspace_id=IDS[4])
            self.assertEqual(self.writer.record_instrument(payload,logical_name=method),first)
            self.assertEqual(first['demand_method'],method)
            self.assertEqual(first['scientific_outcome'],'inconclusive')
            self.assertEqual(payload,before)
        self.assertEqual(self.post.call_count,2)
        requests=[call.kwargs['json']['p_request_id'] for call in self.post.call_args_list]
        self.assertEqual(len(set(requests)),2)

    def test_changed_payload_cannot_change_request_identity(self):
        payload=instrument()['arguments']['payload']
        self.writer.record_instrument(payload,logical_name='prepared-slot')
        with self.assertRaisesRegex(ValueError,'different contents'):
            self.writer.record_instrument({**payload,'assessment_sha256':'e'*64},logical_name='prepared-slot')
        self.post.assert_called_once()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_stops_later_writes_and_retains_exact_request(self):
        self.post.side_effect=TimeoutError('Synthetic loss')
        payload=instrument()['arguments']['payload']
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.record_instrument(payload,logical_name='prepared-slot')
        self.assertTrue(self.writer.stopped)
        pending=journal.pending(self.directory,self.cmd['destination'])
        self.assertEqual(pending[0]['command']['arguments']['payload'],payload)
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.patch_stage(IDS[2],{'status':'succeeded'})
        self.post.assert_called_once()

    def test_foreign_workspace_refuses_before_transport(self):
        with self.assertRaisesRegex(ValueError,'workspace scope'):
            self.writer.record_instrument(instrument()['arguments']['payload'],logical_name='prepared-slot',workspace_id=IDS[0])
        self.post.assert_not_called()

    def test_stopped_writer_cannot_reuse_a_resolved_receipt(self):
        payload=instrument()['arguments']['payload']
        self.writer.record_instrument(payload,logical_name='prepared-slot')
        self.writer.stopped=True
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.record_instrument(payload,logical_name='prepared-slot')
        self.post.assert_called_once()

    def test_unnamed_instrument_refuses(self):
        payload=instrument()['arguments']['payload']
        with self.assertRaisesRegex(ValueError,'retained logical name'):
            self.writer.record_instrument(payload,logical_name='')
        self.post.assert_not_called()

    def test_claim_promotion_refuses_before_transport(self):
        payload={**instrument()['arguments']['payload'],'scientific_outcome':'pass'}
        with self.assertRaisesRegex(ValueError,'Unsupported instrument method or outcome'):
            self.writer.record_instrument(payload,logical_name='prepared-slot')
        self.post.assert_not_called()


if __name__=='__main__':unittest.main()
