"""UNRUN. One finite stdlib TEXT window. No SQL, network or application imports."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat
import time
import traceback

ROOT = Path('/home/nathaniel/.local/state/openplan/engagement-summary-native-preparation-corrections-20261016')
SUBJECT = ROOT / 'subject'
OLD = ('/home/nathaniel/.t3/worktrees/openplan/t3-c02aa002/docs/reviews/2026-10-16-engagement-summary-native-proof-preparation',
       '/home/nathaniel/.local/state/openplan/engagement-summary-native-proof-preparation-20261016',
       '/home/nathaniel/.t3/worktrees/openplan/t3-2873bd16/docs/reviews/2026-10-16-engagement-summary-native-preparation-independent',
       str(SUBJECT))
RESULTS = []


def require(value, name):
    if not value:
        raise AssertionError(name)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return digest(data)


def observe():
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    return {'limits': {k: (group / k).read_text().strip() for k in
                       ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max', 'memory.peak', 'memory.events')},
            'mounts': {line.split()[4]: line.split()[5].split(',') for line in
                       Path('/proc/self/mountinfo').read_text().splitlines()},
            'network': str(Path('/proc/self/ns/net').readlink()),
            'devnull': {'character': stat.S_ISCHR(Path('/dev/null').stat().st_mode),
                        'major': os.major(Path('/dev/null').stat().st_rdev),
                        'minor': os.minor(Path('/dev/null').stat().st_rdev)}}


def resource_gate(value, host):
    for name, expected in {'memory.max': '536870912', 'memory.swap.max': '0',
                           'cpu.max': '50000 100000', 'pids.max': '64'}.items():
        require(value['limits'].get(name) == expected, 'resource-' + name)
    require('ro' in value['mounts'].get('/', []), 'resource-root-ro')
    require('rw' in value['mounts'].get(str(ROOT), []), 'resource-private-rw')
    require(host.startswith('net:[') and host != value['network'], 'resource-unshared-net')
    require(all('ro' in value['mounts'].get(path, []) for path in OLD), 'resource-old-ro')
    require(value['devnull'] == {'character': True, 'major': 1, 'minor': 3}, 'resource-devnull')


def exact_failure(name, function, kind, message):
    try:
        function()
    except Exception as error:
        # Neither nonzero, subclass, wrong type nor a matching prefix is accepted.
        require(type(error) is kind and str(error) == message, 'wrong-failure-contract:' + name)
        RESULTS.append({'name': name, 'outcome': 'EXPECTED_FAILURE', 'type': type(error).__name__,
                        'message': str(error), 'traceback': traceback.format_exc()})
    else:
        raise AssertionError('control-survived:' + name)


def identifier(digit, kind, index):
    return '20261016-0020-400' + str(digit) + '-8000-' + str(kind).zfill(4) + str(index).zfill(8)


def supplied(case, oracle, allocation):
    spec = oracle[case]
    count, digit = spec['eligible'], spec['caseDigit']
    rows, lines = [], []
    for i in range(count + 4):
        n = 0 if i < count + 2 else i - count - 1
        money = (spec['rowCents'] if i < count else ['203', '90000', '777', '888'][i - count])
        retained = 1 if case == 'ordinary501' and i < count else 0
        def decimal(value):
            return str(int(value) // 100) + '.' + str(int(value) % 100).zfill(2)
        rows.append({'id': identifier(digit, 10, i), 'workspace_id': allocation['workspaceA' if n < 2 else 'workspaceB'],
                     'engagement_id': identifier(digit, 3, n), 'project_id': identifier(digit, 1, n),
                     'status': ('sent' if i % 2 == 0 else 'paid') if i < count else ['draft', 'void', 'sent', 'sent'][i - count],
                     'subtotal_amount': decimal(money), 'retention_amount': decimal(retained),
                     'total_amount': decimal(int(money) - retained), 'invoice_date': '2026-10-16'})
        lines.append({'id': identifier(digit, 11, i), 'invoice_id': identifier(digit, 10, i), 'position': 0,
                      'amount': decimal(money), 'deliverable_id': None, 'milestone_id': None})
    return rows, lines


def envelope(case, oracle, allocation, indexes, exclude=False):
    spec = oracle[case]
    digit = spec['caseDigit']
    workspace = allocation['workspaceB' if indexes == [2] else 'workspaceA']
    engagement = identifier(digit, 3, indexes[0]) if len(indexes) == 1 else None
    context = {'case': case, 'workspaceId': workspace, 'workspaceLabel': 'B' if indexes == [2] else 'A',
               'engagementId': engagement, 'excludeInvoiceId': identifier(digit, 10, 0) if exclude else None}
    def bucket(amount):
        return {'amount': amount, 'missing': '0', 'invalid': '0'}
    data = {'version': 1, 'workspace_id': workspace, 'engagement_id': engagement,
            'exclude_invoice_id': context['excludeInvoiceId'], 'complete': True, 'error': None, 'data': []}
    for i in indexes:
        data['data'].append({'engagement_id': identifier(digit, 3, i), 'not_to_exceed_amount': ['10.00', None, '0.00'][i],
                             'billed': bucket((spec['excludedFirstDecimal'] if exclude else spec['billedDecimal']) if i == 0 else ['0.00', '7.77', '8.88'][i]),
                             'draft': bucket('2.03' if i == 0 else '0.00')})
    return data, context


def main():
    os.umask(0o077)
    started = time.monotonic()
    request = ROOT / 'window-request.json'
    grant = json.loads((ROOT / 'grant.json').read_text())
    require(grant.get('requestSha256') == digest(request.read_bytes()) and grant.get('allowPureTextOnce') is True,
            'root-grant-request-binding')
    # Grant provenance remains root's external duty. The compiler window being free is irrelevant.
    for pin in json.loads(request.read_text())['inputPins']:
        require(digest(Path(pin['path']).read_bytes()) == pin['sha256'], 'request-input-pin:' + pin['path'])
    for line in (ROOT / 'inputs.sha256').read_text().splitlines():
        sha, path = line.split('  ', 1)
        require(digest(Path(path).read_bytes()) == sha, 'input-pin:' + path)
    for line in (ROOT / 'input-modes.txt').read_text().splitlines():
        mode, size, path = line.split(' ', 2)
        current = Path(path).stat()
        require(stat.S_IMODE(current.st_mode) == int(mode, 8) and current.st_size == int(size), 'input-mode-size:' + path)
    before = observe()
    save(ROOT / 'resources-before.json', before)
    host = (ROOT / 'host-netns.txt').read_text().strip()
    resource_gate(before, host)
    annotation = deepcopy(before)
    annotation['annotation'] = 'harmless supplied resource annotation'
    resource_gate(annotation, host)
    RESULTS.append({'name': 'resource-annotation', 'outcome': 'SURVIVED'})
    for name in ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max', 'root-ro', 'private-rw', 'unshared-net', 'old-ro', 'devnull'):
        bad = deepcopy(before)
        if name in bad['limits']:
            bad['limits'][name] = 'wrong'
        elif name == 'unshared-net':
            bad['network'] = host
        elif name == 'old-ro':
            bad['mounts'].pop(OLD[0], None)
        elif name == 'devnull':
            bad['devnull']['minor'] = 5
        else:
            bad['mounts'].pop('/' if name == 'root-ro' else str(ROOT), None)
        exact_failure('supplied-resource-' + name, lambda bad=bad: resource_gate(bad, host), AssertionError, 'resource-' + name)
    work = ROOT / 'working'
    work.mkdir(mode=0o700)  # A prior/partial attempt refuses. No retry or overwrite.
    originals = {p: (p.read_bytes(), stat.S_IMODE(p.stat().st_mode)) for p in SUBJECT.iterdir() if p.is_file()}
    working = {}
    try:
        emitter = runpy.run_path(str(SUBJECT / 'emit_fixture.py'), run_name='prepared_emitter')
        reader = runpy.run_path(str(SUBJECT / 'readback.py'), run_name='prepared_reader')
        oracle = json.loads((SUBJECT / 'oracles.json').read_text())
        allocation = json.loads((ROOT / 'allocation.TEXT_ONLY.json').read_text())
        for case in ('ordinary501', 'maximum90', 'maximum1001'):
            text = emitter['render'](allocation, case)
            path = work / (case + '.sql')
            path.write_text(text)
            path.chmod(0o600)
            working[path] = (path.read_bytes(), 0o600)
            context = {'case': case, 'workspaceA': allocation['workspaceA'], 'workspaceB': allocation['workspaceB']}
            reader['seed_text'](path, oracle, context)
            rows, lines = supplied(case, oracle, allocation)
            reader['fixture_rows'](rows, oracle, case, context)
            reader['fixture_lines'](lines, oracle, case)
            save(work / (case + '.supplied-rows.json'), rows)
            save(work / (case + '.supplied-lines.json'), lines)
            for label, indexes, exclude in [('workspaceA', [0, 1], False), ('primary', [0], False),
                                            ('excluded', [0], True), ('workspaceB', [2], False)]:
                data, scope = envelope(case, oracle, allocation, indexes, exclude)
                reader['scalar'](data, oracle, scope)
                save(work / (case + '.' + label + '.json'), {'suppliedOnly': True, 'data': data, 'context': scope})
            reader['fixture_rows'](list(reversed(rows)), oracle, case, context)
            data, scope = envelope(case, oracle, allocation, [0, 1])
            data['data'].reverse()
            reader['scalar'](data, oracle, scope)
            RESULTS.append({'name': case + '-baseline-and-row-order', 'outcome': 'SURVIVED'})
        harmless = work / 'harmless-emitter.py'
        original_emitter = (SUBJECT / 'emit_fixture.py').read_text()
        anchor = '# Reverse emission order makes numeric insertion order an unusable row oracle.'
        require(original_emitter.count(anchor) == 1, 'unique-harmless-anchor')
        working[harmless] = (original_emitter.encode(), 0o600)
        harmless.write_text(original_emitter.replace(anchor, '# Harmless annotation preserves the same emission order.'))
        harmless.chmod(0o600)
        annotated = runpy.run_path(str(harmless), run_name='harmless_emitter')
        require(annotated['render'](allocation, 'ordinary501').encode() == working[work / 'ordinary501.sql'][0], 'harmless-emitter-bytes')
        RESULTS.append({'name': 'emitter-comment', 'outcome': 'SURVIVED'})
        for name, field, value, message in [
            ('boolean-oid', 'databaseOid', True, 'target-not-allocated:databaseOid'),
            ('protected-oid', 'databaseOid', 6227945, 'target-protected-or-not-exclusive'),
            ('pending-system', 'clusterSystemId', None, 'target-not-allocated:clusterSystemId')]:
            bad = deepcopy(allocation)
            bad['target'][field] = value
            save(work / (name + '.input.json'), bad)
            exact_failure(name, lambda bad=bad: emitter['allocation'](bad), ValueError, message)
        bad = deepcopy(allocation)
        bad['workspaceB'] = bad['workspaceA']
        save(work / 'equal-workspaces.input.json', bad)
        exact_failure('equal-workspaces', lambda: emitter['allocation'](bad), ValueError, 'workspace-distinct')
        path = work / 'ordinary501.sql'
        original = working[path][0].decode()
        context = {'case': 'ordinary501', 'workspaceA': allocation['workspaceA'], 'workspaceB': allocation['workspaceB']}
        transition = "UPDATE public.client_invoices SET status='sent',sent_date='2026-10-16' WHERE id='20261016-0020-4001-8000-001000000000' AND status='draft';"
        parent = "'SYNTHETIC-SQL20-ordinary501-0','draft'"
        require(original.count(transition) == original.count(parent) == 1, 'unique-lifecycle-anchors')
        insertion = "INSERT INTO public.client_invoice_line_items (id,invoice_id,position,description,amount,created_at) VALUES ('20261016-0020-4001-8000-001100000505','20261016-0020-4001-8000-001000000000','0','SYNTHETIC extra unused child','1.01','2026-10-16T00:00:00Z');"
        require('20261016-0020-4001-8000-001100000505' not in original, 'unused-second-line-id')
        line_start = original.index('INSERT INTO public.client_invoice_line_items ')
        without = original.replace(transition + '\n', '')
        mutations = [
            ('initial-sent-parent', original.replace(parent, parent.replace("'draft'", "'sent'")), 'draft-parent-insert'),
            ('premature-transition', without[:line_start] + transition + '\n' + without[line_start:], 'one-line-per-parent'),
            ('issued-extra-line', original.replace(transition, transition + '\n' + insertion), 'line-parent-must-be-draft')]
        for name, text, message in mutations:
            try:
                (work / (name + '.input.sql')).write_text(text)
                path.write_text(text)
                exact_failure(name, lambda: reader['seed_text'](path, oracle, context), AssertionError, message)
            finally:
                path.write_bytes(working[path][0])
                path.chmod(working[path][1])
        data, scope = envelope('maximum1001', oracle, allocation, [0])
        data['data'][0]['billed']['amount'] = '1000999999999989.98'
        save(work / 'aggregate-loses-cent.input.json', {'data': data, 'context': scope})
        exact_failure('aggregate-loses-cent', lambda: reader['scalar'](data, oracle, scope), AssertionError, 'literal-billed-cents')
        data, scope = envelope('ordinary501', oracle, allocation, [0, 1])
        data['data'][1]['engagement_id'] = identifier(1, 3, 2)
        save(work / 'workspace-expected-set.input.json', {'data': data, 'context': scope})
        exact_failure('workspace-expected-set', lambda: reader['scalar'](data, oracle, scope), AssertionError, 'scope-identities')
        data, scope = envelope('ordinary501', oracle, allocation, [0, 1])
        data['data'][1]['not_to_exceed_amount'] = '0.00'
        save(work / 'absent-ceiling-becomes-zero.input.json', {'data': data, 'context': scope})
        exact_failure('absent-ceiling-becomes-zero', lambda: reader['scalar'](data, oracle, scope), AssertionError, 'ceiling-zero-absence')
        for p, (body, mode) in working.items():
            p.write_bytes(body)
            p.chmod(mode)
        reader['seed_text'](path, oracle, context)
        data, scope = envelope('ordinary501', oracle, allocation, [0, 1])
        reader['scalar'](data, oracle, scope)
        RESULTS.append({'name': 'restored-baseline', 'outcome': 'SURVIVED'})
        require(time.monotonic() - started < 100, 'inner-finite-deadline')
        save(ROOT / 'result.json', {'state': 'TEXT_ONLY', 'controls': RESULTS, 'noNative': True})
    except BaseException:
        save(ROOT / 'unexpected-failure.json', {'traceback': traceback.format_exc(), 'controls': RESULTS})
        raise
    finally:
        drift = [str(p) for p, (body, mode) in originals.items() if p.read_bytes() != body or stat.S_IMODE(p.stat().st_mode) != mode]
        for p, (body, mode) in working.items():
            p.write_bytes(body)
            p.chmod(mode)
        restored = all(p.read_bytes() == body and stat.S_IMODE(p.stat().st_mode) == mode for p, (body, mode) in working.items())
        save(ROOT / 'restoration.json', {'workingBytesAndModesRestored': restored, 'sourceDrift': drift,
                                        'sourceBytesAndModesUnchanged': not drift})
        save(ROOT / 'resources-after.json', observe())
        save(ROOT / 'artifacts.json', {str(p.relative_to(ROOT)): {'sha256': digest(p.read_bytes()), 'bytes': p.stat().st_size,
                                       'mode': oct(stat.S_IMODE(p.stat().st_mode))} for p in work.iterdir() if p.is_file()})
        require(restored and not drift, 'finally-working-source-restoration')


if __name__ == '__main__':
    main()
