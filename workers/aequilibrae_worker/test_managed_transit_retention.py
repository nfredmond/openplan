"""Actual selected-feed loading, retained bytes and parent artifact confirmation."""
import hashlib
from urllib.parse import parse_qs, urlsplit
from pathlib import Path
import unittest
from unittest.mock import patch
import model_attempt_writer as managed
import model_command_journal as journal
import model_transit_inputs as inputs
import test_model_attempt_writer as writers
import test_model_attempt_outputs as outputs
import test_managed_run_read as reads
import test_transit_feed_handoff as feeds
from test_model_skip_dispatch import aeq


class ManagedTransitTests(unittest.TestCase):
    setUp=writers.WriterTests.setUp
    response=outputs.OutputTests.response

    def prepare(self):
        self.root=self.writer.workspace(self.directory/'work',self.writer.context.run_id)
        self.output=self.writer.create_assignment_outputs(self.root,'run_output')
        row=reads.RunReadTests.configure(self)
        row['model_runs']['input_snapshot_json']=feeds._stamp()['input_snapshot_json']
        self.raw=feeds._feed_bytes()
        self.fake=feeds._FakeRequests(version_rows=[feeds._version_row(workspace_id=self.writer.context.workspace_id,storage_path=self.writer.context.workspace_id+"/synthetic/feed.zip",_bytes=self.raw)],object_bytes=self.raw)
        original_get=self.fake.get
        def projected_get(url, **kwargs):
            response=original_get(url, **kwargs)
            if '/rest/v1/gtfs_feed_versions' in url:
                fields=parse_qs(urlsplit(url).query)['select'][0].split(',')
                response._payload=[{k:v for k,v in item.items() if k in fields} for item in response._payload]
            return response
        self.fake.get=projected_get
        return row

    def retain(self):
        with managed.bind(self.writer),patch.object(aeq,'requests',self.fake):
            return aeq.retain_managed_selected_transit(self.output)

    def test_parent_confirms_original_archive_and_metadata(self):
        self.prepare();record=self.retain()
        _,raw,meta,settings=inputs.consume(record,self.root/'transit-consumed')
        self.assertEqual(raw,self.raw);self.assertEqual(meta['feed_version_id'],feeds.VERSION_ID)
        self.assertEqual(meta['source_name'],'Test Transit')
        self.assertEqual(meta['feed_checksum_sha256'],hashlib.sha256(self.raw).hexdigest())
        payload=self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['artifact_type'],'model_transit_inputs')
        self.assertEqual(payload['content_hash'],record['manifest_sha256'])
        self.assertEqual(payload['file_url'],'local://'+record['manifest_path'])
        self.post.assert_called_once();self.assertEqual(journal.pending(self.directory,self.writer.context.destination),[])

    def test_selected_feed_projection_includes_workspace_ownership(self):
        self.prepare()
        with patch.object(aeq,'requests',self.fake):
            aeq.resolve_selected_feed_version(feeds.VERSION_ID,self.writer.context.workspace_id)
        fields=parse_qs(urlsplit(self.fake.version_query_urls()[0]).query)['select'][0].split(',')
        self.assertIn('workspace_id',fields)

    def test_lost_registration_keeps_bytes_and_stops_without_handoff(self):
        self.prepare();self.post.side_effect=TimeoutError('Synthetic lost reply')
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.retain()
        self.assertTrue(self.writer.stopped)
        self.assertTrue((Path(self.output)/'transit_inputs/manifest.json').is_file())
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'],'model_transit_inputs')

    def test_foreign_workspace_feed_refused_without_substitution(self):
        self.prepare();self.fake=feeds._FakeRequests(version_rows=[feeds._version_row(workspace_id='foreign')],object_bytes=self.raw)
        with self.assertRaises(aeq.gtfs_skim.SelectedFeedError) as caught:self.retain()
        self.assertEqual(caught.exception.no_feed_reason,'selected_feed_not_found')
        self.post.assert_not_called();self.assertFalse((Path(self.output)/'transit_inputs').exists())

    def test_foreign_output_refused_before_source_loading(self):
        self.prepare();self.output=str(self.directory)
        with patch.object(aeq,'_prepare_selected_feed_version',wraps=aeq._prepare_selected_feed_version) as load:
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.retain()
        load.assert_not_called();self.post.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_missing_selection_does_not_acquire_another_feed(self):
        row=self.prepare();row['model_runs']['input_snapshot_json']={}
        with patch.object(aeq,'_prepare_selected_feed_version') as load:
            with self.assertRaises(aeq.gtfs_skim.SelectedFeedError):self.retain()
        load.assert_not_called();self.post.assert_not_called();self.assertFalse(self.writer.stopped)


if __name__=='__main__':unittest.main()
