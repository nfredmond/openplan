"""Independent literal readers for the proposed six-case local window."""
import hashlib
from pathlib import Path
import re

PYTHON_CASES = ('P-WRITE', 'P-READBACK', 'P-INDEPENDENT', 'P-METADATA')
NODE_CASES = ('N-WRITE', 'N-READBACK')
OMISSIONS = {
    'P-W1': ('P-WRITE', 'P-WRITE.actual-eight'),
    'P-W2': ('P-WRITE', 'P-WRITE.zero-refusal'),
    'P-R1': ('P-READBACK', 'P-READBACK.hash-refusal'),
    'P-C1': ('P-INDEPENDENT', 'P-INDEPENDENT.later-markers'),
    'P-M1': ('P-METADATA', 'P-METADATA.mode-refusal'),
    'N-W1': ('N-WRITE', 'N-WRITE.actual-eight'),
    'N-W2': ('N-WRITE', 'N-WRITE.zero-refusal'),
    'N-R1': ('N-READBACK', 'N-READBACK.hash-refusal'),
}


def insist(condition, label):
    if not condition:
        raise AssertionError('READER:' + label)


def literal_order(cases, omissions):
    return ([('harmless', case) for case in cases] + [('baseline', case) for case in cases] +
            [(name, OMISSIONS[name][0]) for name in omissions] + [('restored', case) for case in cases])


def read_source_equivalence(plan):
    for family in ('python', 'node'):
        section = plan[family]
        original = Path(section['original']).read_text()
        for name, body in section['bodies'].items():
            exact = body['text']
            insist(original.count(exact) == 1, family + '-' + name + '-source-body-unique')
            insist(hashlib.sha256(exact.encode()).hexdigest() == body['sha256'], family + '-' + name + '-body-sha')
            for source_path in (section['baseline'], section['harmless']):
                insist(Path(source_path).read_text().count(exact) == 1, family + '-' + name + '-body-equivalence')
        for step in section['steps']:
            insist(hashlib.sha256(Path(step['source']).read_bytes()).hexdigest() == step['sha256'], step['id'] + '-static-variant-sha')


def read_results(python, node, plan, output):
    # Literal expected order and omission labels do not come from observed
    # results, variant source or the guard functions being tested.
    expected_python = literal_order(PYTHON_CASES, ('P-W1', 'P-W2', 'P-R1', 'P-C1', 'P-M1'))
    expected_node = literal_order(NODE_CASES, ('N-W1', 'N-W2', 'N-R1'))
    insist(python['primary'] is None and python['cleanup'] == [], 'python-recording-complete')
    insist(node['primary'] is None and node['cleanup'] == [], 'node-recording-complete')
    insist([(row['variant'], row['case']) for row in python['rows']] == expected_python, 'exact-17-python')
    insist([(row['variant'], row['case']) for row in node['rows']] == expected_node, 'exact-nine-node')
    expected_global = ([['harmless', case] for case in PYTHON_CASES + NODE_CASES] +
                       [['baseline', case] for case in PYTHON_CASES + NODE_CASES] +
                       [[name, OMISSIONS[name][0]] for name in ('P-W1', 'P-W2', 'P-R1', 'P-C1', 'P-M1', 'N-W1', 'N-W2', 'N-R1')] +
                       [['restored', case] for case in PYTHON_CASES + NODE_CASES])
    insist(python['executionOrder'] == expected_global, 'all-six-harmless-first-global-order')
    for name in ('harmless', 'baseline', 'omissions', 'restored'):
        insist((output / ('ack-' + name)).read_bytes() == b'1', name + '-actual-child-barrier')
    for family, result in (('python', python), ('node', node)):
        baseline = Path(plan[family]['baseline']).read_bytes()
        working = output / ('working-python.py' if family == 'python' else 'working-node.mjs')
        insist(working.read_bytes() == baseline, family + '-independent-restored-bytes')
        insist(result['restoredSHA256'] == hashlib.sha256(baseline).hexdigest(), family + '-restored-sha')
        for row in result['rows']:
            variant, case = row['variant'], row['case']
            root = output / (variant + '-' + case)
            if variant in OMISSIONS:
                expected_case, label = OMISSIONS[variant]
                error = row['error']
                insist(case == expected_case and row['passed'] is False and error is not None, variant + '-must-fail-target')
                insist(error['name'] == 'AssertionError' and error['message'] == label, variant + '-exact-assertion-label')
                anchor = plan['assertions'][label]
                if family == 'python':
                    insist(any(frame['filename'] == anchor['path'] and frame['lineno'] == anchor['line']
                               for frame in error['frames']), variant + '-exact-python-assertion-anchor')
                else:
                    insist(error['code'] == 'ERR_ASSERTION' and error['actual'] is False and error['expected'] is True,
                           variant + '-node-assertion-details')
                    insist(re.search(re.escape(anchor['path']) + ':' + str(anchor['line']) + r':\d+', error['stack']) is not None,
                           variant + '-exact-node-assertion-anchor')
            else:
                insist(variant in ('harmless', 'baseline', 'restored') and row['passed'] is True and row['error'] is None,
                       variant + '-' + case + '-survivor')
            # Read fixture bytes independently of the tested writer/readback.
            if case.endswith('WRITE'):
                actual = (root / 'writer').read_bytes()
                expected = b'1' if variant in ('P-W1', 'N-W1') else b'12345678'
                insist(actual == expected and row['evidence']['actualBytes'] == actual.hex(), variant + '-writer-actual-file')
                if variant not in ('P-W1', 'N-W1'):
                    insist(row['evidence']['calls'] == [1] * 8 and row['evidence']['returned'] == 8, variant + '-actual-counts')
                if variant in ('harmless', 'baseline', 'restored'):
                    name = 'RuntimeError' if family == 'python' else 'Error'
                    message = 'invalid_actual_write_count' if family == 'python' else 'report_invalid_actual_write_count'
                    insist(row['evidence']['refusals'] == {'zero': {'name': name, 'message': message}, 'string': {'name': name, 'message': message}},
                           variant + '-both-invalid-count-refusals')
            elif case.endswith('READBACK'):
                insist((root / 'readback').read_bytes() == b'1234567X' and row['evidence']['positiveBytes'] == 8,
                       variant + '-corrupt-readback-actual-file')
            elif case == 'P-INDEPENDENT':
                evidence = row['evidence']
                markers = [(root / name).read_bytes() if (root / name).exists() else None for name in ('marker-a', 'marker-b')]
                insist(evidence['primary']['type'] == 'ValueError' and evidence['primary']['message'] == 'local_primary' and
                       'primary_callback' in evidence['primary']['traceback'], variant + '-primary-traceback')
                if variant == 'P-C1':
                    insist(markers == [None, None] and evidence['caught'] == {'name': 'OSError', 'message': 'local_cleanup'}, 'P-C1-later-action-omission')
                else:
                    insist(markers == [b'A', b'B'], variant + '-independent-marker-readback')
                    insist(evidence['outcome']['primary'] == evidence['primary'], variant + '-independent-primary')
                    errors = evidence['outcome']['errors']
                    insist(len(errors) == 1 and errors[0]['type'] == 'OSError' and errors[0]['message'] == 'local_cleanup' and
                           errors[0]['step'] == 'cleanup' and 'cleanup_callback' in errors[0]['traceback'], variant + '-independent-cleanup')
                    insist(evidence['assertions'] == {'primary': True, 'cleanup': True, 'later': True, 'readback': True}, variant + '-four-independent-assertions')
            elif case == 'P-METADATA':
                evidence = row['evidence']
                insist((root / 'metadata').read_bytes() == b'12345678', variant + '-metadata-fixture-file')
                if variant in ('harmless', 'baseline', 'restored'):
                    for field in ('uid', 'gid'):
                        insist(evidence['strictOwner'][field] == {'name': 'RuntimeError', 'message': 'complete_input_descriptor_changed:' + str(root / 'metadata')},
                               variant + '-strict-' + field)
                    paths = ('/usr/bin/node', '/usr/bin/python3.14', '/usr/bin/bwrap', '/usr/bin/systemd-run',
                             '/usr/bin/systemctl', '/usr/include/node/node_version.h', '/usr/bin/python3')
                    insist([item['path'] for item in evidence['syntheticSystemViews']] == list(paths), variant + '-exact-system-policy-paths')
                    insist(all(item['actualUID'] == 12345 and item['actualGID'] == 23456 and item['systemOwnerParity'] == 'UNPROVED'
                               for item in evidence['syntheticSystemViews']), variant + '-synthetic-owner-view-only')
                    insist(evidence['otherFields'] == [{'name': 'RuntimeError', 'message': 'inner_system_nonowner_descriptor_changed:' + path} for path in paths],
                           variant + '-system-nonowner-exact')
                    insist(evidence['unknown'] == {'name': 'RuntimeError', 'message': 'inner_unknown_owner_path:/usr/bin/not-an-approved-input'},
                           variant + '-no-generic-owner-exemption')
    return {'caseExecutions': 26, 'harmlessSurvivors': 6, 'baselineSurvivors': 6,
            'targetedOmissions': 8, 'restoredSurvivors': 6, 'subjectInvocations': 0}
