"""Assessment journal recovery and complete receipt refusal controls."""
import unittest
from unittest.mock import Mock
import test_model_publication_client as publication_tests
URL = publication_tests.URL
import model_command_client as client
import model_command_journal as journal
import model_command_recovery as recovery
IDS = [f'{n:08d}-1111-4111-8111-111111111111' for n in range(1,10)]
def fixture():
    payload = {
        'p_workspace_id': IDS[0], 'p_model_run_id': IDS[1], 'p_stage_id': IDS[2],
        'p_track': 'assignment', 'p_model_output_artifact_id': IDS[3],
        'p_comparison_basis_sha256': 'a' * 64, 'p_partition': {'count': 1},
        'p_planning_use': 'synthetic test only', 'p_scientific_outcome': 'inconclusive',
        'p_reasons': ['Synthetic unresolved evidence'],
    }
    for kind in ('validation_input', 'comparison_basis', 'assessment'):
        payload.update({f'p_{kind}_file_url': f'storage://run-artifacts/synthetic/{kind}.json',
                        f'p_{kind}_size': 2, f'p_{kind}_sha256': 'a' * 64,
                        f'p_{kind}_metadata': {}})
    row = {
        'id': IDS[4], 'workspace_id': IDS[0], 'model_run_id': IDS[1], 'track': 'assignment',
        'model_output_artifact_id': IDS[3], 'validation_input_bundle_artifact_id': IDS[5],
        'comparison_basis_artifact_id': IDS[6], 'model_validation_assessment_artifact_id': IDS[7],
        'comparison_basis_sha256': 'a' * 64, 'validation_rules_version': 4,
        'partition_json': {'count': 1}, 'planning_use': 'synthetic test only',
        'scientific_outcome': 'inconclusive', 'reasons_json': ['Synthetic unresolved evidence'],
    }
    return payload, row

def artifact_rows(payload, receipt):
    return [{
        'id': receipt[key], 'run_id': payload['p_model_run_id'], 'stage_id': payload['p_stage_id'],
        'artifact_type': kind, 'file_url': payload[f'p_{prefix}_file_url'],
        'file_size_bytes': payload[f'p_{prefix}_size'], 'content_hash': payload[f'p_{prefix}_sha256'],
        'metadata_json': payload[f'p_{prefix}_metadata'],
    } for prefix, key, kind in (
        ('validation_input', 'validation_input_bundle_artifact_id', 'validation_input_bundle'),
        ('comparison_basis', 'comparison_basis_artifact_id', 'model_comparison_basis'),
        ('assessment', 'model_validation_assessment_artifact_id', 'model_validation_assessment'),
    )]

def command():
    p, row = fixture()
    return dict(request_id=IDS[8], destination=client.destination(URL,'synthetic'), operation='record_legacy_model_assessment', arguments=dict(run_id=IDS[1], stage_id=IDS[2], track='assignment', payload=p))

def receipt(cmd):
    p,row=fixture()
    return dict(request_id=cmd['request_id'], assessment=row, artifacts=artifact_rows(p,row))

class AssessmentClientTests(unittest.TestCase):
    setUp = publication_tests.PublicationClientTests.setUp
    deliver = publication_tests.PublicationClientTests.deliver
    response = publication_tests.PublicationClientTests.response

    def test_request_precedes_transport_and_receipt_is_cached(self):
        cmd=command(); expected=receipt(cmd)
        def send(url,**kwargs):
            self.assertEqual(url,URL+'/rest/v1/rpc/record_legacy_model_assessment')
            self.assertEqual(journal.pending(self.root/'journal',cmd['destination'])[0]['command'],cmd)
            self.assertEqual(kwargs['json'],dict(p_request=IDS[8],p_payload=cmd['arguments']['payload']))
            return self.response(expected)
        post=Mock(side_effect=send)
        self.assertEqual(self.deliver(cmd,post),expected)
        self.assertEqual(self.deliver(cmd,post),expected)
        self.assertEqual(post.call_count,1)

    def test_loss_and_recovery(self):
        cmd=command()
        with self.assertRaises(client.DeliveryUnconfirmed): self.deliver(cmd,Mock(side_effect=TimeoutError()))
        self.assertEqual(recovery.pending_summaries(self.root/'journal',base_url=URL,deployment_id='synthetic'),[dict(request_id=IDS[8],operation=cmd['operation'],run_id=IDS[1],stage_id=IDS[2],track='assignment')])
        post=Mock(return_value=self.response(receipt(cmd)))
        self.assertEqual(recovery.recover_request(self.root/'journal',IDS[8],base_url=URL,deployment_id='synthetic',service_key='synthetic-private',post=post),receipt(cmd))
        self.assertEqual(post.call_args.kwargs['json'],dict(p_request=IDS[8],p_payload=cmd['arguments']['payload']))
        self.assertEqual(journal.pending(self.root/'journal',cmd['destination']),[])

    def test_bad_receipts_stay_pending(self):
        edits=[lambda r:r.update(request_id=IDS[0]),lambda r:r['assessment'].update(model_run_id=IDS[0]),lambda r:r['assessment']['partition_json'].update(count=True),lambda r:r['artifacts'][0].update(stage_id=IDS[0]),lambda r:r['artifacts'][0].update(file_size_bytes=True),lambda r:r['artifacts'].pop(),lambda r:r.update(assessment=[r['assessment']])]
        for i,edit in enumerate(edits):
            with self.subTest(case=i):
                cmd=command();bad=receipt(cmd);edit(bad);directory=self.root/str(i)
                with self.assertRaises(client.DeliveryUnconfirmed):self.deliver(cmd,Mock(return_value=self.response(bad)),directory)
                self.assertEqual(len(journal.pending(directory,cmd['destination'])),1)

    def test_invalid_payload_never_sends(self):
        edits=[lambda a:a.update(run_id=IDS[0]),lambda a:a.update(stage_id=IDS[0]),lambda a:a['payload'].update(p_track='combined'),lambda a:a['payload'].update(p_validation_input_size=True),lambda a:a['payload'].update(p_assessment_size=2**63),lambda a:a['payload'].update(p_assessment_sha256='bad'),lambda a:a['payload'].update(unexpected=True)]
        for i,edit in enumerate(edits):
            with self.subTest(case=i):
                cmd=command();edit(cmd['arguments']);post=Mock()
                error = None
                try:self.deliver(cmd,post,self.root/str(i))
                except Exception as failure:error = failure
                post.assert_not_called()
                self.assertIsInstance(error, ValueError)

if __name__=='__main__':unittest.main()
