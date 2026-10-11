"""Real private SQLite admission/start custody; no worker or engine execution."""
from contextlib import closing
import copy
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

import admission_journal
from admission_journal import CREATE, FILENAME, IdentityConflict, Journal, QueueFull


def request(request_id='synthetic-admission-0001'):
    return {'requestId': request_id, 'externalRef': {'workspaceId': 'synthetic-workspace', 'missionId': 'synthetic-mission'},
            'imagery': {'url': 'http://127.0.0.1:1/synthetic-only'}, 'missionTitle': 'Synthetic admission'}


def factory(payload):
    reference = 'odm-' + uuid.uuid4().hex[:20]
    return reference, {'requestId': payload['requestId'], 'jobReference': reference, 'status': 'accepted',
                       'callbackId': str(uuid.uuid4()), 'occurredAt': 'synthetic-fixture-time'}


class Checks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='odm-admission-journal-')
        self.base = Path(self.directory.name)
        self.root = self.base/'root'
        self.journal = Journal(self.root)

    def tearDown(self):
        self.directory.cleanup()

    def admit(self, payload=None, capacity=1):
        return self.journal.admit(payload or request(), factory, max_queued=capacity)

    def alter(self, statement, args=()):
        with closing(sqlite3.connect(self.root/FILENAME)) as connection, connection:
            connection.execute(statement, args)

    def test_committed_admission_survives_reopen(self):
        first, created = self.admit()
        self.assertIsNotNone(first, 'admission must be durably reread')
        self.assertTrue(created, 'new admission must report creation')
        reopened = Journal(self.root).get(request()['requestId'])
        self.assertEqual(first, reopened, 'reopen must retain the complete original admission')

    def test_exact_replay_precedes_capacity(self):
        first, _ = self.admit()
        def no_factory(_payload):
            raise AssertionError('replay must not call a new admission factory')
        replay, created = self.journal.admit(dict(reversed(list(request().items()))), no_factory, max_queued=0)
        self.assertFalse(created, 'replay must not grant a new admission')
        self.assertEqual(first, replay, 'replay must retain original request and receipt')

    def test_changed_payload_conflicts(self):
        first, _ = self.admit()
        changed = request()
        changed['externalRef']['workspaceId'] = 'another-workspace'
        with self.assertRaisesRegex(IdentityConflict, 'request identity already exists'):
            self.admit(changed)
        self.assertEqual(first, self.journal.get(request()['requestId']))

    def test_changed_source_url_conflicts(self):
        self.admit()
        changed = request()
        changed['imagery']['url'] = 'http://127.0.0.1:1/changed-source'
        with self.assertRaisesRegex(IdentityConflict, 'request identity already exists'):
            self.admit(changed)

    def test_queue_ceiling_is_atomic(self):
        self.admit()
        with self.assertRaisesRegex(QueueFull, 'pending admission queue is full'):
            self.admit(request('synthetic-admission-0002'))
        self.assertEqual(len(self.journal.accepted()), 1, 'capacity refusal must not insert another row')

    def test_zero_queue_rejects_new_work(self):
        with self.assertRaisesRegex(QueueFull, 'pending admission queue is full'):
            self.admit(capacity=0)

    def test_invalid_queue_ceiling(self):
        for value in (-1, True, 1.5, '1'):
            with self.assertRaisesRegex(ValueError, 'queue ceiling is invalid'):
                self.admit(capacity=value)
        self.assertFalse(self.root.exists(), 'invalid ceiling must not create a journal')

    def test_invalid_request_id(self):
        for value in ('short', 'x'*129, None, 123):
            with self.assertRaisesRegex(ValueError, 'request ID is invalid'):
                self.admit({'requestId': value})
        with self.assertRaisesRegex(ValueError, 'request ID is invalid'):
            self.journal.admit([], factory, max_queued=1)

    def test_non_json_request_is_not_saved(self):
        bad = request()
        bad['unsafe'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'Out of range float'):
            self.admit(bad)
        self.assertFalse(self.root.exists(), 'non-JSON request must not create a journal')

    def test_factory_identity_guard(self):
        def wrong(payload):
            reference, receipt = factory(payload)
            receipt['requestId'] = 'another-request'
            return reference, receipt
        with self.assertRaisesRegex(ValueError, 'factory identity differs'):
            self.journal.admit(request(), wrong, max_queued=1)
        self.assertEqual(self.journal.accepted(), [], 'bad factory must not commit an admission')

    def test_factory_reference_guard(self):
        def wrong(payload):
            reference, receipt = factory(payload)
            receipt['jobReference'] = 'another-reference'
            return reference, receipt
        with self.assertRaisesRegex(ValueError, 'factory identity differs'):
            self.journal.admit(request(), wrong, max_queued=1)

    def test_factory_status_guard(self):
        def wrong(payload):
            reference, receipt = factory(payload)
            receipt['status'] = 'succeeded'
            return reference, receipt
        with self.assertRaisesRegex(ValueError, 'factory identity differs'):
            self.journal.admit(request(), wrong, max_queued=1)

    def test_factory_exception_rolls_back(self):
        def interrupted(_payload):
            raise RuntimeError('synthetic interrupted factory')
        with self.assertRaisesRegex(RuntimeError, 'synthetic interrupted factory'):
            self.journal.admit(request(), interrupted, max_queued=1)
        self.assertEqual(self.journal.accepted(), [])

    def test_commit_directory_error_replays_original_admission(self):
        saved=[]
        calls=[]
        original=admission_journal.synchronize
        def observed(path):
            calls.append(path)
            if saved:
                raise OSError('synthetic directory sync failed after commit')
            original(path)
        def recorded(payload):
            reference,receipt=factory(payload)
            saved.append(receipt)
            return reference,receipt
        with patch('admission_journal.synchronize',side_effect=observed):
            with self.assertRaisesRegex(OSError,'directory sync failed after commit'):
                self.journal.admit(request(),recorded,max_queued=1)
        replay,created=self.journal.admit(request(),lambda _payload: self.fail('uncertain admission must not run another factory'),max_queued=0)
        self.assertFalse(created)
        self.assertEqual(replay.admission,saved[0],'directory acknowledgment loss must preserve the committed admission')

    def test_start_directory_error_retains_original_intent(self):
        admission,_=self.admit()
        with patch('admission_journal.synchronize',side_effect=OSError('synthetic start directory sync failed')):
            with self.assertRaisesRegex(OSError,'start directory sync failed'):
                self.journal.start(request()['requestId'],admission.job_reference,{'attempt':'original'})
        repeated,permission=self.journal.start(request()['requestId'],admission.job_reference,{'attempt':'original'})
        self.assertFalse(permission,'uncertain start commit must not grant another permission')
        self.assertEqual(repeated.started_context,{'attempt':'original'})

    def test_detached_request_and_receipt(self):
        payload = request()
        entry, _ = self.admit(payload)
        expected = copy.deepcopy(entry)
        payload['externalRef']['workspaceId'] = 'caller-mutated'
        self.assertEqual(entry.request, expected.request, 'caller mutation must not alter the returned request snapshot')
        entry.request['externalRef']['workspaceId'] = 'return-mutated'
        entry.admission['callbackId'] = 'return-mutated'
        self.assertEqual(self.journal.get(request()['requestId']), expected, 'mutable caller and return objects must not rewrite the journal')

    def test_start_once_and_remove_from_accepted_queue(self):
        admission, _ = self.admit()
        started, permission = self.journal.start(request()['requestId'], admission.job_reference, {'stage': 'intake', 'attempt': 'original'})
        self.assertTrue(permission, 'first start must commit its permission')
        self.assertEqual(started.phase, 'started', 'start must cross a durable phase boundary')
        self.assertEqual(self.journal.accepted(), [], 'started work must never enter accepted restart queue')
        self.assertEqual(self.journal.started(), [started], 'started work must remain inspectable')
        self.admit(request('synthetic-admission-0002'))

    def test_exact_start_replay_does_not_grant_another_start(self):
        admission, _ = self.admit()
        first, _ = self.journal.start(request()['requestId'], admission.job_reference, {'stage': 'intake', 'attempt': 'original'})
        repeated, permission = Journal(self.root).start(request()['requestId'], admission.job_reference, {'attempt': 'original', 'stage': 'intake'})
        self.assertFalse(permission, 'start replay must not repeat uncertain external work')
        self.assertEqual(repeated, first, 'start replay must retain original context')

    def test_changed_start_context_conflicts(self):
        admission, _ = self.admit()
        self.journal.start(request()['requestId'], admission.job_reference, {'attempt': 'original'})
        with self.assertRaisesRegex(IdentityConflict, 'start intent already exists'):
            self.journal.start(request()['requestId'], admission.job_reference, {'attempt': 'replacement'})

    def test_wrong_or_missing_start_admission_conflicts(self):
        admission, _ = self.admit()
        with self.assertRaisesRegex(IdentityConflict, 'start does not match'):
            self.journal.start(request()['requestId'], 'another-reference', {})
        with self.assertRaisesRegex(IdentityConflict, 'start does not match'):
            self.journal.start('missing-request', admission.job_reference, {})

    def test_start_context_must_be_json_object(self):
        admission, _ = self.admit()
        with self.assertRaisesRegex(ValueError, 'start context must be an object'):
            self.journal.start(request()['requestId'], admission.job_reference, [])
        with self.assertRaisesRegex(ValueError, 'Out of range float'):
            self.journal.start(request()['requestId'], admission.job_reference, {'unsafe': float('nan')})

    def test_start_context_is_detached(self):
        admission, _ = self.admit()
        context = {'nested': {'attempt': 'original'}}
        started, _ = self.journal.start(request()['requestId'], admission.job_reference, context)
        context['nested']['attempt'] = 'caller-mutated'
        self.assertEqual(started.started_context, {'nested': {'attempt': 'original'}}, 'caller mutation must not alter the returned start snapshot')
        started.started_context['nested']['attempt'] = 'return-mutated'
        self.assertEqual(self.journal.started()[0].started_context, {'nested': {'attempt': 'original'}}, 'start context must remain immutable')

    def test_started_admission_replay_retains_original_receipt(self):
        admission, _ = self.admit()
        self.journal.start(request()['requestId'], admission.job_reference, {'attempt': 'original'})
        replay, created = self.admit()
        self.assertFalse(created)
        self.assertEqual(replay.admission, admission.admission, 'started replay must retain original receipt')

    def test_started_list_excludes_accepted(self):
        self.admit()
        self.assertEqual(self.journal.started(), [], 'accepted work must not appear as started')

    def test_all_sqlite_fields_and_phase_persist(self):
        admission, _ = self.admit()
        self.journal.start(request()['requestId'], admission.job_reference, {'attempt': 'original'})
        with closing(sqlite3.connect(self.root/FILENAME)) as connection:
            columns = [row[1] for row in connection.execute('PRAGMA table_info(admissions)')]
            row = connection.execute('SELECT request_id,request_json,job_reference,admission_json,phase,started_context_json FROM admissions').fetchone()
        self.assertEqual(columns, ['request_id','request_json','job_reference','admission_json','phase','started_context_json'])
        self.assertEqual(row[0], request()['requestId'])
        self.assertEqual(json.loads(row[1]), request())
        self.assertEqual(row[2], admission.job_reference)
        self.assertEqual(json.loads(row[3]), admission.admission)
        self.assertEqual(row[4], 'started')
        self.assertEqual(json.loads(row[5]), {'attempt':'original'})

    def test_stored_identity_corruption_is_rejected(self):
        self.admit()
        bad = request('another-request-identity')
        self.alter('UPDATE admissions SET request_json=?', (json.dumps(bad,sort_keys=True,separators=(',',':')),))
        with self.assertRaisesRegex(ValueError, 'Stored ODM admission identity differs'):
            self.journal.get(request()['requestId'])

    def test_stored_receipt_corruption_is_rejected(self):
        admission, _ = self.admit()
        bad = dict(admission.admission, jobReference='another-reference')
        self.alter('UPDATE admissions SET admission_json=?', (json.dumps(bad, separators=(',', ':')),))
        with self.assertRaisesRegex(ValueError, 'Stored ODM admission identity differs'):
            self.journal.get(request()['requestId'])

    def test_stored_start_corruption_is_rejected(self):
        self.admit()
        self.alter('UPDATE admissions SET started_context_json=?', ('{}',))
        with self.assertRaisesRegex(ValueError, 'Stored ODM start intent differs'):
            self.journal.get(request()['requestId'])

    def test_stored_receipt_encoding_must_match(self):
        admission, _ = self.admit()
        self.alter('UPDATE admissions SET admission_json=?', (json.dumps(admission.admission, indent=2),))
        with self.assertRaisesRegex(ValueError, 'admission encoding differs'):
            self.journal.get(request()['requestId'])

    def test_stored_receipt_nonfinite_json_refuses(self):
        admission, _ = self.admit()
        bad = dict(admission.admission, unknown=float('nan'))
        self.alter('UPDATE admissions SET admission_json=?', (json.dumps(bad, separators=(',', ':')),))
        with self.assertRaisesRegex(ValueError, 'Out of range float'):
            self.journal.get(request()['requestId'])

    def test_stored_context_encoding_must_match(self):
        admission, _ = self.admit()
        self.journal.start(request()['requestId'], admission.job_reference, {'attempt': 'original'})
        self.alter('UPDATE admissions SET started_context_json=?', ('{ "attempt": "original" }',))
        with self.assertRaisesRegex(ValueError, 'start context encoding differs'):
            self.journal.get(request()['requestId'])

    def test_stored_context_nonfinite_json_refuses(self):
        admission, _ = self.admit()
        self.journal.start(request()['requestId'], admission.job_reference, {})
        self.alter('UPDATE admissions SET started_context_json=?', ('{"unknown":NaN}',))
        with self.assertRaisesRegex(ValueError, 'Out of range float'):
            self.journal.get(request()['requestId'])

    def test_new_root_synchronizes_parent_before_database(self):
        original = admission_journal.synchronize
        observations = []
        def observed(path):
            observations.append((path, (self.root/FILENAME).exists()))
            original(path)
        with patch('admission_journal.synchronize', side_effect=observed):
            self.admit()
        self.assertEqual(observations[0], (self.base, False), 'new root must synchronize its parent before database creation')

    def test_unknown_phase_is_not_an_empty_queue(self):
        self.admit()
        with closing(sqlite3.connect(self.root/FILENAME)) as connection, connection:
            connection.execute('PRAGMA ignore_check_constraints=ON')
            connection.execute("UPDATE admissions SET phase='unrecognized'")
        with self.assertRaisesRegex(ValueError, 'Stored ODM start intent differs'):
            self.journal.accepted()

    def test_private_root_and_database(self):
        self.admit()
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root/FILENAME).stat().st_mode), 0o600)
        self.root.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.journal.get(request()['requestId'])

    def test_public_database_refuses(self):
        self.admit()
        (self.root/FILENAME).chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.journal.get(request()['requestId'])

    def test_root_symlink_refuses(self):
        target=self.base/'target';target.mkdir(mode=0o700)
        self.root.symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.admit()
        self.assertEqual(list(target.iterdir()), [], 'alias refusal must not create target files')

    def test_parent_symlink_refuses_before_creating_root(self):
        target=self.base/'target';target.mkdir(mode=0o700)
        alias=self.base/'alias';alias.symlink_to(target,target_is_directory=True)
        journal=Journal(alias/'child')
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            journal.admit(request(),factory,max_queued=1)
        self.assertEqual(list(target.iterdir()), [], 'parent alias refusal must precede root creation')

    def test_database_symlink_and_hardlink_refuse(self):
        self.root.mkdir(mode=0o700)
        target=self.base/'target';target.write_bytes(b'');target.chmod(0o600)
        database=self.root/FILENAME;database.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.admit()
        database.unlink();os.link(target,database)
        with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
            self.admit()
        self.assertEqual(target.read_bytes(), b'', 'linked file refusal must precede SQLite writes')

    def test_special_database_refuses(self):
        self.root.mkdir(mode=0o700)
        os.mkfifo(self.root/FILENAME,0o600)
        with patch('admission_journal.sqlite3.connect', side_effect=AssertionError('special path reached SQLite')):
            with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
                self.admit()

    def test_foreign_owner_refuses(self):
        self.admit()
        with patch('admission_journal.os.getuid', return_value=os.getuid()+1):
            with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
                self.journal.get(request()['requestId'])

    def test_private_sqlite_companions_before_database_access(self):
        self.admit()
        target = self.base/'companion-target';target.write_bytes(b'');target.chmod(0o600)
        for suffix in ('-wal', '-shm'):
            companion = self.root/(FILENAME+suffix)
            for kind in ('public', 'symlink', 'hardlink'):
                with self.subTest(suffix=suffix, kind=kind):
                    if kind == 'public':
                        companion.write_bytes(b'');companion.chmod(0o644)
                    elif kind == 'symlink':
                        companion.symlink_to(target)
                    else:
                        os.link(target, companion)
                    try:
                        with patch('admission_journal.sqlite3.connect', side_effect=AssertionError('unsafe companion reached SQLite')):
                            with self.assertRaisesRegex(ValueError, 'private and owned without aliases'):
                                self.journal.get(request()['requestId'])
                    finally:
                        companion.unlink()
        self.assertEqual(target.read_bytes(), b'', 'companion refusal must preserve aliased bytes')

    def test_unavailable_wal_mode_refuses(self):
        original = sqlite3.connect
        class Connection:
            def __init__(self,*args,**kwargs): self.inner=original(*args,**kwargs)
            def __getattr__(self,name): return getattr(self.inner,name)
            def execute(self,statement,*args):
                return self.inner.execute('PRAGMA journal_mode=DELETE' if statement=='PRAGMA journal_mode=WAL' else statement,*args)
        with patch('admission_journal.sqlite3.connect', side_effect=Connection):
            with self.assertRaisesRegex(ValueError, 'WAL mode unavailable'):
                self.admit()

    def test_full_sync_overrides_a_normal_connection_default(self):
        original = sqlite3.connect
        def normal(*args,**kwargs):
            connection=original(*args,**kwargs)
            connection.execute('PRAGMA synchronous=NORMAL')
            return connection
        with patch('admission_journal.sqlite3.connect',side_effect=normal):
            with self.journal.connection() as connection:
                self.assertEqual(connection.execute('PRAGMA synchronous').fetchone(),(2,),'journal must override NORMAL with FULL synchronization')

    def test_foreign_schema_refuses_without_changing_it(self):
        self.root.mkdir(mode=0o700)
        database=self.root/FILENAME
        with closing(sqlite3.connect(database)) as connection,connection:
            connection.execute('CREATE TABLE unrelated (value TEXT)')
            connection.execute("INSERT INTO unrelated VALUES ('retained')")
        database.chmod(0o600);before=database.read_bytes()
        with self.assertRaisesRegex(ValueError, 'journal schema differs'):
            self.admit()
        self.assertEqual(database.read_bytes(),before,'unknown schema refusal must not change journal bytes')

    def test_unsupported_schema_version_refuses(self):
        self.admit();self.alter('PRAGMA user_version=2')
        with self.assertRaisesRegex(ValueError, 'journal schema differs'):
            self.journal.get(request()['requestId'])

    def test_unknown_schema_objects_refuse_without_changes(self):
        self.admit()
        for statement, name, kind in (
            ('CREATE VIEW foreign_view AS SELECT request_id FROM admissions', 'foreign_view', 'VIEW'),
            ('CREATE INDEX foreign_index ON admissions(phase)', 'foreign_index', 'INDEX'),
            ("CREATE TRIGGER foreign_trigger AFTER INSERT ON admissions BEGIN UPDATE admissions SET phase='started'; END", 'foreign_trigger', 'TRIGGER'),
        ):
            with self.subTest(kind=kind):
                self.alter(statement)
                database = self.root/FILENAME;before = database.read_bytes()
                try:
                    with self.assertRaisesRegex(ValueError, 'journal schema differs'):
                        self.journal.get(request()['requestId'])
                    self.assertEqual(database.read_bytes(), before, 'unknown object refusal must precede database writes')
                finally:
                    self.alter(f'DROP {kind} {name}')

    def test_timeout_and_absolute_root_guards(self):
        for timeout in (0,-1,float('nan'),float('inf'),True,'2'):
            with self.assertRaisesRegex(ValueError,'timeout must be positive and finite'):
                Journal(self.root,timeout=timeout)
        with self.assertRaisesRegex(ValueError,'root must be absolute'):
            Journal('relative-root')

    def test_subprocess_exit_retains_exact_admission(self):
        script='from pathlib import Path;import json,os;from admission_journal import Journal;from test_admission_journal import request,factory;entry,new=Journal(Path(os.environ["TEST_JOURNAL_ROOT"])).admit(request(),factory,max_queued=1);Path(os.environ["TEST_RECEIPT"]).write_text(json.dumps(entry.admission));os._exit(19)'
        receipt=self.base/'receipt.json'
        result=subprocess.run([sys.executable,'-B','-c',script],cwd=Path(__file__).parent,
                              env={**os.environ,'TEST_JOURNAL_ROOT':str(self.root),'TEST_RECEIPT':str(receipt),'PYTHONDONTWRITEBYTECODE':'1'},timeout=10)
        self.assertEqual(result.returncode,19,'owned acceptance process must stop at the selected boundary')
        retained=self.journal.get(request()['requestId'])
        self.assertIsNotNone(retained,'committed admission must survive process exit')
        self.assertEqual(retained.admission,json.loads(receipt.read_text()),'original admission payload must survive process exit')

    def test_concurrent_admission_has_one_identity(self):
        self.journal.accepted()  # initialize schema before concurrent writers
        script='from pathlib import Path;import json,os;from admission_journal import Journal;from test_admission_journal import request,factory;entry,new=Journal(Path(os.environ["TEST_JOURNAL_ROOT"])).admit(request(),factory,max_queued=1);print(json.dumps({"reference":entry.job_reference,"new":new}))'
        children=[]
        try:
            for _ in range(2):
                children.append(subprocess.Popen([sys.executable,'-B','-c',script],cwd=Path(__file__).parent,
                                                 env={**os.environ,'TEST_JOURNAL_ROOT':str(self.root),'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE))
            rows=[]
            for child in children:
                stdout,stderr=child.communicate(timeout=10)
                self.assertEqual(child.returncode,0,stderr.decode())
                rows.append(json.loads(stdout))
            self.assertEqual(sum(row['new'] for row in rows),1,'concurrent admission must create only one identity')
            self.assertEqual(rows[0]['reference'],rows[1]['reference'],'concurrent replays must share original reference')
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill();child.wait(timeout=5)

    def test_concurrent_start_grants_permission_once(self):
        admission,_=self.admit()
        script='from pathlib import Path;import json,os;from admission_journal import Journal;entry,new=Journal(Path(os.environ["TEST_JOURNAL_ROOT"])).start(os.environ["TEST_REQUEST_ID"],os.environ["TEST_REFERENCE"],{"attempt":"original"});print(json.dumps({"permission":new,"context":entry.started_context}))'
        children=[]
        try:
            for _ in range(2):
                children.append(subprocess.Popen([sys.executable,'-B','-c',script],cwd=Path(__file__).parent,
                                                 env={**os.environ,'TEST_JOURNAL_ROOT':str(self.root),'TEST_REQUEST_ID':request()['requestId'],'TEST_REFERENCE':admission.job_reference,'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE))
            rows=[]
            for child in children:
                stdout,stderr=child.communicate(timeout=10)
                self.assertEqual(child.returncode,0,stderr.decode())
                rows.append(json.loads(stdout))
            self.assertEqual(sum(row['permission'] for row in rows),1,'concurrent start must grant only one permission')
            self.assertEqual(rows[0]['context'],rows[1]['context'])
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill();child.wait(timeout=5)

    def test_sqlite_companions_disappearing_before_lstat_are_allowed(self):
        original_private = admission_journal.private
        for suffix in ('-wal', '-shm'):
            with self.subTest(suffix=suffix):
                root = self.base/('vanishing'+suffix)
                journal = Journal(root)
                first, _ = journal.admit(request(), factory, max_queued=1)
                companion = root/(FILENAME+suffix)
                companion.write_bytes(b'');companion.chmod(0o600)
                saved = self.base/('saved'+suffix)
                observed = []
                def disappearing(path, directory):
                    if path == companion:
                        observed.append(path)
                        path.rename(saved)
                    return original_private(path, directory)
                try:
                    with patch('admission_journal.private', side_effect=disappearing):
                        self.assertEqual(journal.get(request()['requestId']), first,
                                         'transient disappearance must retain the original admission')
                    self.assertEqual(observed, [companion], 'probe must reach the existing companion')
                finally:
                    if saved.exists():
                        if companion.exists():
                            companion.rename(self.base/('new-transient'+suffix))
                        saved.rename(companion)

    def test_unavailable_companions_refuse_before_sqlite(self):
        self.admit()
        original_private = admission_journal.private
        for suffix in ('-wal', '-shm'):
            companion = self.root/(FILENAME+suffix)
            companion.write_bytes(b'');companion.chmod(0o600)
            try:
                for error in (PermissionError('companion permission unavailable'),
                              OSError('companion IO unavailable')):
                    with self.subTest(suffix=suffix, error=type(error).__name__):
                        def unavailable(path, directory):
                            if path == companion:
                                raise error
                            return original_private(path, directory)
                        with patch('admission_journal.private', side_effect=unavailable), \
                             patch('admission_journal.sqlite3.connect', side_effect=AssertionError('Unavailable companion reached SQLite')):
                            with self.assertRaisesRegex(type(error), 'companion .* unavailable'):
                                self.journal.get(request()['requestId'])
            finally:
                companion.unlink()

    def test_busy_writer_wait_is_bounded(self):
        self.admit()
        with closing(sqlite3.connect(self.root/FILENAME)) as blocker:
            blocker.execute('BEGIN IMMEDIATE')
            original=sqlite3.connect
            timeouts=[]
            def observed(*args,**kwargs):
                timeouts.append(kwargs['timeout'])
                return original(*args,**kwargs)
            with patch('admission_journal.sqlite3.connect',side_effect=observed):
                with self.assertRaisesRegex(sqlite3.OperationalError,'locked'):
                    Journal(self.root,timeout=0.03).get(request()['requestId'])
            self.assertEqual(timeouts,[0.03],'configured lock budget must reach native SQLite')
            blocker.rollback()


if __name__=='__main__':
    unittest.main()
