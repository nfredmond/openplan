"""Private source-byte custody fixtures. No URL, extraction, engine or live app."""
from contextlib import closing
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from admission_journal import FILENAME, Journal, encoded
import retained_source
from retained_source import prepare


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-source-custody-')
        self.base = Path(self.temporary.name)
        self.source = self.base/'input';self.source.mkdir(mode=0o700)
        self.destination = self.base/'pack'
        self.journal = Journal(self.base/'journal')
        self.payload = {'schemaVersion':'natford-aerial-processing.v1', 'requestId':'synthetic-source-request-0001',
                        'externalRef':{'system':'synthetic-only','workspaceId':'synthetic-workspace','missionId':'synthetic-mission'},
                        'callbackUrl':'http://127.0.0.1:1/never-called',
                        'missionTitle':'Synthetic byte custody', 'imagery':{'type':'zip_url','url':'http://127.0.0.1:1/never-fetched'}}
        self.context = {'installationId':'synthetic-installation','originalActorId':'synthetic-original-actor',
                        'targetId':'synthetic-target','workspaceId':'synthetic-workspace',
                        'missionId':'synthetic-mission','applicationJobId':'synthetic-app-job'}
        self.names = ['original.zip']
        with zipfile.ZipFile(self.source/self.names[0], 'w') as archive:
            archive.writestr(zipfile.ZipInfo('photo.jpg', (2020,1,1,0,0,0)), b'Synthetic bytes, not decoded imagery.')
        (self.source/self.names[0]).chmod(0o600)
        self.reference = 'synthetic-original-job'
        self.admit()

    def tearDown(self):
        self.temporary.cleanup()

    def admit(self):
        self.journal.admit(self.payload, lambda payload:(self.reference, {
            'requestId':payload['requestId'],'jobReference':self.reference,'status':'accepted',
            'callbackId':'synthetic-original-callback','occurredAt':'synthetic-fixture-time'}), max_queued=2)

    def arguments(self):
        return {'journal':self.journal,'request_id':self.payload['requestId'],'reference':self.reference,
                'context':self.context,'source_root':self.source,'sources':self.names,
                'destination':self.destination,'max_bytes':4096,'timeout':2}

    def prepare(self, **changes):
        return prepare(**{**self.arguments(), **changes})

    def photo_manifest(self):
        self.payload['requestId'] = 'synthetic-photo-request-0002'
        self.payload['schemaVersion'] = 'natford-aerial-processing.v1.1'
        self.names = ['first-source', 'second-source']
        photos = []
        for index, name in enumerate(self.names):
            data = ('synthetic photo bytes '+str(index)).encode()
            (self.source/name).write_bytes(data);(self.source/name).chmod(0o600)
            photos.append({'filename': '../original '+str(index)+'.jpg', 'url':'http://127.0.0.1:1/never-'+str(index),
                           'sizeBytes':len(data), 'checksumSha256':hashlib.sha256(data).hexdigest()})
        self.payload['imagery'] = {'type':'photo_manifest','photos':photos}
        self.reference = 'synthetic-original-photo-job'
        self.admit()

    def alter_request(self, transform):
        changed = copy.deepcopy(self.payload);transform(changed)
        with closing(sqlite3.connect(self.journal.root/FILENAME)) as connection, connection:
            connection.execute('UPDATE admissions SET request_json=? WHERE request_id=?',
                               (encoded(changed,canonical=True),self.payload['requestId']))

    def file_image(self, root):
        return {str(path.relative_to(root)):(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
                for path in root.rglob('*') if path.is_file()}

    def test_exact_zip_bytes_and_binding(self):
        before = self.file_image(self.source)
        receipt = self.prepare()
        raw = (self.source/self.names[0]).read_bytes()
        self.assertEqual((self.destination/'objects/source-00000.bin').read_bytes(), raw, 'retained ZIP bytes must match the original')
        plan = json.loads((self.destination/'plan.json').read_text())
        self.assertEqual(plan['binding']['originalRequest'], self.payload, 'plan must retain complete original request')
        self.assertEqual(plan['binding']['originalContext'], self.context, 'plan must retain original authority context')
        self.assertEqual(plan['sources'][0]['sha256'], hashlib.sha256(raw).hexdigest(), 'plan must retain observed source hash')
        self.assertEqual(receipt['manifestSha256'], hashlib.sha256((self.destination/'manifest.json').read_bytes()).hexdigest(), 'receipt must bind actual saved manifest bytes')
        self.assertEqual(receipt['manifestBytes'], (self.destination/'manifest.json').stat().st_size)
        self.assertEqual(self.file_image(self.source), before, 'source bytes and modes must remain unchanged')

    def test_photo_manifest_preserves_slots_and_metadata(self):
        self.photo_manifest();receipt = self.prepare()
        plan = json.loads((self.destination/'plan.json').read_text())
        self.assertEqual([row['imageryMetadata'] for row in plan['sources']], self.payload['imagery']['photos'], 'original ordered photo metadata must remain intact')
        self.assertEqual([row['slot'] for row in receipt['manifest']['sources']], [0,1], 'manifest must preserve original ordered slots')
        for index, name in enumerate(self.names):
            self.assertEqual((self.destination/f'objects/source-{index:05d}.bin').read_bytes(), (self.source/name).read_bytes())
        self.assertFalse((self.base/'original 0.jpg').exists(), 'photo filename must not become an output path')

    def test_plan_and_source_sync_precede_copy(self):
        original_digest = retained_source.digest
        original_sync = os.fsync
        synchronized = []
        def synced(descriptor):
            synchronized.append(os.readlink('/proc/self/fd/'+str(descriptor)))
            original_sync(descriptor)
        def observed(root,name,limit,deadline,output=None):
            if output is not None:
                self.assertTrue((self.destination/'plan.json').is_file(),'durable original plan must precede the first source copy')
                self.assertIn(str(self.source/self.names[0]), synchronized,'original source bytes must synchronize before source copy')
            return original_digest(root,name,limit,deadline,output)
        with patch('retained_source.os.fsync',side_effect=synced), patch('retained_source.digest',side_effect=observed):
            self.prepare()

    def test_copy_sync_precedes_slot_publication(self):
        original_sync=os.fsync;original_rename=Path.rename;synchronized=[]
        def synced(descriptor):
            synchronized.append(os.readlink('/proc/self/fd/'+str(descriptor)))
            original_sync(descriptor)
        def observed(path,target):
            if Path(target).name == 'source-00000.bin':
                self.assertIn(str(path), synchronized,'copied source bytes must synchronize before slot publication')
            return original_rename(path,target)
        with patch('retained_source.os.fsync',side_effect=synced),patch.object(Path,'rename',observed):
            self.prepare()

    def test_slot_tampering_before_first_manifest_refuses(self):
        original=retained_source.digest
        def tampered(root,name,limit,deadline,output=None):
            if Path(root) == self.destination/'objects':
                path=Path(root)/name;path.write_bytes(b'x'*path.stat().st_size)
            return original(root,name,limit,deadline,output)
        with patch('retained_source.digest',side_effect=tampered):
            with self.assertRaisesRegex(ValueError,'Retained source slot differs'):
                self.prepare()
        self.assertFalse((self.destination/'manifest.json').exists(),'changed copied bytes must not publish first completion')

    def test_complete_replay_without_original_sources_is_unchanged(self):
        receipt = self.prepare();before = self.file_image(self.destination)
        self.source.rename(self.base/'original-input-retained')
        self.assertEqual(self.prepare(), receipt, 'completed pack must replay its original receipt without source access')
        self.assertEqual(self.file_image(self.destination), before, 'completed replay must not create new partial records')

    def test_relocated_complete_pack_keeps_identity(self):
        receipt = self.prepare();relocated = self.base/'relocated'
        self.destination.rename(relocated)
        self.source.rename(self.base/'original-input-retained')
        self.assertEqual(self.prepare(destination=relocated), receipt, 'relocated complete pack must retain original identity')

    def test_partial_plan_resumes_only_missing_slots(self):
        self.photo_manifest();original = retained_source.digest
        def interrupted(root, name, limit, deadline, output=None):
            if output is not None and name == self.names[1]:
                raise OSError('synthetic second-copy interruption')
            return original(root,name,limit,deadline,output)
        with patch('retained_source.digest',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'second-copy interruption'):
                self.prepare()
        plan_before = (self.destination/'plan.json').read_bytes()
        self.assertFalse((self.destination/'manifest.json').exists(), 'interrupted copy must not publish completion')
        (self.source/self.names[0]).rename(self.source/'first-source-retained')
        self.prepare()
        self.assertEqual((self.destination/'plan.json').read_bytes(),plan_before,'resumption must not replace the original plan')
        self.assertEqual(len(list((self.destination/'objects').iterdir())),2)

    def test_prepared_plan_refuses_changed_original_bytes(self):
        original = retained_source.publish
        def interrupted(root,name,payload):
            original(root,name,payload)
            if name == 'plan.json':raise OSError('synthetic plan acknowledgment loss')
        with patch('retained_source.publish',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'plan acknowledgment loss'):
                self.prepare()
        saved = (self.destination/'plan.json').read_bytes()
        path = self.source/self.names[0];path.write_bytes(b'x'*path.stat().st_size)
        with self.assertRaisesRegex(ValueError,'Original planned source bytes differ'):
            self.prepare()
        self.assertEqual((self.destination/'plan.json').read_bytes(),saved)
        self.assertFalse((self.destination/'manifest.json').exists())

    def test_manifest_acknowledgment_loss_replays_original(self):
        original = retained_source.synchronize;raised = []
        def interrupted(path):
            original(path)
            if (self.destination/'manifest.json').exists() and not raised:
                raised.append(True);raise OSError('synthetic manifest sync acknowledgment loss')
        with patch('retained_source.synchronize',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'manifest sync acknowledgment loss'):
                self.prepare()
        raw = (self.destination/'manifest.json').read_bytes()
        self.source.rename(self.base/'original-input-retained')
        receipt = self.prepare()
        self.assertEqual(receipt['manifestSha256'],hashlib.sha256(raw).hexdigest(),'lost acknowledgment must retain original completion identity')

    def test_changed_original_context_refuses(self):
        self.prepare()
        changed = dict(self.context, originalActorId='another-actor')
        with self.assertRaisesRegex(ValueError,'Saved source preparation identity differs'):
            self.prepare(context=changed)

    def test_changed_original_request_refuses(self):
        self.prepare();self.alter_request(lambda value:value.update(missionTitle='changed-title'))
        with self.assertRaisesRegex(ValueError,'Saved source preparation identity differs'):
            self.prepare()

    def test_changed_mapping_or_budget_refuses(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError,'Saved source preparation record differs'):
            self.prepare(sources=['changed-original-source'])
        with self.assertRaisesRegex(ValueError,'Saved source preparation identity differs'):
            self.prepare(max_bytes=8192)

    def test_original_context_required_and_scope_bound(self):
        for key in self.context:
            changed = dict(self.context);changed.pop(key)
            with self.assertRaisesRegex(ValueError,'Original source authority context is required'):
                self.prepare(context=changed)
        for key in ('workspaceId','missionId'):
            with self.assertRaisesRegex(ValueError,'Source authority geography/job scope differs'):
                self.prepare(context={**self.context,key:'another-scope'})
        self.assertFalse(self.destination.exists(), 'invalid authority must precede destination writes')

    def test_caller_and_returned_values_are_detached(self):
        result=self.prepare();original=copy.deepcopy(result)
        self.context['originalActorId']='caller-mutated'
        self.assertEqual(result['manifest']['binding']['originalContext'],original['manifest']['binding']['originalContext'],'caller context must not alias saved binding')
        self.context['originalActorId']='synthetic-original-actor'
        result['manifest']['binding']['originalRequest']['missionTitle']='returned-mutated'
        self.assertEqual(self.prepare(),original,'returned values must not rewrite retained identity')

    def test_original_admission_required(self):
        for changed in ({'reference':'another-job'},{'request_id':'missing-request'}):
            with self.assertRaisesRegex(ValueError,'Source custody admission identity differs'):
                self.prepare(**changed)

    def test_context_nonfinite_json_refuses(self):
        with self.assertRaisesRegex(ValueError,'Out of range float'):
            self.prepare(context={**self.context,'unknown':float('nan')})

    def test_limit_and_timeout_guards(self):
        for value in (0,-1,True,'4096',1.5):
            with self.assertRaisesRegex(ValueError,'Source byte limit must be a positive integer'):
                retained_source.finite_limit(value)
            with self.assertRaisesRegex(ValueError,'Source byte limit must be a positive integer'):
                self.prepare(max_bytes=value)
        for value in (0,-1,True,'2',float('nan'),float('inf')):
            with self.assertRaisesRegex(ValueError,'Source custody timeout must be positive and finite'):
                self.prepare(timeout=value)

    def test_source_mapping_and_paths_refuse(self):
        for value in ([], None, [1], self.names*2):
            with self.assertRaisesRegex(ValueError,'Exact original source mapping is required'):
                self.prepare(sources=value)
        for name in ('../original.zip','/absolute.zip','a//b','a/./b','.'):
            with self.assertRaisesRegex(ValueError,'Source relative path is unsafe'):
                self.prepare(sources=[name])

    def test_unsupported_imagery_shape_refuses(self):
        self.alter_request(lambda value:value.update(imagery={'type':'another-type'}))
        with self.assertRaisesRegex(ValueError,'Original imagery source shape is unsupported'):
            self.prepare()

    def test_aggregate_byte_limit_refuses(self):
        with self.assertRaisesRegex(ValueError,'Source bytes exceed the declared limit'):
            self.prepare(max_bytes=1)
        self.assertFalse((self.destination/'plan.json').exists())

    def test_declared_size_refuses_mismatch_and_boolean(self):
        for size in (1,True):
            self.alter_request(lambda value:value['imagery'].update(sizeBytes=size))
            with self.assertRaisesRegex(ValueError,'Source bytes differ from declared size'):
                self.prepare()

    def test_declared_photo_checksum_refuses(self):
        self.photo_manifest()
        self.alter_request(lambda value:value['imagery']['photos'][0].update(checksumSha256='0'*64))
        with self.assertRaisesRegex(ValueError,'Source bytes differ from declared checksum'):
            self.prepare()

    def test_absolute_alias_and_parent_guards(self):
        with self.assertRaisesRegex(ValueError,'absolute paths without aliases'):
            self.prepare(destination=Path('relative-pack'))
        alias = self.base/'alias';alias.symlink_to(self.source,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'absolute paths without aliases'):
            self.prepare(source_root=alias)
        with self.assertRaisesRegex(ValueError,'absolute paths without aliases'):
            self.prepare(destination=alias/'pack')
        self.assertFalse((self.source/'pack').exists())

    def test_public_source_root_and_file_refuse(self):
        self.source.chmod(0o755)
        with self.assertRaisesRegex(ValueError,'private and owned without aliases'):
            self.prepare()
        self.source.chmod(0o700);(self.source/self.names[0]).chmod(0o644)
        with self.assertRaisesRegex(ValueError,'Source file must be private and owned without aliases'):
            self.prepare()

    def test_nested_public_source_directory_refuses(self):
        nested=self.source/'nested';nested.mkdir(mode=0o755)
        nested.chmod(0o755)
        (self.source/self.names[0]).rename(nested/'original.zip');self.names=['nested/original.zip']
        with self.assertRaisesRegex(ValueError,'Source directory must be private and owned'):
            self.prepare()

    def test_foreign_source_owner_refuses(self):
        with patch('retained_source.os.getuid',return_value=os.getuid()+1):
            with self.assertRaisesRegex(ValueError,'Source file must be private and owned without aliases'):
                retained_source.digest(self.source,self.names[0],4096,time.monotonic()+2)

    def test_public_destination_parent_refuses(self):
        self.base.chmod(0o755)
        try:
            with self.assertRaisesRegex(ValueError,'private and owned without aliases'):
                self.prepare()
            self.assertFalse(self.destination.exists(),'unsafe destination parent must precede pack creation')
        finally:
            self.base.chmod(0o700)

    def test_symlink_hardlink_and_special_source_refuse(self):
        path=self.source/self.names[0];saved=self.source/'saved';path.rename(saved)
        path.symlink_to(saved)
        with self.assertRaises(OSError):self.prepare()
        path.unlink();os.link(saved,path)
        with self.assertRaisesRegex(ValueError,'Source file must be private and owned without aliases'):
            self.prepare()
        path.unlink();os.mkfifo(path,0o600)
        with self.assertRaisesRegex(ValueError,'Source file must be private and owned without aliases'):
            self.prepare()

    def test_source_changed_during_hash_refuses(self):
        path=self.source/self.names[0]
        def changed(_deadline):path.write_bytes(b'x'*path.stat().st_size)
        with patch('retained_source.check_time',side_effect=changed):
            with self.assertRaisesRegex(ValueError,'Source file changed during custody'):
                retained_source.digest(self.source,self.names[0],4096,time.monotonic()+2)

    def test_expired_deadline_refuses(self):
        with self.assertRaisesRegex(TimeoutError,'Source custody deadline exceeded'):
            retained_source.digest(self.source,self.names[0],4096,0)

    def test_busy_writer_refuses_with_bounded_lock(self):
        self.destination.mkdir(mode=0o700)
        lock=self.destination/'writer.lock';lock.write_bytes(b'');lock.chmod(0o600)
        with lock.open('rb') as blocker:
            fcntl.flock(blocker.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(TimeoutError,'Source custody deadline exceeded'):
                with retained_source.writer(self.destination, time.monotonic()+2):
                    pass

    def test_disk_budget_refuses(self):
        with patch('retained_source.shutil.disk_usage',return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(ValueError,'Insufficient free space for retained source bytes'):
                self.prepare()
        self.assertFalse((self.destination/'manifest.json').exists())

    def test_saved_plan_and_encoding_corruption_refuse(self):
        self.prepare();path=self.destination/'plan.json';original=path.read_bytes()
        value=json.loads(original);value['unknown']='unreviewed';path.write_bytes(retained_source.json_bytes(value))
        with self.assertRaisesRegex(ValueError,'Saved source preparation identity differs'):
            self.prepare()
        path.write_text(json.dumps(json.loads(original),indent=2))
        with self.assertRaisesRegex(ValueError,'Source custody metadata encoding differs'):
            self.prepare()

    def test_saved_source_row_and_aggregate_corruption_refuse(self):
        self.prepare();path=self.destination/'plan.json';original=json.loads(path.read_text())
        for key,value in [('slot',True),('sourceRelativePath','another-source'),('sha256','bad'),('bytes',True),('imageryMetadata',{'type':'changed'})]:
            changed=copy.deepcopy(original);changed['sources'][0][key]=value
            path.write_bytes(retained_source.json_bytes(changed))
            with self.assertRaisesRegex(ValueError,'Saved source preparation record differs'):
                self.prepare()
        changed=copy.deepcopy(original);changed['sources'][0]['bytes']=8192
        path.write_bytes(retained_source.json_bytes(changed))
        with self.assertRaisesRegex(ValueError,'Saved source preparation exceeds original limit'):
            self.prepare()

    def test_saved_source_mapping_count_refuses(self):
        self.prepare();path=self.destination/'plan.json';value=json.loads(path.read_text());value['sources']=[]
        path.write_bytes(retained_source.json_bytes(value))
        with self.assertRaisesRegex(ValueError,'Saved source preparation mapping differs'):
            self.prepare()

    def test_json_type_changes_do_not_rebind_plan(self):
        self.context['ordinal']=1
        size=(self.source/self.names[0]).stat().st_size
        self.alter_request(lambda value:value['imagery'].update(sizeBytes=size))
        self.prepare();plan=json.loads((self.destination/'plan.json').read_text())
        bound=retained_source.binding(self.journal,self.payload['requestId'],self.reference,self.context)
        metadata=retained_source.imagery_sources(bound)
        changed=copy.deepcopy(plan);changed['binding']['originalContext']['ordinal']=True
        with self.assertRaisesRegex(ValueError,'Saved source preparation identity differs'):
            retained_source.verify_plan(changed,bound,self.names,metadata,4096)
        changed=copy.deepcopy(plan);changed['sources'][0]['imageryMetadata']['sizeBytes']=float(size)
        with self.assertRaisesRegex(ValueError,'Saved source preparation record differs'):
            retained_source.verify_plan(changed,bound,self.names,metadata,4096)

    def test_metadata_read_and_publication_size_bounds(self):
        self.prepare()
        with patch('retained_source.JSON_LIMIT',1):
            with self.assertRaisesRegex(ValueError,'Source custody metadata exceeds the supported size'):
                self.prepare()
            with self.assertRaisesRegex(ValueError,'Source custody metadata exceeds the supported size'):
                retained_source.publish(self.destination,'another.json',b'{}\n')

    def test_explicit_publication_limit_preserves_the_default(self):
        self.prepare()
        with patch('retained_source.JSON_LIMIT', 2):
            with self.assertRaisesRegex(ValueError, '^Source custody metadata exceeds the supported size$'):
                retained_source.publish(self.destination, 'default-limit.json', b'{}\n')
            retained_source.publish(self.destination, 'explicit-limit.json', b'{}\n', json_limit=3)
        self.assertEqual((self.destination/'explicit-limit.json').read_bytes(), b'{}\n', 'Explicit publication must use its declared bound')
        self.assertFalse((self.destination/'default-limit.json').exists(), 'Explicit publication cannot widen the default')

    def test_publication_limit_requires_a_positive_bounded_integer(self):
        self.prepare()
        for value in (False, 0, -1, retained_source.PUBLICATION_LIMIT+1, '3', float('inf'), 2.5):
            with self.assertRaisesRegex(ValueError, '^Source custody publication limit must be a positive bounded integer$'):
                retained_source.publish(self.destination, 'invalid-limit.json', b'', json_limit=value)
        self.assertFalse((self.destination/'invalid-limit.json').exists())

    def test_missing_plan_in_complete_pack_refuses(self):
        self.prepare();(self.destination/'plan.json').rename(self.destination/'retained-original-plan')
        with self.assertRaisesRegex(ValueError,'Completed source custody has no preparation plan'):
            self.prepare()

    def test_corrupt_slot_and_extra_object_refuse(self):
        self.prepare();path=self.destination/'objects/source-00000.bin';original=path.read_bytes()
        path.write_bytes(b'x'*len(original))
        with self.assertRaisesRegex(ValueError,'Retained source slot differs'):
            self.prepare()
        path.write_bytes(original)
        extra=self.destination/'objects/unplanned.bin';extra.write_bytes(b'extra');extra.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'Retained source object mapping differs'):
            self.prepare()

    def test_existing_manifest_is_never_overwritten(self):
        self.prepare();path=self.destination/'manifest.json';bad=path.read_bytes()+b'changed';path.write_bytes(bad)
        with self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
            self.prepare()
        self.assertEqual(path.read_bytes(),bad,'a different manifest must not be overwritten')

    def test_private_files_do_not_depend_on_caller_umask(self):
        previous=os.umask(0o022)
        try:self.prepare()
        finally:os.umask(previous)
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode)==0o600 for path in self.destination.rglob('*') if path.is_file()), 'every retained source record must remain private under a normal caller umask')


if __name__=='__main__':
    unittest.main()
