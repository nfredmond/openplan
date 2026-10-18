"""Read-only final helper comparison and real failed health acquisition."""
import json
import os
from pathlib import Path
import sys
import urllib.error

PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
sys.path.insert(0, str(ROOT))
import rest_uri_recovery_01_launcher as l
import rest_uri_recovery_01_controller as c


def main():
    os.umask(0o077)
    l.pinned_files()
    receipts = l.read('service-receipts-private.json')
    observations = {}
    for kind, receipt in receipts.items():
        before = l.read('rest-uri-recovery-01/' + ('old-rest' if kind == 'rest' else kind) + '-inspect-private.json')
        after = l.inspect(receipt['id'])
        l.p.exact(c.projection(before), c.projection(after), 'unchanged-live-' + kind)
        # Docker's health log gains timestamps while the same container runs.
        state = {k: v for k, v in before['State'].items() if k != 'Health'}
        l.p.exact({**state, 'RestartCount': before['RestartCount']},
                  {**after['State'], 'RestartCount': after['RestartCount']}, 'unchanged-live-state-' + kind)
        with (PRIVATE / ('final-' + kind + '-inspect-private.json')).open('x') as stream:
            json.dump(after, stream, indent=2)
        observations[kind] = {'id': after['Id'], 'configurationUnchanged': True, 'running': after['State']['Running'],
                              'startedAt': after['State']['StartedAt'], 'restartCount': after['RestartCount'],
                              'healthLogChanged': before['State'].get('Health') != after['State'].get('Health')}
    try:
        l.health()
    except urllib.error.HTTPError as error:
        # Real opener and real HTTP response, never supplied or raced health.
        assert error.code == 503 and error.url == l.p.API + '/rest/v1/projects?select=id&limit=0'
        status = error.code; error.close()
    else:
        raise AssertionError('unrecovered-rest-unexpectedly-ready')
    assert not (PRIVATE / 'transition-intent-private.json').exists()
    assert not (PRIVATE / 'active-service-receipts-private.json').exists()
    assert not (PRIVATE / 'active-binding-private.json').exists()
    assert not (ROOT / 'candidate/openplan/.next/BUILD_ID').exists()
    result = {'services': observations, 'actualRestHead': status, 'transitionIntentAbsent': True,
              'actualActiveReceiptsAbsent': True, 'actualActiveBindingAbsent': True, 'appBuildAbsent': True,
              'sourceAnchor': l.read('source-binding-private.json')['sha256'],
              'logicalSourceGlobalStorageRecheck': 'Not performed by child; parent retains immutable source guard.',
              'nativeSuccessIsNotRestReady': True}
    with (PRIVATE / 'final-observations-private.json').open('x') as stream: json.dump(result, stream, indent=2)
    with (PUBLIC / 'evidence/final-observations.json').open('x') as stream: json.dump(result, stream, indent=2)
    print(json.dumps(result))


if __name__ == '__main__': main()
