"""Reader and real HTTP faults with harmless controls and exact restoration."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    helper_path = repo / 'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('private_dispatch_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    paths = {name: repo / ('workers/odm_worker/application_dispatch_' + name + '.py') for name in ('reader', 'http')}
    tests = {name: path.with_name('test_' + path.name) for name, path in paths.items()}
    originals = {name: path.read_bytes() for name, path in paths.items()}
    test_bytes = {name: path.read_bytes() for name, path in tests.items()}
    census = {(name, node.name) for name, raw in test_bytes.items() for node in ast.walk(ast.parse(raw)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(source, label, test, transform, reason, kind='broken_behavior'):
        cases.append((source, label, 'test_' + test, transform, reason, kind))
    guard = lambda message, function=None: lambda source: helper.disable(source, message, function)
    swap = lambda before, after: lambda source: helper.replace(source, before, after)

    add('reader', 'exact-text-changed', 'exact_original_and_fixed_rpc_scope_reach_capture', swap("return receipt['payloadText'].encode('utf-8'), receipt['applicationJob']", "return receipt['payloadText'].strip().encode('utf-8'), receipt['applicationJob']"), 'Private reader must preserve exact UTF-8 original bytes')
    add('reader', 'target-query-changed', 'exact_original_and_fixed_rpc_scope_reach_capture', swap("'p_target': self.dispatch.target", "'p_target': 'different'"), 'Private read must bind the operator installation and target')
    add('reader', 'runtime-owner-not-forwarded', 'exact_original_and_fixed_rpc_scope_reach_capture', swap('raw = self.transport(arguments, deadline, owned=lambda: self.dispatch.runtime._owned)', 'raw = self.transport(arguments, deadline)'), 'Private transport must receive the current runtime ownership adapter')
    add('reader', 'timeout-unchecked', 'constructor_requires_custody_adapter_and_finite_timeout', guard('Private dispatch read timeout must be positive and finite'), 'ValueError not raised')
    add('reader', 'constructor-adapters-unchecked', 'constructor_requires_custody_adapter_and_finite_timeout', guard('Private dispatch custody and transport are required'), ("'NoneType' object has no attribute 'timeout'", 'ValueError not raised'), 'diagnostic_refusal')
    def bypass_early_owner(source):
        source = helper.replace(source, "current = self.dispatch._check(entry.request['requestId'], deadline)", 'current = entry')
        return helper.replace(source, 'entry = self.dispatch._check(request_id, deadline)', 'entry = self.dispatch.runtime.journal.get(request_id)')
    add('reader', 'owner-start-check-after-query', 'owner_and_original_start_precede_transport', bypass_early_owner, 'Unowned or unstarted capture must not read private RPC')
    add('reader', 'changed-admission-unchecked', 'changed_admission_refuses_before_transport', guard('Private application dispatch original admission differs'), 'ValueError not raised')
    add('reader', 'outer-deadline-not-clamped', 'shared_deadline_clamps_before_transport', swap('return min(current, deadline)', 'return current'), 'TimeoutError not raised')
    add('reader', 'deadline-type-unchecked', 'invalid_deadline_refuses_before_transport', swap('if type(deadline) not in (int, float) or not math.isfinite(deadline):', 'if deadline is not True and (type(deadline) not in (int, float) or not math.isfinite(deadline)):'), 'Original dispatch deadline must be finite', 'diagnostic_refusal')
    add('reader', 'late-receipt-validation', 'late_response_refuses_before_receipt_validation', swap('raw = self.transport(arguments, deadline, owned=lambda: self.dispatch.runtime._owned)\n        self.dispatch._check(request_id, deadline)', 'raw = self.transport(arguments, deadline, owned=lambda: self.dispatch.runtime._owned)'), 'Late read reached validation')
    add('reader', 'wire-bound-unchecked', 'wire_bytes_bound_and_type_precede_json_parse', swap('len(raw) <= WIRE_LIMIT', 'len(raw) <= WIRE_LIMIT + 1'), 'ValueError not raised')
    add('reader', 'duplicates-accepted', 'duplicate_nonfinite_and_invalid_utf8_json_refuse', swap('object_pairs_hook=strict_object', 'object_pairs_hook=dict'), 'ValueError not raised')
    add('reader', 'scope-envelope-unchecked', 'scope_format_fields_and_flags_refuse', swap('set(value) != FIELDS', 'False'), 'ValueError not raised')
    add('reader', 'timestamp-syntax-unchecked', 'observation_timestamp_requires_valid_offset_time', swap(r'\d{4}-\d{2}-\d{2}T\d{2}', r'\d{4}-\d{2}-\d{2}[T ]\d{2}'), 'ValueError not raised')
    add('reader', 'timestamp-date-unchecked', 'observation_timestamp_requires_valid_offset_time', swap("datetime.fromisoformat(observed.replace('Z', '+00:00'))", 'pass # Date validity omitted'), 'ValueError not raised')
    add('reader', 'job-uuid-unchecked', 'exact_job_projection_and_canonical_uuid_are_required', swap("if not isinstance(row[key], str) or str(uuid.UUID(row[key])) != row[key]:", 'if False:'), 'ValueError not raised')
    add('reader', 'job-projection-unchecked', 'exact_job_projection_and_canonical_uuid_are_required', guard('Private application dispatch job projection differs'), 'Original dispatch project projection is required', 'diagnostic_refusal')
    add('reader', 'original-hash-unchecked', 'original_byte_count_hash_and_encoding_are_verified', swap("value['payloadSha256'] != hashlib.sha256(payload).hexdigest()", 'False'), 'ValueError not raised')
    add('reader', 'admitted-request-unchecked', 'full_request_and_admitted_scope_are_independently_validated', swap('self.dispatch._record(entry, payload, row)', 'pass # Full original binding omitted'), 'ValueError not raised')
    add('reader', 'revoked-capture-allowed', 'revoked_actor_refuses_first_capture_without_source_work', guard('Private application dispatch actor is no longer authorized'), 'PermissionError not raised')
    add('reader', 'false-observation-promoted', 'fresh_false_observation_preserves_saved_original_and_false_engine_permission', swap("'authorizedNow': current['authorizedNow']", "'authorizedNow': True"), 'Fresh revoked observation must remain false')
    add('reader', 'observation-permits-engine', 'fresh_false_observation_preserves_saved_original_and_false_engine_permission', swap("'engineTransportPermission': False}", "'engineTransportPermission': True}"), 'Private observation must not permit an engine command')
    add('reader', 'saved-original-not-compared', 'changed_original_actor_refuses_observation', guard('Private application dispatch saved original differs'), 'ValueError not raised')
    add('reader', 'lost-original-queried', 'missing_saved_original_refuses_before_fresh_query', swap('saved = self.dispatch.load(request_id, deadline=deadline)\n        current = self._read(request_id, deadline)', 'current = self._read(request_id, deadline)\n        saved = self.dispatch.load(request_id, deadline=deadline)'), 'Missing original cannot be replaced by another query')

    add('http', 'response-bytes-changed', 'exact_post_headers_scope_and_response_without_proxy', swap('return bytes(output)', 'return bytes(output).strip() + b"changed"'), 'Private response bytes must reach the validator unchanged')
    add('http', 'rpc-path-changed', 'exact_post_headers_scope_and_response_without_proxy', swap("parts.path + '/rpc/read_aerial_original_dispatch'", "parts.path + '/rpc/different'"), 'Private endpoint must use only its fixed RPC path')
    add('http', 'api-key-changed', 'exact_post_headers_scope_and_response_without_proxy', swap("'apikey': tokens['apiKey']", "'apikey': 'changed-private-key'"), 'API key must use its dedicated header')
    def opaque_bearer(source):
        source = helper.replace(source, "if tokens['bearerToken'] is not None:", 'if True:')
        return helper.replace(source, "headers['Authorization'] = 'Bearer ' + tokens['bearerToken']", "headers['Authorization'] = 'Bearer ' + (tokens['bearerToken'] or tokens['apiKey'])")
    add('http', 'opaque-key-as-bearer', 'gateway_prefix_and_secret_key_without_bearer', opaque_bearer, 'Opaque API keys cannot become bearer tokens')
    add('http', 'http-unconditionally-allowed', 'constructor_refuses_unapproved_http_and_ambiguous_endpoint', swap("parts.scheme not in (('https', 'http') if allow_http else ('https',))", "parts.scheme not in ('https', 'http')"), 'ValueError not raised')
    add('http', 'constructor-byte-bound-unchecked', 'invalid_constructor_adapters_and_byte_limits_refuse', guard('Private dispatch response bound differs', '__init__'), 'ValueError not raised')
    add('http', 'constructor-adapters-unchecked', 'invalid_constructor_adapters_and_byte_limits_refuse', guard('Private dispatch supervision and credential adapter are required'), 'ValueError not raised')
    add('http', 'pre-cancellation-unchecked', 'pre_cancelled_read_never_resolves_credentials_or_spawns', guard('Private dispatch read cancelled'), 'Cancelled read spawned child')
    add('http', 'cancellation-type-unchecked', 'invalid_cancellation_and_deadline_refuse_before_http', guard('Private dispatch cancellation must be a boolean'), 'ValueError not raised')
    add('http', 'expired-read-continues', 'expired_deadline_refuses_before_credentials', guard('Private dispatch deadline exceeded'), 'Expired private read spawned child')
    add('http', 'rpc-parameters-unchecked', 'credentials_and_parameters_refuse_without_request', guard('Private dispatch RPC parameters differ'), 'Invalid input spawned child')
    add('http', 'credential-shape-unchecked', 'credentials_and_parameters_refuse_without_request', swap("set(value) != {'apiKey', 'bearerToken'}", 'False'), 'Invalid input spawned child')
    add('http', 'credential-token-unchecked', 'credentials_and_parameters_refuse_without_request', swap("if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(ord(char) <= 32 or ord(char) >= 127 for char in token):", 'if False:'), 'Invalid input spawned child')
    add('http', 'credential-error-exposed', 'credential_exceptions_refuse_with_static_reason', swap("raise ValueError('Private dispatch credential resolution failed') from None", 'raise'), 'synthetic-private-error', 'diagnostic_refusal')
    add('http', 'redirect-status-accepted', 'redirect_or_denial_refuses_without_retry', guard('Private dispatch RPC status differs'), 'ValueError not raised')
    add('http', 'response-encoding-accepted', 'response_encoding_type_and_ambiguous_length_refuse', swap("encodings and encodings != ['identity']", 'False'), 'ValueError not raised')
    add('http', 'partial-length-unchecked', 'oversized_and_partial_response_cannot_return_original', swap('or lengths and len(payload) != int(lengths[0]):', 'or False:'), 'ValueError not raised')
    add('http', 'declared-response-limit-unchecked', 'declared_overflow_refuses_before_reading_a_stalled_body', guard('Private dispatch response bytes exceed their bound'), 'Private dispatch deadline exceeded', 'diagnostic_refusal')
    add('http', 'stalled-deadline-unchecked', 'actual_stalled_header_deadline_closes_connection_and_joins_child', guard('Private dispatch deadline exceeded'), 'Private dispatch RPC read did not complete', 'diagnostic_refusal')
    add('http', 'body-cancellation-unchecked', 'actual_body_cancellation_closes_connection_and_joins_child', guard('Private dispatch read cancelled'), 'Private dispatch deadline exceeded', 'diagnostic_refusal')
    add('http', 'ownership-type-unchecked', 'runtime_ownership_refuses_before_credentials', guard('Private dispatch ownership must be a boolean'), 'ValueError not raised')
    add('http', 'ownership-adapter-unchecked', 'runtime_ownership_refuses_before_credentials', guard('Private dispatch ownership adapter is required'), "'NoneType' object is not callable", 'diagnostic_refusal')
    add('http', 'runtime-ownership-loss-unchecked', 'runtime_ownership_end_closes_actual_stalled_connection', guard('Private dispatch runtime ownership ended'), 'Private dispatch deadline exceeded', 'diagnostic_refusal')
    add('http', 'metadata-limit-unchecked', 'metadata_bound_refuses_before_child_spawn', guard('Private dispatch metadata exceeds its bound', '__call__'), 'Oversized metadata spawned child')
    add('http', 'parent-output-limit-unchecked', 'child_output_bounds_stop_and_join_before_return', guard('Private dispatch child output exceeds its bound'), ('ValueError not raised', 'Private dispatch RPC read did not complete'), 'diagnostic_refusal')
    def late_resolver(source):
        source = helper.disable(source, 'Private dispatch deadline exceeded')
        return helper.replace(source, 'connection = factory(parts.hostname, parts.port, timeout=max(.001, deadline - time.monotonic()))', 'connection = factory(parts.hostname, parts.port, timeout=3)')
    add('http', 'resolver-deadline-unchecked', 'stalled_resolver_cannot_start_a_late_private_request', late_resolver, 'TimeoutError not raised')
    add('http', 'parent-lifetime-unwatched', 'parent_exit_stops_and_reaps_private_rpc_child', swap('threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()', 'pass # Parent lifetime watcher omitted'), 'Owner exit must stop the private RPC child')
    add('http', 'private-environment-inherited', 'child_credentials_stay_in_pipe_and_environment_is_narrow', swap("if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}", 'if True'), 'Private child cannot inherit unrelated credentials')
    add('http', 'child-metadata-bound-unchecked', 'child_metadata_bound_refuses_before_waiting_for_body', guard('Private dispatch metadata exceeds its bound', 'child'), 'Oversized child metadata must refuse before waiting for its body')
    add('http', 'child-envelope-unchecked', 'child_envelope_and_bound_refuse_before_network', guard('Private dispatch metadata differs'), 'Invalid child envelope or bound must precede network work')
    add('http', 'child-response-bound-unchecked', 'child_envelope_and_bound_refuse_before_network', guard('Private dispatch response bound differs', 'child'), 'Invalid child envelope or bound must precede network work')
    add('http', 'child-invocation-unchecked', 'child_invocation_refuses_before_network', guard('Owned private dispatch child invocation is required'), 'Invalid child invocation must precede network work')

    assert {(source, test) for source, _label, test, _transform, _reason, _kind in cases} == census, 'Every new test requires its selected fault'
    rows, oracle = [], []
    def execute(source, label, test=None):
        result = subprocess.run([sys.executable, '-B', str(tests[source])] + (['Checks.' + test] if test else []), cwd=repo,
            capture_output=True, timeout=25, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(diagnostic)
        return result.returncode, diagnostic
    def positive(label, harmless=False):
        for source, path in paths.items():
            path.write_bytes(originals[source] + (b'\n# Harmless private read comment.\n' if harmless else b''))
            code, diagnostic = execute(source, label + '-' + source)
            count = sum(name == source for name, _test in census)
            assert code == 0 and 'Ran ' + str(count) + ' tests' in diagnostic, 'Positive private read control failed: ' + label + '-' + source + '\n' + diagnostic
        rows.append({'control': label, 'outcome': 'survived'})
        print(label + ': survived', flush=True)
    try:
        positive('baseline');positive('harmless', True);positive('restored-after-harmless')
        for source, label, test, transform, reason, kind in cases:
            try:
                changed = transform(originals[source].decode());ast.parse(changed);paths[source].write_text(changed)
                code, diagnostic = execute(source, label, test)
                try:
                    helper.verify_failure(test, code, diagnostic, reason)
                except ValueError:
                    raise AssertionError(label + ': wrong private read failure\n' + diagnostic) from None
                if not oracle and kind == 'broken_behavior':
                    oracle = helper.oracle_controls(test, code, diagnostic, reason)
                rows.append({'control': label, 'test': test, 'source': source, 'outcome': 'intended_failure', 'reason': reason, 'kind': kind})
                print(label + ': intended failure', flush=True)
            finally:
                paths[source].write_bytes(originals[source])
            (out / 'partial-controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        positive('restored-final')
        for source, path in paths.items():
            assert path.read_bytes() == originals[source] and tests[source].read_bytes() == test_bytes[source]
        bindings = {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(), *tests.values(), helper_path, Path(__file__)]}
        for name, data in [('controls', rows), ('oracle-controls', oracle), ('source-bindings', bindings)]:
            (out / (name + '.json')).write_text(json.dumps(data, indent=2) + '\n')
        print(json.dumps({'tests': len(census), 'controls': len(rows), 'targeted': len(cases), 'oracleControls': len(oracle)}))
    finally:
        for source, path in paths.items():
            path.write_bytes(originals[source])
            with path.open('rb') as stream:os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
