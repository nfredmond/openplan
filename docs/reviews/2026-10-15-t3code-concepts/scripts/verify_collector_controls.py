"""Run harmless and targeted collector faults, restoring exact source in finally."""
from datetime import datetime, timezone
import hashlib
import json
import os
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
            good = result.returncode != 0 and f'FAIL: {method} (' in text and needle in text and 'SyntaxError' not in text
        else:
            good = result.returncode == 0 and 'Ran 12 tests' in text and '\nOK\n' in text
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
        run('final-restored', original)
    finally:
        source.write_bytes(original)
        receipt = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': records,
                   'sourceRestored': source.read_bytes() == original,
                   'sourceSha256': hashlib.sha256(original).hexdigest(),
                   'testsSha256': hashlib.sha256(tests.read_bytes()).hexdigest(),
                   'blindCategories': ['Mocked transport cannot prove live GitHub completeness or rate-limit behavior.',
                                       'CLI flags are asserted; the separate live recapture tests the installed gh.',
                                       'Captured comments remain truncated; no patch or semantic reading proof.']}
        (output/'controls.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'controls': len(records), 'sourceRestored': True}))


if __name__ == '__main__':
    if len(sys.argv) == 2:
        main(Path(sys.argv[1]))
    else:
        with tempfile.TemporaryDirectory() as temporary:
            main(Path(temporary))
