"""Mutate intake behavior serially; restore owned source even after failure."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

here = Path(__file__).resolve().parent
root = here.parents[2]
path = root / 'openplan/src/lib/gtfs/managed-worker-intake.ts'
original = path.read_text()
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=False)

def change(before, after):
    assert original.count(before) == 1, before
    return original.replace(before, after)

variants = [
    ('baseline', original, None),
    ('harmless', original + '\n// Harmless source custody control.\n', None),
    ('binding', change('isDeepStrictEqual(saved.binding, binding)', 'true'), 'changed actorId source binding'),
    ('unbound-file', change('throw new Error("GTFS source file has no binding");', '// Allow an unbound file.'), 'unbound existing local file'),
    ('private-file', change('before.isFile() && before.uid === process.getuid?.() && (before.mode & 0o077) === 0', 'before.isFile()'), 'public local source files'),
    ('file-symlink', change('constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK', 'constants.O_RDONLY | constants.O_NONBLOCK'), 'symlink local source files'),
    ('size-cap', change('before.size > 0 && before.size <= maxBytes', 'before.size > 0'), 'current installation cap'),
    ('file-sync', change('await writing.writeFile(bytes); await writing.sync();', 'await writing.writeFile(bytes);'), 'saves private synced bytes'),
    ('saved-hash', change('!saved.archive || isDeepStrictEqual(saved.archive, archive)', 'true'), 'changed local bytes'),
    ('missing-saved-file', change('if (!absent(error) || saved.archive) throw error;', 'if (!absent(error)) throw error;'), 'missing saved file'),
    ('prepared-refetch', change('if (snapshot.archive) {', 'if (snapshot.archive && false) {'), 'prepared but unavailable archive'),
    ('snapshot-custody', change('!snapshot.archive || isDeepStrictEqual(snapshot.archive, archive)', 'true'), 'prepared source differs'),
    ('fetch-signal', change('{ ...options.fetchOptions, signal }', '{ ...options.fetchOptions }'), 'limits and cancellation into the fetcher'),
    ('fetch-refusal', change('if (!fetched.ok) return', 'if (!fetched.ok) throw new Error("Lost source refusal");\n        if (!fetched.ok) return'), 'explicit source refusal'),
    ('transport-signal', change('return transport(input, { ...init, signal: active });', 'return transport(input, init);'), 'cancellation to the external upload request'),
    ('inherited-signal', change('const active = inherited ? AbortSignal.any([signal, inherited]) : signal;', 'const active = signal;'), 'both inherited cancellation'),
    ('transport-preabort', change('      signal.throwIfAborted();\n      const inherited', '      const inherited'), 'both inherited cancellation'),
    ('upsert', change('upsert: false', 'upsert: true'), 'saves private synced bytes'),
    ('remote-conflict', change('remote.ok || remote.code === "archive_unavailable"', 'true'), 'mismatched existing bytes'),
    ('skip-download', change('requireMatch(remote.ok, "GTFS uploaded archive is unconfirmed");', '// Trust the upload path only.'), 'path-only upload acknowledgement'),
    ('upload-unbounded', change('await whileActive(upload.storage.from', 'await whileActive(upload.storage.from').replace('}), uploadSignal);', '}), signal);'), 'ignored upload deadline'),
    ('refresh-active', change('refreshed.active && refreshed.state', 'true || refreshed.state'), 'inactive refreshed custody'),
    ('refresh-confirmed', change('refreshed.state === "running" && refreshed.archiveConfirmed', 'refreshed.state === "running"'), 'unconfirmed refreshed custody'),
    ('refresh-scope', change('&& isDeepStrictEqual({ ...refreshed, stage: snapshot.stage, archive: snapshot.archive,\n        archiveConfirmed: snapshot.archiveConfirmed }, snapshot)', ''), 'actor refreshed custody'),
    ('parser-stale-snapshot', change('owned: intake.owned,', 'owned: options.owned,'), 'only the refreshed confirmed attempt'),
    ('parser-shared-directory', change('requireMatch(options.directory !== options.artifact.directory, "GTFS intake and parser directories must differ");', '// Allow shared recovery directories.'), 'sharing parser and source journal'),
    ('inactive-attempt', change('snapshot.active && snapshot.state === "running"', 'snapshot.state === "running"'), 'inactive intake before I/O'),
    ('invalid-target', change('["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash', 'true'), 'invalid-target intake before I/O'),
    ('record-cap', change('Buffer.byteLength(JSON.stringify(record)) <= 65536', 'true'), 'oversized source metadata'),
    ('restored', original, None),
]
records = []
try:
    for name, source, assertion in variants:
        path.write_text(source)
        report = out / f'{name}.json'
        args = [str(root/'openplan/node_modules/.bin/vitest'), 'run', 'src/test/gtfs-managed-worker-intake.test.ts',
                'src/test/gtfs-intake-transport-native.test.ts',
                '--maxWorkers=1', '--reporter=json', f'--outputFile={report}']
        if name == 'upload-unbounded': args += ['--testTimeout=1000']
        result = subprocess.run(args, cwd=root/'openplan', capture_output=True, text=True, timeout=30)
        (out/f'{name}.log').write_text(result.stdout + result.stderr)
        data = json.loads(report.read_text())
        failures = [c['fullName'] for s in data['testResults'] for c in s['assertionResults'] if c['status'] == 'failed']
        if assertion:
            assert result.returncode != 0 and any(assertion in case for case in failures), (name, failures)
        else:
            assert result.returncode == 0 and not failures, (name, failures)
        records.append({'variant': name, 'result': 'expected assertion failure' if assertion else 'pass', 'failedAssertions': failures})
        print(name, records[-1]['result'], flush=True)
finally:
    path.write_text(original)
assert path.read_text() == original
summary = {'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
           'testSha256': hashlib.sha256((root/'openplan/src/test/gtfs-managed-worker-intake.test.ts').read_bytes()).hexdigest(), 'records': records}
(out/'result.json').write_text(json.dumps(summary, indent=2) + '\n')
