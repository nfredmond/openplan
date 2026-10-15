"""Check public disclosure, restoration, file custody and final artifact hashes."""
import ast
import hashlib
import json
import os
from pathlib import Path

import prepare as prep
import verify


def private_values():
    values = set()
    for root in [prep.OLD, prep.ROOT]:
        app, envs = [prep.read(root, name) for name in ['app-env-private.json', 'envs-private.json']]
        values.update(app[key] for key in ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
            'CENSUS_API_KEY', 'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN', 'OPENPLAN_INTEGRATION_KEY_SECRET'])
        values.add(envs['rest']['PGRST_JWT_SECRET'])
        values.update(envs[kind][key] for kind, key in verify.p.URI_KEYS.items())
    return sorted(value.encode() for value in values)


def scan(data, private):
    if any(value in data for value in private):
        raise ValueError('public-disclosure:private-value')


def run():
    os.umask(0o077)
    files = verify.packet_files()
    verify.audit(files)
    report_files = {str(path.relative_to(prep.REPORT)): path.read_bytes()
        for path in sorted(prep.REPORT.rglob('*')) if path.is_file() and path.name != 'manifest.json'}
    combined = b'\n'.join(report_files.values())
    private = private_values()
    scan(combined, private)
    scan(combined + b'\nHarmless wording change.\n', private)
    for value in private:
        try:
            scan(combined + b'\n' + value, private)
        except ValueError as error:
            assert str(error) == 'public-disclosure:private-value'
        else:
            raise AssertionError('public-disclosure:survived')
        scan(combined, private)
    for name, data in report_files.items():
        if name.endswith('.py'):
            ast.parse(data)
        assert '\u2014' not in data.decode(), 'public-prose:em-dash'
    verify.require({'inventory': prep.read(prep.ROOT, 'prior-files-before-private.json')},
        {'inventory': prep.inventory(prep.PRIOR_ROOTS)}, 'final-prior-custody')
    operational = ['clone-intent.json', 'services-intent.json', 'build-intent.json', 'preview-start.json',
        'source-private.dump', 'clone-ready.json', 'service-receipts-private.json']
    for root in [*prep.PRIOR_ROOTS[:3], prep.ROOT]:
        verify.require({'intentFiles': []}, {'intentFiles': [name for name in operational if (root / name).exists()]},
            'combined-packets-unexecuted:' + root.name)
    for root in [prep.REPORT, prep.ROOT]:
        assert not list(root.rglob('__pycache__')), 'bytecode:present'
    for path in prep.ROOT.iterdir():
        verify.require({'regular': True, 'mode': 0o600}, {'regular': path.is_file() and not path.is_symlink(),
            'mode': path.stat().st_mode & 0o777}, 'final-private-mode:' + path.name)
    for name in prep.NAMES:
        verify.require({'bytes': files[name]}, {'bytes': report_files['templates/' + name]}, 'public-template:' + name)
    for commit, path in [(prep.REVIEWED, 'docs/reviews/2026-10-15-combined-preview-cors-correction'),
                         (prep.INDEPENDENT, 'docs/reviews/2026-10-15-combined-preview-cors-independent')]:
        prep.git('diff', '--exit-code', commit, 'HEAD', '--', path)
    manifest = dict(candidate=prep.HEAD, repository=str(prep.REPO), privateRoot=str(prep.ROOT),
        reviewedCommit=prep.REVIEWED, independentCommit=prep.INDEPENDENT,
        privateBindingManifestSha256=prep.sha(files['private-bindings.json']),
        templateBindingManifestSha256=prep.sha(files['template-binding.json']),
        templateSha256=json.loads(files['template-binding.json']),
        publicFileSha256={name: prep.sha(data) for name, data in report_files.items()},
        publicDisclosureScan=dict(harmlessSurvivor=True, injectedPrivateValueRefusals=len(private), exactRestoration=True),
        oldPacketRootsByteModeUnchanged=8, combinedPacketOperationIntentsAbsent=4,
        privateModes=True, noBytecode=True, operationallyProved=False,
        limits='File hashes and synthetic probes do not prove runtime acceptance or protect against privileged replacement.')
    with (prep.REPORT / 'manifest.json').open('x') as stream:
        json.dump(manifest, stream, indent=2)
        stream.write('\n')
    prep.write(prep.ROOT, 'final-artifact-audit-private.json', manifest)
    print(json.dumps({'publicDisclosureScan': manifest['publicDisclosureScan'],
        'publicFiles': len(report_files), 'oldPacketRootsPreserved': 8,
        'privateBindingManifestSha256': manifest['privateBindingManifestSha256'],
        'templateBindingManifestSha256': manifest['templateBindingManifestSha256'],
        'operationallyProved': False}, indent=2))


if __name__ == '__main__':
    run()
