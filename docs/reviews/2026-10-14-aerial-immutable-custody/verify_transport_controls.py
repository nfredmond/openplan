import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

def intended(code, output, reason):
    return code == 1 and re.search(
        r'^(?:Error|AssertionError(?: \[ERR_ASSERTION\])?): ' + re.escape(reason), output, re.MULTILINE
    ) is not None and 'SyntaxError:' not in output and 'ReferenceError:' not in output


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'openplan/src/lib/aerial/artifact-custody-server.ts'
    fixture = Path(__file__).with_name('native_transport.mjs')
    fixture_original = fixture.read_bytes()
    original = source.read_bytes()
    (out / 'original-source-private.ts').write_bytes(original)
    text = original.decode()
    rows = []
    oracles = []
    def execute(label, mode=None):
        target = out / label
        env = {**os.environ, 'OPENPLAN_PROOF_OUT': str(target)}
        if mode:
            env['OPENPLAN_PROOF_MODE'] = mode
        result = subprocess.run(['node', str(Path(__file__).with_name('native_transport.mjs'))],
            cwd=repo / 'openplan', env=env, capture_output=True, text=True, timeout=20)
        (out / (label + '-private.log')).write_text(result.stdout + result.stderr)
        return result.returncode, result.stdout + result.stderr
    def positive(label):
        code, _ = execute(label)
        assert code == 0, label + ' completes all six installed-SDK transport cases'
        assert len(json.loads((out / label / 'transport.json').read_text())['cases']) == 6
        rows.append({'case': label, 'outcome': 'survived', 'transportCases': 6})
    def replace(old, new):
        assert old in text, 'Native mutation reaches current source'
        return text.replace(old, new, 1)
    try:
        positive('baseline')
        source.write_bytes(original + b'\n// Harmless native transport comment.\n')
        fixture.write_bytes(fixture_original + b'\n// Harmless fixture scope note.\n')
        positive('harmless-comment')
        source.write_bytes(original)
        fixture.write_bytes(fixture_original)
        positive('restored-after-harmless')
        no_transport_signal = replace('signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,', 'signal: requestSignal ?? undefined,')
        cases = [
            ('upload-signal-removed', no_transport_signal, 'upload-deadline', 'Native custody transport failed to stop'),
            ('cancellation-ignored', replace('const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;', 'const signal = deadline;'), 'upload-cancellation', 'Current cancellation stops transfer before its later deadline'),
            ('read-transport-signals-removed', no_transport_signal.replace('.download(path, {}, { signal, cache: "no-store" })', '.download(path, {}, { cache: "no-store" })'), 'read-deadline', 'Native custody transport failed to stop'),
            ('buffered-object-before-ceiling', replace('.asStream();', ';').replace('const reader = result.data.getReader();', 'const reader = result.data.stream().getReader();'), 'read-size', 'Excessive stream stops before continued network accumulation'),
            ('stream-ceiling-removed', replace('if (count > expectedBytes) return false;', 'if (false) return false;'), 'read-size', 'Excessive stream stops before continued network accumulation'),
            ('thrown-ack-recovery-removed', replace('  } catch {\n    // Storage may retain', '  } catch {\n    return failedRow(candidate, job, sourceHost, "storage_write_failed", { ...base, code: "storage_write_failed" }, true, now, priorAttempts);\n    // Storage may retain'), 'thrown-acknowledgement', 'Thrown acknowledgement reconciles actual native bytes'),
        ]
        for label, changed, mode, reason in cases:
            try:
                assert changed != text
                source.write_text(changed)
                code, output = execute(label, mode)
                assert intended(code, output, reason), label + ' reaches intended native assertion'
                for name, c, o, r, expected in [
                    ('exact', code, output, reason, True), ('success', 0, output, reason, False),
                    ('wrong-exit', 2, output, reason, False), ('wrong-reason', code, output, 'Absent diagnostic', False),
                    ('source-only', code, 'assert.ok(false, '+reason+')', reason, False),
                    ('syntax', code, 'SyntaxError: '+reason, reason, False),
                    ('reference', code, 'ReferenceError: '+reason, reason, False),
                ]:
                    accepted = intended(c, o, r)
                    assert accepted == expected, label + ' oracle ' + name
                    oracles.append({'case': label, 'oracle': name, 'accepted': accepted})
                rows.append({'case': label, 'outcome': 'intended_failure', 'transportCase': mode, 'diagnostic': reason})
            finally:
                source.write_bytes(original)
        for label, old, diagnostic in [
            ('fixture-rpc-name-unchecked', "    assert.equal(name, 'workspace_storage_bytes', 'Fixture requires original storage RPC');", 'Missing expected rejection: Wrong RPC must fail the fixture'),
            ('fixture-workspace-unchecked', "    assert.deepEqual(args, {p_workspace_id: job.workspaceId}, 'Fixture requires original workspace scope');", 'Missing expected rejection: Wrong workspace must fail the fixture'),
        ]:
            try:
                fixture_text = fixture_original.decode()
                assert fixture_text.count(old) == 1
                fixture.write_text(fixture_text.replace(old, '// Deliberately omitted fixture scope assertion.', 1))
                code, output = execute(label, 'thrown-acknowledgement')
                assert intended(code, output, diagnostic), label + ' reaches intended fixture assertion'
                rows.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': diagnostic})
            finally:
                fixture.write_bytes(fixture_original)
        positive('restored')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracles.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'bindings.json').write_text(json.dumps({str(source.relative_to(repo)): hashlib.sha256(original).hexdigest(), 'native_transport.mjs': hashlib.sha256(Path(__file__).with_name('native_transport.mjs').read_bytes()).hexdigest()}, indent=2) + '\n')
        print(rows)
    finally:
        source.write_bytes(original)
        fixture.write_bytes(fixture_original)
        assert source.read_bytes() == original and fixture.read_bytes() == fixture_original

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
