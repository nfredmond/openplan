import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

FILES = [
    'aerial-artifact-custody.test.ts', 'aerial-custody-georef.test.ts',
    'aerial-processing-callback-route.test.ts', 'aerial-artifact-custody-retry-route.test.ts',
    'aerial-artifact-custody-reaches-a-planner.test.tsx', 'aerial-storage-client-factory.test.ts',
]

def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'openplan/src/lib/aerial/artifact-custody-server.ts'
    factory = repo / 'openplan/src/lib/supabase/server.ts'
    originals = {path: path.read_bytes() for path in [source, factory]}
    bindings = {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in [source, factory] + [repo / 'openplan/src/test' / name for name in FILES]}
    rows = []
    for path, raw in originals.items():
        (out / (path.name + '-original-private')).write_bytes(raw)

    def execute(label, filename=None, pattern=None):
        target = out / (label + '.json')
        cmd = ['npm', 'exec', '--', 'vitest', 'run']
        cmd += ['src/test/' + name for name in ([filename] if filename else FILES)]
        cmd += ['--maxWorkers=1', '--no-file-parallelism', '--reporter=verbose', '--reporter=json', '--outputFile=' + str(target)]
        if pattern:
            cmd += ['--testNamePattern', pattern]
        result = subprocess.run(cmd, cwd=repo / 'openplan', capture_output=True, text=True, timeout=90)
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, json.loads(target.read_text()), output

    expected = None
    def positive(label):
        nonlocal expected
        code, data, _ = execute(label)
        if expected is None:
            expected = data['numPassedTests']
            assert expected == 108, 'All six affected test files reach the complete 108-case cohort'
            assert {Path(file['name']).name for file in data['testResults']} == set(FILES), 'Exact six-file test census'
        assert code == 0 and data['numPassedTests'] == expected and data['numFailedTests'] == 0, label + ' passes complete affected cohort'
        rows.append({'case': label, 'outcome': 'survived', 'tests': expected})

    text = originals[source].decode()
    def replaced(old, new):
        assert old in text, 'Source mutation reaches current implementation: ' + old
        return text.replace(old, new, 1)
    try:
        positive('baseline')
        source.write_bytes(originals[source] + b'\n// Harmless custody transport comment.\n')
        positive('harmless-comment')
        source.write_bytes(originals[source])
        positive('restored-after-harmless')
        deny = replaced('return count === expectedBytes && hash.digest("hex") === expectedSha256;', 'return false;')
        cases = [
            ('original-overwritten', source, replaced('contentType: uploadContentType, upsert: false', 'contentType: uploadContentType, upsert: true'), FILES[0], 'never replaces original storage bytes', 'A retry never replaces the original stored bytes'),
            ('overwrite-mode', source, replaced('contentType: uploadContentType, upsert: false', 'contentType: uploadContentType, upsert: true'), FILES[0], 'downloads the artifact, stores it', 'upsert'),
            ('hash-ignored', source, replaced('hash.digest("hex") === expectedSha256', 'true'), FILES[0], 'refuses missing, unreadable', 'Unconfirmed actual bytes cannot become held: hash'),
            ('matching-recovery-denied', source, deny, FILES[0], 'recovers an unchanged original object', 'Matching retained bytes restore the missing custody row'),
            ('returned-ack-rejected', source, replaced('    await storage.storage', '    const acknowledgement = await storage.storage').replace('upsert: false });', 'upsert: false });\n    if (acknowledgement.error) return failedRow(candidate, job, sourceHost, "storage_write_failed", { ...base, code: "storage_write_failed" }, true, now, priorAttempts);', 1), FILES[0], 'reconciles actual bytes when the upload acknowledgement', 'An uncertain upload reply requires actual matching bytes'),
            ('thrown-ack-not-reconciled', source, replaced('  } catch {\n    // Storage may retain', '  } catch {\n    return failedRow(candidate, job, sourceHost, "storage_write_failed", { ...base, code: "storage_write_failed" }, true, now, priorAttempts);\n    // Storage may retain'), FILES[0], 'reconciles retained bytes after a thrown', 'Thrown acknowledgement requires actual byte reconciliation'),
            ('excessive-stream-not-stopped', source, replaced('if (count > expectedBytes) return false;', 'if (count > expectedBytes * 4) return false;'), FILES[0], 'cancels reconciliation as soon', 'Oversized stream stops at its first excessive chunk'),
            ('cancel-not-forwarded', source, text.replace('    signal.throwIfAborted();\n    const requestSignal', '    const requestSignal'), FILES[0], 'forwards pass cancellation', 'Canceled transport starts no network request'),
            ('callback-held-denied', source, deny, FILES[2], "passes a v1.1 artifact's validated", 'held'),
            ('retry-held-denied', source, deny, FILES[3], 'retries only the artifact', 'Retried artifact records actual held custody'),
            ('planner-held-denied', source, deny, FILES[4], 'writes a PARTIALLY-VERIFIED package', 'Planner package follows actual held custody'),
            ('georef-held-denied', source, deny, FILES[1], "writes the candidate's validated georef", 'held'),
            ('factory-transport-ignored', factory, originals[factory].decode().replace('...(options.fetchImpl ? { global: { fetch: options.fetchImpl } } : {}),', '...{},'), FILES[5], 'preserves the configured target', 'Factory preserves the original configuration authority'),
            ('default-transport-changed', factory, originals[factory].decode().replace('...(options.fetchImpl ? { global: { fetch: options.fetchImpl } } : {}),', 'global: { fetch: options.fetchImpl ?? fetch },'), FILES[5], 'keeps default service clients', 'Default callers retain their SDK transport'),
            ('target-requirement-removed', factory, originals[factory].decode().replace("requireEnv('NEXT_PUBLIC_SUPABASE_URL'),", "'https://invented-target.example.invalid',"), FILES[5], 'refuses a missing configured target', 'Missing required environment variable'),
        ]
        for label, path, changed, filename, pattern, reason in cases:
            try:
                assert changed.encode() != originals[path], label + ' applies'
                path.write_text(changed)
                code, data, output = execute(label, filename, pattern)
                failed = [case for file in data['testResults'] for case in file['assertionResults'] if case['status'] == 'failed']
                assert code == 1 and len(failed) == 1 and pattern in failed[0]['fullName'] and reason in (' '.join(failed[0]['failureMessages']) + output), label + ' reaches intended assertion'
                rows.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': reason})
            finally:
                for original, raw in originals.items():
                    original.write_bytes(raw)
        positive('restored')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'bindings.json').write_text(json.dumps(bindings, indent=2) + '\n')
        print(rows)
    finally:
        for path, raw in originals.items():
            path.write_bytes(raw)
            assert path.read_bytes() == raw

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
