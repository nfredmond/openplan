"""Agreement delivery retries preserve separate records and sensitivity provenance."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from test_activitysim_assignment_handoff import main, identity_record

RUN='11111111-1111-4111-8111-111111111111'
STAGE='22222222-2222-4222-8222-222222222222'


class AgreementRecovery(unittest.TestCase):
    def test_three_slots_repeat_without_duplicate_registration_and_refuse_change(self):
        first=identity_record(0.0004);second=identity_record(0.0003)
        common=dict(workspace_id=RUN,first_assignment_convergence=first['convergence'],second_assignment_convergence=second['convergence'],assignment_profile=first['convergence']['assignment_profile'],assignment_profile_payload_json=first['convergence']['assignment_profile_payload_json'],assignment_profile_digest=first['convergence']['assignment_profile_digest'],network_settings=first['network_settings'],network_settings_payload_json=first['network_settings_payload_json'],network_settings_digest=first['network_settings_digest'],network_state_record=first['network_state_record'],network_state_digest=first['network_state_digest'])
        def send(url,**kwargs):
            self.assertTrue(url.endswith('/rpc/record_legacy_model_artifact'))
            return Mock(status_code=200,json=Mock(return_value={**kwargs['json']['p_payload'],'attempt_id':None}))
        with tempfile.TemporaryDirectory() as temporary,patch.dict(main.os.environ,{'OPENPLAN_DEPLOYMENT_ID':'synthetic'}),patch.object(main,'SUPABASE_URL','http://127.0.0.1:54321'),patch.object(main.requests,'post',side_effect=send) as post,patch.object(main,'sb_post_artifact') as legacy,patch.object(main,'upload_content_addressed_artifact',side_effect=lambda run,stage,name,data,mime:'storage://synthetic/'+name):
            root=Path(temporary);common['journal_dir']=str(root/'journal');identities=[]
            for kind,name,mime in [('demand_model_agreement','agreement.json','application/json'),('demand_model_agreement_report','agreement.md','text/markdown'),('demand_model_agreement_geojson','agreement.geojson','application/geo+json')]:
                path=root/name;path.write_bytes(b'synthetic sensitivity record')
                for _ in range(2):main.register_agreement_artifact(RUN,STAGE,kind,str(path),mime,**common)
                payload=post.call_args.kwargs['json']['p_payload'];identities.append(payload['id'])
                self.assertEqual(payload['artifact_type'],kind)
                self.assertFalse(payload['metadata_json']['is_average'])
                self.assertEqual(payload['metadata_json']['first_assignment_convergence'],first['convergence'])
                self.assertEqual(payload['metadata_json']['second_assignment_convergence'],second['convergence'])
                path.write_bytes(b'changed sensitivity record')
                with self.assertRaises(main.WorkerStateWriteUnconfirmed):main.register_agreement_artifact(RUN,STAGE,kind,str(path),mime,**common)
            self.assertEqual(len(set(identities)),3);self.assertEqual(post.call_count,3);legacy.assert_not_called()


if __name__=='__main__':unittest.main()
