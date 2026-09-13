import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
app = root.parents[2] / 'openplan'
scratch = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/typescript-mutations')
scratch.mkdir(parents=True, exist_ok=True)
paths = {
    'write': app / 'src/lib/engagement/response-write.ts',
    'history': app / 'src/lib/engagement/response-history.ts',
    'worker': app / 'src/lib/notifications/engagement.ts',
    'journal': app / 'src/lib/notifications/response-email-journal.ts',
    'email': app / 'src/lib/notifications/email.ts',
}
originals = {key: path.read_text() for key, path in paths.items()}
tests = ['src/test/' + name for name in (
    'engagement-response-write.test.ts', 'engagement-response-history.test.ts',
    'engagement-response-email-worker.test.ts', 'engagement-response-email-journal.test.ts',
    'notifications-email.test.ts', 'engagement-notifications-reader-inventory.test.ts')]
cases = [
    ('baseline', 'write', None, None, None),
    ('harmless-comment', 'write', 'Send the exact validated intent', 'Send the validated intent unchanged', None),
    ('missing-request', 'write', 'const intent = {\n  requestId: z.string().uuid(),', 'const intent = {\n  requestId: z.string().uuid().optional(),', 'requires caller-retained request identity'),
    ('missing-version', 'write', 'expectedUpdatedAt: z.string().datetime({ offset: true }),', 'expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),', 'requires a reason and original microsecond version'),
    ('blank-reason', 'write', 'reason: z.string().trim().min(1).max(2000),', 'reason: z.string().trim().max(2000),', 'requires a reason and original microsecond version'),
    ('ignored-extra-fields', 'write', '.strict()', '.strip()', 'refuses extra authority and identity fields'),
    ('changed-request', 'write', 'p_request: intent.body.requestId', 'p_request: campaignId', 'sends create provenance to the RPC'),
    ('rounded-version', 'write', 'null : intent.body.expectedUpdatedAt,', 'null : intent.body.expectedUpdatedAt.slice(0,23) + "Z",', 'keeps exact correction identity'),
    ('lost-explicit-null', 'write', 'if (intent.body[key] !== undefined)', 'if (intent.body[key] != null)', 'keeps exact correction identity'),
    ('foreign-campaign-receipt', 'write', '|| result.entry.campaign_id !== campaignId', '|| false', 'refuses an invalid or mismatched receipt'),
    ('foreign-entry-receipt', 'write', '|| (intent.operation !== "create" && result.entryId !== intent.entryId)', '|| false', 'refuses an invalid or mismatched receipt'),
    ('foreign-request-receipt', 'write', 'result.requestId !== intent.body.requestId ||', 'false ||', 'refuses an invalid or mismatched receipt'),
    ('unchecked-receipt-shape', 'write', 'responseWriteResultSchema.parse(response.data)', 'response.data as ResponseWriteResult', 'refuses an invalid or mismatched receipt'),
    ('invented-validation-failure', 'write', '&& message === "Review and publish linked contributions before publishing the staff response"', '&& true', 'distinguishes database P0001'),
    ('lost-conflict-state', 'write', 'if (code === "40001" || code === "23505")', 'if (false)', 'distinguishes database 40001'),
    ('lost-history-reason', 'history', 'change_reason: z.string().nullable().default(null),', 'change_reason: z.string().nullable().default(null).transform(() => null),', 'keeps old reasons unknown'),
    ('invented-old-reason', 'history', 'change_reason: z.string().nullable().default(null),', 'change_reason: z.string().nullable().default("Reason retained"),', 'keeps old reasons unknown'),
    ('ignored-preparation-failure', 'worker', 'if (prepared.error) return "unavailable";', 'if (false) return "unavailable";', 'does not contact transport when preparation'),
    ('ignored-claim-failure', 'worker', 'if (claimed.error) return "unavailable";', 'if (false) return "unavailable";', 'does not contact transport when preparation'),
    ('ignored-message-checksum', 'worker', '|| createHash("sha256").update(claim.messageText).digest("hex") !== claim.contentSha256', '|| false', 'does not contact transport when preparation'),
    ('ignored-attempt-identity', 'worker', 'claim.attemptToken !== attempt ||', 'false ||', 'does not contact transport when preparation'),
    ('unretained-delivery-result', 'worker', 'await journal.retain(outcome);', '// Deliberately skip the journal.', 'requires the retained claim and exact checksum'),
    ('ignored-acknowledgement', 'worker', 'return !result.error && result.data === true;', 'return true;', 'retries only the outcome after acknowledgement fails'),
    ('false-provider-refusal', 'worker', 'result.reason === "not_configured" ? "skipped" : "uncertain"', 'result.reason === "not_configured" ? "skipped" : "failed"', 'records no configured provider as skipped'),
    ('discarded-pending-outcome', 'journal', 'if (await finish(outcome))', 'if (true)', 'recovers an exact retained result in a new journal instance'),
    ('mismatched-journal-file', 'journal', 'if (name !== `${basename(outcome)}.pending.json`)', 'if (false)', 'retains malformed and mismatched files'),
    ('unbounded-provider-request', 'email', 'signal: AbortSignal.timeout(20_000),', '// Deliberately remove the request deadline.', 'bounds a stalled provider request'),
]
results = []
try:
    for name, key, before, after, expected in cases:
        source = originals[key]
        if before:
            assert source.count(before) == (3 if name == 'ignored-extra-fields' else 1), name
            source = source.replace(before, after)
        paths[key].write_text(source)
        report = scratch / f'{name}.json'
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json', f'--outputFile={report}'],
                             cwd=app, text=True, capture_output=True, timeout=45)
        data = json.loads(report.read_text()) if report.exists() else {}
        failed = [test['fullName'] for file in data.get('testResults', [])
                  for test in file.get('assertionResults', []) if test['status'] == 'failed']
        matched = run.returncode == 0 and data.get('numPassedTests', 0) >= 64 if expected is None else run.returncode != 0 and any(expected in title for title in failed)
        results.append({'name': name, 'matched': matched, 'status': run.returncode,
                        'outcome': 'survived' if run.returncode == 0 else 'killed',
                        'changedSourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                        'expectedFailingTest': expected, 'failedTests': failed,
                        'passedTests': data.get('numPassedTests'), 'failedTestCount': data.get('numFailedTests')})
        (root / 'typescript-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
        paths[key].write_text(originals[key])
        print(name, results[-1]['outcome'], matched, flush=True)
        if not matched:
            raise RuntimeError(run.stdout[-1000:] + run.stderr[-1000:] + str(failed))
finally:
    for key, path in paths.items():
        path.write_text(originals[key])
print('Original TypeScript sources restored', flush=True)
