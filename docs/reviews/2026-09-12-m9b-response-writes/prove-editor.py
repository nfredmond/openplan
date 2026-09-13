"""Mutation evidence for retained editor requests, review, notices and the direct-write ratchet."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
app = root.parents[2] / 'openplan'
scratch = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/editor-mutations')
scratch.mkdir(parents=True, exist_ok=True)
paths = {
    'recovery': app / 'src/components/engagement/response-write-recovery.tsx',
    'storage': app / 'src/lib/engagement/pending-response.ts',
    'builder': app / 'src/components/engagement/close-loop-builder.tsx',
    'history': app / 'src/components/engagement/response-history.tsx',
    'notice': app / 'src/components/engagement/response-broadcast-notice.tsx',
    'route': app / 'src/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route.ts',
    'adapter': app / 'src/lib/engagement/response-write.ts',
}
originals = {key: path.read_text() for key, path in paths.items()}
tests = ['src/test/' + name for name in ('engagement-response-recovery.test.tsx', 'close-loop-builder.test.tsx',
    'engagement-response-history-ui.test.tsx', 'engagement-response-write.test.ts', 'write-policy-coverage-guard.test.ts')]
cases = [
    ('baseline', 'recovery', None, None, None),
    ('harmless-comment', 'recovery', 'One pending write per campaign', 'One retained write per campaign', None),
    ('uneditable-invalid-unsent-request', 'recovery', 'if (!pendingResponseSchema.safeParse(value).success)', 'if (false)', 'leaves an invalid unsent edit editable'),
    ('lost-retry-focus', 'recovery', 'recoveryRef.current?.focus()', 'void 0', 'recovers an interrupted correction'),
    ('lost-confirmed-focus', 'recovery', 'confirmationRef.current?.focus()', 'void 0', 'retains before transport'),
    ('body-size-refusal-unconfirmed', 'recovery', 'response.status === 413 ||', 'false ||', 'offers reviewed correction after an HTTP body-size refusal'),
    ('untrimmed-accepted-suggestion', 'builder', 'draft.themeTitle.trim() !== body.themeTitle', 'draft.themeTitle !== body.themeTitle', 'removes an accepted AI suggestion'),
    ('unretained-unreadable-copy', 'storage', 'if (storage.getItem(archiveKey) !== raw)', 'if (false)', 'keeps an unreadable active record'),
    ('archived-valid-request', 'storage', 'if (readable)', 'if (false)', 'does not archive a valid request'),
    ('no-preflight-retention', 'recovery', 'retained = retainPendingResponse(window.sessionStorage, { ...value, phase: "unconfirmed" });', 'retained = { ...value, phase: "unconfirmed" };', 'retains before transport'),
    ('new-identity-on-retry', 'recovery', 'body: JSON.stringify(intent.body)', 'body: JSON.stringify({ ...intent.body, requestId: crypto.randomUUID() })', 'recovers an interrupted correction'),
    ('premature-clear', 'recovery', 'const result = readResponseWriteResult(payload, campaignId, intent);', 'clearPendingResponse(window.sessionStorage, retained);\n      const result = readResponseWriteResult(payload, campaignId, intent);', 'keeps the pending draft after a successful HTTP response'),
    ('forgotten-reload-intent', 'recovery', 'const retained = readPendingResponse(window.sessionStorage, userId, campaignId);', 'const retained = null;', 'keeps a committed removal retry available'),
    ('lost-review-scope', 'recovery', 'rows.some(row => row.campaign_id !== campaignId)', 'false', 'keeps the draft and refuses replacement'),
    ('stale-reviewed-version', 'recovery', 'expectedUpdatedAt: current.updated_at', 'expectedUpdatedAt: p.before!.updated_at', 'requires current-copy review before replacing'),
    ('overwritten-intervening-text', 'recovery', 'if (key in intent.body || editedWords[key] !== previous)', 'if (true)', 'does not overwrite an intervening text correction'),
    ('lost-reviewed-tag-clear', 'recovery', 'words.categoryId = editedWords.categoryId;', 'words.categoryId = proposedCategory;', 'can correct a rejected theme tag'),
    ('unbounded-save', 'recovery', 'signal: AbortSignal.timeout(30_000),', '// Deliberately remove the save deadline.', 'retains before transport'),
    ('discarded-absent-before-review', 'recovery', 'onAbsent(intent.entryId);', '// Deliberately leave the absent card in the current list.', 'resolves a confirmed absent current response'),
    ('ignored-storage-readback', 'storage', 'if (storage.getItem(key) !== serialized)', 'if (false)', 'detects a storage write that returned'),
    ('ignored-storage-owner', 'storage', 'pending.userId !== userId ||', 'false ||', 'refuses a foreign scope or baseline'),
    ('ignored-baseline-version', 'storage', 'pending.before.updated_at === pending.intent.body.expectedUpdatedAt', 'true', 'refuses a foreign scope or baseline'),
    ('cleared-newer-request', 'storage', 'if (current && current.intent.body.requestId !== pending.intent.body.requestId)', 'if (false)', 'does not clear a newer pending request'),
    ('duplicate-created-row', 'builder', 'previous.some(row => row.id === result.entryId)', 'false', 'recovers a created response after reload'),
    ('lost-write-inhibition', 'builder', ' || writes.busy || Boolean(writes.pending)', '', 'keeps the pending draft after a successful HTTP response'),
    ('unrecorded-change-reason', 'builder', 'if (!reason.trim())', 'if (false)', 'requires a recorded reason'),
    ('lost-history-reason', 'history', 'row.change_reason || "Not recorded"', '"Not recorded"', 'shows retained staff and source-withdrawal reasons'),
    ('lost-withdrawal-origin', 'history', 'row.change_origin === "source_withdrawal"', 'false', 'shows retained staff and source-withdrawal reasons'),
    ('false-inbox-delivery', 'notice', 'accepted by the email provider; inbox delivery is not confirmed', 'delivered to the inbox', 'refreshes complete email states'),
    ('ignored-notice-scope', 'notice', 'parsed.data.campaignId === campaignId', 'true', 'refreshes complete email states'),
    ('ignored-history-anchor', 'notice', 'id={anchorId ?? `closeloop-broadcast-notice-${entryId}`}', 'id={`closeloop-broadcast-notice-${entryId}`}', 'reopens a retained publication'),
    ('lost-history-publication-report', 'history', 'row.event === "published" && row.write_request_id', 'false', 'reopens a retained publication'),
    ('fixed-repeated-anchor', 'notice', 'id={anchorId ?? `closeloop-broadcast-notice-${entryId}`}', 'id="closeloop-broadcast-notice"', 'gives repeated cards unique anchors'),
    ('unsafe-direct-delete', 'route', '\nexport const PATCH', '\nimport { createClient } from "@/lib/supabase/server";\nasync function unsafeDelete() { const supabase = await createClient(); await supabase.from("engagement_closeloop_entries").delete().eq("id", "synthetic"); }\nexport const PATCH', 'adds no new UPDATE or DELETE'),
    ('unchecked-browser-receipt', 'adapter', 'const result = responseWriteResultSchema.parse(data);', 'const result = data as ResponseWriteResult;', 'keeps the pending draft after a successful HTTP response'),
]
selected = os.environ.get('OPENPLAN_EDITOR_MUTATIONS_CASES', '').split(',')
selected = [name for name in selected if name]
if selected:
    assert set(selected).issubset({case[0] for case in cases}), selected
    cases = [case for case in cases if case[0] in ('baseline', 'harmless-comment') or case[0] in selected]
output = root / os.environ.get('OPENPLAN_EDITOR_MUTATIONS_REPORT', 'editor-additional-mutations.json' if selected else 'editor-mutations.json')
results = []
try:
    for name, key, before, after, expected in cases:
        source = originals[key]
        if before:
            assert source.count(before) == (2 if name in ('stale-reviewed-version', 'unrecorded-change-reason') else 1), (name, source.count(before))
            source = source.replace(before, after)
        paths[key].write_text(source)
        report = scratch / f'{name}.json'
        if report.exists():
            report.unlink()
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json', f'--outputFile={report}'],
                             cwd=app, text=True, capture_output=True, timeout=60)
        data = json.loads(report.read_text()) if report.exists() else {}
        failed = [test['fullName'] for file in data.get('testResults', []) for test in file.get('assertionResults', []) if test['status'] == 'failed']
        matched = run.returncode == 0 and data.get('numPassedTests', 0) >= 60 if expected is None else run.returncode != 0 and any(expected in title for title in failed)
        results.append({'name': name, 'matched': matched, 'status': run.returncode,
                        'outcome': 'survived' if run.returncode == 0 else 'killed',
                        'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                        'expectedFailingTest': expected, 'failedTests': failed,
                        'passedTests': data.get('numPassedTests'), 'failedTestCount': data.get('numFailedTests')})
        output.write_text(json.dumps(results, indent=2) + '\n')
        paths[key].write_text(originals[key])
        print(name, results[-1]['outcome'], matched, flush=True)
        if not matched:
            raise RuntimeError(run.stdout[-1000:] + run.stderr[-1000:] + str(failed))
finally:
    for key, path in paths.items():
        path.write_text(originals[key])
print('Original editor sources restored', flush=True)
