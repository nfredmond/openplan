"""Run key custody controls in private copies and retain intended failures."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

OPS = Path(__file__).resolve().parents[1]


def prove(destination):
    helper = 'database_key_custody.py'
    full = 'full_restore.py'
    shell = 'disposable-restore-drill.sh'
    cases = []
    def add(name, before, after, test, module=helper, survive=False):
        cases.append((name, module, before, after, test, survive))
    add('harmless helper comment', 'KEY_MOUNT =', '# Harmless control\nKEY_MOUNT =', 'DatabaseKeyCustodyTests', survive=True)
    add('context precedence', 'if context or not host:', 'if not host:', 'DatabaseKeyCustodyTests.test_local_endpoint_and_context_precedence')
    add('remote endpoint', "if not endpoint.startswith('unix://'):", 'if False:', 'DatabaseKeyCustodyTests.test_local_endpoint_and_context_precedence')
    add('container ID', "info['Id'] != service['id']", 'False', 'DatabaseKeyCustodyTests.test_container_identity')
    add('container image', "info['Image'] != service['imageId']", 'False', 'DatabaseKeyCustodyTests.test_container_identity')
    add('container label', "info['Config']['Labels'].get('com.supabase.cli.project') != service['project']", 'False', 'DatabaseKeyCustodyTests.test_container_identity')
    add('container name', "service['name'] != 'supabase_db_' + service['project']", 'False', 'DatabaseKeyCustodyTests.test_container_identity')
    add('readonly mount', "or mounts[0]['RW']", '', 'DatabaseKeyCustodyTests.test_mount_and_canonical_file')
    add('bind mount type', "or mounts[0]['Type'] != 'bind'", '', 'DatabaseKeyCustodyTests.test_mount_and_canonical_file')
    add('canonical bind', 'path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode)', 'not stat.S_ISREG(path.stat().st_mode)', 'DatabaseKeyCustodyTests.test_mount_and_canonical_file')
    add('key byte format', "if not re.fullmatch(rb'[0-9a-fA-F]{64}\\n?', content):", 'if False:', 'DatabaseKeyCustodyTests.test_private_key_bytes')
    add('private archive', 'if private and metadata.st_mode & 0o077:', 'if False:', 'DatabaseKeyCustodyTests.test_private_key_bytes')
    add('archive immutability', 'if read_key(path, private=True) != content:', 'if False:', 'DatabaseKeyCustodyTests.test_private_key_bytes')
    add('key regular identity', 'path.resolve() != path or not stat.S_ISREG(metadata.st_mode)', 'False', 'DatabaseKeyCustodyTests.test_private_key_bytes')
    add('private custody directory', 'if destination.resolve() != destination or destination.stat().st_mode & 0o077:', 'if False:', 'DatabaseKeyCustodyTests.test_capture_private_intent_and_independent_target')
    add('independent target', "if source['id'] == target['id'] or (source_binding['device'], source_binding['inode']) == (target_binding['device'], target_binding['inode']):", 'if False:', 'DatabaseKeyCustodyTests.test_capture_private_intent_and_independent_target')
    add('intent privacy', 'or path.stat().st_mode & 0o077', 'or False', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('intent regular identity', 'if (path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode)', 'if (False', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('capture intent equality', 'if record is not None and record != expected:', 'if False:', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('apply intent equality', 'if read_intent(record_path) != plan:', 'if False:', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('incoming payload hash', "or hashlib.sha256(incoming).hexdigest() != plan['incomingSha256']", 'or False', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('previous payload hash', "or hashlib.sha256(before).hexdigest() != plan['beforeSha256']", 'or False', 'DatabaseKeyCustodyTests.test_intent_privacy_and_payload_changes')
    add('source mounted bytes', '    require_mounted_bytes(source, incoming)\n', '', 'DatabaseKeyCustodyTests.test_source_and_initial_target_mount_must_match_capture')
    add('initial target mounted bytes', '        require_mounted_bytes(target, before)\n', '', 'DatabaseKeyCustodyTests.test_source_and_initial_target_mount_must_match_capture')
    add('mounted byte comparison', 'if mounted != expected:', 'if False:', 'DatabaseKeyCustodyTests.test_source_and_initial_target_mount_must_match_capture')
    add('mounted immutable container ID', "['docker', 'exec', service['id'], 'cat', KEY_MOUNT]", "['docker', 'exec', service['name'], 'cat', KEY_MOUNT]", 'DatabaseKeyCustodyTests.test_source_and_initial_target_mount_must_match_capture')
    add('stopped target replay', '    if record_path.exists():\n', '    if record_path.exists():\n        require_mounted_bytes(target, read_key(before_archive, private=True))\n', 'DatabaseKeyCustodyTests.test_existing_key_intent_does_not_require_a_running_target')
    add('capture binding', "if not binding_matches(record['binding'], target_binding, incoming):", 'if False:', 'DatabaseKeyCustodyTests.test_changed_binding_requires_exact_recovery_bytes')
    add('apply binding', "if not binding_matches(plan['binding'], binding, incoming):", 'if False:', 'DatabaseKeyCustodyTests.test_changed_binding_requires_exact_recovery_bytes')
    add('binding recovery metadata', "return ({k: v for k, v in current.items() if k != 'inode'}\n            == {k: v for k, v in recorded.items() if k != 'inode'}\n            and read_key(Path(current['path'])) == incoming)", "return read_key(Path(current['path'])) == incoming", 'DatabaseKeyCustodyTests.test_changed_binding_requires_exact_recovery_bytes')
    add('unrelated target bytes', "if read_key(path) not in (incoming, before):\n        raise ValueError('Database key target has unrelated bytes')", "if False:\n        raise ValueError('Database key target has unrelated bytes')", 'DatabaseKeyCustodyTests.test_unrelated_current_bytes_are_retained')
    add('binding after stop', "if inspect_binding(target) != binding:\n        raise ValueError('Database key binding changed while stopping')", "if False:\n        raise ValueError('Database key binding changed while stopping')", 'DatabaseKeyCustodyTests.test_changed_binding_or_bytes_while_stopping')
    add('bytes after stop', "if read_key(path) not in (incoming, before):\n        raise ValueError('Database key bytes changed while stopping')", "if False:\n        raise ValueError('Database key bytes changed while stopping')", 'DatabaseKeyCustodyTests.test_changed_binding_or_bytes_while_stopping')
    add('binding before replacement', "if inspect_binding(target) != binding:\n            raise ValueError('Database key file identity changed')", "if False:\n            raise ValueError('Database key file identity changed')", 'DatabaseKeyCustodyTests.test_changed_identity_during_staging_refuse_replacement')
    add('bytes before replacement', "if read_key(path) not in (incoming, before):\n            raise ValueError('Database key bytes changed before replacement')", "if False:\n            raise ValueError('Database key bytes changed before replacement')", 'DatabaseKeyCustodyTests.test_changed_bytes_during_staging_refuse_replacement')
    add('atomic replacement', 'os.replace(temporary, path)', 'path.write_bytes(incoming)', 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    add('file sync', 'os.fsync(handle.fileno())', 'pass # omitted sync', 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    # The last occurrence is the committed replacement directory, rather than capture.
    add('directory sync', "os.fsync(directory_fd)\n        finally:", "pass # omitted directory sync\n        finally:", 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    add('preserved mode', "os.fchmod(handle.fileno(), binding['mode'])", 'os.fchmod(handle.fileno(), 0o600)', 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    add('stop scope', "['docker', 'stop', target['id']]", "['docker', 'stop', 'wrong-target']", 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    add('restart dispatch', "subprocess.run(['docker', 'start', target['id']], check=True, stdout=subprocess.DEVNULL)", 'pass # omitted restart', 'DatabaseKeyCustodyTests.test_atomic_replacement_restart_and_actual_mount')
    add('write verification', 'if read_key(path) != incoming:', 'if False:', 'DatabaseKeyCustodyTests.test_failed_write_or_mount_cannot_claim_success')
    add('mount verification', 'if actual != incoming:', 'if False:', 'DatabaseKeyCustodyTests.test_failed_write_or_mount_cannot_claim_success')
    add('readiness refusal', 'if ready.returncode == 0:', 'if True:', 'DatabaseKeyCustodyTests.test_unready_target_cannot_claim_success')
    add('recovery private directory', "def recover_target_key(destination: Path) -> dict:\n    \"\"\"Recover only a previously captured disposable target's key restart.\"\"\"\n    if destination.resolve() != destination or destination.stat().st_mode & 0o077:", "def recover_target_key(destination: Path) -> dict:\n    \"\"\"Recover only a previously captured disposable target's key restart.\"\"\"\n    if False:", 'DatabaseKeyCustodyTests.test_key_recovery_requires_an_owned_private_target')
    add('recovery target scope', "if not re.fullmatch(r'openplan-restore-target-[0-9]+', plan['targetProject']):", 'if False:', 'DatabaseKeyCustodyTests.test_key_recovery_requires_an_owned_private_target')
    add('CLI action refusal', "if len(sys.argv) != 3 or sys.argv[1] != '--recover-target-key':", 'if False:', 'DatabaseKeyCustodyTests.test_cli_refuses_unknown_action_before_transport')
    add('harmless restore comment', 'SERVICES =', '# Harmless control\nSERVICES =', 'FullRestoreTests', full, True)
    add('encrypted target refusal', "if sql(db, \"SELECT to_regclass('vault.secrets') IS NOT NULL\") == 't' and sql(db, 'SELECT count(*) FROM vault.secrets') != '0':", 'if False:', 'FullRestoreTests.test_existing_encrypted_secrets_are_refused', full)
    add('snapshot key recheck', "    prepare_database_key_restore(source['db'], target['db'], destination)\n    captured_schema", '    captured_schema', 'FullRestoreTests.test_restore_actually_compares_target_before_starting_services', full)
    add('restore key dispatch', "key_custody = apply_database_key_restore(target['db'], key_plan, destination)", "key_custody = {'targetRestarted': False}", 'FullRestoreTests.test_restore_actually_compares_target_before_starting_services', full)
    loader = "_key_spec = importlib.util.spec_from_file_location('openplan_database_key_custody', Path(__file__).with_name('database_key_custody.py'))\nassert _key_spec is not None and _key_spec.loader is not None\n_keys = importlib.util.module_from_spec(_key_spec)\n_key_spec.loader.exec_module(_keys)"
    add('absolute sibling loader', loader, 'import database_key_custody as _keys', 'FullRestoreTests.test_absolute_loader_uses_its_own_sibling_in_isolated_python', full)
    add('harmless canary comment', '  ENCRYPTED_CANARY=', '  # Harmless canary control\n  ENCRYPTED_CANARY=', 'EncryptedCanaryTests', shell, True)
    add('canary refusal', '  test "$ENCRYPTED_CANARY" = 1', '  : "$ENCRYPTED_CANARY"', 'EncryptedCanaryTests', shell)
    add('canary projection', "WHERE name = 'openplan_recovery_canary' AND decrypted_secret =", "WHERE name = 'openplan_recovery_canary' AND name =", 'EncryptedCanaryTests', shell)
    originals = {m: (OPS/m).read_bytes() for m in [helper,full,shell]}
    records = []
    with tempfile.TemporaryDirectory(prefix='openplan-key-controls-') as root:
        scratch = Path(root); (scratch/'tests').mkdir()
        for module in originals: shutil.copyfile(OPS/module,scratch/module)
        for test in ['test_database_key_custody.py','test_full_restore.py','test_restore_encrypted_canary.py']: shutil.copyfile(OPS/'tests'/test,scratch/'tests'/test)
        try:
            for name,module,before,after,test,survive in cases:
                original = originals[module].decode(); assert before in original, name
                # File sync must exercise staging, rather than the earlier archive writer.
                modified = original.replace(before,after,1) if name != 'file sync' else original.rsplit(before,1)[0]+after+original.rsplit(before,1)[1]
                (scratch/module).write_text(modified)
                filename = {helper:'test_database_key_custody',full:'test_full_restore',shell:'test_restore_encrypted_canary'}[module]
                run = subprocess.run([sys.executable,'-B','-m','unittest', filename+'.'+test],cwd=scratch/'tests',env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
                (scratch/module).write_bytes(originals[module])
                if (run.returncode==0) != survive or (not survive and ('FAIL:' not in run.stdout or 'ERROR:' in run.stdout)):
                    raise RuntimeError(name+' did not fail at its intended assertion:\n'+run.stdout)
                records.append({'name':name,'module':module,'test':test,'result':'survived' if survive else 'intended assertion failure','output':run.stdout})
            for filename in ['test_database_key_custody.py','test_full_restore.py','test_restore_encrypted_canary.py']:
                run = subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','tests','-p',filename],cwd=scratch,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
                if run.returncode: raise RuntimeError('Restored control failed:\n'+run.stdout)
                records.append({'name':'restored '+filename,'result':'survived','output':run.stdout})
        finally:
            for module,content in originals.items():
                (scratch/module).write_bytes(content)
                assert (OPS/module).read_bytes()==content, 'Owned original changed'
    result={'sourceSha256':{m:hashlib.sha256(b).hexdigest() for m,b in originals.items()},'controls':records,'limits':'Synthetic files and mocked Docker. No native backend or physical power-loss acceptance.'}
    Path(destination).write_text(json.dumps(result,indent=2)+'\n')
    print(str(len(records))+' key custody controls behave as declared; original bytes unchanged')


if __name__ == '__main__': prove(sys.argv[1])
