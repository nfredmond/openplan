"""Verify the admission counterexample, without treating it as recovery success."""
import copy


def require(condition, label):
    if not condition:
        raise ValueError(label)


def verify(record):
    require(record['firstAdmissionStatus'] == 202, 'first-native-admission')
    require(record['queuedAdmissionStatus'] == 202, 'queued-native-admission')
    require(record['predeathReplayStatus'] == 200, 'predeath-replay-status')
    require(record['predeathReceipt'] == record['queuedReceipt'], 'predeath-original-receipt')
    require(record['changedStatus'] == 200 and record['changedReceipt'] == record['queuedReceipt'], 'changed-metadata-old-receipt')
    require(record['sourceGetsBeforeDeath'] == 1, 'queued-request-not-processing')
    require(record['restartAdmissionStatus'] == 202, 'restart-creates-new-admission')
    require(record['restartReceipt']['requestId'] == record['queuedReceipt']['requestId'], 'same-request-id')
    require(record['restartReceipt']['jobReference'] != record['queuedReceipt']['jobReference'], 'new-job-reference')
    require(record['restartReceipt']['callbackId'] != record['queuedReceipt']['callbackId'], 'new-admission-callback-id')
    require(record['initialRequestHex'] == record['restartRequestHex'], 'exact-original-request-bytes')
    require(record['sourceGetsFinal'] == 2, 'new-worker-starts-new-intake')
    require(record['sourceBodyBytesSent'] == 0, 'no-imagery-body-consumed')
    require(record['engineRequests'] == 0, 'no-nodeodm-request')
    require(record['sqliteCopies'] == 0 and record['sourceOrdinaryFiles'] == 0, 'no-persisted-admission-record')
    require(record['rootBefore'] == record['retainedRoot'], 'complete-root-copy')
    require(record['rootBefore'] == record['rootAfter'], 'original-root-unchanged')
    require(record['packageBefore'] == record['packageAfter'], 'immutable-package-unchanged')
    require(record['sourceHashesBefore'] == record['sourceHashesAfter'], 'executed-source-unchanged')
    return {'observedDefect': 'queued_admission_identity_lost_on_restart', 'recoveryAccepted': False}


def controls(record):
    outcomes = []
    verify(record)
    outcomes.append({'control': 'baseline', 'outcome': 'survived'})
    verify(dict(reversed(list(record.items()))))
    outcomes.append({'control': 'harmless-key-order', 'outcome': 'survived'})
    cases = [
        ('first-native-admission', lambda r: r.update(firstAdmissionStatus=503)),
        ('queued-native-admission', lambda r: r.update(queuedAdmissionStatus=503)),
        ('predeath-replay-status', lambda r: r.update(predeathReplayStatus=202)),
        ('predeath-original-receipt', lambda r: r['predeathReceipt'].update(jobReference='changed')),
        ('changed-metadata-old-receipt', lambda r: r.update(changedStatus=409)),
        ('queued-request-not-processing', lambda r: r.update(sourceGetsBeforeDeath=2)),
        ('restart-creates-new-admission', lambda r: r.update(restartAdmissionStatus=200)),
        ('same-request-id', lambda r: r['restartReceipt'].update(requestId='changed')),
        ('new-job-reference', lambda r: r['restartReceipt'].update(jobReference=r['queuedReceipt']['jobReference'])),
        ('new-admission-callback-id', lambda r: r['restartReceipt'].update(callbackId=r['queuedReceipt']['callbackId'])),
        ('exact-original-request-bytes', lambda r: r.update(restartRequestHex='00')),
        ('new-worker-starts-new-intake', lambda r: r.update(sourceGetsFinal=1)),
        ('no-imagery-body-consumed', lambda r: r.update(sourceBodyBytesSent=1)),
        ('no-nodeodm-request', lambda r: r.update(engineRequests=1)),
        ('no-persisted-admission-record', lambda r: r.update(sqliteCopies=1)),
        ('no-persisted-admission-record', lambda r: r.update(sourceOrdinaryFiles=1)),
        ('complete-root-copy', lambda r: r.update(retainedRoot={})),
        ('original-root-unchanged', lambda r: r.update(rootAfter={})),
        ('immutable-package-unchanged', lambda r: r.update(packageAfter={})),
        ('executed-source-unchanged', lambda r: r.update(sourceHashesAfter={})),
    ]
    for label, mutation in cases:
        disposable = copy.deepcopy(record)
        try:
            mutation(disposable)
            try:
                verify(disposable)
            except ValueError as error:
                if str(error) != label:
                    raise AssertionError(f'{label}: wrong failure {error}') from error
                outcomes.append({'control': label, 'outcome': 'intended_refusal'})
            else:
                raise AssertionError(f'{label}: false counterexample survived')
        finally:
            disposable = None
    verify(record)
    outcomes.append({'control': 'restored', 'outcome': 'survived'})
    return outcomes
