"""Run harmless and targeted collector faults, restoring exact source in finally."""
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile


def main(output):
    directory = Path(__file__).parent
    source = directory/'fetch_pr_details.py'
    tests = directory/'test_fetch_pr_details.py'
    original = source.read_bytes()
    body = original.decode()
    records = []
    shutil.rmtree(directory/'__pycache__', ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)
    faults = [
        ('ignore-api-failure', 'if result.returncode:', 'if False:',
         'test_api_failure_is_never_cached_at_any_endpoint', 'API unavailable'),
        ('omit-slurp', "args.extend(['--paginate', '--slurp'])", "args.extend(['--paginate'])",
         'test_all_pages_are_flattened_in_order', 'CLI must slurp every list endpoint'),
        ('discard-pages', 'records.extend(page)', 'records.extend([])',
         'test_all_pages_are_flattened_in_order', 'all 190 files must survive pagination'),
        ('ignore-json-failure', "raise CollectionError(f'API malformed JSON: {endpoint}') from error", 'return {}',
         'test_malformed_transport_is_refused', 'CollectionError not raised'),
        ('allow-list-as-object', 'if not isinstance(payload, dict):', 'if False:',
         'test_malformed_transport_is_refused', 'CollectionError not raised'),
        ('allow-missing-pages', 'if not isinstance(payload, list) or not payload:', 'if False:',
         'test_malformed_transport_is_refused', 'CollectionError not raised'),
        ('allow-malformed-page', 'if not isinstance(page, list) or any(not isinstance(item, dict) for item in page):', 'if False:',
         'test_malformed_transport_is_refused', 'CollectionError not raised'),
        ('ignore-pr-identity', "raise CollectionError(f'API malformed PR identity: {number}')", 'pass',
         'test_wrong_pr_identity_is_refused', 'malformed PR identity'),
        ('allow-missing-filename', "raise CollectionError(f'API malformed file name: {number}')", 'pass',
         'test_malformed_row_is_not_dropped', 'CollectionError not raised'),
        ('allow-malformed-body', "raise CollectionError(f'API malformed comment body: {number}/{name}')", 'pass',
         'test_malformed_row_is_not_dropped', 'CollectionError not raised'),
        ('reuse-legacy-cache', 'if valid_cache(cached, number):', 'if path.exists():',
         'test_legacy_cache_refreshes_and_failed_refresh_preserves_history', 'CollectionError not raised'),
        ('ignore-cache-schema', "record.get('schema') != SCHEMA", 'False',
         'test_only_intact_complete_current_cache_is_reused', 'altered cache must be rejected'),
        ('ignore-cache-number', "record.get('number') != number", 'False',
         'test_only_intact_complete_current_cache_is_reused', 'altered cache must be rejected'),
        ('allow-boolean-cache-number', "type(record.get('number')) is not int", 'False',
         'test_only_intact_complete_current_cache_is_reused', 'cache identity cannot be boolean'),
        ('ignore-cache-completion', "collection.get('complete') is not True", 'False',
         'test_only_intact_complete_current_cache_is_reused', 'altered cache must be rejected'),
        ('ignore-cache-counts',
         "if type(counts.get(name)) is not int or counts[name] != len(rows):\n            return False",
         'if False:\n            return False',
         'test_only_intact_complete_current_cache_is_reused', 'altered cache must be rejected'),
        ('ignore-cache-receipt', "record.get('receiptSha256') == digest(record)", 'True',
         'test_only_intact_complete_current_cache_is_reused', 'altered cache must be rejected'),
        ('erase-before-publish', 'os.replace(temporary, path)', 'path.unlink(missing_ok=True)\n        os.replace(temporary, path)',
         'test_failed_atomic_publication_preserves_previous_record', 'failed publication must preserve the previous cache path'),
        ('hide-upstream-census', "'fileCountMatchesDeclared': len(lists['files']) == pr['changed_files']", "'fileCountMatchesDeclared': True",
         'test_upstream_file_census_discrepancy_stays_explicit', 'True is not false'),
        ('omit-api-deadline', 'text=True, timeout=60', 'text=True',
         'test_all_pages_are_flattened_in_order', 'API calls need a bounded deadline'),
        ('ignore-timeout-classification', "raise CollectionError(f'API deadline exceeded: {endpoint}') from error", 'return {}',
         'test_timeout_is_unavailable_without_publication', 'API deadline exceeded'),
        ('allow-duplicate-selection',
         "if any(not re.fullmatch(r'[1-9][0-9]*', value) for value in selected) or len(set(selected)) != len(selected):",
         'if False:', 'test_duplicate_selection_is_not_collected', 'CollectionError not raised'),
        ('allow-absent-comment-body',
         "if 'body' not in item or not isinstance(item['body'], str):",
         "if item.get('body') is not None and not isinstance(item['body'], str):",
         'test_required_comment_fields_are_not_invented', 'missing comment fields must be refused before projection'),
        ('allow-null-comment-body',
         "if 'body' not in item or not isinstance(item['body'], str):",
         "if 'body' not in item or (item['body'] is not None and not isinstance(item['body'], str)):",
         'test_comment_field_types_are_refused', 'comment fields must retain their declared string type'),
        ('allow-nested-login', "not isinstance(author.get('login'), str)", 'False',
         'test_nested_comment_authors_are_refused_before_signing', 'nested author must be refused before signing'),
        ('allow-missing-comment-metadata',
         "if field not in item or not isinstance(item[field], str):",
         "if field in item and not isinstance(item[field], str):",
         'test_required_comment_fields_are_not_invented', 'missing comment fields must be refused before projection'),
        ('allow-null-comment-metadata',
         "if field not in item or not isinstance(item[field], str):",
         "if field not in item or (item[field] is not None and not isinstance(item[field], str)):",
         'test_comment_field_types_are_refused', 'comment fields must retain their declared string type'),
        ('skip-projected-row-validation', 'validate_comment(row, name, number, projected=True)', 'pass',
         'test_projected_cache_rows_are_validated_even_with_new_digest',
         'malformed projected cache row must be rejected despite matching digest'),
        ('reuse-old-comment-policy', "collection.get('commentRowPolicy') != COMMENT_ROW_POLICY", 'False',
         'test_prior_v2_policy_is_not_reused', 'prior v2 receipt must refresh under the explicit comment policy'),
        ('erase-before-malformed-refresh', 'record = collect(number)',
         "path.write_text('erased')\n        record = collect(number)",
         'test_bad_v2_failed_refresh_preserves_bytes_without_success', 'malformed refresh must preserve old bytes'),
        ('claim-success-before-refresh', 'record = collect(number)',
         "print('fresh success')\n        record = collect(number)",
         'test_bad_v2_failed_refresh_preserves_bytes_without_success', 'malformed refresh must not claim fresh success'),
        ('reject-deleted-authors', 'if author is not None and invalid_author:', 'if invalid_author:',
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'deleted authors must remain collectable'),
        ('reject-empty-review-body', "if 'body' not in item or not isinstance(item['body'], str):",
         "if 'body' not in item or not isinstance(item['body'], str) or (name == 'reviews' and not item['body']):",
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'empty review bodies must remain collectable'),
        ('remove-comment-truncation', "(item.get('body') or '')[:limit]", "(item.get('body') or '')",
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'reader text must retain existing truncation limits'),
        ('numeric-projection-breaks-actual-reader', "    record['collection'] =",
         "    record['issueComments'][0]['user'] = 7\n    record['collection'] =",
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'actual full_text.py must read valid/deleted/empty rows'),

        ('unlink-before-malformed-refresh', 'record = collect(number)',
         "path.unlink(missing_ok=True)\n        record = collect(number)",
         'test_bad_v2_failed_refresh_preserves_bytes_without_success', 'malformed refresh must preserve historical path'),
        ('skip-bad-v2-repair', '        publish(path, record)', '        pass',
         'test_bad_v2_failed_refresh_preserves_bytes_without_success', 'valid retry must replace bad v2 with a validated receipt'),
        ('invent-empty-body', "(item.get('body') or '')[:limit]", "(item.get('body') or 'invented')[:limit]",
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'empty review bodies must remain empty strings'),
        ('invent-deleted-author', "'user': (item.get('user') or {}).get('login')",
         "'user': (item.get('user') or {}).get('login') or 'invented-author'",
         'test_actual_full_text_reads_valid_deleted_and_empty_rows', 'deleted authors must retain null identity'),

        ('allow-file-status', "raise CollectionError(f'API malformed file status: {number}')", 'pass',
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-file-additions', "if type(item.get(field)) is not int:",
         "if field != 'additions' and type(item.get(field)) is not int:",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-file-deletions', "if type(item.get(field)) is not int:",
         "if field != 'deletions' and type(item.get(field)) is not int:",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-boolean-file-counts', "type(item.get(field)) is not int", "not isinstance(item.get(field), int)",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-pr-additions', "if type(pr.get(field)) is not int:",
         "if field != 'additions' and type(pr.get(field)) is not int:",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-pr-deletions', "if type(pr.get(field)) is not int:",
         "if field != 'deletions' and type(pr.get(field)) is not int:",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-boolean-cache-pr-changed-files', "if type(pr.get(field)) is not int:",
         "if (field != 'changed_files' or type(pr.get(field)) is not bool) and type(pr.get(field)) is not int:",
         'test_consumed_cache_fields_refuse_even_with_recomputed_digest', 'malformed consumed cache field must refuse despite recomputed digest'),
        ('allow-boolean-pr-counts', "type(pr.get(field)) is not int", "not isinstance(pr.get(field), int)",
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('allow-negative-cache-file-census', "if pr['changed_files'] < 0:", 'if False:',
         'test_consumed_cache_fields_refuse_even_with_recomputed_digest', 'malformed consumed cache field must refuse despite recomputed digest'),
        ('allow-pr-merge-sha', "raise CollectionError(f'API malformed PR merge_commit_sha: {number}')", 'pass',
         'test_consumed_source_fields_are_refused_before_signing', 'malformed consumed source field must refuse before signing'),
        ('skip-file-cache-validation', 'validate_file(row, number)', 'pass',
         'test_consumed_cache_fields_refuse_even_with_recomputed_digest', 'malformed consumed cache field must refuse despite recomputed digest'),
        ('skip-pr-cache-validation', "validate_pr_projection(record.get('pr'), number)", 'pass',
         'test_consumed_cache_fields_refuse_even_with_recomputed_digest', 'malformed consumed cache field must refuse despite recomputed digest'),
        ('reuse-old-consumed-policy', "collection.get('consumedProjectionPolicy') != CONSUMED_PROJECTION_POLICY", 'False',
         'test_prior_consumed_projection_policy_requires_refresh', 'prior consumed projection policy must refresh erased distinctions'),
        ('reject-zero-file-counts', "if type(item.get(field)) is not int:",
         "if type(item.get(field)) is not int or item.get(field) == 0:",
         'test_actual_both_readers_accept_zero_ordinary_deleted_empty', 'valid zero/ordinary counts and deleted/empty comments must collect'),
        ('corrupt-counts-for-readers', "    record['collection'] =",
         "    record['files'][0]['additions'] = 999\n    record['collection'] =",
         'test_actual_both_readers_accept_zero_ordinary_deleted_empty', 'both readers must retain actual file counts'),
        ('consumed-erase-before-refresh', 'record = collect(number)',
         "path.write_text('erased')\n        record = collect(number)",
         'test_consumed_bad_refresh_preserves_history_and_recovers', 'consumed refusal must preserve historical bytes'),
        ('consumed-unlink-before-refresh', 'record = collect(number)',
         "path.unlink(missing_ok=True)\n        record = collect(number)",
         'test_consumed_bad_refresh_preserves_history_and_recovers', 'consumed refusal must preserve historical path'),
        ('consumed-success-before-refresh', 'record = collect(number)',
         "print('success')\n        record = collect(number)",
         'test_consumed_bad_refresh_preserves_history_and_recovers', 'consumed refusal must print no success line'),
        ('consumed-skip-recovery-publication', '        publish(path, record)', '        pass',
         'test_consumed_bad_refresh_preserves_history_and_recovers', 'recovery must replace malformed bytes'),
        ('allow-malformed-source-before-reader-probe', "if type(item.get(field)) is not int:", 'if False:',
         'test_actual_readers_expose_historical_malformed_input_after_refusal', 'malformed source cannot publish before actual reader probe'),
    ]

    def run(label, mutated, method=None, needle=None):
        source.write_bytes(mutated)
        args = [sys.executable, '-I', '-B', str(tests), '-v']
        if method:
            args.append('CollectorTests.' + method)
        result = subprocess.run(args, cwd=directory, capture_output=True, text=True,
                                timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        text = result.stdout + result.stderr
        (output/(label+'.log')).write_text(text)
        if method:
            failed_methods = re.findall(r'^FAIL: (\w+) \(', text, re.M)
            diagnostics = re.findall(r'^AssertionError: (.*?)(?=^FAIL: |^ERROR: |\Z)', text, re.M | re.S)
            good = (result.returncode != 0 and failed_methods and all(name == method for name in failed_methods)
                    and any(needle in diagnostic for diagnostic in diagnostics)
                    and 'SyntaxError' not in text and '\nERROR:' not in text
                    and 'FAILED (failures=' in text)
        else:
            good = result.returncode == 0 and 'Ran 25 tests' in text and '\nOK\n' in text
        records.append({'case': label, 'exitCode': result.returncode, 'expected': 'targeted_failure' if method else 'survived',
                        'method': method, 'requiredDiagnostic': needle, 'matched': good})
        if not good:
            raise AssertionError('Collector control did not reach its intended outcome: ' + label)

    try:
        run('baseline', original)
        run('harmless-comment', original+b'\n# Harmless collector control.\n')
        run('restored-after-harmless', original)
        for label, old, new, method, needle in faults:
            if body.count(old) != 1:
                raise AssertionError('Collector fault anchor differs: ' + label)
            run(label, body.replace(old, new).encode(), method, needle)
        # The author refusal must be removed without introducing an unrelated
        # AttributeError in the projection; the test detects silent data loss.
        mutant = body.replace("raise CollectionError(f'API malformed comment author: {number}/{name}')", 'pass')
        mutant = mutant.replace("(item.get('user') or {}).get('login')", "(item.get('user') if isinstance(item.get('user'), dict) else {}).get('login')")
        run('drop-malformed-author', mutant.encode(), 'test_malformed_row_is_not_dropped', 'CollectionError not raised')
        mutant = body.replace("if 'user' not in item:", 'if False:').replace("author = item['user']", "author = item.get('user')")
        run('allow-absent-author', mutant.encode(), 'test_required_comment_fields_are_not_invented',
            'missing comment fields must be refused before projection')
        raw_validation = "    for name in LISTS[1:]:\n        for item in lists[name]:\n            validate_comment(item, name, number)\n"
        if body.count(raw_validation) != 1:
            raise AssertionError('Collector fault anchor differs: validate-after-signing')
        mutant = body.replace(raw_validation, '').replace('    return record\n', raw_validation + '    return record\n')
        run('validate-after-signing', mutant.encode(), 'test_nested_comment_authors_are_refused_before_signing',
            "Expected 'digest' to not have been called")
        consumed_validation = "    validate_pr_projection(pr, number)\n    for item in lists['files']:\n        validate_file(item, number)\n"
        if body.count(consumed_validation) != 1:
            raise AssertionError('Collector fault anchor differs: consumed-validate-after-signing')
        mutant = body.replace(consumed_validation, '').replace('    return record\n', consumed_validation + '    return record\n')
        run('consumed-validate-after-signing', mutant.encode(),
            'test_consumed_source_fields_are_refused_before_signing', "Expected 'digest' to not have been called")
        run('final-restored', original)
    finally:
        source.write_bytes(original)
        receipt = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': records,
                   'sourceRestored': source.read_bytes() == original,
                   'sourceSha256': hashlib.sha256(original).hexdigest(),
                   'pythonVersion': sys.version, 'pythonExecutable': sys.executable,
                   'readerSha256': hashlib.sha256((directory/'full_text.py').read_bytes()).hexdigest(),
                   'digestReaderSha256': hashlib.sha256((directory/'digest.py').read_bytes()).hexdigest(),
                   'fullCohortMethods': 25,
                   'controllerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   'testsSha256': hashlib.sha256(tests.read_bytes()).hexdigest(),
                   'blindCategories': ['Mocked transport cannot prove live GitHub completeness or rate-limit behavior.',
                                       'CLI flags are asserted; no new live corpus recapture runs in this correction.',
                                       'Captured comments remain truncated; no patch or semantic reading proof.']}
        (output/'controls.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'controls': len(records), 'sourceRestored': True}))


if __name__ == '__main__':
    if len(sys.argv) == 2:
        main(Path(sys.argv[1]))
    else:
        with tempfile.TemporaryDirectory() as temporary:
            main(Path(temporary))
