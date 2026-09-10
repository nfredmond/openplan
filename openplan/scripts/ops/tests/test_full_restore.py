"""Failure controls for disposable recovery custody; live services are separate."""
import copy
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import full_restore as recovery


class FullRestoreTests(unittest.TestCase):
    def test_project_identity(self):
        project = 'openplan-restore-source-123'
        info = [{'Config': {'Labels': {'com.supabase.cli.project': project}, 'Image': 'matching'}, 'Image': 'sha256:one'}]
        with patch.object(recovery, 'output', return_value=json.dumps(info)):
            self.assertEqual(len(recovery.require_project(project, 'source')), 4)
            with self.assertRaisesRegex(ValueError, 'Only an owned'):
                recovery.require_project('openplan', 'source')
            with self.assertRaisesRegex(ValueError, 'Only an owned'):
                recovery.require_project('openplan-restore-target-123', 'source')
            info[0]['Config']['Labels']['com.supabase.cli.project'] = 'other'
        with patch.object(recovery, 'output', return_value=json.dumps(info)):
            with self.assertRaisesRegex(ValueError, 'identity differs'):
                recovery.require_project(project, 'source')

    def test_all_service_images_must_match(self):
        source = {s: {'imageId': 'same'} for s in recovery.SERVICES}
        recovery.require_matching(source, copy.deepcopy(source))
        for service in recovery.SERVICES:
            target = copy.deepcopy(source)
            target[service]['imageId'] = 'different'
            with self.assertRaisesRegex(ValueError, 'images must match'):
                recovery.require_matching(source, target)

    def test_existing_records_or_recovery_names_are_refused(self):
        with patch.object(recovery, 'sql', return_value='0'):
            recovery.require_empty_target('owned')
        for index in range(4):
            with patch.object(recovery, 'sql', side_effect=['0']*index+['1']):
                with self.assertRaisesRegex(ValueError, 'existing records|already exist'):
                    recovery.require_empty_target('owned')

    def test_scheduled_jobs_need_separate_quiescence(self):
        with patch.object(recovery, 'sql', return_value='f'):
            recovery.require_no_jobs('owned')
        with patch.object(recovery, 'sql', side_effect=['t', '0']):
            recovery.require_no_jobs('owned')
        with patch.object(recovery, 'sql', side_effect=['t', '1']):
            with self.assertRaisesRegex(ValueError, 'Scheduled SQL jobs'):
                recovery.require_no_jobs('owned')

    def test_custom_roles_are_refused_before_capture(self):
        source = {s: {'name': s, 'imageId': 'same'} for s in recovery.SERVICES}
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root)/'not-created'
            with patch.object(recovery, 'require_project', return_value=source), patch.object(recovery, 'require_empty_target'), patch.object(recovery, 'require_no_jobs'), patch.object(recovery, 'role_inventory', side_effect=['source-role', 'different-role']), patch.object(recovery, 'run', side_effect=AssertionError('Capture started before matching roles')):
                with self.assertRaisesRegex(ValueError, 'Cluster role definitions differ'):
                    recovery.full_restore('source', 'target', destination)
            self.assertFalse(destination.exists())

    def test_inventory_queries_every_discovered_table(self):
        names = ['auth.users', 'pgsodium.key', 'public.new_future_table', 'storage.objects']
        large_objects = ['pg_catalog.pg_largeobject', 'pg_catalog.pg_largeobject_metadata']
        def query(_db, command):
            if command.startswith('SELECT coalesce(jsonb_agg'):
                if "c.relkind='S'" in command:
                    return json.dumps(['public.identity_sequence'])
                self.assertIn("c.relkind IN ('r','m')", command)
                self.assertIn("n.nspname !~ '^pg_'", command)
                self.assertIn("n.nspname<>'information_schema'", command)
                return json.dumps(names.copy())
            if command == 'SELECT jsonb_build_array(last_value,is_called) FROM public.identity_sequence':
                return '[123,true]'
            self.assertIn(command, [f'SELECT count(*) FROM {name}' for name in names+large_objects])
            return '2'
        with patch.object(recovery, 'sql', side_effect=query), patch.object(recovery, 'schema_hash', return_value='schema'), patch.object(recovery, 'stream_hash', return_value='bytes') as stream, patch.object(recovery, 'database_properties', return_value={'owner': 'postgres'}):
            result = recovery.database_inventory('owned')
        self.assertEqual(set(result['tables']), set(names+large_objects))
        self.assertEqual(result['sequences'], {'public.identity_sequence': [123, True]})
        self.assertEqual(result['databaseProperties'], {'owner': 'postgres'})
        for name, call in zip(names+large_objects, stream.call_args_list):
            self.assertIn(f'FROM {name} t ORDER BY to_jsonb(t)::text', call.args[0][-1])
        self.assertEqual(stream.call_count, len(names+large_objects))

    def test_exact_inventory_includes_missing_new_empty_and_changed_tables(self):
        original = {'schemaSha256': 'schema', 'tables': {'public.work': {'rows': 1, 'sha256': 'bytes'}, 'auth.users': {'rows': 0, 'sha256': 'empty'}}}
        recovery.compare_inventory(original, copy.deepcopy(original))
        changes = [
            {'schemaSha256': 'changed', 'tables': original['tables']},
            {'schemaSha256': 'schema', 'tables': {'public.work': original['tables']['public.work']}},
            {'schemaSha256': 'schema', 'tables': {**original['tables'], 'public.new': {'rows': 0, 'sha256': 'empty'}}},
            {'schemaSha256': 'schema', 'tables': {**original['tables'], 'public.work': {'rows': 1, 'sha256': 'changed'}}},
        ]
        changes.append({**original, 'sequences': {'public.id': [456, True]}})
        changes.append({**original, 'databaseProperties': {'owner': 'different'}})
        for changed in changes:
            with self.assertRaisesRegex(ValueError, 'Restored database differs'):
                recovery.compare_inventory(original, changed)

    def test_restore_actually_compares_target_before_starting_services(self):
        baseline = {'databaseProperties': {'owner': 'postgres'}, 'schemaSha256': 'schema', 'tables': {'public.work': {'rows': 1, 'sha256': 'original'}}}
        bad = {'databaseProperties': {'owner': 'postgres'}, 'schemaSha256': 'schema', 'tables': {'public.work': {'rows': 1, 'sha256': 'changed'}}}
        for fault in (None, 'source', 'target', 'storage'):
            with tempfile.TemporaryDirectory() as root:
                source = {s: {'name': 'source-'+s, 'image': 'matching', 'imageId': 'same'} for s in recovery.SERVICES}
                target = {s: {'name': 'target-'+s, 'image': 'matching', 'imageId': 'same'} for s in recovery.SERVICES}
                def command(args, **kwargs):
                    if handle := kwargs.get('stdout'):
                        if hasattr(handle, 'write'):
                            handle.write(b'synthetic archive')
                def storage(_storage, path):
                    with tarfile.open(path, 'w:gz') as tar:
                        content = b'changed' if fault == 'storage' and path.name == 'restored-storage.tgz' else b'original'
                        member = tarfile.TarInfo('private.txt')
                        member.size = len(content)
                        tar.addfile(member, io.BytesIO(content))
                with patch.object(recovery, 'require_project', side_effect=[source, target]), patch.object(recovery, 'require_empty_target'), patch.object(recovery, 'require_no_jobs'), patch.object(recovery, 'role_inventory', return_value='same'), patch.object(recovery, 'run', side_effect=command) as calls, patch.object(recovery, 'sql'), patch.object(recovery, 'database_inventory', side_effect=[copy.deepcopy(baseline), bad if fault == 'source' else copy.deepcopy(baseline), bad if fault == 'target' else copy.deepcopy(baseline)]), patch.object(recovery, 'schema_hash', return_value='schema'), patch.object(recovery, 'storage_archive', side_effect=storage), patch.object(recovery, 'wait_for_services') as ready, patch.object(recovery, 'restore_database_properties') as properties:
                    if fault:
                        message = 'Restored Storage bytes differ' if fault == 'storage' else 'Restored database differs: public.work'
                        with self.assertRaisesRegex(ValueError, message):
                            recovery.full_restore('source', 'target', Path(root)/'archive')
                        self.assertFalse(any(call.args[0][:2] == ['docker', 'start'] for call in calls.call_args_list))
                    else:
                        result = recovery.full_restore('source', 'target', Path(root)/'archive')
                        self.assertEqual(result['database'], baseline)
                        ready.assert_called_once_with(['source-auth', 'source-storage', 'target-auth', 'target-storage'])
                        properties.assert_called_once_with('source-db', 'target-db', Path(root)/'archive')
                        created = [call.args[0] for call in calls.call_args_list if 'createdb' in call.args[0] and call.args[0][-1] == 'openplan_recovered']
                        self.assertEqual(len(created), 1)
                        self.assertEqual(created[0][-3:], ['--owner', 'postgres', 'openplan_recovered'])
                        self.assertTrue(any(call.args[0][:2] == ['docker', 'start'] for call in calls.call_args_list))

    def test_failed_snapshot_process_cannot_return_a_hash(self):
        self.assertEqual(recovery.stream_hash([sys.executable, '-c', "print('abc', end='')"]), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
        with self.assertRaisesRegex(RuntimeError, 'Snapshot command failed'):
            recovery.stream_hash([sys.executable, '-c', "import sys; print('partial'); sys.exit(7)"])

    def test_service_readiness_waits_and_fails_if_health_never_arrives(self):
        with patch.object(recovery, 'output', side_effect=['starting', 'healthy']), patch.object(recovery.time, 'sleep') as wait:
            recovery.wait_for_services(['owned-auth'])
            wait.assert_called_once_with(1)
        with patch.object(recovery, 'output', return_value='unhealthy'), patch.object(recovery.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'did not become healthy'):
                recovery.wait_for_services(['owned-storage'])

    def test_database_properties_include_authority_without_disclosing_settings(self):
        properties = {'owner': 'postgres', 'acl': [['postgres', 'PUBLIC', 'CONNECT', False]]}
        with patch.object(recovery, 'sql', side_effect=['[[null,["app.test=synthetic-sensitive-value"]]]', json.dumps(properties)]) as query:
            result = recovery.database_properties('owned')
        self.assertEqual(result['owner'], 'postgres')
        self.assertEqual(result['acl'], properties['acl'])
        self.assertNotIn('synthetic-sensitive-value', json.dumps(result))
        self.assertEqual(len(result['settingsSha256']), 64)
        metadata_query = query.call_args_list[1].args[1]
        for field in ("'owner',pg_get_userbyid(datdba)", 'aclexplode', 'datconnlimit', 'datlocale', 'datcollversion'):
            self.assertIn(field, metadata_query)
        with patch.object(recovery, 'sql', side_effect=['[[null,["app.test=changed"]]]', json.dumps(properties)]):
            self.assertNotEqual(result['settingsSha256'], recovery.database_properties('owned')['settingsSha256'])

    def test_delegated_database_grantor_is_refused_before_private_sql(self):
        with patch.object(recovery, 'sql', return_value='1'), patch.object(recovery.subprocess, 'run', side_effect=AssertionError('Private SQL ran for unsupported grantors')):
            with self.assertRaisesRegex(ValueError, 'Delegated database grantors'):
                recovery.restore_database_properties('source', 'target', Path('/unused'))

    def archive(self, entries):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        path = Path(root.name)/'storage.tgz'
        with tarfile.open(path, 'w:gz') as tar:
            for name, kind, content in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                if kind == tarfile.REGTYPE:
                    member.size = len(content)
                    tar.addfile(member, io.BytesIO(content))
                else:
                    member.linkname = '/outside'
                    tar.addfile(member)
        return path

    def test_storage_hashes_actual_bytes_and_accepts_directories(self):
        entries = [('.', tarfile.DIRTYPE, b''), ('./private/a.txt', tarfile.REGTYPE, b'original')]
        first = recovery.storage_inventory(self.archive(entries))
        self.assertEqual(first['private/a.txt']['bytes'], 8)
        changed = recovery.storage_inventory(self.archive([('private/a.txt', tarfile.REGTYPE, b'changed!')]))
        self.assertNotEqual(first, changed)

    def test_storage_refuses_escaping_paths_links_and_duplicates(self):
        for name, kind in [('/absolute', tarfile.REGTYPE), ('a/../escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('fifo', tarfile.FIFOTYPE)]:
            with self.assertRaisesRegex(ValueError, 'unsafe path or entry'):
                recovery.storage_inventory(self.archive([(name, kind, b'')]))
        with self.assertRaisesRegex(ValueError, 'duplicate paths'):
            recovery.storage_inventory(self.archive([('./a', tarfile.REGTYPE, b'one'), ('a', tarfile.REGTYPE, b'two')]))

    def test_schema_discards_only_random_restriction_tokens(self):
        with patch.object(recovery, 'output', return_value='-- schema\n\\restrict first\nCREATE TABLE important();\n\\unrestrict first'):
            first = recovery.schema_hash('source')
        with patch.object(recovery, 'output', return_value='-- schema\n\\restrict second\nCREATE TABLE important();\n\\unrestrict second'):
            self.assertEqual(first, recovery.schema_hash('target'))
        with patch.object(recovery, 'output', return_value='-- schema\nCREATE TABLE wrong();'):
            self.assertNotEqual(first, recovery.schema_hash('target'))


if __name__ == '__main__':
    unittest.main()
