"""Retain exact publication requests and refuse unrelated receipt evidence."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
IDS=[f'{n:08d}-1111-4111-8111-111111111111' for n in range(1,9)]
URL='http://127.0.0.1:54321'

def command():
    scope={'workspace_id':IDS[1],'model_run_id':IDS[2],'track':'behavioral_demand'}
    claim={**scope,'claim_status':'prototype_only','status_reason':'Synthetic incomplete evidence','validation_summary_json':{'quantity':0}}
    metrics=[{**scope,'metric_key':key,'metric_label':'Synthetic metric','threshold_comparator':'manual','status':'warn','blocks_claim_grade':True,'detail':'Synthetic unresolved input','metadata_json':{'quantity':0}} for key in ('one','two')]
    return {'request_id':IDS[0],'destination':client.destination(URL,'synthetic'),'operation':'publish_legacy_model_evidence','arguments':{'workspace_id':IDS[1],'run_id':IDS[2],'track':'behavioral_demand','expected':{'claims':[],'metrics':[]},'payload':{'claim':claim,'metrics':metrics}}}

def receipt(cmd):
    args=cmd['arguments']
    claim={**copy.deepcopy(args['payload']['claim']),'id':IDS[3],'county_run_id':None,'reasons_json':[]}
    metrics=[{**copy.deepcopy(row),'id':IDS[4+i],'county_run_id':None,'source_manifest_id':None,'observed_value':None,'threshold_value':None,'threshold_max_value':None} for i,row in enumerate(args['payload']['metrics'])]
    return {'request_id':cmd['request_id'],'workspace_id':args['workspace_id'],'run_id':args['run_id'],'track':args['track'],'evidence':{'claims':[claim],'metrics':metrics}}

class PublicationClientTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
    def deliver(self,cmd,post,directory=None):
        return client.deliver(directory or self.root/'journal',cmd,base_url=URL,deployment_id='synthetic',service_key='synthetic-private',post=post)
    def response(self,value):return Mock(status_code=200,json=Mock(return_value=value))
    def test_full_request_is_retained_before_transport_and_cached_after_receipt(self):
        cmd=command();expected=receipt(cmd);expected['evidence']['metrics'].reverse()
        def send(url,**kwargs):
            self.assertEqual(url,URL+'/rest/v1/rpc/publish_legacy_model_evidence')
            self.assertEqual(journal.pending(self.root/'journal',cmd['destination'])[0]['command'],cmd)
            self.assertEqual(kwargs['json'],{'p_request':IDS[0],'p_workspace':IDS[1],'p_run':IDS[2],'p_track':'behavioral_demand','p_expected':cmd['arguments']['expected'],'p_payload':cmd['arguments']['payload']})
            return self.response(expected)
        post=Mock(side_effect=send)
        self.assertEqual(self.deliver(cmd,post),expected);self.assertEqual(self.deliver(cmd,post),expected)
        self.assertEqual(post.call_count,1)
    def test_lost_reply_recovers_without_stage_identity(self):
        cmd=command()
        with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(side_effect=TimeoutError('synthetic-private')))
        self.assertEqual(recovery.pending_summaries(self.root/'journal',base_url=URL,deployment_id='synthetic'),[{'request_id':IDS[0],'operation':'publish_legacy_model_evidence','run_id':IDS[2],'stage_id':None,'track':'behavioral_demand'}])
        expected=receipt(cmd)
        self.assertEqual(recovery.recover_request(self.root/'journal',IDS[0],base_url=URL,deployment_id='synthetic',service_key='synthetic-private',post=Mock(return_value=self.response(expected))),expected)
        self.assertEqual(journal.pending(self.root/'journal',cmd['destination']),[])
    def test_mismatched_receipts_stay_pending(self):
        edits=[lambda r:r.update(request_id=IDS[7]),lambda r:r.update(workspace_id=IDS[7]),lambda r:r.update(run_id=IDS[7]),lambda r:r.update(track='assignment'),lambda r:r['evidence']['claims'][0].update(claim_status='screening_grade'),lambda r:r['evidence']['claims'][0].update(reasons_json=['stale']),lambda r:r['evidence']['claims'][0]['validation_summary_json'].update(quantity=False),lambda r:r['evidence']['claims'][0].update(id='not-a-uuid'),lambda r:r['evidence']['metrics'].pop(),lambda r:r['evidence']['metrics'][1].update(id=IDS[4]),lambda r:r['evidence']['metrics'][1].update(metric_key='one'),lambda r:r['evidence']['metrics'][0].update(source_manifest_id=IDS[7]),lambda r:r['evidence']['metrics'][0]['metadata_json'].update(quantity=False)]
        for i,edit in enumerate(edits):
            with self.subTest(case=i):
                cmd=command();bad=receipt(cmd);edit(bad);directory=self.root/str(i)
                with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(return_value=self.response(bad)),directory)
                self.assertEqual(len(journal.pending(directory,cmd['destination'])),1)
    def test_invalid_commands_never_contact_transport(self):
        edits=[lambda a:a.update(track='shared'),lambda a:a['payload']['claim'].update(workspace_id=IDS[7]),lambda a:a['payload']['claim'].update(claim_status='screening_grade'),lambda a:a['payload']['metrics'][0].update(metric_key=True),lambda a:a['payload']['metrics'][0].update(blocks_claim_grade=1),lambda a:a['payload']['metrics'][1].update(metric_key='one'),lambda a:a['expected'].update(claims={}),lambda a:a['payload']['metrics'][0].update(county_run_id=IDS[7])]
        for i,edit in enumerate(edits):
            with self.subTest(case=i):
                cmd=command();edit(cmd['arguments']);post=Mock()
                error = None
                try:self.deliver(cmd,post,self.root/str(i))
                except Exception as caught:error = caught
                post.assert_not_called()
                self.assertIsInstance(error, ValueError)
    def test_prior_claim_identity_cannot_change(self):
        cmd=command();cmd['arguments']['expected']['claims']=[receipt(cmd)['evidence']['claims'][0]]
        changed=receipt(cmd);changed['evidence']['claims'][0]['id']=IDS[7]
        with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(return_value=self.response(changed)))

if __name__=='__main__':unittest.main()
