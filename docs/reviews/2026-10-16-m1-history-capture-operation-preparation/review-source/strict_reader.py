"""Exact supplied-operation report comparisons. No subject or file execution."""
import hashlib
import json


class ReportRefusal(RuntimeError):
    pass


def require(value, reason):
    if not value:
        raise ReportRefusal(reason)


def check_error(actual, wanted, name):
    if wanted is None:
        require(actual is None, 'operation-report:unexpected-error:' + name)
        return
    require(type(actual) is dict and set(actual) == {'fullClass', 'message', 'traceback'}, 'operation-report:error-schema:' + name)
    require(actual['fullClass'] == wanted['fullClass'], 'operation-report:fulltype:' + name)
    require(actual['message'] == wanted['message'], 'operation-report:message:' + name)
    trace = actual['traceback']
    require(type(trace) is str and trace.startswith(wanted['tracePrefix'])
            and trace.rstrip().splitlines()[-1] == wanted['suffix']
            and wanted['location'] in trace, 'operation-report:trace:' + name)


def read_report(report, mapping):
    require(type(report) is dict and set(report) == {'authority', 'rows', 'callerInvocations', 'chunkChecks',
            'callerDefinitions', 'actualCoreDefinitions', 'actualArchiveDefinitions', 'realToolCalls', 'kernelSignals',
            'archiveAccess', 'history', 'productionApproval'}, 'operation-report:schema')
    require(report['authority'] == 'SUPPLIED_BOUNDARY_AND_OWNED_REAL_FDS_ONLY'
            and report['callerInvocations'] == 15 and report['chunkChecks'] == 2 and report['callerDefinitions'] == 17
            and report['actualCoreDefinitions'] == report['actualArchiveDefinitions'] == 1
            and report['realToolCalls'] == report['kernelSignals'] == 0 and report['archiveAccess'] is False
            and report['history'] == 'UNASSESSED' and report['productionApproval'] is None, 'operation-report:authority-counts')
    require(len(report['rows']) == len(mapping['rows']) == 17
            and [x['name'] for x in report['rows']] == [x['name'] for x in mapping['rows']], 'operation-report:inventory')
    for row, wanted in zip(report['rows'], mapping['rows']):
        name = wanted['name']
        require(set(row) == {'name', 'definition', 'outcome', 'observation', 'fault', 'restoration'}
                and row['definition'] == wanted['definition'] and row['outcome'] == wanted['outcome'], 'operation-report:identity:' + name)
        observation = row['observation']
        require(set(observation) == {'exception', 'terminal', 'prewrite', 'recordFiles', 'operations', 'counts',
                'primaryIdentity', 'originalPrimaryFrames', 'originalFramesPresent', 'originalCauseRetained',
                'originalContextRetained', 'capturedBodyRead'}, 'operation-report:observation-schema:' + name)
        check_error(observation['exception'], wanted['error'], name + ':exception')
        check_error(row['fault'], wanted['fault'], name + ':fault')
        require(observation['operations'] == wanted['operations'] and observation['counts'] == wanted['counts']
                and observation['capturedBodyRead'] is False, 'operation-report:operations-counts:' + name)
        for key in ('primaryIdentity', 'originalFramesPresent', 'originalCauseRetained', 'originalContextRetained'):
            require(observation[key] is wanted[key], 'operation-report:primary-state:' + key + ':' + name)
        require(observation['originalPrimaryFrames'] == wanted['originalPrimaryFrames'], 'operation-report:original-frames:' + name)
        require(row['restoration'] == {'forcedFDCloses': 0, 'ownedFDsEmpty': True, 'fixtureBytesExact': True,
                'fixtureMetadataExact': True, 'archiveGlobalsRestored': True, 'productionOracleStillNone': True}, 'operation-report:restoration:' + name)
        terminal = observation['terminal']
        if wanted['status'] is None:
            require(terminal is None and observation['prewrite'] == observation['recordFiles'] == {}, 'operation-report:no-terminal:' + name)
            continue
        require(type(terminal) is dict and set(terminal) == {'operationStatus', 'managerExit', 'rawToolReturncode',
                'rawCaptureTerminal', 'assessment', 'primaryFailure', 'finalizationAttempts', 'finalizationIssues',
                'terminalRecordAttempted', 'terminalRecordFailure', 'productionApproval', 'history', 'retry'}, 'operation-report:terminal-schema:' + name)
        require(terminal['operationStatus'] == wanted['status'] and terminal['managerExit'] == wanted['managerExit']
                and terminal['rawToolReturncode'] == wanted['rawReturn'] and terminal['terminalRecordAttempted'] is True
                and terminal['productionApproval'] is None and terminal['history'] == 'UNASSESSED'
                and terminal['retry'] is False, 'operation-report:terminal-status:' + name)
        require(terminal['rawCaptureTerminal'] == wanted['rawCaptureTerminal'], 'operation-report:raw-capture-terminal:' + name)
        require(terminal['finalizationAttempts'] == wanted['finalizationAttempts']
                and len(terminal['finalizationIssues']) == len(wanted['issues']), 'operation-report:attempt-issues:' + name)
        for actual, expected in zip(terminal['finalizationIssues'], wanted['issueErrors']):
            require(set(actual) == {'operation', 'fullClass', 'message', 'traceback'}
                    and actual['operation'] == expected['operation'], 'operation-report:issue-schema:' + name)
            check_error({k: actual[k] for k in ('fullClass', 'message', 'traceback')}, expected['error'], name + ':issue:' + actual['operation'])
        check_error(terminal['primaryFailure'], wanted['primaryError'], name + ':primary')
        check_error(terminal['terminalRecordFailure'], wanted['terminalRecordError'], name + ':terminal-record')
        assessment = terminal['assessment']
        if wanted['assessmentExit'] is None:
            require(assessment is None, 'operation-report:no-assessment:' + name)
        else:
            require(type(assessment) is dict and set(assessment) == {'rawCaptureRecorded', 'rawToolReturncode',
                    'rawStreams', 'accepted', 'envelope', 'history', 'assessmentExit', 'toolFailure', 'fullClass', 'message', 'traceback'}
                    and assessment['rawCaptureRecorded'] is True and assessment['rawToolReturncode'] == 0
                    and assessment['rawStreams'] == wanted['suppliedStreams'] and assessment['accepted'] is False
                    and assessment['envelope'] == assessment['history'] == 'UNASSESSED'
                    and assessment['assessmentExit'] == wanted['assessmentExit'] and assessment['toolFailure'] is False,
                    'operation-report:assessment:' + name)
            check_error({k: assessment[k] for k in ('fullClass', 'message', 'traceback')}, mapping['absentOracleError'], name + ':assessment')
        require(list(observation['prewrite']) == wanted['recordNames']
                and list(observation['recordFiles']) == wanted['recordNames'], 'operation-report:record-inventory:' + name)
        prewrite = observation['prewrite']['operation.terminal.json']
        require(prewrite['operationStatus'] == wanted['prewriteStatus'] and prewrite['terminalRecordFailure'] is None,
                'operation-report:prewrite-state:' + name)
        for record_name, info in observation['recordFiles'].items():
            raw = (json.dumps(observation['prewrite'][record_name], indent=2) + '\n').encode()
            if record_name == 'operation.terminal.json' and wanted['recordFailure']:
                require(info == {'partialBytes': 37, 'partialSHA256': hashlib.sha256(raw[:37]).hexdigest()}, 'operation-report:partial-record:' + name)
            else:
                require(info == {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}, 'operation-report:record-hash:' + name)
    return {'authority': 'SUPPLIED_OPERATION_REPORT_ONLY', 'entries': 17, 'callerInvocations': 15, 'chunkChecks': 2,
            'namedFaults': 5, 'harmless': 'SURVIVED', 'restored': True, 'history': 'UNASSESSED', 'productionApproval': None}
