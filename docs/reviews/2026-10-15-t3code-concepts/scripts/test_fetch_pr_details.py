"""Exercise the collector transport, complete-page handling and cache boundary."""
import contextlib
import copy
import io
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
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
            'additions': 190, 'deletions': 0, 'merge_commit_sha': None,
            'user': {'login': 'synthetic'}, 'base': {'sha': 'a'*40}, 'head': {'sha': 'b'*40}}


def payloads():
    files = [{'filename': f'file-{i}.ts', 'status': 'modified', 'additions': 1, 'deletions': 0} for i in range(190)]
    return [pr(), [files[:100], files[100:]],
            [[{'user': {'login': 'human'}, 'body': 'issue-one', 'created_at': '2026-10-15T00:00:00Z'}], [{'user': None, 'body': 'issue-two', 'created_at': '2026-10-15T00:00:01Z'}]],
            [[{'user': {'login': 'reviewer'}, 'path': 'file-189.ts', 'body': 'review-comment'}]],
            [[{'user': {'login': 'reviewer'}, 'state': 'COMMENTED', 'body': 'review'}]]]


COMMENT_ENDPOINTS = ((2, 'issueComments', 'created_at'),
                     (3, 'reviewComments', 'path'), (4, 'reviews', 'state'))


MISSING = object()


def consumed_defects():
    # Each row starts from a valid surrounding fixture, then changes one field.
    for scope, fields in (('files', ('filename', 'status', 'additions', 'deletions')),
                          ('pr', ('title', 'state', 'additions', 'deletions',
                                  'changed_files', 'merge_commit_sha'))):
        for field in fields:
            bad_values = [MISSING, None, True, False, [], {}]
            if field in ('additions', 'deletions', 'changed_files'):
                bad_values += ['one', '0', 1.0, float('nan'), float('inf')]
            else:
                bad_values += [7]
            if field == 'merge_commit_sha':
                bad_values.remove(None)
            if field == 'changed_files':
                bad_values += [-1]
            if field == 'filename':
                bad_values += ['']
            if field == 'state':
                bad_values += ['unavailable']
            for bad in bad_values:
                yield scope, field, bad


def alter_field(row, field, bad):
    if bad is MISSING:
        del row[field]
    else:
        row[field] = bad


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
        for position, bad, diagnostic in [(1, {'filename': None, 'status': 'modified', 'additions': 1, 'deletions': 0}, 'file name'),
                                          (2, {'body': {}, 'user': None, 'created_at': '2026-10-15T00:00:00Z'}, 'comment body'),
                                          (3, {'body': 'text', 'user': 'bad-author', 'path': 'file.ts'}, 'comment author')]:
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


    def test_required_comment_fields_are_not_invented(self):
        for position, name, extra in COMMENT_ENDPOINTS:
            for field in ('body', 'user', extra, 'all'):
                values = payloads()
                row = values[position][0][0]
                if field == 'all':
                    row.clear()
                else:
                    del row[field]
                diagnostic = 'body' if field == 'all' else 'author' if field == 'user' else field
                with self.subTest(endpoint=name, missing=field):
                    with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                        with self.assertRaisesRegex(collector.CollectionError, 'malformed comment ' + diagnostic,
                                                   msg='missing comment fields must be refused before projection'):
                            collector.collect(3699)

    def test_nested_comment_authors_are_refused_before_signing(self):
        for position, name, _ in COMMENT_ENDPOINTS:
            for author in ({}, {'login': 7}, {'login': None}, {'login': {}}, {'login': []}, {'login': True}):
                values = payloads()
                values[position][0][0]['user'] = author
                with self.subTest(endpoint=name, author=author):
                    with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                        with patch.object(collector, 'digest', wraps=collector.digest) as sign:
                            with self.assertRaisesRegex(collector.CollectionError, 'malformed comment author',
                                                       msg='nested author must be refused before signing'):
                                collector.collect(3699)
                            sign.assert_not_called()

    def test_comment_field_types_are_refused(self):
        for position, name, extra in COMMENT_ENDPOINTS:
            for field in ('body', extra):
                for bad in (None, 7, {}, [], True):
                    values = payloads()
                    values[position][0][0][field] = bad
                    with self.subTest(endpoint=name, field=field, value=bad):
                        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                            with self.assertRaisesRegex(collector.CollectionError, 'malformed comment ' + field,
                                                       msg='comment fields must retain their declared string type'):
                                collector.collect(3699)

    def test_projected_cache_rows_are_validated_even_with_new_digest(self):
        record, _ = self.collect()
        for _, name, extra in COMMENT_ENDPOINTS:
            for field, bad in [('user', 7), ('user', {}), ('body', None), (extra, None)]:
                broken = copy.deepcopy(record)
                broken[name][0][field] = bad
                broken['receiptSha256'] = collector.digest(broken)
                with self.subTest(endpoint=name, field=field, value=bad):
                    self.assertFalse(collector.valid_cache(broken, 3699),
                                     'malformed projected cache row must be rejected despite matching digest')
            for field in ('user', 'body', extra):
                broken = copy.deepcopy(record)
                del broken[name][0][field]
                broken['receiptSha256'] = collector.digest(broken)
                with self.subTest(endpoint=name, missing=field):
                    self.assertFalse(collector.valid_cache(broken, 3699),
                                     'missing projected cache field must be rejected despite matching digest')

    def test_prior_v2_policy_is_not_reused(self):
        record, _ = self.collect()
        for policy in (None, 'obsolete'):
            broken = copy.deepcopy(record)
            if policy is None:
                del broken['collection']['commentRowPolicy']
            else:
                broken['collection']['commentRowPolicy'] = policy
            broken['receiptSha256'] = collector.digest(broken)
            self.assertFalse(collector.valid_cache(broken, 3699),
                             'prior v2 receipt must refresh under the explicit comment policy')

    def test_bad_v2_failed_refresh_preserves_bytes_without_success(self):
        record, _ = self.collect()
        for position, name, extra in COMMENT_ENDPOINTS:
            for defect in ('missing', 'author'):
                old = copy.deepcopy(record)
                del old['collection']['commentRowPolicy']
                old[name] = ([{'user': None, 'body': '', extra: None}] if defect == 'missing' else
                             [{'user': 7, 'body': 'old malformed', extra: 'retained'}])
                old['collection']['endpointCounts'][name] = 1
                old['receiptSha256'] = collector.digest(old)
                with self.subTest(endpoint=name, defect=defect), tempfile.TemporaryDirectory() as directory:
                    root = self.root(directory)
                    path = root/'pr-details/3699.json'
                    original = (json.dumps(old, indent=1) + '\n').encode()
                    path.write_bytes(original)
                    values = payloads()
                    values[position][0] = [{}] if defect == 'missing' else [
                        {**values[position][0][0], 'user': {'login': 7}}]
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]) as run:
                            with self.assertRaisesRegex(collector.CollectionError, 'malformed comment',
                                                       msg='bad v2 cache must attempt and refuse malformed refresh'):
                                collector.main(root)
                    self.assertEqual(run.call_count, 5, 'invalid cache must refetch all five endpoints')
                    self.assertTrue(path.exists(), 'malformed refresh must preserve historical path')
                    self.assertEqual(path.read_bytes(), original, 'malformed refresh must preserve old bytes')
                    self.assertEqual(output.getvalue(), '', 'malformed refresh must not claim fresh success')
                    self.assertEqual(list(path.parent.glob('*.tmp')), [])
                    with contextlib.redirect_stdout(io.StringIO()):
                        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in payloads()]):
                            collector.main(root)
                    self.assertTrue(collector.valid_cache(json.loads(path.read_text()), 3699),
                                    'valid retry must replace bad v2 with a validated receipt')

    def test_actual_full_text_reads_valid_deleted_and_empty_rows(self):
        values = payloads()
        for position, name, extra in COMMENT_ENDPOINTS:
            metadata = {'created_at': '2026-10-15T00:00:00Z', 'path': 'file-189.ts', 'state': 'COMMENTED'}[extra]
            values[position] = [[
                {'user': {'login': 'human-' + name}, 'body': 'kept-' + name, extra: metadata},
                {'user': None, 'body': 'deleted-' + name, extra: metadata},
                {'user': {'login': 'empty-' + name}, 'body': '', extra: metadata},
            ]]
        values[2][0][0]['body'] += 'x' * 5000
        values[3][0][0]['body'] += 'y' * 3000
        values[4][0][0]['body'] += 'z' * 3000
        with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
            try:
                record = collector.collect(3699)
            except collector.CollectionError as error:
                self.fail('deleted authors must remain collectable; empty review bodies must remain collectable: ' + str(error))
        with tempfile.TemporaryDirectory() as directory:
            root = self.root(directory)
            collector.publish(root/'pr-details/3699.json', record)
            corpus = {'number': 3699, 'title': 'Synthetic consumer PR', 'state': 'closed',
                      'merged_at': None, 'body': 'Synthetic complete body'}
            (root/'pull-requests.jsonl').write_text(json.dumps(corpus) + '\n')
            reader = Path(__file__).with_name('full_text.py')
            result = subprocess.run([sys.executable, '-I', '-B', str(reader), str(root)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, 'actual full_text.py must read valid/deleted/empty rows: ' + result.stderr)
            text = (root/'scratch/full/batch-01.txt').read_text()
            for _, name, _ in COMMENT_ENDPOINTS:
                self.assertIn('kept-' + name, text, 'actual reader must retain human comment text')
                self.assertIn('deleted-' + name, text, 'actual reader must retain deleted-author text')
            self.assertIn('file-189.ts(+1/-0)', text)
            self.assertEqual(json.loads((root/'scratch/full/manifest.json').read_text()), {'3699': 1})

        self.assertTrue(collector.valid_cache(record, 3699), 'valid deleted authors and empty bodies must remain reusable')
        for _, name, _ in COMMENT_ENDPOINTS:
            self.assertIsNone(record[name][1]['user'], 'deleted authors must retain null identity')
            self.assertEqual(record[name][2]['body'], '', 'empty review bodies must remain empty strings')
            self.assertEqual(len(record[name][0]['body']), 4000 if name == 'issueComments' else 2500,
                             'reader text must retain existing truncation limits')


    def test_consumed_source_fields_are_refused_before_signing(self):
        for scope, field, bad in consumed_defects():
            values = payloads()
            row = values[1][0][0] if scope == 'files' else values[0]
            alter_field(row, field, bad)
            with self.subTest(scope=scope, field=field, bad=repr(bad)):
                with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                    with patch.object(collector, 'digest', wraps=collector.digest) as sign:
                        with self.assertRaisesRegex(collector.CollectionError, 'malformed (file|PR)',
                                                   msg='malformed consumed source field must refuse before signing'):
                            collector.collect(3699)
                        sign.assert_not_called()

    def test_consumed_cache_fields_refuse_even_with_recomputed_digest(self):
        record, _ = self.collect()
        for scope, field, bad in consumed_defects():
            broken = copy.deepcopy(record)
            alter_field(broken['files'][0] if scope == 'files' else broken['pr'], field, bad)
            broken['receiptSha256'] = collector.digest(broken)
            with self.subTest(scope=scope, field=field, bad=repr(bad)):
                self.assertFalse(collector.valid_cache(broken, 3699),
                                 'malformed consumed cache field must refuse despite recomputed digest')
        broken = copy.deepcopy(record)
        broken['pr'] = None
        broken['receiptSha256'] = collector.digest(broken)
        self.assertFalse(collector.valid_cache(broken, 3699), 'missing PR projection must refuse')

    def test_prior_consumed_projection_policy_requires_refresh(self):
        record, _ = self.collect()
        for policy in (MISSING, None, 'obsolete'):
            broken = copy.deepcopy(record)
            alter_field(broken['collection'], 'consumedProjectionPolicy', policy)
            # Old projection erased missing merge SHA into valid-looking null.
            broken['pr']['merge_commit_sha'] = None
            broken['receiptSha256'] = collector.digest(broken)
            self.assertFalse(collector.valid_cache(broken, 3699),
                             'prior consumed projection policy must refresh erased distinctions')

    def test_consumed_bad_refresh_preserves_history_and_recovers(self):
        record, _ = self.collect()
        for scope, field, bad in consumed_defects():
            with self.subTest(scope=scope, field=field, bad=repr(bad)), tempfile.TemporaryDirectory() as directory:
                root = self.root(directory)
                old = copy.deepcopy(record)
                alter_field(old['files'][0] if scope == 'files' else old['pr'], field, bad)
                old['receiptSha256'] = collector.digest(old)
                path = root/'pr-details/3699.json'
                original = (json.dumps(old, indent=1) + '\n').encode()
                path.write_bytes(original)
                values = payloads()
                alter_field(values[1][0][0] if scope == 'files' else values[0], field, bad)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                        with self.assertRaisesRegex(collector.CollectionError, 'malformed (file|PR)',
                                                   msg='malformed source must refuse refresh before publication'):
                            collector.main(root)
                self.assertTrue(path.exists(), 'consumed refusal must preserve historical path')
                self.assertEqual(path.read_bytes(), original, 'consumed refusal must preserve historical bytes')
                self.assertEqual(output.getvalue(), '', 'consumed refusal must print no success line')
                self.assertEqual(list(path.parent.glob('*.tmp')), [])
                with contextlib.redirect_stdout(io.StringIO()):
                    with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in payloads()]) as run:
                        collector.main(root)
                self.assertEqual(run.call_count, 5, 'recovery must collect all endpoints')
                self.assertNotEqual(path.read_bytes(), original, 'recovery must replace malformed bytes')
                self.assertTrue(collector.valid_cache(json.loads(path.read_text()), 3699),
                                'recovery must publish a current valid receipt')

    def test_actual_both_readers_accept_zero_ordinary_deleted_empty(self):
        for count in (0, 3):
            values = payloads()
            for row in [values[0]] + values[1][0] + values[1][1]:
                row['additions'] = count
                row['deletions'] = count
            values[0]['changed_files'] = count
            values[0]['merge_commit_sha'] = None if count == 0 else 'synthetic-sha'
            for position, _, _ in COMMENT_ENDPOINTS:
                values[position][0][0]['user'] = None
                values[position][0].append({**values[position][0][0], 'body': ''})
            with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                try:
                    record = collector.collect(3699)
                except collector.CollectionError as error:
                    self.fail('valid zero/ordinary counts and deleted/empty comments must collect: ' + str(error))
            self.assertTrue(collector.valid_cache(record, 3699), 'valid zero counts must remain reusable')
            with tempfile.TemporaryDirectory() as directory:
                root = self.root(directory)
                collector.publish(root/'pr-details/3699.json', record)
                (root/'pull-requests.jsonl').write_text(json.dumps({
                    'number': 3699, 'title': 'Synthetic both readers', 'state': 'closed',
                    'body': 'Synthetic complete body', 'merged_at': None}) + '\n')
                for reader_name in ('digest.py', 'full_text.py'):
                    args = [sys.executable, '-I', '-B', str(Path(__file__).with_name(reader_name)), str(root)]
                    if reader_name == 'digest.py':
                        args.append('3699')
                    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, 'both actual readers must accept valid zero/ordinary data: ' + result.stderr)
                    text = result.stdout if reader_name == 'digest.py' else (root/'scratch/full/batch-01.txt').read_text()
                    self.assertIn('file-0.ts(+' + str(count), text, 'both readers must retain actual file counts')
                    self.assertIn('issue-one', text, 'both readers must retain deleted-author text')
                    self.assertIn('review-comment', text, 'both readers must retain deleted review text')

    def test_actual_readers_expose_historical_malformed_input_after_refusal(self):
        cases = [('additions', 'one', 1, 0), ('filename', MISSING, 1, 1),
                 ('deletions', MISSING, 0, 1)]
        for field, bad, digest_exit, full_exit in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = self.root(directory)
                path = root/'pr-details/3699.json'
                values = payloads()
                alter_field(values[1][0][0], field, bad)
                with patch.object(collector.subprocess, 'run', side_effect=[response(p) for p in values]):
                    with self.assertRaises(collector.CollectionError,
                                           msg='malformed source cannot publish before actual reader probe'):
                        collector.main(root)
                self.assertFalse(path.exists(), 'malformed source must not publish reader input')
                # Bypass publication only to measure unchanged historical readers.
                record, _ = self.collect()
                alter_field(record['files'][0], field, bad)
                path.write_text(json.dumps(record))
                (root/'pull-requests.jsonl').write_text(json.dumps({
                    'number': 3699, 'title': 'Synthetic malformed history', 'state': 'closed',
                    'body': 'Synthetic', 'merged_at': None}) + '\n')
                for name, expected in (('digest.py', digest_exit), ('full_text.py', full_exit)):
                    args = [sys.executable, '-I', '-B', str(Path(__file__).with_name(name)), str(root)]
                    if name == 'digest.py':
                        args.append('3699')
                    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, expected,
                                     'actual historical reader behavior must remain visible: ' + result.stderr)
                    if expected:
                        self.assertIn('TypeError' if field == 'additions' else 'KeyError', result.stderr,
                                      'reader failure must identify malformed input')



if __name__ == '__main__':
    unittest.main()
