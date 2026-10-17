"""Seventeen future supplied observations. Source preparation, no executable entry."""
import hashlib
import json
from pathlib import Path


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def judge(observation, scenario):
    error, terminal = observation['exception'], observation['terminal']
    operations = observation['operations']
    if scenario == 'primary' and not (observation['primaryIdentity'] is True
            and observation['originalFramesPresent'] is True):
        raise AssertionError('operation-control:primary-preservation')
    if scenario == 'skip-source' and 'mock.final.source' not in operations:
        raise AssertionError('operation-control:missing-final-source-readback')
    if scenario == 'close' and not (error is not None and terminal['operationStatus'] == 'FAILED'
                                   and terminal['managerExit'] == 1):
        raise AssertionError('operation-control:cleanup-only-refusal')
    if scenario == 'promote' and terminal['assessment']['assessmentExit'] != 2:
        raise AssertionError('operation-control:absent-oracle-assessment')
    if scenario == 'chunk' and error is None:
        raise AssertionError('operation-control:missing-refusal:stream-cap')


def exact_error(actual, wanted, prefix=True):
    if wanted is None:
        require(actual is None, 'operation-control:unexpected-error')
        return
    require(type(actual) is dict and actual['fullClass'] == wanted['fullClass']
            and actual['message'] == wanted['message'], 'operation-control:exact-error')
    trace = actual['traceback']
    require((not prefix or trace.startswith(wanted['tracePrefix']))
            and trace.rstrip().splitlines()[-1] == wanted['suffix']
            and wanted['location'] in trace, 'operation-control:exact-error-trace')


def snapshot(boundary, error, returned, adapter):
    terminal = boundary.terminal if boundary.terminal is not None else returned
    original_frames = []
    tb = boundary.primary_trace
    while tb is not None:
        original_frames.append('File "' + tb.tb_frame.f_code.co_filename + '", line ' + str(tb.tb_lineno) + ',')
        tb = tb.tb_next
    cause = None
    if error is not None:
        cause = error.__cause__ if error is boundary.primary else error
    retained_cause = getattr(cause, 'original_primary_cause', None)
    return {'exception': adapter.detail(error) if error is not None else None,
            'terminal': terminal, 'prewrite': boundary.prewrite,
            'recordFiles': boundary.record_files, 'operations': list(boundary.operations),
            'counts': {'opens': boundary.owned.opens, 'closes': boundary.owned.closes,
                       'readCalls': boundary.owned.reads, 'readBytes': boundary.owned.read_bytes,
                       'hashCalls': boundary.hash_calls, 'captureCalls': boundary.capture_calls},
            'primaryIdentity': None if boundary.primary is None else error is boundary.primary,
            'originalPrimaryFrames': original_frames,
            'originalFramesPresent': None if boundary.primary is None else all(
                item in adapter.detail(error)['traceback'] for item in original_frames),
            'originalCauseRetained': None if boundary.primary is None else retained_cause is boundary.primary_cause,
            'originalContextRetained': None if boundary.primary is None else getattr(cause, 'original_primary_context', False) is boundary.primary_context,
            'capturedBodyRead': False}


def run(caller_raw, core_raw, archive_raw, mapping, fixture, output, writer, progress, deadline, adapter):
    fixture, output = Path(fixture), Path(output)
    require(hashlib.sha256(caller_raw).hexdigest() == mapping['callerSHA256'], 'operation-control:caller-pin')
    require(caller_raw.count(adapter.ENTRY_ANCHOR.encode()) == 1, 'operation-control:supplied-entry-anchor')
    fixture_before, fixture_metadata = fixture.read_bytes(), adapter.metadata(fixture)
    source_before = {}
    for path, wanted_sha in mapping['preservedSourcePaths'].items():
        p = Path(path)
        raw = p.read_bytes()
        require(hashlib.sha256(raw).hexdigest() == wanted_sha, 'operation-control:preserved-source-pin')
        source_before[path] = (raw, adapter.metadata(p))
    require(fixture_before == b'M1-op\x00\xff\n', 'operation-control:tiny-fixture')
    actual_core = adapter.define(core_raw, mapping['coreDefinition'], progress)
    actual_archive = adapter.define(archive_raw, mapping['archiveDefinition'], progress)
    core_globals = actual_core.PRODUCTION_ORACLE_APPROVAL
    rows, calls, chunks, definitions = [], 0, 0, 0
    try:
        for wanted in mapping['rows']:
            deadline()
            name = wanted['name']
            source = caller_raw
            if wanted['entry'] == 'supplied':
                source = source.replace(adapter.ENTRY_ANCHOR.encode(), adapter.ENTRY_REPLACEMENT.encode(), 1)
            if wanted['annotation']:
                source += b'\n# Harmless supplied annotation.\n'
            if wanted['transform'] is not None:
                transform = wanted['transform']
                anchor = transform['anchor'].encode()
                require(source.count(anchor) == 1, 'operation-control:unique-mutant-anchor')
                source = source.replace(anchor, transform['replacement'].encode(), 1)
            module = adapter.define(source, wanted['definition'], progress)
            definitions += 1
            directory = output / name
            require(directory.parent == output and '/' not in name and name not in ('.', '..'), 'operation-control:case-path')
            directory.mkdir(mode=0o700)
            scenario = wanted['scenario']
            boundary = adapter.Boundary(scenario, fixture, directory, actual_core, actual_archive, writer)
            module.os = boundary.owned
            if wanted['entry'] == 'supplied':
                boundary.fixture_globals(module)
            require(module.OPERATION_SOURCE_APPROVAL is None, 'operation-control:no-production-authority')
            error = returned = fault = observation = None
            restoration = None
            try:
                progress({'event': 'case-entry', 'name': name, 'definition': wanted['definition'],
                          'authority': adapter.AUTHORITY, 'checked': False})
                try:
                    if wanted['entry'] == 'chunk':
                        chunks += 1
                        require(module.chunk_size.__globals__ is module.__dict__, 'operation-control:chunk-globals')
                        module.chunk_size(67108864, b'x', 67108864)
                    else:
                        calls += 1
                        entry = module.supplied_fixture_entry if wanted['entry'] == 'supplied' else module.capture_after_separate_root_admission
                        require(entry.__globals__ is module.__dict__, 'operation-control:entry-globals')
                        returned = entry(boundary)
                except BaseException as caught:
                    error = caught
                observation = snapshot(boundary, error, returned, adapter)
                progress({'event': 'observation', 'name': name, 'checked': False, 'observation': observation})
                if wanted['error'] is None:
                    require(error is None, 'operation-control:unexpected-error-object:' + name)
                else:
                    full = wanted['error']['fullClass']
                    expected_type = {'builtins.RuntimeError': RuntimeError, 'builtins.ValueError': ValueError}.get(full)
                    if expected_type is None:
                        expected_type = getattr(module, full.rsplit('.', 1)[1])
                    require(type(error) is expected_type, 'operation-control:exact-error-object-class:' + name)
                try:
                    judge(observation, wanted['judgeScenario'])
                except AssertionError as caught:
                    if wanted['fault'] is None or type(caught) is not AssertionError or str(caught) != wanted['fault']['message']:
                        raise
                    fault = adapter.detail(caught)
                    exact_error(fault, wanted['fault'])
                else:
                    require(wanted['fault'] is None, 'operation-control:named-fault-survived:' + name)
                exact_error(observation['exception'], wanted['error'])
                require(observation['operations'] == wanted['operations'] and observation['counts'] == wanted['counts'],
                        'operation-control:exact-boundary-counts:' + name)
                for key in ('primaryIdentity', 'originalFramesPresent', 'originalCauseRetained', 'originalContextRetained'):
                    require(observation[key] is wanted[key], 'operation-control:primary-state:' + key + ':' + name)
                if observation['terminal'] is not None:
                    terminal = observation['terminal']
                    require(terminal['operationStatus'] == wanted['status'] and terminal['managerExit'] == wanted['managerExit']
                            and terminal['rawToolReturncode'] == wanted['rawReturn'], 'operation-control:terminal-status:' + name)
                    require(terminal['finalizationAttempts'] == wanted['finalizationAttempts'], 'operation-control:attempt-order:' + name)
                    require([(x['operation'], x['fullClass'], x['message']) for x in terminal['finalizationIssues']]
                            == [tuple(x) for x in wanted['issues']], 'operation-control:issue-order:' + name)
                    if terminal['assessment'] is not None:
                        require(terminal['assessment']['accepted'] is False and terminal['assessment']['history'] == 'UNASSESSED'
                                and terminal['assessment']['assessmentExit'] == wanted['assessmentExit'], 'operation-control:assessment-tier:' + name)
                    prewrite = observation['prewrite']['operation.terminal.json']
                    require(prewrite['operationStatus'] == wanted['prewriteStatus']
                            and prewrite['terminalRecordFailure'] is None, 'operation-control:terminal-prewrite:' + name)
                    failure = terminal['terminalRecordFailure']
                    if wanted['recordFailure']:
                        require(failure['fullClass'] == 'builtins.OSError' and failure['message'] == 'supplied:operation-terminal-record'
                                and observation['recordFiles']['operation.terminal.json']['partialBytes'] == 37,
                                'operation-control:terminal-record-failure:' + name)
                    else:
                        require(failure is None, 'operation-control:unexpected-terminal-record-failure:' + name)
                for record_name, info in observation['recordFiles'].items():
                    serialized = (json.dumps(observation['prewrite'][record_name], indent=2) + '\n').encode()
                    if 'partialSHA256' in info:
                        raw = (directory / (record_name + '.partial')).read_bytes()
                        require(raw == serialized[:37] and len(raw) == info['partialBytes']
                                and hashlib.sha256(raw).hexdigest() == info['partialSHA256'],
                                'operation-control:partial-record-bytes:' + name)
                    else:
                        raw = (directory / record_name).read_bytes()
                        require(raw == serialized and len(raw) == info['bytes']
                                and hashlib.sha256(raw).hexdigest() == info['sha256'],
                                'operation-control:record-bytes:' + name)
            finally:
                forced = boundary.owned.restore()
                boundary.archive.restore()
                restoration = {'forcedFDCloses': forced, 'ownedFDsEmpty': not boundary.owned.live,
                               'fixtureBytesExact': fixture.read_bytes() == fixture_before,
                               'fixtureMetadataExact': adapter.metadata(fixture) == fixture_metadata,
                               'archiveGlobalsRestored': actual_archive.ARCHIVE_PATH == boundary.archive.saved_path
                                                       and actual_archive.os is boundary.archive.saved_os,
                               'productionOracleStillNone': actual_core.PRODUCTION_ORACLE_APPROVAL is core_globals is None}
                progress({'event': 'case-restoration', 'name': name, 'restoration': restoration})
                require(forced == 0 and all(value is True for key, value in restoration.items() if key != 'forcedFDCloses'),
                        'operation-control:case-restoration:' + name)
            row = {'name': name, 'definition': wanted['definition'], 'outcome': wanted['outcome'],
                   'observation': observation, 'fault': fault, 'restoration': restoration}
            rows.append(row)
            progress({'event': 'case', 'ordinal': len(rows), 'row': row})
        require(len(rows) == definitions == 17 and calls == 15 and chunks == 2, 'operation-control:exact-population')
        return {'authority': adapter.AUTHORITY, 'rows': rows, 'callerInvocations': calls, 'chunkChecks': chunks,
                'callerDefinitions': definitions, 'actualCoreDefinitions': 1, 'actualArchiveDefinitions': 1,
                'realToolCalls': 0, 'kernelSignals': 0, 'archiveAccess': False, 'history': 'UNASSESSED', 'productionApproval': None}
    finally:
        require(fixture.read_bytes() == fixture_before and adapter.metadata(fixture) == fixture_metadata,
                'operation-control:fixture-final-restoration')
        for path, (raw, before_metadata) in source_before.items():
            p = Path(path)
            require(p.read_bytes() == raw and adapter.metadata(p) == before_metadata,
                    'operation-control:source-final-restoration:' + path)
        progress({'event': 'restoration', 'callerInvocations': calls, 'chunkChecks': chunks,
                  'callerDefinitions': definitions, 'fixtureExact': True, 'sourceVariantsMemoryOnly': True})
