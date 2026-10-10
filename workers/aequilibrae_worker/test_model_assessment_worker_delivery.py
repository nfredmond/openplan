"""Normal worker assessment helper retains exact requests and stops on uncertainty."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main
from test_model_assessment_client import fixture, artifact_rows, IDS, URL
import model_command_journal as journal
main = import_worker_main()


class WorkerAssessmentDelivery(unittest.TestCase):
    def test_native_worker_helper_uses_retained_route_and_cached_receipt(self):
        payload, row = fixture()
        with tempfile.TemporaryDirectory() as temporary, patch.dict(main.os.environ, {'OPENPLAN_DEPLOYMENT_ID':'synthetic'}), patch.object(main,'SUPABASE_URL',URL), patch.object(main,'SUPABASE_KEY','synthetic-private'):
            directory=Path(temporary)/'journal'
            def send(url,**kwargs):
                self.assertEqual(url,URL+'/rest/v1/rpc/record_legacy_model_assessment')
                # Inspect the committed journal independently of helper globals.
                import model_command_client
                saved=journal.pending(directory,model_command_client.destination(URL,'synthetic'))
                self.assertEqual(len(saved),1)
                self.assertEqual(saved[0]['command']['arguments']['payload'],payload)
                self.assertEqual(kwargs['json']['p_payload'],payload)
                return Mock(status_code=200,json=Mock(return_value=dict(request_id=kwargs['json']['p_request'],assessment=row,artifacts=artifact_rows(payload,row))))
            with patch.object(main.requests,'post',side_effect=send) as post:
                for _ in range(2):
                    self.assertEqual(main.sb_record_retained_modeling_validation_assessment(payload,assessment_id=IDS[8],journal_dir=str(directory)),row)
                self.assertEqual(post.call_count,1)

    def test_lost_reply_leaves_pending_without_legacy_fallback(self):
        import model_command_client
        payload,_=fixture()
        with tempfile.TemporaryDirectory() as temporary, patch.dict(main.os.environ, {'OPENPLAN_DEPLOYMENT_ID':'synthetic'}), patch.object(main,'SUPABASE_URL',URL), patch.object(main,'SUPABASE_KEY','synthetic-private'), patch.object(main.requests,'post',side_effect=TimeoutError('synthetic secret')) as post:
            directory=Path(temporary)/'journal'
            with self.assertRaises(main.WorkerStateWriteUnconfirmed) as error:
                main.sb_record_retained_modeling_validation_assessment(payload,assessment_id=IDS[8],journal_dir=str(directory))
            self.assertNotIn('synthetic secret',str(error.exception))
            self.assertEqual(post.call_count,1)
            self.assertEqual(len(journal.pending(directory,model_command_client.destination(URL,'synthetic'))),1)

    def test_missing_deployment_stops_before_transport(self):
        payload,_=fixture()
        with tempfile.TemporaryDirectory() as temporary, patch.dict(main.os.environ, {'OPENPLAN_DEPLOYMENT_ID':''}), patch.object(main,'SUPABASE_URL',URL), patch.object(main,'SUPABASE_KEY','synthetic-private'), patch.object(main.requests,'post') as post:
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):
                main.sb_record_retained_modeling_validation_assessment(payload,assessment_id=IDS[8],journal_dir=temporary)
            post.assert_not_called()
            self.assertFalse((Path(temporary)/'model-commands.sqlite3').exists())


if __name__=='__main__':unittest.main()
