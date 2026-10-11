"""Check cancellation assertions against altered behavior in the owned checkout."""
from pathlib import Path
import hashlib, json, subprocess, sys
here = Path(__file__).resolve().parent
root = here.parents[2]
paths = [root/'openplan/src/lib/gtfs/fetch.ts', root/'openplan/src/lib/http/outbound-url.ts']
originals = [path.read_text() for path in paths]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=False)

def change(index, before, after, count=1):
    assert originals[index].count(before) == count, before
    sources = originals.copy()
    sources[index] = sources[index].replace(before, after)
    return sources

variants = [
    ('baseline', originals, None),
    ('harmless', [s+'\n// Harmless cancellation control.\n' for s in originals], None),
    ('wrapper-signal', change(0, '    signal: options.signal,\n', ''), 'pre-cancelled feed wrapper'),
    ('unbounded-resolver', change(1, 'Promise.race([fetchValidatedHops(raw, init, options, hops), cancelled])',
        'fetchValidatedHops(raw, init, options, hops)'), 'existing download deadline'),
    ('late-dns-connect', change(1, '    const checked = await assertPublicHttpUrl(target, options);\n    init.signal?.throwIfAborted();',
        '    const checked = await assertPublicHttpUrl(target, options);'), 'abandoned lookup finishes'),
    ('late-response-leak', change(1, '      void discardBody(response);\n      init.signal.throwIfAborted();',
        '      init.signal.throwIfAborted();'), 'late response from a transport'),
    ('body-not-cancelled', change(0, 'const stop = () => { void cancel(reader); };', 'const stop = () => {};'),
        'stalled body even when its transport ignores'),
    ('wait-for-cleanup', change(0, '        void cancel(reader);', '        await cancel(reader);', count=2),
        'oversized-body refusal'),
    ('listener-retained', change(1, '    signal?.removeEventListener("abort", abort);', ''), 'cleans cancellation listeners'),
    ('reader-lock-retained', change(0, '    reader.releaseLock();', ''), 'partial body'),
    ('restored', originals, None),
]
records = []
try:
    for name, sources, expected_failure in variants:
        for path, source in zip(paths, sources): path.write_text(source)
        report = out/f'{name}.json'
        result = subprocess.run([str(root/'openplan/node_modules/.bin/vitest'), 'run',
            'src/test/gtfs-fetch-cancellation.test.ts', '--maxWorkers=1', '--reporter=json', f'--outputFile={report}'],
            cwd=root/'openplan', text=True, capture_output=True, timeout=30)
        (out/f'{name}.log').write_text(result.stdout+result.stderr)
        data = json.loads(report.read_text())
        failures = [case['fullName'] for suite in data['testResults'] for case in suite['assertionResults'] if case['status']=='failed']
        if expected_failure:
            assert result.returncode != 0 and any(expected_failure in item for item in failures), (name, failures)
        else:
            assert result.returncode == 0 and not failures and data['numPassedTests']==11, (name, result.stderr[-1000:])
        records.append({'variant': name, 'result': 'expected assertion failure' if expected_failure else 'pass',
            'failedAssertions': failures})
finally:
    for path, source in zip(paths, originals): path.write_text(source)
for path, source in zip(paths, originals): assert path.read_text()==source
summary = {'sourceSha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
    'testSha256': hashlib.sha256((root/'openplan/src/test/gtfs-fetch-cancellation.test.ts').read_bytes()).hexdigest(),
    'records': records}
(out/'result.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps(summary))
