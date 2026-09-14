"""Probe complete preparation and its inspector; preserve exact original bytes after each fault."""
from pathlib import Path
import hashlib
import json
import subprocess

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
engine = app / 'src/lib/engagement/synthesis-preparation.ts'
panel = app / 'src/components/engagement/synthesis-source-inspection.tsx'
originals = {p: p.read_bytes() for p in [engine, panel]}
tests = ['src/test/engagement-synthesis-preparation.test.ts', 'src/test/engagement-synthesis-preparation-panel.test.tsx']
complete = 'accounts for every source at 301 comments'
history = 'keeps historical versions'
missing = 'preserves uncategorized'
empty = 'counts retained sessions'
refusal = 'refuses duplicate membership'
ui = 'shows complete counts and all group members'
ui_missing = 'displays unavailable historical context'
cases = [
 ('baseline', None, '', '', []),
 ('harmless-comment', engine, '', '// Harmless preparation control.\n', []),
 ('drop-tail', engine, 'for (const item of snapshot.items)', 'for (const item of snapshot.items.slice(0, 300))', [complete]),
 ('drop-surveys', engine, 'for (const answer of snapshot.answers)', 'for (const answer of snapshot.answers.slice(0, 0))', [complete]),
 ('wrong-source-hash', engine, 'sha256: sourceSha256', 'sha256: "0".repeat(64)', [complete]),
 ('invent-neutral', engine, '"not_assessed" as const', '"neutral" as const', [complete]),
 ('wrong-algorithm-version', engine, 'algorithmVersion: 1 as const', 'algorithmVersion: 2 as const', [complete]),
 ('replies-are-comments', engine, 'if (item.parent_item_id) replies++; else comments++;', 'comments++;', [history]),
 ('rewrite-history', engine, 'category(item.configuration_version_id, item.category_id)', 'category(snapshot.campaign.configurationVersionId, item.category_id)', [history]),
 ('lose-question-prompt', engine, 'label: answer.question_prompt_snapshot', 'label: null', [history]),
 ('lose-question-type', engine, 'questionType: answer.question_type', 'questionType: "free_text"', [empty]),
 ('colliding-source-kinds', engine, '`answer:${answer.id}`', '`item:${answer.id}`', [history]),
 ('missing-definition-as-uncategorized', engine, '!definition ? "definition_unavailable" : questionMissing', '!definition ? "uncategorized" : questionMissing', [missing]),
 ('missing-question-as-uncategorized', engine, 'questionMissing ? "question_unavailable"', 'questionMissing ? "uncategorized"', [missing]),
 ('missing-category-as-uncategorized', engine, '!retainedCategory ? "category_unavailable"', '!retainedCategory ? "uncategorized"', [missing]),
 ('hide-empty-sessions', engine, 'sessions.size - answeredSessions.size', '0', [empty]),
 ('allow-duplicate-membership', engine, 'throw new Error("Duplicate preparation source membership")', 'void 0', [refusal]),
 ('substitute-orphan-session', engine, 'sessions.get(answer.session_id)', '(sessions.get(answer.session_id) ?? snapshot.sessions[0])', [refusal]),
 ('ignore-item-count', engine, 'snapshot.counts.items !== comments + replies', 'false', [refusal]),
 ('ignore-answer-count', engine, 'snapshot.counts.answers !== snapshot.answers.length', 'false', [refusal]),
 ('ignore-session-count', engine, 'snapshot.counts.sessions !== sessions.size', 'false', [refusal]),
 ('hide-group-filter', panel, '(!members || members.has(row.id))', 'true', [ui]),
 ('hide-complete-count', panel, '{preparation.counts.contributions} contributions accounted for:', '0 contributions accounted for:', [ui]),
 ('hide-assessment-limit', panel, 'Themes, sentiment, typed-answer interpretation and representative support are not assessed.', 'Interpretation completed.', [ui]),
 ('retain-stale-search', panel, 'setGroupId(event.target.value); setSearch(""); setPage(0);', 'setGroupId(event.target.value); setPage(0);', [ui]),
 ('truncate-group-membership', panel, 'selectedGroup.sourceIds.join("\\n")', 'selectedGroup.sourceIds.slice(0, 25).join("\\n")', [ui]),
 ('hide-missing-version', panel, 'selectedGroup.versionId ?? "unavailable"', 'selectedGroup.versionId ?? "current"', [ui_missing]),
]
results = []
try:
    for name, path, old, replacement, expected in cases:
        for file, raw in originals.items(): file.write_bytes(raw)
        if path:
            source = originals[path].decode()
            if old and source.count(old) != 1: raise RuntimeError(f'Missing/ambiguous seam: {name}')
            path.write_text(source.replace(old, replacement) if old else replacement + source)
        run = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', *tests, '--reporter=json'], cwd=app, text=True, capture_output=True, timeout=60)
        payload = json.loads(run.stdout[run.stdout.index('{'):])
        failed = [a['fullName'] for f in payload['testResults'] for a in f['assertionResults'] if a['status'] == 'failed']
        ok = payload['numTotalTests'] == 10 and payload['numPendingTests'] == 0 and (run.returncode == 0 and not failed if not expected else run.returncode == 1 and all(any(e in f for f in failed) for e in expected))
        results.append({'case': name, 'exitCode': run.returncode, 'failed': failed, 'expectedOutcome': ok})
        print(json.dumps(results[-1]), flush=True)
        if not ok: raise RuntimeError(f'Unexpected outcome: {name}\n{run.stdout}\n{run.stderr}')
finally:
    for file, raw in originals.items(): file.write_bytes(raw)
(review / 'preparation-mutations.json').write_text(json.dumps({
    'sourcesRestored': all(file.read_bytes() == raw for file, raw in originals.items()), 'cases': results,
    'sourceSha256': {str(p.relative_to(app)): hashlib.sha256(raw).hexdigest() for p, raw in originals.items()},
    'testSha256': {p: hashlib.sha256((app / p).read_bytes()).hexdigest() for p in tests},
    'limits': 'Pure preparation and rendered component behavior on synthetic snapshots. This does not verify browser layout, stored source integrity, live database access, human interpretation, saved staff reviews, generation, or exports.'
}, indent=2) + '\n')
