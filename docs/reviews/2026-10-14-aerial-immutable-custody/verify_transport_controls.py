import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'openplan/src/lib/aerial/artifact-custody-server.ts'
    original = source.read_bytes()
    (out / 'original-source-private.ts').write_bytes(original)
    text = original.decode()
    rows = []
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
        positive('harmless-comment')
        source.write_bytes(original)
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
                assert code == 1 and reason in output, label + ' reaches intended native assertion'
                rows.append({'case': label, 'outcome': 'intended_failure', 'transportCase': mode, 'diagnostic': reason})
            finally:
                source.write_bytes(original)
        positive('restored')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'bindings.json').write_text(json.dumps({str(source.relative_to(repo)): hashlib.sha256(original).hexdigest(), 'native_transport.mjs': hashlib.sha256(Path(__file__).with_name('native_transport.mjs').read_bytes()).hexdigest()}, indent=2) + '\n')
        print(rows)
    finally:
        source.write_bytes(original)
        assert source.read_bytes() == original

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
