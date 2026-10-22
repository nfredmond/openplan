"""Native engine observation controls with exact restoration and failure checks."""
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
    source = repo/'workers/odm_worker/native_engine_attestation.py'
    tests = source.with_name('test_native_engine_attestation.py')
    original = source.read_bytes();test_bytes = tests.read_bytes()
    helper_path = repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('authority_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, change, reason, kind='broken_behavior', fixture=False):
        cases.append((label, 'test_'+test, change, reason, kind, fixture))
    swap = lambda before, after: lambda text: helper.replace(text, before, after)
    guard = lambda reason, function=None: lambda text: helper.disable(text, reason, function)
    add('mounted-byte-hash-omitted', 'valid_identity_and_exact_configuration',
        swap("'sha256': hashlib.sha256(data).hexdigest()", "'sha256': '0' * 64"), 'Exact mounted configuration spelling must affect its hash')
    add('launch-image-unchecked', 'launch_refusals', guard('Native engine image is unsupported'), 'Native launch guard: Image')
    add('launch-profile-unchecked', 'launch_refusals', swap("config.get('Entrypoint') != ['/usr/bin/node']", 'False'), 'Native launch guard: Config.Entrypoint')
    add('launch-environment-unchecked', 'launch_refusals', guard('Native engine launch environment differs'), 'Native launch guard: Config.Env')
    add('launch-isolation-unchecked', 'launch_refusals', guard('Native engine launch isolation differs'), 'Native launch guard: HostConfig.')
    add('mount-profile-unchecked', 'launch_refusals', guard('Native engine mount profile is unsupported'), 'Native mount guard: Type')
    add('mount-access-unchecked', 'launch_refusals', guard('Native engine mount access differs'), 'Native mount guard: RW')
    add('configuration-profile-unchecked', 'launch_refusals', guard('Native engine configuration profile is unsupported'), 'Unsupported native configuration must refuse')
    add('original-identity-unchecked', 'identity_and_state_refusals', guard('Native engine original identity differs'), ('Native identity guard:', 'Native original configuration digest must match'))
    add('original-state-unchecked', 'identity_and_state_refusals', guard('Native engine original is not running'), 'Native identity guard: State.')
    add('bridge-unchecked', 'network_and_endpoint_refusals', guard('Native engine original bridge differs'), 'Native network guard:')
    add('membership-unchecked', 'network_and_endpoint_refusals', guard('Native engine original network membership differs'), 'Native member guard: EndpointID')
    add('endpoint-unchecked', 'network_and_endpoint_refusals', swap('address != member_address', 'False'), 'Native member guard: IPv4Address')
    add('json-duplicates-accepted', 'json_refusals', swap('if key in result:', 'if False:'), 'Native JSON bound, uniqueness and finite values must refuse')
    add('json-nonfinite-accepted', 'json_refusals', swap("raise ValueError('Native engine observation has a nonfinite number')", 'return 0'), 'Native JSON bound, uniqueness and finite values must refuse')
    add('json-text-accepted', 'json_refusals', guard('Native engine observation byte limit differs'), 'Native JSON bound, uniqueness and finite values must refuse')
    add('complete-observation-false', 'supervised_three_read_only_requests', swap('            return True', '            return False'), 'Actual supervised observation must return true')
    add('host-path-substituted-for-mounted-bytes', 'mounted_bytes_are_not_host_path_bytes',
        lambda text: helper.replace(helper.replace(text, '    data, process = process_configuration(container)', "    data, process = process_configuration(container)\n    data = Path(next(item['Source'] for item in container['Mounts'] if item['Destination']=='/proof-config.json')).read_bytes()"), '    data, current_process = process_configuration(current)', "    data, current_process = process_configuration(current)\n    data = Path(next(item['Source'] for item in current['Mounts'] if item['Destination']=='/proof-config.json')).read_bytes()"),
        'Mounted bytes cannot be replaced by host path bytes')
    def no_precheck(text):
        text=helper.replace(text, '    def __call__(self, engine, deadline, *, owned):\n        self._check(deadline, owned)', '    def __call__(self, engine, deadline, *, owned):\n        pass')
        return helper.replace(text, '        self._check(deadline, owned)\n        lifetime_read, lifetime_write', '        pass\n        lifetime_read, lifetime_write')
    add('prechecks-omitted', 'pre_refusals_never_start_an_observer', no_precheck, 'Pre-refused observation cannot start a child')
    add('configured-original-unchecked', 'pre_refusals_never_start_an_observer', guard('Native engine configured original differs'), 'Changed configured original cannot attest')
    add('parent-deadline-unchecked', 'stalled_observation_keeps_actual_deadline',
        swap('        finite_deadline(deadline)\n\n    def __call__', '        pass\n\n    def __call__'), 'Native observation must report its actual deadline')
    add('active-owner-unchecked', 'owner_ends_during_observation', guard('Native engine observation owner ended'), 'Native owner must interrupt its observation')
    add('peer-uid-unchecked', 'peer_uid_requires_actual_unix_credentials', guard('Native engine daemon peer differs'), 'Native daemon peer cannot differ')
    def no_daemon_bound(text):
        return helper.disable(helper.disable(text, 'Native engine daemon response exceeds its bound'), 'Native engine observation byte limit differs')
    add('daemon-response-and-json-bounds-omitted', 'daemon_bytes_and_diagnostics_refuse', no_daemon_bound, 'Malformed native daemon bytes must refuse')
    add('constructor-config-unchecked', 'explicit_constructor_and_launch_port', guard('Explicit Linux native daemon configuration is required'), 'Native constructor must retain its explicit original')
    add('constructor-container-unchecked', 'explicit_constructor_and_launch_port', guard('Native engine original container and supported image are required'), 'Native constructor must retain its explicit original')
    add('launch-port-unchecked', 'explicit_constructor_and_launch_port', guard('Native engine launch port differs'), 'Native launch port must remain valid')
    add('input-frame-bound-omitted', 'child_frame_bound_precedes_body_read', guard('Native engine observer input exceeds its bound', 'child'), 'Oversized native observer frame must refuse before body')
    add('parent-receipt-unchecked', 'parent_receipt_and_output_bounds', guard('Native engine observer receipt differs'), 'Malformed native observer receipt must refuse')
    final="            self._check(deadline, owned)\n            return True"
    add('post-receipt-owner-unchecked', 'owner_and_deadline_rechecked_after_receipt', swap(final, '            return True'), 'Native owner must be checked after the completed receipt')
    add('post-receipt-deadline-unchecked', 'owner_and_deadline_rechecked_after_receipt',
        swap(final, "            if owned() is not True: raise InterruptedError('Controlled owner-only refusal')\n            return True"), 'Native deadline must be checked after the completed receipt')
    for field in ['Config', 'HostConfig', 'Mounts']:
        value={'Config':'config','HostConfig':'host','Mounts':'mounts'}[field]
        add('launch-fingerprint-omits-'+field, 'original_launch_metadata_affects_fingerprint', swap("'"+field+"': "+value, "'"+field+"': {}"), 'Original native launch metadata must affect its fingerprint: '+field)
    add('parent-buffer-bound-unchecked', 'parent_buffers_stay_bounded', guard('Native engine observer output exceeds its bound'), 'Native observer buffer may not exceed its bound')
    add('child-input-shape-unchecked', 'child_input_shape_refuses_before_daemon', guard('Native engine observer input shape differs'), 'Foreign native input cannot query the daemon')
    add('parent-lifetime-watcher-omitted', 'observer_ends_when_parent_exits', swap('    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()', '    pass'), 'Native observer must end with its parent lifetime')
    for reason in ['Native engine launch inspection differs', 'Native engine original mounts are required',
            'Native engine mount scope differs', 'Native engine original network differs']:
        add('structural-'+reason.split('Native engine ')[1].replace(' ', '-'), 'structural_projection_refusals',
            guard(reason, 'observed_identity' if reason == 'Native engine original network differs' else 'inspect_projection'), 'Required native refusal: ' + reason, 'diagnostic_refusal')
    add('address-refusal-type-changed', 'structural_projection_refusals',
        swap("raise ValueError('Native engine original address differs')", "raise TypeError('Native engine original address differs')"),
        'Required native refusal: Native engine original address differs', 'diagnostic_refusal')
    add('socket-scope-unchecked', 'socket_scope_before_daemon_access', guard('Native engine daemon socket differs'),
        'Required native refusal: Native engine daemon socket differs')
    for reason in ['Native engine daemon response shape differs', 'Native engine daemon observation is unavailable']:
        add(reason.replace(' ', '-'), 'daemon_shape_and_status_refusals', guard(reason), 'Required native refusal: ' + reason)
    add('parent-metadata-bound-unchecked', 'parent_metadata_bound_precedes_spawn', guard('Native engine observer input exceeds its bound', '__call__'),
        'Oversized native metadata cannot start an observer')
    for reason in ['Native engine ownership callback is required', 'Native engine ownership must return a boolean']:
        add(reason.replace(' ', '-'), 'ownership_callback_refusal_types', guard(reason), 'Required native refusal: ' + reason, 'diagnostic_refusal')
    for reason in ['Native engine original network differs', 'Native engine original network ID differs']:
        add('child-'+reason.replace(' ', '-'), 'child_network_shape_and_id_before_lookup', guard(reason, 'child'),
            'Required native refusal: ' + reason, 'diagnostic_refusal')
    add('observer-failed-status-unchecked', 'failed_observer_exit_and_stderr_refuse', guard('Native engine observation refused'),
        'Required native refusal: Native engine observation refused')
    add('mount-enumeration-order-canonicalization-omitted', 'mount_enumeration_order_does_not_change_identity',
        swap("    mounts = sorted(mounts, key=lambda mount: mount['Destination'])\n", ''),
        'Mount enumeration order cannot change native launch identity')
    for reason in ['Native engine process is unavailable', 'Native engine process configuration is not bounded regular bytes']:
        add(reason.replace(' ', '-'), 'process_configuration_and_refusals', guard(reason), 'Required native refusal: ' + reason)
    add('kernel-configuration-leaf-followed', 'process_configuration_and_refusals',
        swap("os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=root_fd", "os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=root_fd"),
        'Kernel configuration cannot follow a substituted leaf')
    add('kernel-identity-unchecked', 'process_identity_and_changed_read_refusals',
        swap("if not separator or int(head.split(b' (', 1)[0]) != pid or fields[0] in (b'Z', b'X', b'x') or not fields[19].isdigit() or int(fields[19]) <= 0:", 'if False:'),
        'Required native refusal: Native engine process identity differs')
    add('kernel-read-change-unchecked', 'process_identity_and_changed_read_refusals', guard('Native engine process configuration changed while reading'),
        'Required native refusal: Native engine process configuration changed while reading')
    add('kernel-process-after-read-unchecked', 'process_identity_and_changed_read_refusals', swap('identity() != original', 'False'),
        'Required native refusal: Native engine process configuration changed while reading')
    add('original-changed-during-observation-unchecked', 'process_and_configuration_rechecked', guard('Native engine original changed during observation'),
        'Changed native process or configuration must refuse')
    add('kernel-stat-byte-bound-unchecked', 'process_identity_and_changed_read_refusals',
        swap('if not isinstance(raw, bytes) or len(raw) > WIRE_LIMIT:', 'if False:'),
        'Required native refusal: Native engine process identity differs')
    add('final-daemon-container-read-omitted', 'supervised_three_read_only_requests',
        swap("current = daemon_get(metadata['socketPath'], metadata['daemonUid'], deadline, 'containers/' + engine['instanceId'] + '/json')", 'current = container'),
        'Only exact original read-only native observations are allowed')
    add('unknown-path-has-error-body', 'child_network_shape_and_id_before_lookup',
        swap("self.send_response(404);self.send_header('Content-Length', '0');self.end_headers()", 'self.send_error(404)'),
        'Unknown daemon path must return a bodyless refusal', fixture=True)
    add('retired-observer-cleanup-unhandled', 'observer_ends_when_parent_exits',
        swap('                except ProcessLookupError:\n                    pass', '                except ProcessLookupError:\n                    raise'),
        'Retired observer must not fail cleanup', fixture=True)
    add('cleanup-swallows-permission', 'observer_ends_when_parent_exits',
        swap('                except ProcessLookupError:\n                    pass', '                except OSError:\n                    pass'),
        'Observer cleanup must retain permission refusal', fixture=True)
    if {row[1] for row in cases} != census:raise ValueError('Native observation tests lack selected controls')
    rows = [];oracles = []
    def restore():
        source.write_bytes(original)
        tests.write_bytes(test_bytes)
        with source.open('rb') as stream:os.fsync(stream.fileno())
    def execute(label, test=None):
        result = subprocess.run([sys.executable, '-B', str(tests)]+(['NativeTests.'+test] if test else []),
            cwd=repo, capture_output=True, timeout=20, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = (result.stdout+result.stderr).decode(errors='replace')
        (out/(label+'-private.log')).write_text(diagnostic)
        return result.returncode, diagnostic
    def positive(label, harmless=False):
        restore()
        if harmless:
            source.write_bytes(original+b'\n# Harmless native observation comment.\n')
            tests.write_bytes(test_bytes+b'\n# Harmless native fixture comment.\n')
        code, diagnostic = execute(label)
        assert code == 0 and 'Ran '+str(len(census))+' tests' in diagnostic, 'Native observation positive control failed: '+label
        rows.append({'control': label, 'outcome': 'survived'})
    try:
        positive('baseline');positive('harmless-comment', True);positive('restored-after-harmless')
        for label, test, change, reason, kind, fixture in cases:
            try:
                target=tests if fixture else source
                text = change((test_bytes if fixture else original).decode());ast.parse(text);target.write_text(text)
                code, diagnostic = execute(label, test)
                helper.verify_failure(test, code, diagnostic, reason)
                if not oracles:oracles = helper.oracle_controls(test, code, diagnostic, reason)
                rows.append({'control': label, 'test': test, 'kind': kind, 'reason': reason, 'outcome': 'intended_failure'})
            finally:restore()
        positive('restored-final')
        assert source.read_bytes() == original and tests.read_bytes() == test_bytes
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, tests, Path(__file__))}, indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            unit = os.environ['OPENPLAN_OWNED_PROOF_UNIT']
            raw = subprocess.check_output(['systemctl', '--user', 'show', unit, '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            values = dict(line.split('=', 1) for line in raw.splitlines())
            group = Path('/sys/fs/cgroup') / values.pop('ControlGroup').lstrip('/')
            values['memoryEvents'] = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
            (out / 'resources.json').write_text(json.dumps(values, indent=2) + '\n')
        print(json.dumps({'tests': len(census), 'controls': len(rows), 'faults': len(cases), 'survivors': 4, 'oracleControls': len(oracles)}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
