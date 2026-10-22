"""Private local effect records. No network, decoded imagery or live authority."""
from concurrent.futures import ThreadPoolExecutor
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import unittest
from unittest.mock import patch

from admission_journal import Journal
import engine_effects as module
from engine_effects import Effects
import retained_source


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-effects-')
        self.base = Path(self.temporary.name)
        self.input = self.base/'input';self.input.mkdir(mode=0o700)
        self.source = self.base/'source';self.root = self.base/'effects'
        self.request = {'requestId': 'synthetic-engine-request', 'externalRef': {
            'workspaceId': 'synthetic-workspace', 'missionId': 'synthetic-mission'},
            'imagery': {'type': 'photo_manifest', 'photos': [
                {'filename': 'original-a.jpg', 'url': 'http://127.0.0.1:1/never-a'},
                {'filename': 'original-b.jpg', 'url': 'http://127.0.0.1:1/never-b'}]}}
        self.context = {key: 'synthetic-'+key for key in ('installationId', 'originalActorId', 'targetId', 'applicationJobId')}
        self.context.update(workspaceId='synthetic-workspace', missionId='synthetic-mission')
        self.reference = 'synthetic-original-job'
        self.journal = Journal(self.base/'admissions')
        self.journal.admit(self.request, lambda request: (self.reference, {
            'requestId': request['requestId'], 'jobReference': self.reference, 'status': 'accepted'}), max_queued=2)
        for name in ('a.jpg', 'b.jpg'):
            path = self.input/name;path.write_bytes(('Synthetic ordinary bytes '+name).encode());path.chmod(0o600)
        self.source_arguments = {'journal': self.journal, 'request_id': self.request['requestId'],
            'reference': self.reference, 'context': self.context, 'source_root': self.input,
            'sources': ['a.jpg', 'b.jpg'], 'destination': self.source, 'max_bytes': 4096, 'timeout': 2}
        self.engine = {'instanceId': 'synthetic-private-engine', 'endpoint': 'http://127.0.0.1:1',
            'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4', 'imageId': 'sha256:'+'a'*64,
            'configurationSha256': 'b'*64, 'credentialReference': 'synthetic-no-secret'}
        self.task = '12345678-1234-4234-8234-123456789abc'
        self.options = [{'name': 'synthetic-flag', 'value': True}, {'name': 'synthetic-count', 'value': 1}]
        self.args = {'root': self.root, 'source_arguments': self.source_arguments, 'engine': self.engine,
            'task_uuid': self.task, 'name': 'Synthetic original task', 'options': self.options,
            'filenames': ['slot-a.jpg', 'slot-b.jpg']}

    def tearDown(self):
        self.temporary.cleanup()

    def open(self, **changes):
        return Effects(**{**self.args, **changes})

    def image(self, root):
        return {str(path.relative_to(root)): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
                for path in root.rglob('*') if path.is_file()}

    def edit(self, name, change):
        path = self.root/name;value = json.loads(path.read_bytes());change(value)
        path.write_bytes(retained_source.json_bytes(value))

    def test_original_plan_and_commands(self):
        effects = self.open();plan = json.loads((self.root/'plan.json').read_bytes())
        self.assertEqual(plan['format'], 'openplan.odm-engine-plan.v1', 'photo plan format must remain original')
        self.assertEqual(set(plan), {'format', 'binding', 'sourceManifestSha256', 'engine', 'taskUuid', 'name', 'options', 'uploads'}, 'photo plan fields must remain original')
        self.assertEqual(plan['binding']['originalRequest'], self.request, 'original request must remain in plan')
        self.assertEqual(plan['engine'], self.engine, 'complete engine identity must remain in plan')
        self.assertEqual(plan['sourceManifestSha256'], hashlib.sha256((self.source/'manifest.json').read_bytes()).hexdigest())
        intent, first = effects.issue('init')
        self.assertIs(first, True)
        self.assertEqual(intent['planSha256'], hashlib.sha256((self.root/'plan.json').read_bytes()).hexdigest(), 'intent must bind exact saved plan bytes')
        self.assertEqual(intent['command']['headers'], {'set-uuid': self.task})
        self.assertEqual(json.loads(intent['command']['form']['options']), self.options)
        upload, _first = effects.issue('upload:1')
        self.assertEqual(upload['command']['multipart']['objectRelativePath'], 'objects/source-00001.bin')
        self.assertEqual(upload['command']['multipart']['filename'], 'slot-b.jpg')
        self.assertEqual(upload['command']['multipart']['sha256'], hashlib.sha256((self.input/'b.jpg').read_bytes()).hexdigest())
        commit, _first = effects.issue('commit')
        self.assertEqual(commit['command'], {'method': 'POST', 'path': '/task/new/commit/'+self.task})

    def test_unresolved_intent_never_issues_again(self):
        effects = self.open();original, _first = effects.issue('init');before = self.image(self.root)
        replay, first = self.open().issue('init')
        self.assertIs(first, False, 'uncertain init must not issue twice')
        self.assertEqual(replay, original)
        self.assertEqual(self.image(self.root), before, 'unresolved replay must preserve ordinary bytes and modes')
        self.assertEqual(effects.snapshot()['commands'][0]['state'], 'unresolved')

    def test_all_commands_have_independent_once_only_intents(self):
        effects = self.open()
        for operation in ('init', 'upload:0', 'upload:1', 'commit'):
            first, flag = effects.issue(operation);self.assertIs(flag, True)
            self.assertEqual(first['commandSha256'], hashlib.sha256(retained_source.json_bytes(first['command'])).hexdigest(), 'each command must bind its exact descriptor')
            self.assertIs(effects.issue(operation)[1], False)
        self.assertEqual(len(list(self.root.glob('*.intent.json'))), 4)

    def test_changed_original_plan_refuses(self):
        self.open();before = self.image(self.root)
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.open(name='Changed task')
        self.assertEqual(self.image(self.root), before)
        changed = copy.deepcopy(self.engine);changed['instanceId'] = 'another-engine'
        with self.assertRaisesRegex(ValueError, 'differs'): self.open(engine=changed)
        changed = copy.deepcopy(self.options);changed[1]['value'] = True
        with self.assertRaisesRegex(ValueError, 'differs'): self.open(options=changed)
        with self.assertRaisesRegex(ValueError, 'differs'): self.open(task_uuid='22345678-1234-4234-8234-123456789abc')
        with self.assertRaisesRegex(ValueError, 'differs'): self.open(filenames=['other-a.jpg', 'slot-b.jpg'])

    def test_engine_descriptor_refuses_unknown_fields_credentials_and_digests(self):
        for changes in ({'token': 'synthetic-not-a-secret'}, {'endpoint': 'http://user@localhost'},
                        {'endpoint': 'http://localhost/?token=synthetic'}, {'endpoint': 'http://localhost/#other'},
                        {'endpoint': 'file:///tmp/fixture'}, {'api': 'unknown'}, {'version': 'changed'},
                        {'imageId': 'mutable-tag'}, {'configurationSha256': 'bad'}, {'instanceId': ''}):
            with self.subTest(changes=changes), self.assertRaises(ValueError): module.engine_identity({**self.engine, **changes})

    def test_task_name_options_and_filename_guards(self):
        receipt = retained_source.prepare(**self.source_arguments)
        for changes in ({'task_uuid': self.task.upper()}, {'task_uuid': '00000000-0000-0000-0000-000000000000'},
                        {'task_uuid': '12345678-1234-4234-1234-123456789abc'},
                        {'task_uuid': '12345678-1234-8234-8234-123456789abc'}, {'name': ''}, {'name': 'x'*513},
                        {'options': [{'name': 'a', 'value': None}]}, {'options': [{'name': 'a', 'value': 1}, {'name': 'a', 'value': 2}]},
                        {'options': [{'name': 'a', 'value': float('nan')}]}, {'filenames': ['../a.jpg', 'slot-b.jpg']},
                        {'filenames': ['a.dng', 'b.jpg']}, {'filenames': ['a.jpg', 'a.jpg']}, {'filenames': [[], 'b.jpg']}):
            args = {key: self.args[key] for key in ('engine', 'task_uuid', 'name', 'options', 'filenames')}
            with self.subTest(changes=str(changes)), self.assertRaises(ValueError): module.make_plan(receipt, **{**args, **changes})

    def test_zip_is_not_an_upload_image(self):
        receipt = retained_source.prepare(**self.source_arguments)
        receipt['manifest']['binding']['originalRequest']['imagery']['type'] = 'zip_url'
        args = {key: self.args[key] for key in ('engine', 'task_uuid', 'name', 'options', 'filenames')}
        with self.assertRaisesRegex(ValueError, '^ZIP source requires original derived-image custody$'): module.make_plan(receipt, **args)

    def test_original_source_bytes_rechecked_before_issue(self):
        effects = self.open();(self.source/'objects/source-00000.bin').write_bytes(b'changed bytes')
        with self.assertRaises(ValueError): effects.issue('init')
        self.assertFalse((self.root/'command-00000.intent.json').exists(), 'corrupt retained bytes must not issue a command')

    def test_saved_plan_and_intent_corruption_refuse(self):
        effects = self.open();effects.issue('init')
        self.edit('command-00000.intent.json', lambda value: value.update(commandSha256='0'*64))
        with self.assertRaisesRegex(ValueError, 'intent differs'): effects.snapshot()
        (self.root/'command-00000.intent.json').unlink()
        self.edit('plan.json', lambda value: value.update(name='changed'))
        with self.assertRaisesRegex(ValueError, 'plan differs'): effects.snapshot()

    def test_orphan_and_unknown_records_refuse(self):
        effects = self.open();path = self.root/'command-00000.reply.json';path.write_bytes(b'{}\n');path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'no original intent'): effects.snapshot()
        path.unlink();path = self.root/'unknown.intent.json';path.write_bytes(b'{}\n');path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'unknown effect'): effects.snapshot()

    def test_missing_plan_never_recreates_command_identity(self):
        self.open().issue('init');(self.root/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no original plan'): self.open()

    def test_reply_requires_original_intent(self):
        effects = self.open()
        with self.assertRaisesRegex(ValueError, 'durably issued'): effects.save_reply('init', 200, json.dumps({'uuid': self.task}).encode())

    def test_exact_reply_preserved_without_custody_promotion(self):
        effects = self.open();effects.issue('init');body = ('{ "uuid" : "'+self.task+'" }\n').encode()
        reply = effects.save_reply('init', 200, body)
        self.assertEqual(reply['bodySha256'], hashlib.sha256(body).hexdigest(), 'reply must bind exact original raw bytes')
        self.assertEqual(reply['parsed'], {'uuid': self.task})
        self.assertEqual(reply['engineCustodyVerification'], 'unassessed', 'HTTP acknowledgment must not promote custody')
        before = self.image(self.root)
        self.assertEqual(self.open().save_reply('init', 200, body), reply)
        self.assertEqual(self.image(self.root), before)
        self.assertIs(self.open().issue('init')[1], False)
        state = effects.snapshot()['commands'][0]
        self.assertEqual(state, {'operation': 'init', 'state': 'acknowledged', 'engineCustodyVerification': 'unassessed'})
        with self.assertRaisesRegex(ValueError, 'differs'): effects.save_reply('init', 200, json.dumps({'uuid': self.task}).encode())

    def test_upload_reply_success_is_exact_boolean(self):
        effects = self.open()
        for operation in ('upload:0', 'upload:1'):
            effects.issue(operation)
            for body in (b'{}', b'{"success":1}', b'{"success":false}', b'{"success":true,"error":""}'):
                with self.assertRaisesRegex(ValueError, 'acknowledgment'): effects.save_reply(operation, 200, body)
            self.assertEqual(effects.save_reply(operation, 200, b'{"success":true}')['parsed'], {'success': True})

    def test_commit_reply_requires_original_uuid(self):
        effects = self.open();effects.issue('commit')
        for value in ({}, {'success': True}, {'uuid': 'other', 'success': True},
                      {'uuid': True}, {'uuid': 1}, {'uuid': self.task.upper()},
                      {'uuid': self.task, 'error': ''}):
            with self.assertRaisesRegex(ValueError, 'acknowledgment'):
                effects.save_reply('commit', 200, json.dumps(value).encode())
        self.assertFalse((self.root/'command-00003.reply.json').exists())

    def test_actual_commit_uuid_reply_is_retained(self):
        effects = self.open();effects.issue('commit')
        body = ('{ "uuid" : "'+self.task+'" }\n').encode()
        reply = effects.save_reply('commit', 200, body)
        self.assertEqual(reply['parsed'], {'uuid': self.task})
        self.assertEqual(reply['bodySha256'], hashlib.sha256(body).hexdigest(), 'Commit reply must preserve exact original bytes')
        self.assertEqual(reply['engineCustodyVerification'], 'unassessed', 'Commit acknowledgement cannot promote engine custody')
        before = self.image(self.root)
        self.assertEqual(self.open().save_reply('commit', 200, body), reply)
        self.assertEqual(self.image(self.root), before, 'Commit reply replay must not rewrite original records')

    def test_invalid_legacy_commit_receipt_is_not_rewritten(self):
        effects = self.open();effects.issue('commit')
        effects.save_reply('commit', 200, json.dumps({'uuid': self.task}).encode())
        body = b'{"success":true}'
        self.edit('command-00003.reply.json', lambda value:value.update(
            bodyBase64=base64.b64encode(body).decode(), bodySha256=hashlib.sha256(body).hexdigest(),
            bodyBytes=len(body), parsed={'success': True}))
        before = self.image(self.root)
        with self.assertRaisesRegex(ValueError, 'acknowledgment'):effects.snapshot()
        self.assertEqual(self.image(self.root), before, 'Invalid old mock commit receipt must remain unchanged')

    def test_response_bounds_types_json_and_uuid(self):
        effects = self.open();effects.issue('init')
        valid = json.dumps({'uuid': self.task}).encode()
        for status, body in ((True, valid), (201, valid), (500, valid), (200, '{}'),
                             (200, valid+b' '*module.RESPONSE_LIMIT), (200, b'[]'), (200, b'{}'),
                             (200, b'{"uuid":"other"}'), (200, b'{"uuid":true}'), (200, b'\xff'),
                             (200, ('{"uuid":"a","uuid":"'+self.task+'"}').encode()),
                             (200, ('{"uuid":"'+self.task+'","x":NaN}').encode()), (200, b'{"x":1e999}')):
            with self.subTest(status=status, body=str(body[:80])), self.assertRaises(ValueError): module.parsed_reply(effects.plan, 'init', status, body)
        self.assertEqual(effects.snapshot()['commands'][0]['state'], 'unresolved')

    def test_stored_reply_revalidated(self):
        effects = self.open();effects.issue('upload:0');effects.save_reply('upload:0', 200, b'{"success":true}')
        original = (self.root/'command-00001.reply.json').read_bytes()
        self.edit('command-00001.reply.json', lambda value: value.update(bodyBase64=1))
        with self.assertRaisesRegex(ValueError, 'reply encoding'): effects.snapshot()
        (self.root/'command-00001.reply.json').write_bytes(original)
        self.edit('command-00001.reply.json', lambda value: value.update(bodySha256='0'*64))
        with self.assertRaisesRegex(ValueError, 'reply identity'): effects.snapshot()

    def test_changed_actual_manifest_receipt_refuses(self):
        effects = self.open();receipt = retained_source.prepare(**self.source_arguments)
        receipt['manifestSha256'] = '0'*64
        with patch.object(module, 'prepare', return_value=receipt), self.assertRaisesRegex(ValueError, 'Actual retained engine source identity differs'):
            effects.issue('init')
        self.assertFalse((self.root/'command-00000.intent.json').exists())

    def test_first_issue_waits_for_durable_publication(self):
        effects = self.open();sync = retained_source.synchronize
        def interrupted(path):
            if path == self.root and (self.root/'command-00000.intent.json').exists(): raise OSError('synthetic lost durable acknowledgment')
            return sync(path)
        with patch.object(retained_source, 'synchronize', interrupted), self.assertRaisesRegex(OSError, 'synthetic lost'): effects.issue('init')
        self.assertIs(self.open().issue('init')[1], False, 'visible intent after interrupted sync must not issue twice')

    def test_reply_sync_interruption_recovers_exact_bytes(self):
        effects = self.open();effects.issue('upload:0');sync = retained_source.synchronize
        def interrupted(path):
            if path == self.root and (self.root/'command-00001.reply.json').exists(): raise OSError('synthetic reply acknowledgment loss')
            return sync(path)
        with patch.object(retained_source, 'synchronize', interrupted), self.assertRaisesRegex(OSError, 'synthetic reply'): effects.save_reply('upload:0', 200, b'{"success":true}')
        self.assertEqual(self.open().save_reply('upload:0', 200, b'{"success":true}')['bodyBytes'], 16)

    def test_concurrent_callers_only_one_first_issue(self):
        self.open()
        with ThreadPoolExecutor(max_workers=2) as pool:
            flags = list(pool.map(lambda _value: self.open().issue('init')[1], range(2)))
        self.assertEqual(sorted(flags), [False, True], 'concurrent callers must have one first issue')

    def test_relocated_copy_replays_without_original_source(self):
        effects = self.open();effects.issue('init');identity = effects.snapshot();before = self.image(self.root)
        moved = self.base/'moved';moved.mkdir(mode=0o700)
        shutil.copytree(self.root, moved/'effects');shutil.copytree(self.source, moved/'source')
        shutil.rmtree(self.input)
        changed = {**self.source_arguments, 'destination': moved/'source'}
        recovered = self.open(root=moved/'effects', source_arguments=changed)
        self.assertEqual(recovered.snapshot(), identity, 'relocation must preserve original command identity')
        self.assertIs(recovered.issue('init')[1], False)
        self.assertEqual(self.image(moved/'effects'), before)

    def test_mutable_caller_and_returned_values_do_not_alias(self):
        effects = self.open();self.engine['instanceId'] = 'changed';self.options[0]['value'] = False;self.context['originalActorId'] = 'changed'
        intent, _first = effects.issue('init');intent['command']['form']['name'] = 'changed'
        self.assertEqual(effects.issue('init')[0]['command']['form']['name'], 'Synthetic original task', 'returned intent must not alias journal identity')
        self.assertEqual(effects.plan['engine']['instanceId'], 'synthetic-private-engine')

    def test_private_root_alias_and_overlap_guards(self):
        self.open()
        for changes in ({'root': Path('relative')}, {'root': self.source}, {'root': self.source/'nested'}):
            with self.assertRaises(ValueError): self.open(**changes)
        linked = self.base/'alias';linked.symlink_to(self.root)
        with self.assertRaises(ValueError): self.open(root=linked)
        (self.root/'plan.json').chmod(0o644)
        with self.assertRaises(ValueError): self.open()

    def test_busy_lock_timeout_and_unknown_operation(self):
        effects = self.open()
        for timeout in (True, 0, -1, float('nan'), float('inf')):
            with self.assertRaisesRegex(ValueError, 'timeout'): self.open(timeout=timeout)
        with retained_source.writer(self.root, __import__('time').monotonic()+1), self.assertRaises(TimeoutError): self.open(timeout=0.01)
        for operation in ('upload:-1', 'upload:2', '../other', 'cancel'):
            with self.assertRaisesRegex(ValueError, 'unsupported'): effects.issue(operation)

    def test_partial_records_preserved_and_files_private(self):
        effects = self.open();partial = self.root/'.partial-retained';partial.write_bytes(b'Synthetic partial');partial.chmod(0o600)
        old = os.umask(0)
        try: effects.issue('init')
        finally: os.umask(old)
        self.assertEqual(partial.read_bytes(), b'Synthetic partial', 'interrupted partial records must remain available')
        self.assertTrue(all(mode == 0o600 for _data, mode in self.image(self.root).values()))


if __name__ == '__main__':
    unittest.main()
