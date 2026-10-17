"""Six future comparisons over the same actual17 report. No caller replay."""
import copy
import hashlib
import json
from pathlib import Path

MESSAGE_ANCHOR = b"    require(actual['message'] == wanted['message'], 'operation-report:message:' + name)\n"
MESSAGE_BYPASS = b'    # Supplied exact-message comparison omitted.\n'


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def fingerprint(report, mapping):
    return hashlib.sha256(json.dumps([report, mapping], sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def run(reader_raw, original, report, mapping, readmap, progress, deadline, adapter):
    initial = fingerprint(report, mapping)
    require(hashlib.sha256(reader_raw).hexdigest() == readmap['original']['sourceSHA256']
            and reader_raw.count(MESSAGE_ANCHOR) == 1, 'operation-reader:source-anchor')
    rows, calls, loads = [], 0, 1

    def invoke(module, value):
        nonlocal calls
        calls += 1
        deadline()
        require(calls <= 6 and module.read_report.__globals__ is module.__dict__
                and module.read_report.__globals__['ReportRefusal'] is module.ReportRefusal, 'operation-reader:actual-globals')
        return module.read_report(value, mapping)

    def refuse(module, value, reason):
        try:
            invoke(module, value)
        except module.ReportRefusal as error:
            if type(error) is not module.ReportRefusal or str(error) != reason:
                raise
            return adapter.detail(error)
        raise AssertionError('operation-reader-control:missing-refusal:message')

    def add(row):
        wanted = readmap['rows'][len(rows)]
        require(row['name'] == wanted['name'], 'operation-reader:exact-row-name')
        if 'outcome' in wanted:
            require(row['outcome'] == wanted['outcome'], 'operation-reader:exact-row-outcome')
        else:
            require(row['fullClass'] == wanted['fullClass'] and row['message'] == wanted['message']
                    and row['traceback'].startswith('Traceback ')
                    and row['traceback'].rstrip().splitlines()[-1] == wanted['suffix']
                    and wanted['location'] in row['traceback'], 'operation-reader:exact-row-error-trace')
        rows.append(row)
        progress({'event': 'reader-case', 'ordinal': len(rows), 'row': row})

    try:
        neutral = copy.deepcopy([report, mapping])
        require(fingerprint(*neutral) == initial and neutral[0] is not report, 'operation-reader:harmless-copy')
        # Use the actual supplied map for the one call, while preserving actual globals.
        require(original.read_report.__globals__ is original.__dict__
                and original.__name__ == readmap['original']['moduleName']
                and original.__file__ == readmap['original']['virtualFile'], 'operation-reader:original-globals')
        add({'name': 'harmless-copy-first', 'outcome': 'SURVIVED', 'result': invoke(original, neutral[0])})
        add({'name': 'baseline', 'outcome': 'PASS', 'result': invoke(original, report)})
        bad_message = copy.deepcopy(report)
        require(bad_message['rows'][11]['name'] == 'replace-primary', 'operation-reader:literal-fault-row')
        bad_message['rows'][11]['fault']['message'] = 'operation-control:primary-preservation:wrong-refusal'
        add({'name': 'wrong-message', **refuse(original, bad_message, 'operation-report:message:replace-primary:fault')})
        bad_origin = copy.deepcopy(report)
        old = mapping['rows'][11]['fault']['location']
        trace = bad_origin['rows'][11]['fault']['traceback']
        require(trace.count(old) == 1, 'operation-reader:unique-origin')
        bad_origin['rows'][11]['fault']['traceback'] = trace.replace(old, 'File "SUPPLIED_WRONG_ORIGIN", line 1,', 1)
        add({'name': 'wrong-origin', **refuse(original, bad_origin, 'operation-report:trace:replace-primary:fault')})
        altered = reader_raw.replace(MESSAGE_ANCHOR, MESSAGE_BYPASS, 1)
        mutant = adapter.define(altered, readmap['messageBypass'], progress)
        loads += 1
        try:
            refuse(mutant, bad_message, 'operation-report:message:replace-primary:fault')
        except AssertionError as error:
            if type(error) is not AssertionError or str(error) != 'operation-reader-control:missing-refusal:message':
                raise
            add({'name': 'message-bypass', **adapter.detail(error), 'mutantSHA256': hashlib.sha256(altered).hexdigest()})
        else:
            raise RuntimeError('operation-reader:message-bypass-survived')
        restored = adapter.define(reader_raw, readmap['restored'], progress)
        loads += 1
        add({'name': 'restored', 'outcome': 'PASS', 'result': invoke(restored, report)})
        require(calls == len(rows) == 6 and loads == 3, 'operation-reader:population')
        return {'authority': 'SUPPLIED_OUTCOME_READER_CONTROLS_ONLY', 'rows': rows, 'readerCalls': calls,
                'readerDefinitions': loads, 'callerReplay': False, 'inputFingerprint': initial}
    finally:
        require(fingerprint(report, mapping) == initial, 'operation-reader:input-restoration')
        path = Path(readmap['sourcePath'])
        require(path.read_bytes() == reader_raw and adapter.metadata(path) == readmap['sourceMetadata'],
                'operation-reader:source-restoration')
        progress({'event': 'reader-restoration', 'callerReplay': False, 'readerCalls': calls,
                  'readerDefinitions': loads, 'inputsExact': True, 'sourceExact': True})
