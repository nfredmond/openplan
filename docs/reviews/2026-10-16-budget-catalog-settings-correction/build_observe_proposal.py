#!/usr/bin/python3
"""Build a non-authoritative OBSERVE proposal from actual parent-retained files."""
import json
import os
import sys

from capture_catalog import ROOT, SUBJECT, reuse, sha

REVIEW = '7d9875a25ea513fadc231fd402bb82caaf0d87da'
RESPONSE = '91fbccd5e52abad57713843d7477c8e4772bd749'
SEAL = 'b9c0e7c418df4a295f44f1374a539e6e33dbd242a210c2840dd07831a6b1a35c'
CONTROLLER_ROOT = '/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2'
OUTER_ROOT = ROOT.parent/'outer-v2'


def main():
    os.umask(0o077)
    if sys.argv[1:] != ['--prepare-only']:
        raise ValueError('proposal-only-entry')
    j, p, _ = reuse()
    j.private(ROOT, True)
    bindings = j.read(ROOT/'observe-bindings.actual.json')
    p.same(REVIEW, bindings.get('independentReviewCommit'), 'fixed-independent-review')
    p.same(RESPONSE, bindings.get('metadataResponseCommit'), 'fixed-metadata-response')
    paths = {
        'catalogSHA256': ROOT/'capture-attempt/catalog.json',
        'scopeSHA256': ROOT/'capture-attempt/original-scope.json',
        'captureManagerAckSHA256': ROOT/'capture-attempt/manager-ack.json',
        'captureCollectedSHA256': OUTER_ROOT/'native-capture-parent/complete.json',
        'captureCompleteSHA256': ROOT/'capture-attempt/complete.json',
        'captureManagerTerminalSHA256': ROOT/'capture-manager-terminal.json',
        'captureOuterTerminalSHA256': ROOT/'capture-outer-terminal.json',
        'reviewSHA256': ROOT/'observe-review.md',
        'windowSHA256': ROOT/'observe-window.json',
        'publicationSHA256': ROOT/'observe-publication.json',
        'inputSHA256': ROOT/'observe-input.json',
        'packageSHA256': SUBJECT/'source-pins.json',
        'planSHA256': SUBJECT/'plan.json',
    }
    for key, path in paths.items():
        p.hash_text(bindings.get(key), 'missing-actual-'+key)
        if key not in ('packageSHA256', 'planSHA256'):
            j.private(path)
        p.require(not path.is_symlink() and path.stat().st_size > 0, 'nonempty-actual-file')
        p.same(bindings[key], sha(path), 'actual-file-'+key)
    p.same(SEAL, bindings['packageSHA256'], 'exact-schema2-422-source-seal')
    capture = j.read(paths['captureCompleteSHA256'])
    p.same('capture-complete', capture.get('status'), 'actual-capture-complete')
    for key in ('catalogSHA256', 'scopeSHA256'):
        p.same(bindings[key], capture.get(key), 'captured-'+key)
    p.same(sha(ROOT/'catalog-capture-request.json'), capture.get('requestSHA256'), 'captured-request')
    p.same(sha(ROOT/'capture-grant.json'), capture.get('grantSHA256'), 'captured-grant')
    p.same(sha(ROOT/'catalog-capture.sql'), capture.get('inputSHA256'), 'captured-query')
    p.same(2, capture.get('schema'), 'capture-schema2')
    p.same(p.SCOPE_SCHEMA, capture.get('scopeSchema'), 'capture-scope-schema')
    p.same(bindings['captureManagerAckSHA256'], capture.get('managerAckSHA256'), 'capture-ack-hash')
    intent = j.read(ROOT/'capture-attempt/intent.json')
    p.same(intent['entry'], capture.get('entry'), 'capture-entry-complete')
    j.verify_manager_ack(ROOT/'capture-attempt', capture['unitName'], capture['entry'], 90)
    collected = j.read(paths['captureCollectedSHA256'])
    p.same('collected-correlated-capture', collected.get('status'), 'capture-collector-complete')
    for key, expected in {'invocation':capture['invocation'],
            'captureManagerAckSHA256':bindings['captureManagerAckSHA256'],
            'captureCompleteSHA256':bindings['captureCompleteSHA256']}.items():
        p.same(expected, collected.get(key), 'capture-collector-'+key)
    outer_terminal = j.read(OUTER_ROOT/'native-capture-parent/terminal.json')
    p.same(sha(OUTER_ROOT/'native-capture-parent/terminal.json'), collected.get('outerTerminalSHA256'),
           'capture-collected-terminal-hash')
    p.same(0, outer_terminal.get('returncode'), 'capture-collected-exit')
    p.same(None, outer_terminal.get('failure'), 'capture-collected-error')
    for key in ('captureManagerTerminalSHA256', 'captureOuterTerminalSHA256'):
        receipt = j.read(paths[key])
        p.same('terminal-success', receipt.get('status'), 'capture-parent-terminal')
        p.same(capture['invocation'], receipt.get('invocation'), 'capture-parent-invocation')
        p.same(capture['unitName'], receipt.get('unitName'), 'capture-parent-unit')
        p.same(capture['requestSHA256'], receipt.get('requestSHA256'), 'capture-parent-request')
        p.same(0, receipt.get('returncode'), 'capture-parent-exit')
    catalog = j.read(paths['catalogSHA256'])
    p.native(catalog, {}, 'postgres')
    scope = j.read(paths['scopeSHA256'])
    p.scope(scope)
    expected_input = p.canonical({'stage': 'observe', 'source': p.SOURCE, 'target': p.TARGET, 'scopeSchema':p.SCOPE_SCHEMA})
    p.same(expected_input, paths['inputSHA256'].read_bytes(), 'exact-observe-payload')
    window = j.read(paths['windowSHA256'])
    publication = j.read(paths['publicationSHA256'])
    common = {'stage': 'observe', 'source': p.SOURCE, 'app': p.APP, 'target': p.TARGET,
              'exclusive': False, 'nativeOperationGranted': False,
              'inputSHA256': bindings['inputSHA256']}
    for row in (window, publication):
        for key, expected in common.items():
            p.same(expected, row.get(key), 'observe-proposal-record-'+key)
    for key in ('notBefore', 'notAfter'):
        p.require(type(window.get(key)) is int, 'concrete-proposed-window')
        p.same(window[key], publication.get(key), 'same-proposed-window')
    p.require(0 < window['notAfter']-window['notBefore'] <= 600, 'finite-proposed-window')
    proposal = dict(common, schema=2, status='PROPOSAL_REQUIRES_PARENT_ADMISSION',
        authority='root-published-exclusive-budget-operation', uid=os.getuid(),
        notBefore=window['notBefore'], notAfter=window['notAfter'],
        unitName=p.OBSERVE_UNIT, scopeSchema=p.SCOPE_SCHEMA, predecessorSHA256=None,
        catalogIdentity={key: catalog[key] for key in
            ('systemIdentifier', 'oid', 'sessionOid', 'currentOid', 'postgresOid')},
        originalScope=scope, **{key: bindings[key] for key in
            ('reviewSHA256', 'windowSHA256', 'publicationSHA256', 'inputSHA256',
             'packageSHA256', 'planSHA256')})
    j.record(ROOT/'observe-proposal.json', {
        'status': 'PREPARED_NOT_ADMITTED', 'admissionProposal': proposal,
        'bindings': bindings, 'captureInvocation': capture['invocation'],
        'controllerRoot': CONTROLLER_ROOT,
        'notice': 'Root must publish fresh final records and authorize OBSERVE separately. '
                  'Changing false flags changes record hashes. Recompute final admission. '
                  'This builder never writes controller admissions or executes it.'})


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('REFUSED: actual capture, terminal custody or concrete bindings missing', file=sys.stderr)
        raise SystemExit(1)
