"""Run real editor/recovery tests under restored source faults; a harmless comment must survive."""
from pathlib import Path
import hashlib
import json
import subprocess

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
recovery = app / 'src/lib/engagement/synthesis-review-recovery.ts'
editor = app / 'src/components/engagement/synthesis-review-editor.tsx'
parent = app / 'src/components/engagement/engagement-synthesis-sources.tsx'
originals = {p: p.read_bytes() for p in [recovery, editor, parent]}
tests = ['src/test/engagement-synthesis-review-editor.test.tsx', 'src/test/engagement-synthesis-review-recovery.test.ts']
cases = [('baseline', [], []), ('harmless-comment', [(editor, '', '// Harmless editor comment.\n')], [])]

def fault(name, path, old, replacement, expected):
    cases.append((name, [(path, old, replacement)], [expected]))

for message, expected in [
    ('Review recovery belongs to another source or session', 'retains incomplete full text'),
    ('Review recovery changed in another tab. Reopen the saved copy before editing.', "refuses another tab's edits"),
    ('The review edit could not be retained in this browser', "refuses another tab's edits"),
    ('Keep the exact pending review request until it is confirmed or preserved', 'freezes the parent'),
    ('A review request is already pending', 'freezes the parent'),
    ('Latest recovery copy belongs to another source', 'preserves unreadable'),
    ('The recovery copy could not be preserved', 'refuses failed preservation'),
    ('The preserved review copy could not be moved aside', 'refuses failed preservation'),
    ('The review receipt differs. Keep the request for recovery.', 'retains requests for refused'),
]:
    fault(message, recovery, f'throw new Error("{message}")', f'void "Removed {message}"', expected)

fault('intent-source-binding', recovery,
      'ctx.addIssue({ code: "custom", message: "Review request belongs to another account or source" });',
      '', 'checks create source identity')
fault('intent-parent-binding', recovery,
      'ctx.addIssue({ code: "custom", message: "Review request differs from its retained parent" });',
      '', 'freezes the parent')
cases.append(('bypass-stale-recovery-before-transport', [
    (recovery, '!working.pending || !same(readReviewWorkingCopy(storage, working), working)', '!working.pending'),
    (recovery, ' || !same(readReviewWorkingCopy(storage, previous), previous)', ''),
], ['does not send a missing']))
fault('drop-unreadable-original', recovery, 'new Set([raw, latest?.draft', 'new Set([null, latest?.draft', 'preserves unreadable')
fault('drop-newest-unsaved-text', recovery, 'latest?.draft || latest?.pending ? JSON.stringify(latest) : null', 'null', 'keeps the newest text visible')
fault('lost-save-confirmation', recovery,
      'cleanupError = "Review saved. Browser cleanup failed; retrying the preserved request will reopen the same save.";',
      'throw new Error("Lost confirmed save");', 'keeps confirmation after cleanup')
fault('clear-unconfirmed-on-refusal', recovery, 'if (!response.ok) throw new ReviewSaveError',
      'if (!response.ok) { storage.removeItem(key(working)); }\n  if (!response.ok) throw new ReviewSaveError', 'retains requests for refused')
fault('new-request-on-retry', recovery, 'body: JSON.stringify(intent), cache:',
      'body: JSON.stringify({ ...intent, requestId: crypto.randomUUID() }), cache:', 'keeps exact requests after interruption')

for message, expected in [
    ('Review history belongs to another source', 'refuses foreign saved review'),
    ('Saved review identity differs from this source', 'refuses foreign saved review'),
    ('Revision history belongs to another review', 'refuses foreign saved review'),
    ('Revision continuation belongs to another review', 'loads both history tails'),
]:
    fault(message, editor, f'throw new Error("{message}")', f'void "Removed {message}"', expected)
fault('late-read-replaces-current', editor,
      'if (current !== epoch.current || sequence !== reading.current) return;',
      '', 'keeps the newer requested revision')
fault('hide-newest-unstored-text', editor, 'setWorking(value); setBlocked(true);', 'setBlocked(true);', 'keeps the newest text visible')
fault('allow-new-create-while-pending', editor, 'Boolean(draft || working.pending)', 'Boolean(draft)', 'retries the exact command')
fault('editable-old-revision', editor, 'Boolean(oldRevision)', 'false', 'restores complete unfinished notes')
fault('skip-local-change-validation', editor,
      'applySynthesisReviewChange(saved.content, change, snapshot, sourceSha256);',
      '', 'requires a reason and a real change')
fault('truncate-typed-notes', editor, 'set({ notes: event.target.value })', 'set({ notes: event.target.value.slice(0, 600) })', 'restores complete unfinished notes')
fault('drop-staff-label', editor, 'set({ label: event.target.value })', 'set({ label: current.label })', 'edits actual contribution membership')
fault('drop-staff-summary', editor, 'set({ summary: event.target.value })', 'set({ summary: current.summary })', 'edits actual contribution membership')
fault('drop-staff-sentiment', editor, 'set({ sentiment: event.target.value as ReviewDraft["sentiment"] })', 'set({ sentiment: current.sentiment })', 'edits actual contribution membership')
fault('ignore-membership-removal', editor, 'current.members.filter(id => id !== row.id)', 'current.members', 'edits actual contribution membership')
fault('ignore-membership-addition', editor, '[...current.members, row.id]', 'current.members', 'edits actual contribution membership')
fault('hide-source-recovery-notice', parent, 'return recovery.draft || recovery.pending ?', 'return false ?', 'retries the exact command')
fault('lose-focus-reopening', parent, 'if (requestId) void inspect(requestId);', '', 'reopens the selected source after focus')
fault('lose-review-connection', parent,
      '<SynthesisReviewEditor userId={userId} workspaceId={workspaceId} campaignId={campaignId} sourceId={inspection.requestId} sourceSha256={inspection.snapshotSha256} snapshot={inspection.snapshot} onAccessLost={loseReviewAccess} recoveryMemory={reviewMemory(inspection)} />',
      '', 'creates a retained review from the real saved-source panel')

fault('lose-quota-failed-memory', editor, 'recoveryMemory.current = value;', '', 'keeps quota-failed text')
fault('overwrite-quota-failed-edit-on-history-open', editor, 'if (!blocked) update(', 'update(', 'keeps quota-failed text')
fault('hide-quota-recovery-notice', parent, 'if (unsaved?.draft || unsaved?.pending)', 'if (false)', 'keeps quota-failed text')
fault('disconnect-source-recovery-memory', parent, ' recoveryMemory={reviewMemory(inspection)}', '', 'keeps quota-failed text')

# Both read and write refusals must clear the standalone editor, even before its parent unmounts it.
cases.append(('render-after-access-refusal', [(editor, 'setAccessLost(true); onAccessLost();', 'onAccessLost();')], ['hides private content']))
results = []
try:
    for name, changes, expected in cases:
        for path, raw in originals.items():
            path.write_bytes(raw)
        for path, old, replacement in changes:
            source = path.read_text()
            count = 2 if name in ['render-after-access-refusal', 'allow-new-create-while-pending'] else 1
            if old and source.count(old) != count:
                raise RuntimeError(f'Missing or ambiguous mutation seam: {name}: {source.count(old)}')
            path.write_text(source.replace(old, replacement) if old else replacement + source)
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json'], cwd=app, text=True, capture_output=True, timeout=60)
        data = json.loads(run.stdout[run.stdout.index('{'):])
        failed = [a['fullName'] for f in data['testResults'] for a in f['assertionResults'] if a['status'] == 'failed']
        ok = data['numTotalTests'] == 25 and data['numPendingTests'] == 0 and (
            run.returncode == 0 and not failed if not expected else run.returncode == 1 and all(any(e in f for f in failed) for e in expected))
        results.append({'case': name, 'exitCode': run.returncode, 'failed': failed, 'expectedOutcome': ok})
        print(json.dumps(results[-1]), flush=True)
        if not ok:
            raise RuntimeError(run.stdout + run.stderr)
finally:
    for path, raw in originals.items():
        path.write_bytes(raw)
(review / 'review-ui-mutations.json').write_text(json.dumps({
    'sourcesRestored': all(p.read_bytes() == raw for p, raw in originals.items()), 'cases': results,
    'sourceSha256': {str(p.relative_to(app)): hashlib.sha256(raw).hexdigest() for p, raw in originals.items()},
    'testSha256': {p: hashlib.sha256((app / p).read_bytes()).hexdigest() for p in tests},
    'limits': 'Real editor and browser-storage logic with synthetic transport in jsdom. Not native layout, browser lifecycle, actual database concurrency, human usefulness, approvals or exports. The stale-copy fault removes both overlapping pre-transport checks to test actual unintended sending.'
}, indent=2) + '\n')
