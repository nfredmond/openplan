"""Bound input custody and screen this report without executing subject code."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUBJECT = HERE.parent / '2026-10-15-portfolio-skip-preview-v5-corrections'
PACKET = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v5-independent-round2-20261015-78ca8e4a')
PRIOR = Path('/home/nathaniel/.t3/worktrees/openplan/t3-1eb9f303/docs/reviews/2026-10-15-portfolio-skip-preview-v4-independent-round1')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def js(path):
    return json.loads(path.read_text())


def main():
    before = js(PRIVATE / 'subject-before-02.json')
    after = {str(path.relative_to(PACKET)): {'sha256': sha(path), 'mode': path.stat().st_mode & 0o777}
             for path in PACKET.rglob('*') if path.is_file() and not path.is_symlink()}
    assert before == after, 'subject-private-changed'
    manifest = js(SUBJECT / 'manifest.json')
    assert all(sha(PACKET / name) == expected for name, expected in manifest['files'].items())
    old_inventory_names = ['v4-full-inventory-before.json', 'v4-full-inventory-after-preparation.json',
                           'old-roots-after-final-audit-01.json', 'old-roots-after-final-audit-02.json', 'old-roots-after-final-audit-03.json']
    assert len({sha(PACKET / name) for name in old_inventory_names}) == 1, 'saved-inventory-binding'
    # Retained bytes only. No fresh dump, source capture or live transport.
    dump = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump')
    assert dump.stat().st_size == 16232305 and sha(dump) == '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'
    v4 = PACKET.with_name('project-portfolio-skip-preview-20261015-v4')
    envs = js(PACKET / 'envs-private.json'); old_envs = js(v4 / 'envs-private.json')
    for kind, key in [('rest', 'PGRST_DB_URI'), ('auth', 'GOTRUE_DB_DATABASE_URL'), ('storage', 'DATABASE_URL')]:
        assert envs[kind][key] == old_envs[kind][key], 'inherited-role-uri'
    failures = js(SUBJECT / 'harness-failures.json')
    for key, name in [('newFailure', 'failed-delta-controls-01.py'), ('finalAuditFailure', 'failed-final-audit-01.py'), ('secondFinalAuditFailure', 'failed-final-audit-02.py')]:
        assert sha(PACKET / name) == failures[key]['retainedSourceSHA256'], 'retained-failure-source'
    bindings = js(SUBJECT / 'review-bindings.json')
    for name, expected in bindings['files'].items():
        assert sha(PRIOR / name) == expected, 'prior-review-source'
    secret_values = set()
    for obj in [js(PACKET / 'app-env-private.json'), *envs.values()]:
        for key, value in obj.items():
            if any(word in key for word in ['KEY', 'SECRET', 'DATABASE_URL', 'DB_URI']) and len(value) > 15:
                secret_values.add(value.encode())
    assert secret_values, 'empty-secret-screen'
    def screen(data):
        assert not any(value in data for value in secret_values), 'known-secret'
        assert bytes.fromhex('e28094') not in data, 'typography'
    def detects(scanner, data, expected):
        try:
            scanner(data)
        except AssertionError as error:
            assert str(error) == expected
        else:
            raise AssertionError('missing-detector')
    screen(b'Harmless report wording')
    detects(screen, next(iter(secret_values)), 'known-secret')
    detects(screen, bytes.fromhex('e28094'), 'typography')
    try:
        detects(lambda data: None, next(iter(secret_values)), 'known-secret')
    except AssertionError as error:
        assert str(error) == 'missing-detector'
    else:
        raise AssertionError('disabled-scanner-survived')
    for path in HERE.rglob('*'):
        if path.is_file(): screen(path.read_bytes())
    controls = js(HERE / 'controls.json')
    assert sha(HERE / 'review_controls.py') == controls['reviewControlSHA256']
    assert not list((PACKET / 'execution').iterdir()) and not (PACKET / 'candidate').exists()
    report = {'subjectCommit': 'e33ad511e1e98f9ee4cfa59a32d13f23ef1debcc',
              'subjectPublicFiles': {str(path.relative_to(SUBJECT)): sha(path) for path in sorted(SUBJECT.rglob('*')) if path.is_file()},
              'subjectSealedPrivateFiles': manifest['files'],
              'priorReviewFiles': bindings['files'], 'allExistingPrivateFilesUnchanged': len(after),
              'savedOldInventorySHA256': sha(PACKET / old_inventory_names[0]),
              'retainedDump': {'bytes': dump.stat().st_size, 'sha256': sha(dump)},
              'retainedFailureSourcesMatch': True, 'knownSecretAndTypographyScreen': True,
              'screenHarmlessInjectionAndDisabledControls': True,
              'newCandidateAbsent': True, 'executionEmpty': True, 'postJourneyResultAbsent': not (PACKET / 'post-journey-result.json').exists(),
              'controlsSHA256': sha(HERE / 'controls.json'), 'driverSHA256': sha(HERE / 'review_controls.py'),
              'auditDriverSHA256': sha(Path(__file__)),
              'limits': ['Saved inventories are not fresh live old-root scans.', 'Known-value screening cannot establish absence of unknown secrets.', 'No live service or database preservation observation.']}
    (HERE / 'source-bindings.json').write_text(json.dumps(report, indent=2) + '\n')
    (PRIVATE / 'final-readback.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'subjectPublicFiles': len(report['subjectPublicFiles']), 'sealedPrivateFiles': len(manifest['files']), 'privateFilesUnchanged': len(after), 'knownSecretScreen': True, 'operatingStages': 0}))


if __name__ == '__main__':
    main()
