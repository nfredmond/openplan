"""Private supplied metadata records, without transport or permission claims."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import hashlib
import json
import shutil
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

import retained_task_observation as module
from retained_source import json_bytes, writer
import test_task_observation as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        fixtures.Checks.setUp(self)
        self.records_root = self.fixture.base / 'observation-records'
        self.records_root.mkdir(mode=0o700)
    tearDown = fixtures.Checks.tearDown

    def store(self, root=None, plan=None, records_root=None, **kwargs):
        return module.Observations(self.fixture.root if root is None else root,
                                   self.plan if plan is None else plan,
                                   records_root=self.records_root if records_root is None else records_root, **kwargs)

    def body(self):
        return json.dumps(self.value, indent=2).encode() + b'\n'

    def saved(self, result):
        return self.records_root / (result['bodySha256'] + '.json')

    def change_saved(self, result, change):
        path = self.saved(result)
        value = json.loads(path.read_bytes())
        change(value)
        path.write_bytes(json_bytes(value))

    def test_exact_bytes_reopen_after_private_root_copy(self):
        store = self.store()
        result = store.record(200, self.body())
        original = self.saved(result).read_bytes()
        target = self.fixture.base / 'relocated-observations'
        shutil.copytree(self.fixture.root, target)
        copied_records = self.fixture.base / 'copied-records'
        shutil.copytree(self.records_root, copied_records)
        self.assertEqual(self.store(target, records_root=copied_records).load(result['bodySha256']), result,
                         'Copied root must retain the exact checked observation')
        self.assertEqual(self.saved(result).read_bytes(), original,
                         'Reopening must leave the original record unchanged')

    def test_equal_reply_replay_keeps_original_record_inode_and_bytes(self):
        store = self.store()
        result = store.record(200, self.body())
        path = self.saved(result)
        original = path.read_bytes()
        inode = path.stat().st_ino
        self.assertEqual(store.record(200, self.body()), result)
        self.assertEqual(path.stat().st_ino, inode, 'Equal replay must keep the original inode')
        self.assertEqual(path.read_bytes(), original, 'Equal replay must keep original record bytes')

    def test_different_raw_spellings_remain_separate_records(self):
        store = self.store()
        first = store.record(200, self.body())
        second = store.record(200, json.dumps(self.value).encode())
        self.assertNotEqual(first['bodySha256'], second['bodySha256'],
                            'Distinct reply spellings cannot collapse to one original')
        self.assertEqual(store.load(first['bodySha256']), first)
        self.assertEqual(store.load(second['bodySha256']), second)

    def test_changed_existing_record_cannot_be_overwritten_by_replay(self):
        store = self.store()
        result = store.record(200, self.body())
        self.change_saved(result, lambda v: v.update(publicationPermission=True))
        before = self.saved(result).read_bytes()
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            store.record(200, self.body())
        self.assertEqual(self.saved(result).read_bytes(), before)

    def test_saved_interpretation_and_permissions_are_recomputed(self):
        store = self.store()
        result = store.record(200, self.body())
        original = self.saved(result).read_bytes()
        for change in ({'publicationPermission': True}, {'transportPermission': True},
                       {'processingQualityVerification': 'verified'},
                       {'reportedState': 'completed'}, {'bodyBytes': 0},
                       {'originalPlanSha256': '0' * 64}, {'extra': True}):
            with self.subTest(change=change):
                self.change_saved(result, lambda v: v.update(change))
                with self.assertRaisesRegex(ValueError, 'interpretation differs'):
                    store.load(result['bodySha256'])
                self.saved(result).write_bytes(original)

    def test_changed_response_body_cannot_reuse_the_original_digest(self):
        store = self.store()
        result = store.record(200, self.body())
        changed = json.dumps({**self.value, 'progress': 0}).encode()
        self.saved(result).write_bytes(json_bytes(module.observe(self.plan, 200, changed)))
        with self.assertRaisesRegex(ValueError, 'body digest differs'):
            store.load(result['bodySha256'])

    def test_missing_or_invalid_saved_body_refuses(self):
        store = self.store()
        result = store.record(200, self.body())
        original = self.saved(result).read_bytes()
        for value in (None, 1, '%%%', 'é'):
            self.change_saved(result, lambda v: v.update(bodyBase64=value))
            with self.assertRaisesRegex(ValueError, 'body differs'):
                store.load(result['bodySha256'])
            self.saved(result).write_bytes(original)
        self.change_saved(result, lambda v: v.pop('bodyBase64'))
        with self.assertRaisesRegex(ValueError, 'body differs'):
            store.load(result['bodySha256'])

    def test_changed_plan_refuses_before_record_or_load(self):
        store = self.store()
        result = store.record(200, self.body())
        changed = copy.deepcopy(self.plan)
        changed['name'] += '-changed'
        (self.fixture.root / 'plan.json').write_bytes(json_bytes(changed))
        for operation in (lambda: store.record(200, self.body()),
                          lambda: store.load(result['bodySha256']), lambda: self.store()):
            with self.assertRaisesRegex(ValueError, 'original plan differs'):
                operation()

    def test_plan_is_detached_from_constructor_input(self):
        plan = copy.deepcopy(self.plan)
        store = self.store(plan=plan)
        plan['name'] = 'changed-after-construction'
        result = store.record(200, self.body())
        self.assertEqual(result['originalPlanSha256'], hashlib.sha256(json_bytes(self.plan)).hexdigest(),
                         'Constructor input must not alias the saved original plan')

    def test_missing_root_or_plan_is_not_provisioned(self):
        root = self.fixture.base / 'missing-root'
        with self.assertRaises(FileNotFoundError):
            self.store(root)
        self.assertFalse(root.exists(), 'Reading observations cannot provision a missing engine root')
        (self.fixture.root / 'plan.json').unlink()
        with self.assertRaises(FileNotFoundError):
            self.store()

    def test_invalid_original_plan_refuses_even_when_saved_bytes_match(self):
        changed = copy.deepcopy(self.plan)
        changed['sourceManifestSha256'] = 'invalid'
        (self.fixture.root / 'plan.json').write_bytes(json_bytes(changed))
        with self.assertRaisesRegex(ValueError, 'Original engine plan shape'):
            self.store(plan=changed)

    def test_record_root_must_be_separate_from_the_engine_tree(self):
        for root in (self.fixture.root, self.fixture.base, self.fixture.root / 'nested-records'):
            if not root.exists():
                root.mkdir(mode=0o700)
            with self.assertRaisesRegex(ValueError, 'separate from engine commands'):
                self.store(records_root=root)

    def test_missing_record_root_is_not_provisioned(self):
        root = self.fixture.base / 'missing-record-root'
        with self.assertRaises(FileNotFoundError):
            self.store(records_root=root)
        self.assertFalse(root.exists(), 'Missing metadata recovery root cannot be commissioned by a read')

    def test_original_ledger_plan_is_required_when_records_exist(self):
        store = self.store()
        result = store.record(200, self.body())
        (self.records_root / 'plan.json').unlink()
        for call in (lambda: self.store(), lambda: store.record(200, self.body()),
                     lambda: store.load(result['bodySha256'])):
            with self.assertRaisesRegex(ValueError, 'ledger plan is missing'):
                call()

    def test_changed_ledger_plan_refuses_without_replacing_originals(self):
        store = self.store()
        result = store.record(200, self.body())
        changed = copy.deepcopy(self.plan)
        changed['name'] += '-changed'
        (self.records_root / 'plan.json').write_bytes(json_bytes(changed))
        original = self.saved(result).read_bytes()
        with self.assertRaisesRegex(ValueError, 'ledger plan differs'):
            store.load(result['bodySha256'])
        self.assertEqual(self.saved(result).read_bytes(), original)

    def test_engine_journal_remains_usable_without_added_paths(self):
        before = {p.name for p in self.fixture.root.iterdir()}
        store = self.store()
        store.record(200, self.body())
        self.assertEqual({p.name for p in self.fixture.root.iterdir()}, before,
                         'Recording task metadata cannot change engine command paths')
        commands = self.fixture.open().snapshot()['commands']
        self.assertTrue(all(row['state'] == 'unissued' for row in commands),
                        'Metadata records cannot alter engine command intent states')

    def test_alternate_and_duplicate_key_record_encoding_refuses(self):
        store = self.store()
        result = store.record(200, self.body())
        canonical = self.saved(result).read_bytes()
        for raw in (json.dumps(result, indent=2).encode(),
                    b'{"publicationPermission":true,' + canonical[1:]):
            self.saved(result).write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'encoding differs'):
                store.load(result['bodySha256'])

    def test_alias_and_public_root_refuse(self):
        alias = self.fixture.base / 'root-alias'
        alias.symlink_to(self.fixture.root)
        with self.assertRaisesRegex(ValueError, 'without aliases'):
            self.store(alias)
        self.fixture.root.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'private'):
            self.store()

    def test_unsafe_observation_directory_and_record_refuse(self):
        store = self.store()
        result = store.record(200, self.body())
        folder = self.records_root
        folder.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'private'):
            store.load(result['bodySha256'])
        folder.chmod(0o700)
        self.saved(result).chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private'):
            store.load(result['bodySha256'])

    def test_digest_is_checked_before_any_record_path_read(self):
        store = self.store()
        store.record(200, self.body())
        for digest in ('0' * 63, 'A' * 64, '../plan', '0' * 64 + '/other', None, True):
            with patch.object(module, 'reader', side_effect=AssertionError('Invalid digest reached record read')):
                with self.assertRaisesRegex(ValueError, 'digest differs'):
                    store.load(digest)

    def test_invalid_reply_does_not_write_observation_root(self):
        store = self.store()
        with self.assertRaisesRegex(ValueError, 'response status'):
            store.record(201, self.body())
        self.assertEqual(list(self.records_root.iterdir()), [], 'Invalid replies cannot write the separate metadata root')

    def test_invalid_timeout_and_shared_deadline_refuse(self):
        for timeout in (True, None, 0, -1, float('inf'), float('nan'), 10 ** 400):
            with self.assertRaisesRegex(ValueError, 'timeout'):
                self.store(timeout=timeout)
        store = self.store()
        for deadline in (True, 'later', float('inf'), float('nan'), 10 ** 400):
            with self.assertRaisesRegex(ValueError, 'shared deadline'):
                store.record(200, self.body(), deadline=deadline)

    def test_shared_deadline_is_never_extended(self):
        store = self.store(timeout=60)
        supplied = time.monotonic() + 1
        self.assertEqual(store._deadline(supplied), supplied,
                         'Nested observation deadline must retain the actual earlier bound')
        with self.assertRaisesRegex(TimeoutError, 'deadline exceeded'):
            store.record(200, self.body(), deadline=time.monotonic() - 1)

    def test_record_and_load_size_limits_precede_publication_and_json_parse(self):
        store = self.store()
        with patch.object(module, 'RECORD_LIMIT', 10):
            with self.assertRaisesRegex(ValueError, 'record bound'):
                store.record(200, self.body())
        result = store.record(200, self.body())
        payload = self.saved(result).read_bytes()
        original_loads = json.loads
        def bounded_json(value, *args, **kwargs):
            if value == payload:
                raise AssertionError('Oversized observation reached JSON parsing')
            return original_loads(value, *args, **kwargs)
        with patch.object(module, 'RECORD_LIMIT', 10), patch.object(module.json, 'loads', side_effect=bounded_json):
            with self.assertRaisesRegex(ValueError, 'record bound'):
                store.load(result['bodySha256'])

    def test_actual_lock_contention_retains_the_deadline(self):
        store = self.store(timeout=10)
        result = store.record(200, self.body())
        with writer(self.records_root, time.monotonic() + 1):
            with self.assertRaisesRegex(TimeoutError, 'deadline exceeded'):
                store.record(200, self.body(), deadline=time.monotonic() + 2)
        self.assertEqual(store.load(result['bodySha256']), result)

    def test_concurrent_equal_records_retain_one_exact_reply(self):
        store = self.store()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: store.record(200, self.body()), range(2)))
        self.assertEqual(results[0], results[1])
        records = [p for p in self.records_root.glob('*.json') if p.name != 'plan.json']
        self.assertEqual(len(records), 1, 'Concurrent equal replies must retain one original record')
        self.assertEqual(store.load(results[0]['bodySha256']), results[0])

    def _initial_publication_contender(self, construct):
        store = self.store(timeout=10)
        partial_ready = threading.Event()
        contender_ready = threading.Event()
        release = threading.Event()
        rename = Path.rename
        lock = module.writer

        def paused_rename(path, target):
            if target == self.records_root / 'plan.json':
                partial_ready.set()
                if not release.wait(5):
                    raise AssertionError('Initial plan publication was not released')
            return rename(path, target)

        @contextmanager
        def observed_writer(root, deadline):
            if partial_ready.is_set() and not release.is_set():
                contender_ready.set()
            with lock(root, deadline):
                yield

        def contender():
            current = self.store(timeout=10) if construct else store
            return current.record(200, self.body())

        with patch.object(Path, 'rename', side_effect=paused_rename, autospec=True), \
                patch.object(module, 'writer', side_effect=observed_writer), \
                ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(store.record, 200, self.body())
            try:
                self.assertTrue(partial_ready.wait(5), 'Actual private plan temporary file must reach publication')
                self.assertTrue(list(self.records_root.glob('.partial-*')),
                                'The contender must encounter actual in-progress plan bytes')
                second = pool.submit(contender)
                second.add_done_callback(lambda _: contender_ready.set())
                self.assertTrue(contender_ready.wait(5), 'The contender must reach validation or its writer lock')
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5), second.result(timeout=5),
                             'Initial publication contenders must retain the same exact reply')
        self.assertEqual(store.load(hashlib.sha256(self.body()).hexdigest()), first.result())

    def test_record_waits_for_initial_plan_publication(self):
        self._initial_publication_contender(False)

    def test_constructor_waits_for_initial_plan_publication(self):
        self._initial_publication_contender(True)

    def test_directory_sync_failure_recovers_the_original_published_record(self):
        store = self.store()
        store.record(200, self.body())
        other = json.dumps(self.value).encode()
        import retained_source
        original_sync = retained_source.synchronize
        target = self.records_root / (hashlib.sha256(other).hexdigest() + '.json')
        def lost_reply_sync(root):
            if target.exists():
                raise OSError('Synthetic sync loss')
            return original_sync(root)
        with patch.object(retained_source, 'synchronize', side_effect=lost_reply_sync):
            with self.assertRaisesRegex(OSError, 'Synthetic sync loss'):
                store.record(200, other)
        result = store.record(200, other)
        self.assertEqual(store.load(result['bodySha256']), result,
                         'Interrupted publication must recover the original exact reply')

    def test_late_published_record_remains_but_acknowledgment_refuses(self):
        store = self.store()
        original_time = time.monotonic
        original_publish = module.publish
        late = False
        def delayed_publish(*args, **kwargs):
            nonlocal late
            original_publish(*args, **kwargs)
            late = True
        with patch.object(module, 'publish', side_effect=delayed_publish), \
             patch.object(module.time, 'monotonic', side_effect=lambda: original_time() + (10 if late else 0)):
            with self.assertRaisesRegex(TimeoutError, 'deadline exceeded'):
                store.record(200, self.body())
        result = module.observe(self.plan, 200, self.body())
        self.assertEqual(store.load(result['bodySha256']), result,
                         'Late publication must retain its original bytes without a success acknowledgment')

    def test_reopened_views_keep_denied_permissions_and_independent_bytes(self):
        store = self.store()
        result = store.record(200, self.body())
        digest = result['bodySha256']
        original = self.saved(result).read_bytes()
        result['publicationPermission'] = True
        result['engine']['instanceId'] = 'changed'
        loaded = store.load(digest)
        self.assertIs(loaded['publicationPermission'], False,
                      'Reopened observations must keep publication denied')
        loaded['requestedOptions'].clear()
        self.assertEqual(self.saved({ 'bodySha256': digest }).read_bytes(), original,
                         'Returned views cannot rewrite retained private metadata')


if __name__ == '__main__':
    unittest.main()
