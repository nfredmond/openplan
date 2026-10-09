"""Exact decision/receipt tests. These do not establish API actor authorization."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal
import model_recovery_decision_command as decision

IDS=[f'{n:08d}-1111-4111-8111-111111111111' for n in range(1,7)]
STAMP='2026-10-08T19:00:00+00:00'
BASE='http://127.0.0.1:9'

def command():
    return {'request_id':IDS[0],'destination':client.destination(BASE,'synthetic-recovery'),'operation':'abandon_model_run_execution',
      'arguments':{'workspace_id':IDS[1],'run_id':IDS[2],'actor_id':IDS[3],'reason':'Explicit synthetic abandonment','evidence':{'scope':'unconfirmed'},
      'expected_state':{'model_id':IDS[0],'workspace_id':IDS[1],'run_id':IDS[2],'status':'running','updated_at':STAMP,'attempt_managed':True,
       'stages':[{'id':IDS[4],'status':'running','updated_at':STAMP,'active_attempt_id':IDS[5],'attempt_managed':True}]}}}

def receipt(c):
    return {'request_id':c['request_id'],**{k:c['arguments'][k] for k in ('workspace_id','run_id','actor_id')},
      'outcome':'execution_abandoned','run_status':'cancelled','process_termination_verified':False,'continuation_authorized':False,
      'model_resumed':False,'reported_evidence_verified':False,'request_payload':decision.request_payload(c)}

class RecoveryDecisionTests(unittest.TestCase):
    def test_exact_transport_and_retained_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            c=command();answer=receipt(c);calls=[]
            def post(url,**kwargs):
                self.assertEqual(len(journal.pending(Path(temp),c['destination'])),1)
                self.assertEqual(kwargs['json'],{'p_request_id':c['request_id'],**{'p_'+k:v for k,v in c['arguments'].items()}})
                calls.append(url);return Mock(status_code=200,json=lambda:answer)
            for _ in range(2):
                self.assertEqual(client.deliver(Path(temp),c,base_url=BASE,deployment_id='synthetic-recovery',service_key='synthetic',post=post),answer)
            self.assertEqual(calls,[BASE+'/rest/v1/rpc/abandon_model_run_execution'])

    def test_invalid_decisions_never_reach_transport(self):
        edits=[lambda a:a.update(reason=' '),lambda a:a.update(actor_id='invalid'),lambda a:a.update(evidence=[]),
          lambda a:a['expected_state'].update(workspace_id=IDS[0]),lambda a:a['expected_state'].update(status='succeeded'),
          lambda a:a['expected_state'].update(attempt_managed=1),lambda a:a['expected_state'].update(updated_at='2026-10-08'),
          lambda a:a['expected_state']['stages'].append(copy.deepcopy(a['expected_state']['stages'][0])),
          lambda a:a['expected_state']['stages'][0].update(active_attempt_id='invalid'),lambda a:a.update(evidence={'large':'x'*65537})]
        for edit in edits:
            with self.subTest(edit=edit),tempfile.TemporaryDirectory() as temp:
                c=command();edit(c['arguments']);post=Mock(side_effect=AssertionError('Invalid decision reached transport'))
                try:
                    with self.assertRaises((ValueError,TypeError)):
                        client.deliver(Path(temp),c,base_url=BASE,deployment_id='synthetic-recovery',service_key='synthetic',post=post)
                finally:post.assert_not_called()

    def test_changed_receipts_remain_pending(self):
        edits=[lambda r:r.update(actor_id=IDS[0]),lambda r:r.update(process_termination_verified=True),lambda r:r.update(model_resumed=0),
          lambda r:r.update(continuation_authorized=True),lambda r:r.update(reported_evidence_verified=True),
          lambda r:r['request_payload'].update(reason='Different decision'),lambda r:r['request_payload'].update(reported_evidence={}),
          lambda r:r['request_payload']['expected_state'].update(status='queued'),lambda r:r.update(extra='unexpected')]
        for edit in edits:
            with self.subTest(edit=edit),tempfile.TemporaryDirectory() as temp:
                c=command();r=copy.deepcopy(receipt(c));edit(r)
                with self.assertRaises(client.DeliveryUnconfirmed):
                    client.deliver(Path(temp),c,base_url=BASE,deployment_id='synthetic-recovery',service_key='synthetic',post=Mock(return_value=Mock(status_code=200,json=lambda:r)))
                self.assertEqual(len(journal.pending(Path(temp),c['destination'])),1)

if __name__=='__main__':unittest.main()
