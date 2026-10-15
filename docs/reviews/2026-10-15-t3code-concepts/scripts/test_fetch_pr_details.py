"""Exercise the collector transport, complete-page handling and cache boundary."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('fetch_pr_details.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def response(payload, code=0):
    return subprocess.CompletedProcess([], code, json.dumps(payload), 'synthetic unavailable' if code else '')


def pr():
    return {'number': 3699, 'title': 'Synthetic research PR', 'state': 'closed', 'changed_files': 190,
            'user': {'login': 'synthetic'}, 'base': {'sha': 'a'*40}, 'head': {'sha': 'b'*40}}


def payloads():
    files = [{'filename': f'file-{i}.ts', 'status': 'modified', 'additions': 1, 'deletions': 0} for i in range(190)]
    return [pr(), [files[:100], files[100:]],
            [[{'user': {'login': 'human'}, 'body': 'issue-one'}], [{'user': None, 'body': 'issue-two'}]],
            [[{'user': {'login': 'reviewer'}, 'path': 'file-189.ts', 'body': 'review-comment'}]],
            [[{'user': {'login': 'reviewer'}, 'state': 'COMMENTED', 'body': 'review'}]]]


class CollectorTests(unittest.TestCase):
    def collect(self):
        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in payloads()]) as run:
            record = collector.collect(3699)
        return record, run

    def root(self, directory):
        root = Path(directory)
        (root/'evidence').mkdir()
        (root/'evidence/deep-review-selection.tsv').write_text('number\tnote\n3699\tsynthetic\n')
        (root/'pr-details').mkdir()
        return root

    def test_all_pages_are_flattened_in_order(self):
        record, run = self.collect()
        self.assertEqual(len(record['files']), 190, 'all 190 files must survive pagination')
        self.assertEqual(record['files'][-1]['filename'], 'file-189.ts')
        self.assertEqual([item['body'] for item in record['issueComments']], ['issue-one', 'issue-two'])
        self.assertEqual(record['reviewComments'][0]['body'], 'review-comment')
        self.assertEqual(record['reviews'][0]['body'], 'review')
        self.assertEqual(record['pr']['head'], 'b'*40)
        self.assertEqual(run.call_args_list[0].args[0], ['gh', 'api', 'repos/pingdotgg/t3code/pulls/3699'])
        for call in run.call_args_list[1:]:
            self.assertEqual(call.args[0][0:4], ['gh', 'api', '--paginate', '--slurp'], 'CLI must slurp every list endpoint')
        self.assertTrue(all(call.kwargs.get('timeout') == 60 for call in run.call_args_list), 'API calls need a bounded deadline')
        self.assertTrue(record['collection']['fileCountMatchesDeclared'])
        self.assertTrue(collector.valid_cache(record, 3699))

    def test_empty_page_is_available_not_failed(self):
        with patch.object(collector.subprocess, 'run', return_value=response([[]])):
            self.assertEqual(collector.api('synthetic', paginated=True), [])

    def test_timeout_is_unavailable_without_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            with patch.object(collector.subprocess, 'run', side_effect=subprocess.TimeoutExpired('gh', 60)):
                with self.assertRaisesRegex(collector.CollectionError, 'API deadline exceeded'):
                    collector.main(root)
            self.assertFalse((root/'pr-details/3699.json').exists())

    def test_duplicate_selection_is_not_collected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            (root/'evidence/deep-review-selection.tsv').write_text('number\tnote\n3699\tone\n3699\ttwo\n')
            record, _ = self.collect()
            with patch.object(collector, 'collect', return_value=record) as collect:
                with self.assertRaisesRegex(collector.CollectionError, 'Selection must contain unique positive PR numbers'):
                    collector.main(root)
            collect.assert_not_called()

    def test_api_failure_is_never_cached_at_any_endpoint(self):
        for position in range(5):
            with self.subTest(endpoint=position), tempfile.TemporaryDirectory() as directory:
                root = self.root(directory)
                responses = [response(p) for p in payloads()]
                responses[position] = response({'message': 'rate limited'}, 1)
                with patch.object(collector.subprocess, 'run', side_effect=responses):
                    with self.assertRaisesRegex(collector.CollectionError, 'API unavailable'):
                        collector.main(root)
                self.assertFalse((root/'pr-details/3699.json').exists(), 'failed collection must not publish a cache')

    def test_malformed_transport_is_refused(self):
        shapes = [(False, 'not-json', 'malformed JSON'), (False, [], 'expected object'),
                  (True, [], 'expected slurped pages'), (True, {}, 'expected slurped pages'),
                  (True, [{'filename': 'flat.ts'}], 'malformed page'),
                  (True, [[{'filename': 'one.ts'}, 'bad-row']], 'malformed page')]
        for paginated, value, diagnostic in shapes:
            with self.subTest(shape=value):
                result = response(value)
                if value == 'not-json':
                    result.stdout = 'not-json'
                with patch.object(collector.subprocess, 'run', return_value=result):
                    with self.assertRaisesRegex(collector.CollectionError, diagnostic):
                        collector.api('synthetic', paginated=paginated)

    def test_wrong_pr_identity_is_refused(self):
        for field, value in [('number', 3700), ('number', True), ('title', None),
                             ('state', 'unavailable'), ('changed_files', None)]:
            broken = pr()
            broken[field] = value
            with self.subTest(field=field, value=value), patch.object(collector.subprocess, 'run', return_value=response(broken)):
                with self.assertRaisesRegex(collector.CollectionError, 'malformed PR identity'):
                    collector.collect(3699)

    def test_malformed_row_is_not_dropped(self):
        for position, bad, diagnostic in [(1, {'filename': None}, 'file name'),
                                          (2, {'body': {}}, 'comment body'),
                                          (3, {'body': 'text', 'user': 'bad-author'}, 'comment author')]:
            values = payloads()
            values[position] = [[bad]]
            with self.subTest(position=position), patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                with self.assertRaisesRegex(collector.CollectionError, diagnostic):
                    collector.collect(3699)

    def test_legacy_cache_refreshes_and_failed_refresh_preserves_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            path = root/'pr-details/3699.json'
            original = b'{"number":3699,"pr":{"title":null},"files":[]}'
            path.write_bytes(original)
            with patch.object(collector.subprocess, 'run', return_value=response({}, 1)):
                with self.assertRaisesRegex(collector.CollectionError, 'API unavailable'):
                    collector.main(root)
            self.assertEqual(path.read_bytes(), original, 'failed refresh must preserve historical bytes')
            with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in payloads()]) as run:
                collector.main(root)
            self.assertEqual(run.call_count, 5, 'legacy caches must refetch every endpoint')
            self.assertTrue(collector.valid_cache(json.loads(path.read_text()), 3699))

    def test_only_intact_complete_current_cache_is_reused(self):
        record, _ = self.collect()
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            collector.publish(root/'pr-details/3699.json', record)
            with patch.object(collector.subprocess, 'run', side_effect=AssertionError('intact cache unexpectedly refetched')):
                collector.main(root)
        for change in ['receipt', 'count', 'complete', 'schema', 'identity']:
            broken = copy.deepcopy(record)
            if change == 'receipt': broken['files'][0]['filename'] = 'changed.ts'
            if change == 'count': broken['collection']['endpointCounts']['files'] = 0
            if change == 'complete': broken['collection']['complete'] = False
            if change == 'schema': broken['schema'] = 'old'
            if change == 'identity': broken['number'] = 1
            if change != 'receipt':
                broken['receiptSha256'] = collector.digest(broken)
            with self.subTest(change=change):
                self.assertFalse(collector.valid_cache(broken, 3699), 'altered cache must be rejected')
        boolean = copy.deepcopy(record)
        boolean['number'] = True
        boolean['receiptSha256'] = collector.digest(boolean)
        self.assertFalse(collector.valid_cache(boolean, 1), 'cache identity cannot be boolean')

    def test_upstream_file_census_discrepancy_stays_explicit(self):
        values = payloads()
        values[0]['changed_files'] = 0
        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
            record = collector.collect(3699)
        self.assertEqual(len(record['files']), 190)
        self.assertFalse(record['collection']['fileCountMatchesDeclared'])

    def test_failed_atomic_publication_preserves_previous_record(self):
        record, _ = self.collect()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'3699.json'
            path.write_bytes(b'historical')
            with patch.object(collector.os, 'replace', side_effect=OSError('synthetic publication failure')):
                with self.assertRaisesRegex(OSError, 'synthetic publication failure'):
                    collector.publish(path, record)
            self.assertTrue(path.exists(), 'failed publication must preserve the previous cache path')
            self.assertEqual(path.read_bytes(), b'historical')
            self.assertEqual(list(path.parent.glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
