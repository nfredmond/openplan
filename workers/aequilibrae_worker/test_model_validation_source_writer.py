"""Owned source files and real command journals, with synthetic HTTP receipts."""
import hashlib
import json
from pathlib import Path
import unittest

import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired
from model_validation_source_catalog import build_catalog
from test_model_validation_source_catalog import fixture


class BoundSourceTests(unittest.TestCase):
    from test_model_attempt_outputs import OutputTests
    response = OutputTests.response

    def setUp(self):
        from test_model_attempt_writer import WriterTests
        WriterTests.setUp(self)

    def prepare(self, method='aequilibrae'):
        ctx = self.writer.context
        root = self.writer.workspace(self.directory / 'runs', ctx.run_id)
        args, payloads = fixture(method, include_payloads=True)
        args['context'].update(workspace_id=ctx.workspace_id, model_run_id=ctx.run_id,
                               stage_id=ctx.stage_id, attempt_id=ctx.attempt_id)
        basis = json.loads(args['documents']['comparison_basis'])
        basis['model_run_id'] = ctx.run_id
        payload = json.dumps(basis, sort_keys=True).encode()
        args['documents']['comparison_basis'] = payload
        record = args['document_records']['comparison_basis']
        record.update(sha256=hashlib.sha256(payload).hexdigest(), bytes=len(payload))
        payloads[record['path']] = payload
        source = root / ('sources_' + method)
        source.mkdir()
        for name, content in payloads.items(): (source / name).write_bytes(content)
        paths = {entry['role']: source / entry['artifact']['path'] for entry in build_catalog(**args)['entries']}
        return {'method': method, 'catalog_arguments': args, 'source_paths': paths}

    def test_both_methods_register_exact_distinct_manifest_slots(self):
        paths = []
        for method in ('aequilibrae', 'activitysim'):
            retained = self.writer.retain_validation_sources(**self.prepare(method))
            paths.append(retained['manifest_path'])
            args = self.post.call_args.kwargs['json']
            payload = args['p_payload']
            self.assertEqual(args['p_attempt_id'], self.writer.context.attempt_id)
            self.assertEqual(payload['artifact_type'], 'model_validation_sources')
            self.assertEqual(payload['file_url'], 'local://' + retained['manifest_path'])
            self.assertEqual(payload['content_hash'], hashlib.sha256(Path(retained['manifest_path']).read_bytes()).hexdigest())
            self.assertEqual(payload['metadata_json']['context']['method'], method)
            self.assertEqual(payload['metadata_json']['publication_state'], 'retained_locally')
            self.assertEqual(payload['metadata_json']['scientific_acceptance'], 'unassessed')
        self.assertNotEqual(*paths)
        self.assertEqual(self.post.call_count, 2)

    def test_foreign_attempt_source_refuses_before_registration(self):
        kwargs = self.prepare()
        role = '/match_audit/network_sha256'
        foreign = self.directory / 'foreign.dat'
        foreign.write_bytes(kwargs['source_paths'][role].read_bytes())
        kwargs['source_paths'][role] = foreign
        with self.assertRaisesRegex(ValueError, 'owned attempt'):
            self.writer.retain_validation_sources(**kwargs)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_changed_source_stops_without_registration(self):
        kwargs = self.prepare()
        path = kwargs['source_paths']['/match_audit/network_sha256']
        path.write_bytes(b'x' * path.stat().st_size)
        with self.assertRaisesRegex(ValueError, 'bytes differ'):
            self.writer.retain_validation_sources(**kwargs)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)
        self.assertFalse((self.writer.files.path / 'validation_sources_aequilibrae/manifest.json').exists())

    def test_wrong_context_stops_before_registration(self):
        kwargs = self.prepare()
        kwargs['catalog_arguments']['context']['workspace_id'] = self.writer.context.run_id
        with self.assertRaisesRegex(ValueError, 'context differs'):
            self.writer.retain_validation_sources(**kwargs)
        self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_lost_reply_preserves_exact_command_and_stops(self):
        kwargs = self.prepare()
        self.post.side_effect = TimeoutError('synthetic lost reply')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.retain_validation_sources(**kwargs)
        self.assertTrue(self.writer.stopped)
        pending = journal.pending(self.directory, self.writer.context.destination)
        self.assertEqual(len(pending), 1)
        payload = pending[0]['command']['arguments']['payload']
        self.assertEqual(payload['artifact_type'], 'model_validation_sources')
        manifest = Path(payload['file_url'].removeprefix('local://'))
        self.assertEqual(hashlib.sha256(manifest.read_bytes()).hexdigest(), payload['content_hash'])
        with self.assertRaises(ReconciliationRequired):
            self.writer.retain_validation_sources(**kwargs)
        self.post.assert_called_once()


if __name__ == '__main__':
    unittest.main()
