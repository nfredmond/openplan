"""Held PURE23 same-process entry. No tool, archive or operating authority."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import types

HERE = Path('/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-window-preparation-r1')
PARENT = HERE.parent
CONTROL = PARENT / 'pure-control-preparation-r1'
ROOT = Path('/home/nathaniel/.local/state/openplan/m1-history-operation-pure-root-decision-20261016')


def main():
    api = globals().get('WINDOW_API')
    if api is None or api.__file__ != str(HERE / 'window_primitives.py'):
        raise RuntimeError('operation-pure:guarded-same-process-entry-required')
    require = api.need
    require(api.record.__globals__ is api.__dict__, 'operation-pure:actual-window-globals')
    request_raw = api.read_blob(HERE / 'PURE_REQUEST.json', 1048576)
    request_sha = hashlib.sha256(request_raw).hexdigest()
    require(sys.argv == [str(HERE / 'pure_main.py'), request_sha], 'operation-pure:exact-argv')
    request = json.loads(request_raw)
    grant = json.loads(api.read_blob(ROOT / 'GRANT.json', 1048576))
    entry = json.loads(api.read_blob(ROOT / 'attempt-01/subject-entry-intent.json', 1048576))
    require(grant['status'] == 'GRANTED_ONE_M1_HISTORY_OPERATION_PURE23_WINDOW'
            and grant['requestSHA256'] == entry['requestSHA256'] == request_sha
            and grant['subjectSysArgv'] == sys.argv and entry['sameProcessPID'] == os.getpid()
            and entry['executionModel'] == 'GUARDED_SAME_PROCESS_RUNPY'
            and entry['sourceInputsSHA256'] == request['sourceInputsSHA256'], 'operation-pure:root-entry-binding')
    require(sys.flags.isolated == 1 and sys.flags.no_site == 1 and sys.dont_write_bytecode,
            'operation-pure:isolated-python')
    output = HERE / 'pure-output-01'
    require(Path.cwd() == output and list(output.iterdir()) == [], 'operation-pure:new-empty-output')
    started = globals()['WINDOW_STARTED']

    def deadline():
        require(time.monotonic() - started < 25, 'operation-pure:inner-deadline')

    def write(path, raw):
        path = Path(path)
        require(path.is_relative_to(output) and path != output, 'operation-pure:owned-write-only')
        deadline()
        api.write_blob(path, raw)

    def record(name, value):
        write(output / name, (json.dumps(value, indent=2, sort_keys=True) + '\n').encode())

    events = []

    def progress(value):
        events.append(value)
        record('event-' + str(len(events)).zfill(3) + '.json', value)

    record('control-entry.json', {'requestSHA256': request_sha, 'sameProcessPID': os.getpid(),
           'sourceExecutionBegun': False, 'authority': 'SUPPLIED_BOUNDARY_AND_OWNED_REAL_FDS_ONLY',
           'realToolCalls': 0, 'archiveAccess': False, 'productionApproval': None})
    source_inputs = {}
    raws, before = {}, {}
    fixture = output / 'supplied-eight-byte.bin'
    fixture_before = None
    primary = saved = None
    issues = []
    operation_report = reader_report = None
    definitions = []
    try:
        source_manifest_raw = api.read_blob(HERE / 'SOURCE_INPUTS.json', 1048576, deadline)
        require(hashlib.sha256(source_manifest_raw).hexdigest() == request['sourceInputsSHA256'],
                'operation-pure:source-manifest-pin')
        source_inputs = json.loads(source_manifest_raw)['subjectInputs']
        for path, expected in source_inputs.items():
            before[path] = api.descriptor(path, expected, True, deadline)
            raw = api.read_blob(path, expected['bytes'], deadline)
            require(hashlib.sha256(raw).hexdigest() == expected['sha256'], 'operation-pure:source-bytes')
            raws[path] = raw
        mapping = json.loads(raws[str(CONTROL / 'CASE_MAP.json')])
        readmap = json.loads(raws[str(CONTROL / 'READ_MAP.json')])
        record('subject-import-intent.json', {'requestSHA256': request_sha, 'sameProcessPID': os.getpid(),
               'sourceInputs': before, 'dynamicDefinitionBudget': 25, 'sourceExecutionBegun': False})

        def define(path, module_name, virtual_file=None):
            raw = raws[str(path)]
            identity = {'moduleName': module_name, 'virtualFile': virtual_file or str(path),
                        'sourceSHA256': hashlib.sha256(raw).hexdigest()}
            progress({'event': 'definition-intent', **identity})
            module = types.ModuleType(module_name)
            module.__file__ = identity['virtualFile']
            exec(compile(raw, module.__file__, 'exec'), module.__dict__)
            definitions.append(identity)
            return module

        adapter = define(CONTROL / 'supplied_adapter.py', '_m1_operation_adapter')
        controls = define(CONTROL / 'controls.py', '_m1_operation_controls')
        reader = define(CONTROL / 'strict_reader.py', readmap['original']['moduleName'], readmap['original']['virtualFile'])
        reader_controls = define(CONTROL / 'reader_controls.py', '_m1_operation_reader_controls')
        require(reader.read_report.__globals__ is reader.__dict__, 'operation-pure:actual-reader-globals')
        write(fixture, b'M1-op\x00\xff\n')
        fixture_before = adapter.metadata(fixture)
        operation_report = controls.run(raws[str(PARENT / 'operation_caller.py')],
                raws[str(PARENT / 'history_core.py')], raws[str(PARENT / 'archive_checks.py')],
                mapping, fixture, output, write, progress, deadline, adapter)
        record('operation-report.json', operation_report)
        reader_report = reader_controls.run(raws[str(CONTROL / 'strict_reader.py')], reader,
                operation_report, mapping, readmap, progress, deadline, adapter)
        record('reader-report.json', reader_report)
        count = sum(row['event'] == 'definition-intent' for row in events)
        require(count == 25 and len(definitions) == 4
                and len(operation_report['rows']) == 17 and len(reader_report['rows']) == 6,
                'operation-pure:exact-population-23-25')
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        after = {}
        for path, expected in source_inputs.items():
            value = api.attempt_finalization(issues, 'final-source:' + path,
                    lambda path=path, expected=expected: api.descriptor(path, expected, True))
            if value is not None:
                after[path] = value
        if fixture_before is not None:
            def fixture_check():
                require(api.read_blob(fixture, 8) == b'M1-op\x00\xff\n'
                        and adapter.metadata(fixture) == fixture_before, 'operation-pure:fixture-final-exact')
                return {'bytes': 8, 'metadata': fixture_before, 'exact': True}
            fixture_result = api.attempt_finalization(issues, 'fixture-final-readback', fixture_check)
        else:
            fixture_result = None
        terminal = {'primary': api.error_detail(primary) if primary is not None else None,
                    'cleanupIssues': issues, 'terminalRecordFailure': None,
                    'operationObservations': len(operation_report['rows']) if operation_report else None,
                    'readerObservations': len(reader_report['rows']) if reader_report else None,
                    'definitionIntents': sum(row['event'] == 'definition-intent' for row in events),
                    'fixture': fixture_result, 'sourceAfter': after, 'realToolCalls': 0,
                    'archiveAccess': False, 'history': 'UNASSESSED', 'productionApproval': None}
        try:
            record('pure-terminal.json', terminal)
        except BaseException as error:
            terminal['terminalRecordFailure'] = api.error_detail(error)
            issues.append(dict(operation='subject-terminal-record', **api.error_detail(error)))
    api.propagate(primary, saved, terminal)


if __name__ == '__main__':
    main()
