"""Synthetic file custody controls. Docker transport is mocked here."""
import copy
import hashlib
import importlib.util
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('keys', Path(__file__).resolve().parents[1]/'database_key_custody.py')
keys = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(keys)


class DatabaseKeyCustodyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.destination = self.root/'custody'
        self.destination.mkdir(mode=0o700)
        self.source_path = self.root/'source.key'
        self.target_path = self.root/'target.key'
        self.incoming = b'a'*64
        self.before = b'b'*64
        self.source_path.write_bytes(self.incoming)
        self.target_path.write_bytes(self.before)
        # Other operations tests may change the process umask. Keep this
        # synthetic mount mode explicit so a later mode mutation differs.
        self.source_path.chmod(0o644)
        self.target_path.chmod(0o644)
        self.source = self.service('source')
        self.target = self.service('target')
        self.calls = []
        self.infos = {s['name']: {'Id': s['id'], 'Image': s['imageId'],
            'Config': {'Labels': {'com.supabase.cli.project': s['project']}},
            'Mounts': [{'Destination': keys.KEY_MOUNT, 'Type': 'bind', 'RW': False, 'Source': str(path)}]}
            for s, path in [(self.source, self.source_path), (self.target, self.target_path)]}
        self.environment = patch.dict(os.environ, {'DOCKER_CONTEXT': '', 'DOCKER_HOST': ''})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.output_patch = patch.object(keys.subprocess, 'check_output', side_effect=self.output)
        self.output_patch.start()
        self.addCleanup(self.output_patch.stop)

    def service(self, kind):
        project = 'openplan-restore-'+kind+'-123'
        return {'name': 'supabase_db_'+project, 'project': project, 'id': kind+'-id', 'imageId': 'sha256:image'}

    def output(self, args, **kwargs):
        self.calls.append(args)
        if args[:3] == ['docker', 'context', 'inspect']:
            return 'unix:///var/run/docker.sock\n'
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([self.infos[args[2]]])
        if args == ['docker', 'exec', self.target['id'], 'cat', keys.KEY_MOUNT]:
            return self.target_path.read_bytes()
        raise AssertionError('Unexpected Docker command: '+str(args))

    def prepare(self):
        return keys.prepare_database_key_restore(self.source, self.target, self.destination)

    def apply(self, plan=None, run=None):
        plan = plan or self.prepare()
        run = run or (lambda args, **kwargs: subprocess.CompletedProcess(args, 0))
        with patch.object(keys.subprocess, 'run', side_effect=run), patch.object(keys.time, 'sleep'):
            return keys.apply_database_key_restore(self.target, plan, self.destination)

    def test_local_endpoint_and_context_precedence(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'ssh://remote'}):
            with self.assertRaisesRegex(ValueError, 'local Unix Docker endpoint'):
                keys.inspect_binding(self.target)
            with patch.dict(os.environ, {'DOCKER_CONTEXT': 'owned-local'}):
                try:
                    keys.inspect_binding(self.target)
                except ValueError as error:
                    self.fail('Selected local context was refused: '+str(error))
                self.assertIn(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', 'owned-local'], self.calls)
        with patch.object(keys.subprocess, 'check_output', return_value='tcp://remote:2375'):
            with self.assertRaisesRegex(ValueError, 'local Unix Docker endpoint'):
                keys.inspect_binding(self.target)

    def test_container_identity(self):
        keys.inspect_binding(self.target)
        variants = [('Id', 'other'), ('Image', 'other')]
        for field, value in variants:
            with self.subTest(field=field):
                original = self.infos[self.target['name']][field]
                self.infos[self.target['name']][field] = value
                with self.assertRaisesRegex(ValueError, 'ownership differs'):
                    keys.inspect_binding(self.target)
                self.infos[self.target['name']][field] = original
        labels = self.infos[self.target['name']]['Config']['Labels']
        labels['com.supabase.cli.project'] = 'other'
        with self.assertRaisesRegex(ValueError, 'ownership differs'):
            keys.inspect_binding(self.target)
        labels['com.supabase.cli.project'] = self.target['project']
        with self.assertRaisesRegex(ValueError, 'ownership differs'):
            keys.inspect_binding({**self.target, 'project': 'other'})
        self.infos['wrong-name'] = self.infos[self.target['name']]
        with self.assertRaisesRegex(ValueError, 'ownership differs'):
            keys.inspect_binding({**self.target, 'name': 'wrong-name'})

    def test_mount_and_canonical_file(self):
        info = self.infos[self.target['name']]
        original = copy.deepcopy(info['Mounts'])
        for mounts in [[], original*2, [{**original[0], 'Type': 'volume'}], [{**original[0], 'RW': True}]]:
            info['Mounts'] = mounts
            with self.assertRaisesRegex(ValueError, 'one read-only file bind'):
                keys.inspect_binding(self.target)
        for path in ['relative.key', str(self.root/'..'/self.root.name/'target.key'), str(self.root)]:
            info['Mounts'] = [{**original[0], 'Source': path}]
            with self.assertRaisesRegex(ValueError, 'canonical regular file'):
                keys.inspect_binding(self.target)
        alias = self.root/'alias.key'; alias.symlink_to(self.target_path)
        info['Mounts'] = [{**original[0], 'Source': str(alias)}]
        with self.assertRaisesRegex(ValueError, 'canonical regular file'):
            keys.inspect_binding(self.target)

    def test_private_key_bytes(self):
        path = self.destination/'key'
        keys.preserve_key(path, self.incoming)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(keys.read_key(path, private=True), self.incoming)
        for content, message in [(b'a'*63, 'file is invalid'), (b'z'*64, 'bytes are invalid'), (b'a'*64+b'x', 'bytes are invalid')]:
            path.write_bytes(content)
            with self.assertRaisesRegex(ValueError, message):
                keys.read_key(path, private=True)
        path.write_bytes(self.incoming); path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'must be private'):
            keys.read_key(path, private=True)
        path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'original is retained'):
            keys.preserve_key(path, self.before)
        self.assertEqual(path.read_bytes(), self.incoming)
        # A 65-byte link avoids accidental rejection by the size guard alone.
        link = self.destination/'link'; link.symlink_to('./'*31+'key')
        with self.assertRaisesRegex(ValueError, 'file is invalid'):
            keys.read_key(link)

    def test_capture_private_intent_and_independent_target(self):
        plan = self.prepare()
        self.assertEqual(self.prepare(), plan)
        self.assertEqual(keys.read_key(self.destination/'target-root-before-private.key', private=True), self.before)
        self.assertEqual(plan['incomingSha256'], hashlib.sha256(self.incoming).hexdigest())
        self.destination.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'directory must be canonical and private'):
            self.prepare()
        self.destination.chmod(0o700)
        independent = self.root/'independent'; independent.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'target must be independent'):
            keys.prepare_database_key_restore(self.source, self.source, independent)
        self.target_path.unlink(); os.link(self.source_path, self.target_path)
        with self.assertRaisesRegex(ValueError, 'target must be independent'):
            keys.prepare_database_key_restore(self.source, self.target, independent)

    def test_intent_privacy_and_payload_changes(self):
        plan = self.prepare(); record = self.destination/'database-key-custody-private.json'
        record.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'intent must be private'):
            self.prepare()
        record.chmod(0o600)
        alias = self.destination/'intent-link'; alias.symlink_to(record)
        with self.assertRaisesRegex(ValueError, 'intent must be private and regular'):
            keys.read_intent(alias)
        changed = {**plan, 'sourceId': 'other'}; record.write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, 'intent differs'):
            self.prepare()
        record.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'intent differs'):
            self.apply({**plan, 'targetId': 'other'})
        for name in ['database-root-private.key', 'target-root-before-private.key']:
            path = self.destination/name; original = path.read_bytes(); path.write_bytes(b'c'*64)
            with self.assertRaisesRegex(ValueError, 'payload differs'):
                self.apply(plan)
            path.write_bytes(original)
        self.source_path.write_bytes(b'd'*64)
        with self.assertRaisesRegex(ValueError, 'original is retained'):
            self.prepare()

    def test_changed_binding_requires_exact_recovery_bytes(self):
        plan = self.prepare()
        replaced = self.root/'replacement'; replaced.write_bytes(self.before)
        replaced.chmod(plan['binding']['mode']); os.replace(replaced, self.target_path)
        with self.assertRaisesRegex(ValueError, 'binding differs'):
            self.prepare()
        with self.assertRaisesRegex(ValueError, 'target binding changed'):
            self.apply(plan)
        self.target_path.write_bytes(self.incoming)
        self.assertEqual(self.prepare(), plan)
        self.target_path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'binding differs'):
            self.prepare()

    def test_unrelated_current_bytes_are_retained(self):
        plan = self.prepare(); self.target_path.write_bytes(b'c'*64)
        with patch.object(keys.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'target has unrelated bytes'):
                self.apply(plan, run)
            run.assert_not_called()
        self.assertEqual(self.target_path.read_bytes(), b'c'*64)

    def test_atomic_replacement_restart_and_actual_mount(self):
        plan = self.prepare(); old = self.target_path.stat(); calls = []
        def run(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0)
        fsync_types = []; original_fsync = keys.os.fsync
        def fsync(fd):
            fsync_types.append(stat.S_IFMT(os.fstat(fd).st_mode)); original_fsync(fd)
        with patch.object(keys.os, 'fsync', side_effect=fsync):
            result = self.apply(plan, run)
        new = self.target_path.stat()
        self.assertNotEqual(old.st_ino, new.st_ino)
        self.assertEqual((old.st_uid,old.st_gid,old.st_mode), (new.st_uid,new.st_gid,new.st_mode))
        self.assertEqual(self.target_path.read_bytes(), self.incoming)
        self.assertEqual(self.source_path.read_bytes(), self.incoming)
        self.assertEqual((self.destination/'target-root-before-private.key').read_bytes(), self.before)
        self.assertEqual(calls[:2], [['docker', 'stop', self.target['id']], ['docker', 'start', self.target['id']]])
        self.assertEqual(fsync_types, [stat.S_IFREG, stat.S_IFDIR])
        self.assertIn(['docker', 'exec', self.target['id'], 'cat', keys.KEY_MOUNT], self.calls)
        self.assertTrue(result['mountedBytesVerified'])
        self.assertNotIn('Sha256', json.dumps(result))
        self.assertEqual(list(self.root.glob('.openplan-restore-key-*')), [])

    def test_interrupted_restart_replays_retained_intent(self):
        plan = self.prepare()
        def interrupted(args, **kwargs):
            if args[:2] == ['docker', 'start']:
                raise RuntimeError('Interrupted restart')
            return subprocess.CompletedProcess(args, 0)
        with self.assertRaisesRegex(RuntimeError, 'Interrupted restart'):
            self.apply(plan, interrupted)
        self.assertEqual(self.prepare(), plan)
        self.assertTrue(self.apply(plan)['mountedBytesVerified'])

    def test_changed_binding_or_bytes_while_stopping(self):
        for fault in ['binding', 'bytes']:
            self.target_path.write_bytes(self.before); plan = self.prepare()
            def run(args, **kwargs):
                if args[:2] == ['docker', 'stop']:
                    if fault == 'binding':
                        replacement = self.root/'replacement'; replacement.write_bytes(self.before); os.replace(replacement, self.target_path)
                    else:
                        self.target_path.write_bytes(b'c'*64)
                return subprocess.CompletedProcess(args, 0)
            with self.assertRaisesRegex(ValueError, 'changed while stopping'):
                self.apply(plan, run)
            # Restore only the synthetic intent so each fault starts independently.
            for path in self.destination.iterdir(): path.unlink()

    def test_changed_bytes_during_staging_refuse_replacement(self):
        plan = self.prepare(); actual_fsync = keys.os.fsync
        def fsync(fd):
            actual_fsync(fd); self.target_path.write_bytes(b'c'*64)
        with patch.object(keys.os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(ValueError, 'bytes changed before replacement'):
                self.apply(plan)
        self.assertEqual(self.target_path.read_bytes(), b'c'*64)
        self.assertEqual(list(self.root.glob('.openplan-restore-key-*')), [])

    def test_changed_identity_during_staging_refuse_replacement(self):
        plan = self.prepare(); actual_fsync = keys.os.fsync
        def fsync(fd):
            actual_fsync(fd)
            replacement = self.root/'replacement'; replacement.write_bytes(self.before); os.replace(replacement, self.target_path)
        with patch.object(keys.os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(ValueError, 'file identity changed'):
                self.apply(plan)
        self.assertEqual(self.target_path.read_bytes(), self.before)

    def test_failed_write_or_mount_cannot_claim_success(self):
        plan = self.prepare()
        with patch.object(keys.os, 'replace'):
            with self.assertRaisesRegex(ValueError, 'write is unconfirmed'):
                self.apply(plan)
        actual_output = self.output
        def wrong_mount(args, **kwargs):
            if 'cat' in args: return self.before
            return actual_output(args, **kwargs)
        with patch.object(keys.subprocess, 'check_output', side_effect=wrong_mount):
            with self.assertRaisesRegex(ValueError, 'mounted key differs'):
                self.apply(plan)

    def test_unready_target_cannot_claim_success(self):
        plan = self.prepare()
        with patch.object(keys.subprocess, 'run', return_value=subprocess.CompletedProcess([],1)) as run, patch.object(keys.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                keys.apply_database_key_restore(self.target, plan, self.destination)
            self.assertEqual(sum('pg_isready' in c.args[0] for c in run.call_args_list), 60)

    def test_key_recovery_requires_an_owned_private_target(self):
        plan = self.prepare()
        with patch.object(keys.subprocess, 'run', side_effect=lambda args,**kwargs: subprocess.CompletedProcess(args,0)):
            self.assertTrue(keys.recover_target_key(self.destination)['mountedBytesVerified'])
        self.destination.chmod(0o755)
        with patch.object(keys.subprocess, 'run', return_value=subprocess.CompletedProcess([],0)), self.assertRaisesRegex(ValueError, 'directory must be canonical and private'):
            keys.recover_target_key(self.destination)
        self.destination.chmod(0o700)
        record = self.destination/'database-key-custody-private.json'
        record.write_text(json.dumps({**plan,'targetProject':'openplan','targetName':'supabase_db_openplan'}))
        with patch.object(keys, 'apply_database_key_restore') as apply:
            with self.assertRaisesRegex(ValueError, 'owned disposable restore target'):
                keys.recover_target_key(self.destination)
            apply.assert_not_called()

    def test_cli_refuses_unknown_action_before_transport(self):
        result = subprocess.run([sys.executable,'-I','-B',str(Path(keys.__file__).resolve()),'--unknown',str(self.destination)],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Usage: database_key_custody.py --recover-target-key',result.stderr)


if __name__ == '__main__':
    unittest.main()
