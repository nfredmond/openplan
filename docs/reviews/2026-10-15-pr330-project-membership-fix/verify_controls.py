"""Exercise focused page assertions, retaining exact source restoration receipts."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
PAGE = ROOT / 'openplan/src/app/(app)/projects/[projectId]/page.tsx'
TEST = ROOT / 'openplan/src/test/project-detail-page.test.tsx'
PREFIX = 'ProjectDetailPage project workspace permission props uses the project role for '
LABELS = [
    'active viewer and project owner', 'active owner and project viewer',
    'active viewer and project admin', 'active viewer and project member',
    'same workspace owner', 'same workspace viewer', 'missing membership',
    'missing role', 'unknown role', 'read error with stale owner data',
]
ROLE = '  const projectRole = projectMembershipResult.error ? null : projectMembershipResult.data?.role;'
DISCLOSURE = '  reads.check("your role in this project\'s workspace", projectMembershipResult);'


def replaced(source, old, new, count=1):
    assert source.count(old) >= count, f'mutation anchor missing: {old}'
    return source.replace(old, new, count)


def classify(code, data, names, diagnostic=None):
    executed = [a for r in data.get('testResults', []) for a in r.get('assertionResults', [])
                if a['status'] in ('passed', 'failed')]
    assert sorted(a['fullName'] for a in executed) == sorted(names), 'wrong or missing executed tests'
    if diagnostic is None:
        assert code == 0 and data.get('success') is True, 'harmless control did not survive'
        assert all(a['status'] == 'passed' for a in executed), 'harmless assertion failure'
        return 'survived'
    assert code == 1 and data.get('success') is False, 'fault did not produce assertion exit 1'
    assert executed and all(a['status'] == 'failed' for a in executed), 'fault unexpectedly survived'
    for a in executed:
        messages = '\n'.join(a.get('failureMessages', []))
        assert 'AssertionError' in messages and diagnostic in messages, 'wrong failure diagnostic'
    return 'intended assertion failure'


def main():
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    original = PAGE.read_bytes()
    test_original = TEST.read_bytes()
    source = original.decode()
    cases = [('harmless-comment', source.replace('// Project controls follow', '// These project controls follow'), LABELS, None)]
    cases.append(('stale-active-role', replaced(source, ROLE, '  const projectRole = membership.role;'), LABELS[:2], 'project workspace permission props'))
    cases.append(('allow-all-controls', source.replace(', projectRole)', ', "owner")'), ['same workspace viewer'], 'project workspace permission props'))
    for label in LABELS:
        expression = '"viewer"' if label in [LABELS[0], LABELS[2], LABELS[3], LABELS[4]] else '"owner"'
        cases.append(('scenario-' + label.replace(' ', '-'), replaced(source, ROLE, f'  const projectRole = {expression};'), [label], 'project workspace permission props'))
    cases.append(('ignore-membership-read-error', replaced(source, ROLE, '  const projectRole = projectMembershipResult.data?.role;'), [LABELS[-1]], 'project workspace permission props'))
    gate_anchors = [
        ('posture', 'canWriteProjects: canAccessWorkspaceAction("plans.write", projectRole)'),
        ('stage-gate', 'canRecordDecision={canAccessWorkspaceAction("stage_gates.decisions.write", projectRole)}'),
        ('identity', 'canWriteIdentity={canAccessWorkspaceAction("plans.write", projectRole)}'),
        ('funding', 'canWriteAwards={canAccessWorkspaceAction("programs.write", projectRole)}'),
        ('documents', 'canGenerateEvidenceBundle={canAccessWorkspaceAction("programs.write", projectRole)}'),
    ]
    for label, anchor in gate_anchors:
        cases.append(('gate-' + label, replaced(source, anchor, anchor.replace('projectRole', 'membership.role')), [LABELS[1]], 'project workspace permission props'))
    # Four identical canWrite expressions, checked one at a time so no gate can hide behind another.
    anchor = 'canWrite={canAccessWorkspaceAction("plans.write", projectRole)}'
    assert source.count(anchor) == 4
    for index, label in enumerate(['delivery', 'cost', 'map', 'record']):
        parts = source.split(anchor)
        mutated = anchor.join(parts[:index + 1]) + anchor.replace('projectRole', 'membership.role') + anchor.join(parts[index + 1:])
        cases.append(('gate-' + label, mutated, [LABELS[1]], 'project workspace permission props'))
    cases.extend([
        ('projection', replaced(source, '.select("role")', '.select("user_id")'), [LABELS[0]], 'membership role projection'),
        ('workspace-filter', replaced(source, '.eq("workspace_id", project.workspace_id)', '.eq("workspace_id", membership.workspace_id)'), [LABELS[0]], 'project workspace filter'),
        ('user-filter', replaced(source, '.eq("user_id", user.id)', '.eq("user_id", project.id)'), [LABELS[0]], 'authenticated user filter'),
        ('active-navigation-mutation', replaced(source, ROLE, ROLE + '\n  membership.role = "viewer";'), [LABELS[1]], 'active navigation membership stays unchanged'),
        ('active-admission-removed', replaced(source, '  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);', '  const membership = { workspace_id: "workspace-active", role: "owner" };'), [LABELS[1]], 'active workspace admission stays in place'),
        ('failure-disclosure', replaced(source, DISCLOSURE, DISCLOSURE.replace("your role in this project's workspace", 'workspace controls')), [LABELS[-1]], 'membership read failure disclosure'),
        ('missing-composed-panel', replaced(source, '<ProjectMapPresencePanel', '<section'), [LABELS[0]], 'one composed page component'),
    ])
    start = source.index('  const projectMembershipResult =')
    end = source.index('\n', source.index(ROLE)) + 1
    lookup = source[start:end]
    moved = source[:start] + source[end:]
    moved = moved.replace('  const projectResult = await supabase', lookup.replace('project.workspace_id', 'membership.workspace_id') + '\n  const projectResult = await supabase', 1)
    cases.append(('membership-before-rls-project', moved, ['same workspace owner'], 'RLS project read precedes membership read'))
    results = []
    try:
        for number, (name, mutated, labels, diagnostic) in enumerate(cases):
            assert mutated != source, name
            receipt = out / f'{number:02d}-{name}.json'
            log = out / f'{number:02d}-{name}.log'
            names = [PREFIX + "'" + label + "'" for label in labels]
            pattern = '^(?:' + '|'.join(re.escape(n) for n in names) + ')$'
            try:
                PAGE.write_text(mutated)
                command = ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/test/project-detail-page.test.tsx',
                           '--config', '../docs/reviews/2026-10-15-pr330-project-membership-fix/vitest.config.mts',
                           '--configLoader', 'runner', '--maxWorkers', '1', '--no-file-parallelism',
                           '-t', pattern, '--reporter=json', '--outputFile=' + str(receipt)]
                with log.open('w') as stream:
                    run = subprocess.run(command, cwd=ROOT / 'openplan', stdout=stream, stderr=subprocess.STDOUT, timeout=90)
                verdict = classify(run.returncode, json.loads(receipt.read_text()), names, diagnostic)
                results.append({'name': name, 'verdict': verdict, 'executed': len(names), 'diagnostic': diagnostic})
                print(f'{name}: {verdict}', flush=True)
            finally:
                PAGE.write_bytes(original)
                assert PAGE.read_bytes() == original and TEST.read_bytes() == test_original, 'source restoration mismatch'
    finally:
        PAGE.write_bytes(original)
        summary = {'controls': results, 'pageSha256': hashlib.sha256(original).hexdigest(),
                   'testSha256': hashlib.sha256(test_original).hexdigest(),
                   'sourceRestored': PAGE.read_bytes() == original and TEST.read_bytes() == test_original}
        (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')


if __name__ == '__main__':
    main()
