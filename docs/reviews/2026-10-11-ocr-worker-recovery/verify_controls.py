"""Keep a survivor and test every new recovery observation comparison.

These controls change observations, not worker runtime behavior. The separate
native driver also removes the saved result in a disposable copy and observes
the actual extraction refusal. No retained source or package is edited here.
"""
import copy
import json
from pathlib import Path
import sys

from recovery_oracle import verify


def changed_callback(record, key, value):
    result = json.loads(bytes.fromhex(record['firstCallbackHex']))
    result[key] = value
    record['firstCallbackHex'] = json.dumps(result).encode().hex()
    record['beforeJob']['result'] = result


def run(record):
    outcomes = []
    verify(record)
    outcomes.append({'control': 'baseline', 'outcome': 'survived'})
    harmless = dict(reversed(list(record.items())))
    verify(harmless)
    outcomes.append({'control': 'harmless-key-order', 'outcome': 'survived'})
    cases = [
        ('admission-status', lambda r: r.update(admissionStatus=200)),
        ('accepted-status', lambda r: r['accepted'].update(status='failed')),
        ('completed-admission-replay-status', lambda r: r.update(replayStatus=202)),
        ('original-admission-replay', lambda r: r['replayAccepted'].update(callbackId='regenerated')),
        ('changed-request-refusal', lambda r: r.update(changedRequestStatus=200)),
        ('consumer-auth-and-payload-identity', lambda r: r.update(consumerErrors=['wrong-bearer'])),
        ('saved-request-binding', lambda r: r['beforeJob']['request'].update(documentTitle='changed')),
        ('saved-result-before-http', lambda r: r['beforeJob'].update(state='running')),
        ('saved-result-content', lambda r: r['beforeJob']['result'].update(progress=1)),
        ('original-result-status', lambda r: changed_callback(r, 'status', 'failed')),
        ('original-request-id', lambda r: changed_callback(r, 'requestId', 'different-request')),
        ('original-job-reference', lambda r: changed_callback(r, 'jobReference', 'different-job')),
        ('original-page-count', lambda r: changed_callback(r, 'pageCount', 2)),
        ('page-sequence', lambda r: changed_callback(r, 'pages', [dict(page, page=4) for page in r['beforeJob']['result']['pages']])),
        ('blank-middle-page', lambda r: changed_callback(r, 'pages', [dict(page, text='invented' if page['page'] == 2 else page['text']) for page in r['beforeJob']['result']['pages']])),
        ('fixture-page-text', lambda r: changed_callback(r, 'pages', [dict(page, text='' if page['page'] == 1 else page['text']) for page in r['beforeJob']['result']['pages']])),
        ('native-text-engine', lambda r: changed_callback(r, 'engine', dict(r['beforeJob']['result']['engine'], name='mocked'))),
        ('recovered-terminal-state', lambda r: r['afterJob'].update(state='undelivered')),
        ('recovered-job-content', lambda r: r['afterJob'].update(job_reference='changed')),
        ('exact-callback-bytes', lambda r: r.update(secondCallbackHex=(bytes.fromhex(r['secondCallbackHex']) + b' ').hex())),
        ('two-terminal-deliveries', lambda r: r.update(terminalDeliveries=1)),
        ('one-logical-consumer-result', lambda r: r.update(logicalResults=2)),
        ('no-second-source-download', lambda r: r.update(sourceGets=2)),
        ('no-second-source-download', lambda r: r.update(deniedSourceGets=1)),
        ('no-extraction-reentry', lambda r: r.update(extractionProbes=['pdfinfo'])),
        ('complete-root-and-journal-copy', lambda r: r.update(retainedRoot={})),
        ('original-root-unchanged', lambda r: r.update(sourceRootAfter={})),
        ('immutable-package-unchanged', lambda r: r.update(packageAfter={})),
        ('runtime-source-and-modes-unchanged', lambda r: r.update(runtimeOrdinaryAfter={})),
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
                raise AssertionError(f'{label}: broken observation survived')
        finally:
            disposable = None
    verify(record)
    outcomes.append({'control': 'restored', 'outcome': 'survived'})
    return outcomes


if __name__ == '__main__':
    record = json.loads(Path(sys.argv[1]).read_text())
    result = run(record)
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'controls': len(result), 'positive': 3, 'broken': len(result) - 3}))
