"""Compare native observations without calling the worker or its result builders.

This checks the selected synthetic text-layer job, not an OpenPlan consumer,
OCR accuracy, installation discovery or a long-running recognition workload.
"""
import json


def require(condition, label):
    if not condition:
        raise ValueError(label)


def verify(record):
    request = record['request']
    before, after = record['beforeJob'], record['afterJob']
    first = bytes.fromhex(record['firstCallbackHex'])
    second = bytes.fromhex(record['secondCallbackHex'])
    result = json.loads(first)
    require(record['admissionStatus'] == 202, 'admission-status')
    require(record['accepted']['status'] == 'accepted', 'accepted-status')
    require(record['replayStatus'] == 200, 'completed-admission-replay-status')
    require(record['replayAccepted'] == record['accepted'], 'original-admission-replay')
    require(record['changedRequestStatus'] == 409, 'changed-request-refusal')
    require(record['consumerErrors'] == [], 'consumer-auth-and-payload-identity')
    require(before['request'] == request, 'saved-request-binding')
    require(before['state'] == 'undelivered', 'saved-result-before-http')
    require(before['result'] == result, 'saved-result-content')
    require(result['status'] == 'succeeded', 'original-result-status')
    require(result['requestId'] == request['requestId'], 'original-request-id')
    require(result['jobReference'] == record['accepted']['jobReference'], 'original-job-reference')
    require(result['pageCount'] == 3, 'original-page-count')
    require([page['page'] for page in result['pages']] == [1, 2, 3], 'page-sequence')
    require(result['pages'][1]['text'] == '', 'blank-middle-page')
    require('Synthetic page one: retained input.' in result['pages'][0]['text']
            and 'Synthetic page three: original result.' in result['pages'][2]['text'],
            'fixture-page-text')
    require(result['engine']['name'] == 'poppler-text-layer', 'native-text-engine')
    require(after['state'] == 'succeeded', 'recovered-terminal-state')
    require({key: value for key, value in before.items() if key != 'state'} ==
            {key: value for key, value in after.items() if key != 'state'}, 'recovered-job-content')
    require(first == second, 'exact-callback-bytes')
    require(record['terminalDeliveries'] == 2, 'two-terminal-deliveries')
    require(record['logicalResults'] == 1, 'one-logical-consumer-result')
    require(record['sourceGets'] == 1 and record['deniedSourceGets'] == 0, 'no-second-source-download')
    require(record['extractionProbes'] == [], 'no-extraction-reentry')
    require(record['sourceRootBefore'] == record['retainedRoot'], 'complete-root-and-journal-copy')
    require(record['sourceRootBefore'] == record['sourceRootAfter'], 'original-root-unchanged')
    require(record['packageBefore'] == record['packageAfter'], 'immutable-package-unchanged')
    require(record['runtimeOrdinaryBefore'] == record['runtimeOrdinaryAfter'], 'runtime-source-and-modes-unchanged')
    require(record['sourceHashesBefore'] == record['sourceHashesAfter'], 'executed-source-unchanged')
    return {'verified': True, 'claim': 'synthetic_native_text_layer_saved_result_recovery'}
