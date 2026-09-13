"""Prove the response route boundary and private aggregate reader without changing a database."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
app = root.parents[2] / 'openplan'
scratch = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/route-mutations')
scratch.mkdir(parents=True, exist_ok=True)
paths = {
    'route': app / 'src/lib/engagement/response-write-route.ts',
    'reader': app / 'src/lib/engagement/response-broadcast.ts',
    'get': app / 'src/app/api/engagement/campaigns/[campaignId]/closeloop/broadcasts/[requestId]/route.ts',
}
originals = {key: path.read_text() for key, path in paths.items()}
cases = [
    ('baseline', 'route', None, None, None),
    ('harmless-comment', 'route', 'the database owns all write side effects', 'the transaction owns all write side effects', None),
    ('write-with-read-permission', 'route', 'user.id, "engagement.write"', 'user.id, "engagement.read"', 'passes the caller'),
    ('lost-entry-identity', 'route', 'entryId: entryParams.parse(params.data).entryId', 'entryId: params.data.campaignId', 'passes the caller'),
    ('no-body-limit', 'route', 'BODY_LIMITS.normalJson', '1_000_000', 'rejects oversize JSON'),
    ('write-with-denied-access', 'route', 'if (!access.allowed)', 'if (false)', 'refuses denied campaign access'),
    ('ignored-access-read-failure', 'route', 'if (access.error)', 'if (false)', 'refuses unreadable campaign access'),
    ('missing-campaign-write', 'route', 'if (!access.campaign)', 'if (false)', 'refuses missing campaign access'),
    ('lost-write-refusal', 'route', '{ status: written.error.status, headers }', '{ status: 200, headers }', 'preserves transaction refusal'),
    ('lost-replay-create-status', 'route', 'operation === "create" && !written.result.replayed', 'operation === "create"', 'preserves a confirmed replay'),
    ('unread-publication-status', 'route', 'written.result.becamePublished\n', 'false\n', 'publication reports durable status'),
    ('lost-confirmed-save', 'route', '// The receipt proves the save.', 'if (written.result.becamePublished) return NextResponse.json(unconfirmed, { status: 503, headers });\n      // The receipt proves the save.', 'keeps publication confirmed'),
    ('report-read-invented-success', 'route', 'broadcast.error || !broadcast.report', 'false', 'keeps publication confirmed'),
    ('ignored-report-campaign', 'reader', 'report.campaignId !== campaignId ||', 'false ||', 'refuses incomplete, foreign or unsafe report'),
    ('ignored-report-request', 'reader', 'report.requestId !== requestId', 'false', 'refuses incomplete, foreign or unsafe report'),
    ('leaked-extra-report-data', 'reader', '.strict()', '.passthrough()', 'refuses incomplete, foreign or unsafe report'),
    ('ignored-report-shape', 'reader', 'responseBroadcastSchema.parse(response.data)', 'response.data as ResponseBroadcast', 'refuses incomplete, foreign or unsafe report'),
    ('ignored-report-total', 'reader', 'total === report.preparedCount', 'true', 'refuses incomplete, foreign or unsafe report'),
    ('invented-queued-count', 'reader', 'report.preparedCount === null && total === 0', 'true', 'refuses incomplete, foreign or unsafe report'),
    ('negative-outcome-count', 'reader', '.int().nonnegative().safe()', '.int().safe()', 'refuses incomplete, foreign or unsafe report'),
    ('read-with-read-permission', 'get', 'user.id, "engagement.write"', 'user.id, "engagement.read"', 'returns a validated complete report'),
    ('private-read-with-denied-access', 'get', 'if (!access.allowed)', 'if (false)', 'refuses denied access before a private read'),
    ('private-read-after-access-error', 'get', 'if (access.error)', 'if (false)', 'refuses unreadable access before a private read'),
    ('private-read-missing-campaign', 'get', 'if (!access.campaign)', 'if (false)', 'refuses missing access before a private read'),
    ('lost-private-cache', 'get', '"private, no-store"', '"public, max-age=3600"', 'returns a validated complete report'),
    ('missing-report-as-zero', 'get', 'if (!result.report)', 'if (false)', 'distinguishes a missing record from known zero'),
    ('ignored-private-permission-refusal', 'get', 'if (result.error)', 'if (false)', 'preserves a database permission refusal'),
]
results = []
try:
    for name, key, before, after, expected in cases:
        source = originals[key]
        if before:
            assert source.count(before) == (2 if name in ('lost-entry-identity', 'leaked-extra-report-data') else 1), name
            source = source.replace(before, after)
        paths[key].write_text(source)
        report = scratch / f'{name}.json'
        if report.exists():
            report.unlink()
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', 'src/test/engagement-response-write-route.test.ts', '--reporter=json', f'--outputFile={report}'],
                             cwd=app, text=True, capture_output=True, timeout=45)
        data = json.loads(report.read_text()) if report.exists() else {}
        failed = [test['fullName'] for file in data.get('testResults', []) for test in file.get('assertionResults', []) if test['status'] == 'failed']
        matched = run.returncode == 0 and data.get('numPassedTests') == 83 if expected is None else run.returncode != 0 and any(expected in title for title in failed)
        results.append({'name': name, 'matched': matched, 'status': run.returncode,
                        'outcome': 'survived' if run.returncode == 0 else 'killed',
                        'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                        'expectedFailingTest': expected, 'failedTests': failed,
                        'passedTests': data.get('numPassedTests'), 'failedTestCount': data.get('numFailedTests')})
        (root / 'route-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
        paths[key].write_text(originals[key])
        print(name, results[-1]['outcome'], matched, flush=True)
        if not matched:
            raise RuntimeError(run.stdout[-1000:] + run.stderr[-1000:] + str(failed))
finally:
    for key, path in paths.items():
        path.write_text(originals[key])
print('Original route and reader sources restored', flush=True)
