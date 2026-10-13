"""Exercise each new journal test with restored, bounded source mutations.

SQLite rows are real. Some negative controls check early diagnostic refusal
where another guard still prevents unsafe storage. No worker or engine runs.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def replace(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Mutation anchor is not unique')
    return text.replace(before, after, 1)


def method(text, name, before, after):
    start = text.index('    def ' + name + '(')
    end = text.find('\n    def ', start + 1)
    end = len(text) if end == -1 else end
    return text[:start] + replace(text[start:end], before, after) + text[end:]


def disable_guard(text, message):
    lines = text.splitlines(keepends=True)
    needle = f"raise ValueError('{message}')"
    found = [index for index, line in enumerate(lines) if needle in line]
    if len(found) != 1:
        raise ValueError('Guard anchor is not unique')
    index = found[0] - 1
    indentation = lines[index][:len(lines[index]) - len(lines[index].lstrip())]
    lines[index] = indentation + 'if False:\n'
    return ''.join(lines)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/admission_journal.py'
    tests = repo/'workers/odm_worker/test_admission_journal.py'
    original = source.read_bytes()
    text = original.decode()
    test_before = tests.read_bytes()
    all_tests = {node.name for node in ast.walk(ast.parse(test_before))
                 if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, kind='broken_behavior'):
        cases.append((label, test, transform, reason, kind))
    def guard(message):
        return lambda value: disable_guard(value, message)
    no_commit = lambda value: replace(value, "            connection.execute('COMMIT')", '            pass # interrupted before commit')
    no_identity = guard('Stored ODM admission identity differs')
    no_start_intent = guard('Stored ODM start intent differs')
    # The entry check and the connection-wide unknown-phase check intentionally
    # share a message. Select the entry block explicitly for field corruption.
    no_start_intent = lambda value: replace(value,
        "    if phase not in ('accepted', 'started') or (phase == 'accepted' and context is not None) or (phase == 'started' and not isinstance(context, dict)):",
        '    if False:')
    no_queue = lambda value: replace(value, '            if pending >= max_queued:', '            if False:')
    admit_return = lambda value, replacement: method(value, 'admit', '                return existing, False', replacement)
    start_return = lambda value, replacement: method(value, 'start', '                return existing, False', replacement)
    no_alias_preflight = lambda value: replace(value, '            if ancestor.is_symlink():', '            if False:')
    no_mode = lambda value: replace(value, 'stat.S_IMODE(info.st_mode) & 0o077', 'False')
    no_factory = guard('ODM admission factory identity differs')

    add('uncommitted-admission', 'test_committed_admission_survives_reopen', no_commit, 'reopen must retain the complete original admission')
    add('replay-calls-factory', 'test_exact_replay_precedes_capacity', lambda v: admit_return(v, '                factory(json.loads(request_json))\n                return existing, False'), 'replay must not call a new admission factory')
    for test in ('test_changed_payload_conflicts','test_changed_source_url_conflicts'):
        add('changed-request-replay-'+test, test, lambda v: replace(v, '                if encoded(existing.request, canonical=True) != request_json:', '                if False:'), 'IdentityConflict not raised')
    for test in ('test_queue_ceiling_is_atomic','test_zero_queue_rejects_new_work'):
        add('missing-queue-bound-'+test, test, no_queue, 'QueueFull not raised')
    add('boolean-queue-ceiling', 'test_invalid_queue_ceiling', lambda v: replace(v, ' or isinstance(max_queued, bool)', ''), 'ValueError not raised')
    add('invalid-request-id', 'test_invalid_request_id', guard('ODM admission request ID is invalid'), 'ValueError not raised')
    add('nan-request', 'test_non_json_request_is_not_saved', lambda v: replace(v, 'allow_nan=False', 'allow_nan=True'), 'ValueError not raised')
    for test in ('test_factory_identity_guard','test_factory_reference_guard','test_factory_status_guard'):
        add('late-factory-refusal-'+test, test, no_factory, 'does not match', 'diagnostic_refusal')
    add('swallowed-factory-interruption', 'test_factory_exception_rolls_back', lambda v: replace(v,
        '            reference, admission = factory(json.loads(request_json))',
        '            try:\n                reference, admission = factory(json.loads(request_json))\n            except RuntimeError:\n                return None, False'), 'RuntimeError not raised')
    no_final_sync = lambda v: replace(v, "            connection.execute('COMMIT')\n            synchronize(self.root)", "            connection.execute('COMMIT')\n            pass # missing directory synchronization")
    add('missing-admission-directory-sync', 'test_commit_directory_error_replays_original_admission', no_final_sync, 'OSError not raised')
    add('missing-start-directory-sync', 'test_start_directory_error_retains_original_intent', no_final_sync, 'OSError not raised')
    add('caller-request-alias', 'test_detached_request_and_receipt', lambda v: method(v, 'admit',
        '        return result, True', '        object.__setattr__(result, "request", request)\n        return result, True'), 'caller mutation must not alter the returned request snapshot')
    add('first-start-no-permission', 'test_start_once_and_remove_from_accepted_queue', lambda v: method(v, 'start', '        return result, True', '        return result, False'), 'first start must commit its permission')
    add('repeated-start-permission', 'test_exact_start_replay_does_not_grant_another_start', lambda v: start_return(v, '                return existing, True'), 'start replay must not repeat uncertain external work')
    add('changed-start-context', 'test_changed_start_context_conflicts', lambda v: replace(v, '                if encoded(existing.started_context, canonical=True) != context_json:', '                if False:'), 'IdentityConflict not raised')
    add('foreign-start-reference', 'test_wrong_or_missing_start_admission_conflicts', lambda v: replace(v, '            if existing is None or existing.job_reference != reference:', '            if existing is None:'), 'IdentityConflict not raised')
    add('non-json-start-context', 'test_start_context_must_be_json_object', lambda v: replace(v, 'allow_nan=False', 'allow_nan=True'), 'ValueError not raised')
    add('caller-start-context-alias', 'test_start_context_is_detached', lambda v: method(v, 'start',
        '        return result, True', '        object.__setattr__(result, "started_context", context)\n        return result, True'), 'caller mutation must not alter the returned start snapshot')
    add('started-replay-receipt-change', 'test_started_admission_replay_retains_original_receipt', lambda v: admit_return(v,
        '                existing.admission["callbackId"] = "changed"\n                return existing, False'), 'started replay must retain original receipt')
    add('accepted-leaks-into-started-list', 'test_started_list_excludes_accepted', lambda v: method(v, 'started', " WHERE phase='started' ORDER BY", ' ORDER BY'), 'accepted work must not appear as started')
    add('lost-start-context-field', 'test_all_sqlite_fields_and_phase_persist', lambda v: replace(v,
        '(context_json, request_id))', '("{}", request_id))'), "{'attempt': 'original'}")
    add('stored-request-corruption', 'test_stored_identity_corruption_is_rejected', no_identity, 'ValueError not raised')
    add('stored-receipt-corruption', 'test_stored_receipt_corruption_is_rejected', no_identity, 'ValueError not raised')
    add('stored-start-corruption', 'test_stored_start_corruption_is_rejected', no_start_intent, 'ValueError not raised')
    add('stored-receipt-encoding', 'test_stored_receipt_encoding_must_match', guard('Stored ODM admission encoding differs'), 'ValueError not raised')
    add('stored-receipt-nan', 'test_stored_receipt_nonfinite_json_refuses', lambda v: replace(v, 'allow_nan=False', 'allow_nan=True'), 'ValueError not raised')
    add('stored-context-encoding', 'test_stored_context_encoding_must_match', guard('Stored ODM start context encoding differs'), 'ValueError not raised')
    add('stored-context-nan', 'test_stored_context_nonfinite_json_refuses', lambda v: replace(v, 'allow_nan=False', 'allow_nan=True'), 'ValueError not raised')
    add('new-root-parent-not-synchronized', 'test_new_root_synchronizes_parent_before_database', lambda v: replace(v, '            synchronize(self.root.parent)', '            pass # missing parent synchronization'), 'new root must synchronize its parent before database creation')
    add('unknown-phase-hidden-as-empty', 'test_unknown_phase_is_not_an_empty_queue', lambda v: replace(v,
        "            if connection.execute(\"SELECT 1 FROM admissions WHERE phase NOT IN ('accepted','started') OR phase IS NULL LIMIT 1\").fetchone() is not None:",
        '            if False:'), 'ValueError not raised')
    add('public-root', 'test_private_root_and_database', no_mode, 'ValueError not raised')
    add('public-journal', 'test_public_database_refuses', no_mode, 'ValueError not raised')
    add('root-alias', 'test_root_symlink_refuses', lambda v: replace(no_alias_preflight(v), 'info = path.lstat()', 'info = path.stat()'), 'ValueError not raised')
    add('parent-alias-creation', 'test_parent_symlink_refuses_before_creating_root', no_alias_preflight, 'ValueError not raised')
    add('journal-hardlink', 'test_database_symlink_and_hardlink_refuse', lambda v: replace(v, '(not directory and info.st_nlink != 1)', 'False'), 'ValueError not raised')
    add('special-file-reaches-sqlite', 'test_special_database_refuses', lambda v: replace(v, 'stat.S_ISREG(info.st_mode)', 'True'), 'special path reached SQLite')
    add('foreign-root-owner', 'test_foreign_owner_refuses', lambda v: replace(v, 'info.st_uid != os.getuid()', 'False'), 'ValueError not raised')
    add('unsafe-sqlite-companions', 'test_private_sqlite_companions_before_database_access', lambda v: replace(v, '                private(companion, False)', '                pass # missing companion validation'), 'unsafe companion reached SQLite')
    add('transient-companion-disappearance-refuses', 'test_sqlite_companions_disappearing_before_lstat_are_allowed', lambda v: replace(v,
        '                except (FileNotFoundError, ValueError):',
        '                except (FileNotFoundError, ValueError):\n                    raise'), 'No such file or directory')
    add('unavailable-companion-reaches-sqlite', 'test_unavailable_companions_refuse_before_sqlite', lambda v: replace(v,
        '''                except (FileNotFoundError, ValueError):
                    # SQLite can unlink a companion during lookup, leaving zero-link
                    # inode metadata. Ignore retirement only when the name is gone.
                    try:
                        companion.lstat()
                    except FileNotFoundError:
                        pass
                    else:
                        raise''',
        '                except (OSError, ValueError):\n                    pass'), 'Unavailable companion reached SQLite')
    add('unsupported-wal', 'test_unavailable_wal_mode_refuses', guard('ODM journal WAL mode unavailable'), 'ValueError not raised')
    add('normal-instead-of-full', 'test_full_sync_overrides_a_normal_connection_default', lambda v: replace(v, "connection.execute('PRAGMA synchronous=FULL')", "connection.execute('PRAGMA synchronous=NORMAL')"), 'journal must override NORMAL with FULL synchronization')
    add('foreign-schema-overwritten', 'test_foreign_schema_refuses_without_changing_it', guard('ODM admission journal schema differs'), 'ValueError not raised')
    add('foreign-version-accepted', 'test_unsupported_schema_version_refuses', guard('ODM admission journal schema differs'), 'ValueError not raised')
    add('unknown-schema-objects', 'test_unknown_schema_objects_refuse_without_changes', lambda v: replace(v,
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        "SELECT type,name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"), 'ValueError not raised')
    add('invalid-timeout-accepted', 'test_timeout_and_absolute_root_guards', guard('ODM journal timeout must be positive and finite'), 'ValueError not raised')
    add('relative-root-accepted', 'test_timeout_and_absolute_root_guards', guard('ODM journal root must be absolute'), 'ValueError not raised')
    add('process-exit-loses-admission', 'test_subprocess_exit_retains_exact_admission', no_commit, 'committed admission must survive process exit')
    add('concurrent-uncommitted-admissions', 'test_concurrent_admission_has_one_identity', no_commit, 'concurrent admission must create only one identity')
    add('concurrent-repeated-start-permission', 'test_concurrent_start_grants_permission_once', lambda v: start_return(v, '                return existing, True'), 'concurrent start must grant only one permission')
    add('lock-budget-not-forwarded', 'test_busy_writer_wait_is_bounded', lambda v: replace(v, 'timeout=self.timeout, isolation_level=None', 'timeout=0, isolation_level=None'), 'configured lock budget must reach native SQLite')

    covered = {row[1] for row in cases}
    if covered != all_tests:
        raise ValueError('Changed journal tests lack targeted controls: ' + repr(sorted(all_tests-covered)))
    outcomes = []
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    def execute(label, tests_selected=None):
        arguments = [sys.executable, '-B', str(tests)]
        if tests_selected:
            arguments += ['Checks.' + tests_selected]
        result = subprocess.run(arguments, cwd=repo, env=environment, capture_output=True, timeout=20)
        output = result.stdout + result.stderr
        (out/(label+'.log')).write_bytes(output)
        return result.returncode, output.decode(errors='replace')
    def positive(label, payload):
        source.write_bytes(payload)
        code, output = execute(label)
        if code != 0 or not re.search(r'Ran \d+ tests', output):
            raise AssertionError(label + ': positive control failed\n' + output)
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original+b'\n# Harmless proof-control comment.\n')
        positive('restored-after-harmless', original)
        for label, test, transform, reason, kind in cases:
            try:
                mutated = transform(text)
                ast.parse(mutated)
                source.write_text(mutated)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output):
                    raise AssertionError(label + ': targeted test did not fail')
                # Require the final diagnostic, rather than a source line that
                # happens to mention the intended assertion in its traceback.
                lines = output.splitlines()
                starts = [index for index, line in enumerate(lines)
                          if re.match(r'^(?:[A-Za-z_][\w.]*Error|[\w.]*Conflict):', line)]
                # unittest appends an equality message after a multiline diff.
                # Include that diagnostic block, excluding traceback source.
                diagnostic = ''
                if starts:
                    end = next((index for index in range(starts[-1] + 1, len(lines))
                                if lines[index].startswith('------')), len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic:
                    raise AssertionError(label + ': wrong failure: ' + repr(diagnostic))
                outcomes.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:
                source.write_bytes(original)
        positive('restored-final', original)
        if source.read_bytes() != original or tests.read_bytes() != test_before:
            raise AssertionError('Source or tests were not restored')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original).hexdigest(),
                                                        'testsSha256':hashlib.sha256(test_before).hexdigest()},indent=2)+'\n')
        print(json.dumps({'controls':len(outcomes),'positive':4,'broken':len(cases),'testsCovered':len(covered)}))
    finally:
        source.write_bytes(original)
        descriptor=os.open(source,os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    run(args.repo.resolve(),args.out.absolute())
