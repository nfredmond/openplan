"""Actual retained ZIP slots and original effects. No external requests."""
import copy
import hashlib
import json
import shutil
import unittest
import zipfile
from unittest.mock import patch

import derived_zip
import draft_custody
import engine_effects as module
from admission_journal import Journal
from retained_source import json_bytes
import test_engine_effects as photo_fixture


class Checks(unittest.TestCase):
    def setUp(self):
        photo_fixture.Checks.setUp(self)
        self.request['imagery'] = {'type': 'zip_url', 'url': 'http://127.0.0.1:1/never.zip'}
        self.journal = Journal(self.base/'zip-admissions')
        self.journal.admit(self.request, lambda request: (self.reference, {
            'requestId': request['requestId'], 'jobReference': self.reference, 'status': 'accepted'}), max_queued=2)
        self.archive = self.input/'original.zip'
        self.members = [('second/a.jpg', b'Synthetic B'), ('first/a.JPG', b'Synthetic A')]
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, raw in self.members: archive.writestr(name, raw)
        self.archive.chmod(0o600)
        self.source_arguments.update(journal=self.journal, sources=['original.zip'])
        self.derived = self.base/'derived'
        self.derivation = {'destination': self.derived, 'max_expanded_bytes': 4096,
                           'max_entries': 100, 'max_directory_bytes': 1024*1024}
        self.args.update(derived_arguments=self.derivation, filenames=['image-00000.jpg', 'image-00001.jpg'])

    tearDown = photo_fixture.Checks.tearDown
    open = photo_fixture.Checks.open
    image = photo_fixture.Checks.image

    def receipt(self):
        return derived_zip.prepare(self.source_arguments, **self.derivation)

    def plan(self, receipt):
        return module.make_plan(receipt, **{key: self.args[key] for key in ('engine', 'task_uuid', 'name', 'options', 'filenames')})

    def test_zip_plan_binds_original_lineage_and_ordered_slots(self):
        effects = self.open();receipt = self.receipt();plan = effects.plan
        self.assertEqual(plan['format'], module.ZIP_FORMAT, 'ZIP plans need a distinct original format')
        self.assertEqual(plan['sourceManifestSha256'], receipt['manifestSha256'], 'plan must bind actual derived manifest')
        self.assertEqual(plan['sourceCustody'], {'retainedManifestSha256': receipt['manifest']['sourceManifestSha256'],
            'derivedPlanSha256': receipt['manifest']['planSha256'], 'archive': receipt['manifest']['archive']}, 'original raw and derived lineage must remain')
        self.assertEqual(plan['binding']['originalRequest'], self.request)
        for index, raw in enumerate((self.members[1][1], self.members[0][1])):
            command, first = effects.issue('upload:'+str(index));self.assertIs(first, True)
            row = command['command']['multipart']
            self.assertEqual(row['objectRelativePath'], f'objects/image-{index:05d}.bin', 'upload must use derived slot')
            self.assertEqual(row['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(row['archiveMember'], ['first/a.JPG', 'second/a.jpg'][index])
        self.assertEqual(draft_custody.original_plan(plan), plan)

    def test_raw_zip_never_becomes_upload(self):
        from retained_source import prepare
        receipt = prepare(**self.source_arguments)
        with self.assertRaisesRegex(ValueError, '^ZIP source requires original derived-image custody$'): self.plan(receipt)

    def test_lineage_shape_hashes_and_archive_types_refuse(self):
        receipt = self.receipt()
        for changes in ({'sourceManifestSha256': 'bad'}, {'planSha256': 1}, {'archive': {'bytes': True, 'sha256': 'a'*64}},
                        {'archive': {'bytes': 1, 'sha256': 'bad'}}, {'archive': {'bytes': 1, 'sha256': 'a'*64, 'extra': True}}, {'format': 'raw'}):
            changed = copy.deepcopy(receipt);changed['manifest'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError): self.plan(changed)

    def test_empty_or_invalid_slot_mapping_refuses(self):
        receipt = self.receipt()
        changed = copy.deepcopy(receipt);changed['manifest']['sources'] = []
        with self.assertRaisesRegex(ValueError, 'slots are required'): self.plan(changed)
        for changes in ({'slot': True}, {'slot': 1}, {'objectRelativePath': 'objects/source-00000.bin'}, {'bytes': True},
                        {'bytes': -1}, {'sha256': 'bad'}, {'extra': 1}):
            changed = copy.deepcopy(receipt);changed['manifest']['sources'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'slot mapping differs'): self.plan(changed)

    def test_member_path_filename_and_order_refuse(self):
        receipt = self.receipt()
        for changes in ({'archiveMember': '../a.jpg'}, {'archiveMember': '/a.jpg'}, {'archiveMember': 'a//a.jpg'},
                        {'archiveMember': 'a\\b.jpg'}, {'archiveMember': 'a\x00.jpg'}, {'archiveMember': 'a.zip'},
                        {'archiveMember': 1}, {'filename': 'arbitrary.jpg'}):
            changed = copy.deepcopy(receipt);changed['manifest']['sources'][0].update(changes)
            with self.subTest(changes=str(changes)), self.assertRaisesRegex(ValueError, 'member or filename differs'): self.plan(changed)
        changed = copy.deepcopy(receipt);changed['manifest']['sources'][0]['archiveMember'] = 'z/a.jpg'
        with self.assertRaisesRegex(ValueError, 'member order differs'): self.plan(changed)
        changed['manifest']['sources'][0]['archiveMember'] = 'second/a.jpg'
        with self.assertRaisesRegex(ValueError, 'member order differs'): self.plan(changed)

    def test_caller_cannot_rename_derived_uploads(self):
        with self.assertRaisesRegex(ValueError, 'derived filenames must be preserved'):
            self.open(filenames=['other-a.jpg', 'other-b.jpg'])
        self.assertFalse(self.root.exists(), 'rename refusal must precede engine journal creation')

    def test_exact_derivation_arguments_and_root_overlap_refuse(self):
        for args in (False, {}, {'destination': self.derived}, {**self.derivation, 'timeout': 1}, {**self.derivation, 'source_arguments': {}}):
            with self.subTest(args=args), patch.object(module.derived_zip, 'prepare', side_effect=AssertionError('Invalid derivation arguments reached source intake')):
                with self.assertRaisesRegex(ValueError, 'Exact ZIP derivation arguments'): self.open(derived_arguments=args)
        for root in (self.derived, self.derived/'nested', self.base):
            with self.subTest(root=root), self.assertRaisesRegex(ValueError, 'roots must not overlap'): self.open(root=root)

    def test_photo_cannot_claim_zip_derivation(self):
        self.source_arguments['request_id'] = 'synthetic-another-request'
        photo_journal = Journal(self.base/'photo-admissions')
        photo = copy.deepcopy(self.request);photo['requestId'] = 'synthetic-another-request';photo['imagery'] = {'type': 'photo_manifest', 'photos': [{'filename': 'a.jpg', 'url': 'http://127.0.0.1:1/never'}]}
        photo_journal.admit(photo, lambda request: (self.reference, {'requestId': 'synthetic-another-request', 'jobReference': self.reference, 'status': 'accepted'}), max_queued=2)
        self.source_arguments.update(journal=photo_journal, sources=['a.jpg'])
        with patch.object(module, 'make_plan', side_effect=AssertionError('Non-ZIP derivation reached engine plan')):
            with self.assertRaisesRegex(ValueError, 'ZIP'): self.open()
        self.assertFalse(self.root.exists(), 'source type refusal must precede engine journal creation')

    def test_every_operation_rechecks_actual_zip_and_image_bytes(self):
        effects = self.open()
        for path in (self.source/'objects/source-00000.bin', self.derived/'objects/image-00000.bin'):
            old = path.read_bytes()
            try:
                path.write_bytes(b'Changed original bytes')
                for operation in (lambda: effects.issue('init'), effects.snapshot, lambda: effects.save_reply('init', 200, b'{}')):
                    with self.assertRaises(ValueError): operation()
                self.assertFalse((self.root/'command-00000.intent.json').exists(), 'corrupt ZIP lineage cannot issue an intent')
            finally: path.write_bytes(old)

    def test_derived_receipt_change_refuses_before_intent(self):
        effects = self.open();receipt = self.receipt();receipt['manifestSha256'] = '0'*64
        with patch.object(module.derived_zip, 'prepare', return_value=receipt), self.assertRaisesRegex(ValueError, 'Actual retained engine source identity differs'):
            effects.issue('init')
        self.assertFalse((self.root/'command-00000.intent.json').exists())

    def test_caller_derivation_mutation_does_not_change_original(self):
        effects = self.open();original = effects.plan_hash
        self.derivation['destination'] = self.base/'changed';self.derivation['max_expanded_bytes'] = 1
        self.assertEqual(effects.snapshot()['planSha256'], original, 'caller derivation must not alias saved identity')
        self.assertFalse((self.base/'changed').exists())

    def test_stopped_copy_preserves_unresolved_commands_and_missing_slot_recovery(self):
        effects = self.open();intent, _first = effects.issue('upload:0');before = self.image(self.root)
        moved = self.base/'moved';moved.mkdir(mode=0o700)
        for name, source in (('effects', self.root), ('source', self.source), ('derived', self.derived)):
            shutil.copytree(source, moved/name)
        shutil.rmtree(self.input);(moved/'derived/objects/image-00001.bin').unlink()
        recovered = self.open(root=moved/'effects', source_arguments={**self.source_arguments, 'destination': moved/'source'},
            derived_arguments={**self.derivation, 'destination': moved/'derived'})
        self.assertEqual(recovered.plan_hash, effects.plan_hash, 'relocation must preserve ZIP plan hash')
        self.assertEqual(recovered.issue('upload:0'), (intent, False), 'uncertain ZIP upload must not issue again')
        self.assertEqual((moved/'derived/objects/image-00001.bin').read_bytes(), self.members[0][1])
        self.assertEqual(self.image(moved/'effects'), before)

    def test_draft_plan_shape_and_zip_source_identity_refuse(self):
        plan = self.open().plan
        for change, diagnostic in (
            (lambda p: p.pop('sourceCustody'), 'shape or source identity differs'),
            (lambda p: p['sourceCustody'].update(extra=1), '^Original ZIP source custody shape differs$'),
            (lambda p: p['sourceCustody'].update(archive={'bytes': True, 'sha256': 'a'*64}), 'lineage is required'),
            (lambda p: p['binding']['originalRequest']['imagery'].update(type='photo_manifest'), '^Original ZIP plan requires ZIP imagery$'),
            (lambda p: p['uploads'][0].update(objectRelativePath='objects/source-00000.bin'), 'upload record differs')):
            changed = copy.deepcopy(plan);change(changed)
            with self.subTest(plan=changed), self.assertRaisesRegex(ValueError, diagnostic): draft_custody.original_plan(changed)

    def test_captured_zip_draft_compares_actual_bytes_without_permission(self):
        plan = self.open().plan;root = self.base/'engine';draft = root/'tmp'/self.task;draft.mkdir(parents=True, mode=0o700)
        (root/'tmp').chmod(0o700);root.chmod(0o700)
        (draft/'body.json').write_bytes(json_bytes(module.commands(plan)['init']['form']));(draft/'body.json').chmod(0o600)
        for row in plan['uploads']:
            target = draft/row['filename'];target.write_bytes((self.derived/row['objectRelativePath']).read_bytes());target.chmod(0o600)
        observed = draft_custody.inspect(root, plan, max_bytes=4096)
        self.assertEqual(observed['state'], 'complete_matching_draft')
        self.assertIs(observed['transportPermission'], False, 'ZIP byte comparison cannot authorize transport')
        self.assertEqual(observed['sourceProvenanceVerification'], 'unassessed')
        (draft/'image-00000.jpg').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'upload differs'): draft_custody.inspect(root, plan, max_bytes=4096)


if __name__ == '__main__': unittest.main()
