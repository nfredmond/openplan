"""R2 author-owned emitted-text/oracle checks, adapted from reviewed02c7c6d6 reader. No SQL parser, transport, subprocess or native action.

Run only under a separately admitted finite window, using private subject copies.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path('/home/nathaniel/.local/state/openplan/project-budget-native-proof-corrections-20261016')
NS = bytes.fromhex('d36e75ef833648eba71e7f34993fdce0')
TOTALS = {33: '3299999999999967', 79: '7899999999999921', 89: '8899999999999911',
          90: '8999999999999910', 101: '10099999999999899', 1001: '100099999999998999'}
PREREQS = {'workspaceA': '11111111-1111-4111-8111-111111111111',
           'workspaceB': '22222222-2222-4222-8222-222222222222',
           'owner': '33333333-3333-4333-8333-333333333333',
           'assignee': '44444444-4444-4444-8444-444444444444',
           'database': 'UNALLOCATED_PURE_TEXT_ONLY'}


def uid(case, kind, index=0):
    # Independent UUID5 implementation: do not call the generator's identity/uuid5.
    digest = bytearray(hashlib.sha1(NS + f'{case}/{kind}/{index}'.encode()).digest()[:16])
    digest[6] = (digest[6] & 15) | 80
    digest[8] = (digest[8] & 63) | 128
    h = digest.hex()
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'


def insist(condition, label):
    if not condition:
        raise AssertionError(label)


def emitted_rows(sql):
    # Recognizes ONLY this generator's quoted-literal emission, not general SQL.
    tables = {}
    for match in re.finditer(r'INSERT INTO public\.(\w+) \(([^)]+)\) VALUES\n(.*?);\n', sql, re.S):
        columns = match[2].split(',')
        rows = []
        for row in match[3].split(',\n'):
            insist(row.startswith('(') and row.endswith(')'), 'emission-row-shape')
            inner = row[1:-1]
            tokens = re.findall(r"'(?:[^']|'')*'|NULL", inner)
            insist(','.join(tokens) == inner and len(tokens) == len(columns), 'emission-literal-shape')
            values = [None if t == 'NULL' else t[1:-1].replace("''", "'") for t in tokens]
            rows.append(dict(zip(columns, values)))
        tables.setdefault(match[1], []).extend(rows)
    insist(set(tables) == {'projects', 'invoicing_clients', 'project_deliverables',
                          'project_spend_entries', 'client_invoices', 'client_invoice_line_items'}, 'emission-tables')
    for rows in tables.values():
        insist(len({r['id'] for r in rows}) == len(rows), 'emission-duplicate-id')
    return tables


def cents(text):
    insist(isinstance(text, str) and re.fullmatch(r'\d+\.\d{2}', text) is not None, 'money-literal-shape')
    return int(text.replace('.', ''))


def lifecycle_readback(sql):
    """Read this emitter's INSERT/UPDATE text in order, not general SQL or PostgreSQL."""
    pattern = re.compile(r'INSERT INTO public\.(client_invoices|client_invoice_line_items) '
                         r'\(([^)]+)\) VALUES\n(.*?);\n|'
                         r'UPDATE public\.client_invoices SET (.*?) WHERE id IN \((.*?)\) '
                         r"AND status='(draft|sent)';\n", re.S)
    parents = {}
    lines = {}
    for match in pattern.finditer(sql):
        if match[1]:
            columns = match[2].split(',')
            for row in match[3].split(',\n'):
                insist(row.startswith('(') and row.endswith(')'), 'lifecycle-row-shape')
                tokens = re.findall(r"'(?:[^']|'')*'|NULL", row[1:-1])
                insist(','.join(tokens) == row[1:-1] and len(tokens) == len(columns), 'lifecycle-literal-shape')
                item = dict(zip(columns, [None if x == 'NULL' else x[1:-1].replace("''", "'") for x in tokens]))
                if match[1] == 'client_invoices':
                    insist(item['id'] not in parents, 'lifecycle-duplicate-parent')
                    parents[item['id']] = {'retention_percent': '0.00', 'retention_amount': '0.00',
                                           'sent_date': None, 'paid_date': None, **item}
                else:
                    parent = parents.get(item['invoice_id'])
                    insist(parent is not None, 'line-parent-missing')
                    insist(parent['status'] == 'draft', 'line-parent-must-be-draft')
                    insist(item['id'] not in lines, 'lifecycle-duplicate-line')
                    lines[item['id']] = item
        else:
            assignments = dict(re.findall(r"([a-z_]+)='([^']*)'", match[4]))
            insist(','.join(k + "='" + v + "'" for k, v in assignments.items()) == match[4], 'update-assignment-shape')
            ids = [x[1:-1] for x in re.findall(r"'[a-f0-9-]+'", match[5])]
            insist(','.join("'" + x + "'" for x in ids) == match[5], 'update-id-shape')
            for invoice in ids:
                insist(invoice in parents, 'update-parent-missing')
                old = parents[invoice]
                insist(old['status'] == match[6], 'update-predicate-matched')
                new = {**old, **assignments}
                transitions = {'draft': {'draft', 'sent', 'void'}, 'sent': {'sent', 'paid', 'void'},
                               'paid': {'paid', 'void'}, 'void': {'void'}}
                insist(new['status'] in transitions[old['status']], 'header-legal-status-transition')
                if old['status'] != 'draft':
                    for key in assignments:
                        if key == 'status':
                            continue
                        if key == 'paid_date' and old['status'] == 'sent' and new['status'] == 'paid':
                            continue
                        insist(new[key] == old.get(key), 'issued-header-immutable')
                if any(key in assignments for key in ('subtotal_amount', 'total_amount', 'retention_amount')):
                    total = sum(cents(x['amount']) for x in lines.values() if x['invoice_id'] == invoice)
                    insist(cents(new['subtotal_amount']) == total and cents(new['retention_amount']) == 0
                           and cents(new['total_amount']) == total, 'draft-header-line-total')
                parents[invoice] = new
    insist(len(lines) == len(emitted_rows(sql)['client_invoice_line_items']), 'lifecycle-all-lines-read')
    insist(len(parents) == len(emitted_rows(sql)['client_invoices']), 'lifecycle-all-parents-read')
    insist(len(re.findall(r'^UPDATE public\.client_invoices ', sql, re.M)) ==
           sum(1 for m in pattern.finditer(sql) if m[4] is not None), 'lifecycle-all-updates-read')
    return parents


def check_project_projection(expected_ids, actual_rows, label):
    insist(sorted(r['id'] for r in actual_rows) == sorted(expected_ids), label)


def foreign_readback(rows, actual, case):
    if case != 'ordinary':
        insist(actual['foreignExclusions'] is None, 'max-case-foreign-boundary')
        return
    excluded = actual['foreignExclusions']
    expected = {'project': uid(case, 'foreign-project'), 'workspace': PREREQS['workspaceB'],
                'deliverables': [uid(case, 'foreign-deliverable')], 'spendEntries': [uid(case, 'foreign-spend')],
                'deliverableBudgetCents': '77777', 'spendCents': '88888',
                'visibilityRequired': 'same dual A/B ordinary caller can see these rows separately'}
    insist(excluded == expected, 'foreign-exclusion-oracle')
    d = [r for r in rows['project_deliverables'] if r['project_id'] == expected['project']]
    spend = [r for r in rows['project_spend_entries'] if r['project_id'] == expected['project']]
    insist([r['id'] for r in d] == expected['deliverables'] and d[0]['budget_amount'] == '777.77', 'foreign-deliverable-present')
    insist([r['id'] for r in spend] == expected['spendEntries'] and spend[0]['amount'] == '888.88'
           and spend[0]['deliverable_id'] == d[0]['id'], 'foreign-spend-present')
    foreign_project = next(r for r in rows['projects'] if r['id'] == expected['project'])
    insist(foreign_project['workspace_id'] == PREREQS['workspaceB'], 'foreign-project-workspace')
    project = actual['project']
    for table, key, label in [('project_deliverables', 'deliverables', 'foreign-deliverable-leak'),
                              ('project_spend_entries', 'spendEntries', 'foreign-spend-leak')]:
        check_project_projection(actual[key], [r for r in rows[table] if r['project_id'] == project], label)


def independent(sql, oracle, case):
    rows = emitted_rows(sql)
    maximum = case != 'ordinary'
    n = int(case[4:]) if maximum else 1201
    project = uid(case, 'project')
    ds = [uid(case, 'deliverable', i) for i in range(n)]
    ss = [uid(case, 'spend', i) for i in range(n)]
    inv = [uid(case, 'invoice', i) for i in range(n)]
    lines = [uid(case, 'line', i) for i in range(n)]
    actual = oracle['cases'][case]
    expected_total = TOTALS[n] if maximum else '120100'
    insist(int(expected_total) == n * (99999999999999 if maximum else 100), 'literal-product')
    expected_cents = {'deliverableBudgetTotal': expected_total if maximum else '120100000',
                      'spendToDate': expected_total, 'actualToDate': expected_total,
                      'billedToDate': expected_total if maximum else '600500',
                      'statedBudget': None if maximum else '999900',
                      'remainingAgainstStatedBudget': None if maximum else '879800'}
    insist(actual['cents'] == expected_cents, 'literal-cents')
    for key, ids in [('deliverables', ds), ('spendEntries', ss), ('invoices', inv)]:
        insist(actual[key] == sorted(ids), 'uuid-order-' + key)
    insist(actual['project'] == project and actual['count'] == n, 'project-count')
    insist(actual['lineCount'] == (n if maximum else 2402), 'line-count')
    insist(actual['lastDeliverable'] == ds[-1], 'last-deliverable-id')
    insist(actual['lastDeliverableBilledCents'] == (None if maximum else '360500'), 'last-deliverable-cents')
    projected = next(r for r in rows['projects'] if r['id'] == project)
    insist(projected['workspace_id'] == PREREQS['workspaceA'] and projected['budget_amount'] ==
           (None if maximum else '9999.00'), 'project-budget')
    for table, ids, money_key, amount in [
        ('project_deliverables', ds, 'budget_amount', '999999999999.99' if maximum else '1000.00'),
        ('project_spend_entries', ss, 'amount', '999999999999.99' if maximum else '1.00')]:
        actual_rows = [r for r in rows[table] if r['project_id'] == project]
        insist([r['id'] for r in actual_rows] == ids and all(r['project_id'] == project for r in actual_rows), 'emission-ids-' + table)
        insist(all(r[money_key] == amount for r in actual_rows), 'emission-money-' + table)
    insist(all(r['updated_at'] == '2026-10-16T00:00:00Z' and r['percent_complete'] == '50.00'
               and r['assignee_user_id'] == PREREQS['assignee'] for r in rows['project_deliverables'] if r['project_id'] == project), 'deliverable-ties-fields')
    insist(all(r['entry_date'] == '2026-10-16' and r['deliverable_id'] == ds[i]
               for i, r in enumerate(r for r in rows['project_spend_entries'] if r['project_id'] == project)), 'spend-ties-links')
    expected_lines = {uid(case, 'line', i): (inv[i], ds[i], '999999999999.99' if maximum else '2.00') for i in range(n)}
    if not maximum:
        expected_lines.update({uid(case, 'extra-line', i): (inv[0], ds[-1], '3.00') for i in range(n)})
    native_lines = {r['id']: (r['invoice_id'], r.get('deliverable_id'), r['amount'])
                    for r in rows['client_invoice_line_items'] if r['invoice_id'] in inv}
    insist(native_lines == expected_lines, 'emission-line-links-money')
    expected_nested = {i: sorted(k for k, v in expected_lines.items() if v[0] == i) for i in sorted(inv)}
    insist(actual['linesByInvoice'] == expected_nested, 'nested-line-identities')
    parents = lifecycle_readback(sql)
    for i, invoice in enumerate(inv):
        r = parents[invoice]
        insist(r['status'] == ('sent' if i % 2 == 0 else 'paid') and r['project_id'] == project
               and r['workspace_id'] == PREREQS['workspaceA'] and r['client_id'] == uid(case, 'client'), 'invoice-fields')
        insist(r['total_amount'] == r['subtotal_amount'] ==
               ('999999999999.99' if maximum else ('3605.00' if i == 0 else '2.00')), 'invoice-header-money')
    expected_excluded = [] if maximum else [
        {'invoice': uid(case, kind + '-invoice'), 'line': uid(case, kind + '-line'), 'reason': kind}
        for kind in ('draft', 'void', 'foreign')]
    insist(actual['excluded'] == expected_excluded, 'excluded-identities')
    insist(len(parents) == n + (0 if maximum else 3), 'invoice-raw-count')
    insist(len(rows['client_invoice_line_items']) == (n if maximum else 2405), 'line-raw-count')
    for excluded in expected_excluded:
        p = parents[excluded['invoice']]
        foreign = excluded['reason'] == 'foreign'
        insist(p['status'] == ('sent' if foreign else excluded['reason']) and
               p['project_id'] == (uid(case, 'foreign-project') if foreign else project), 'excluded-fields')
    foreign_readback(rows, actual, case)
    insist(sql.startswith('-- SYNTHETIC PREPARATION.') and '\nBEGIN;\n' in sql and
           sql.endswith('SELECT txid_current() AS fixture_transaction;\nCOMMIT;\n'), 'transaction-text')
    return {'case': case, 'count': n, 'eligibleLines': len(expected_lines),
            'cents': expected_cents, 'project': project, 'firstInvoice': inv[0], 'lastDeliverable': ds[-1]}


def main():
    """Only an admitted pure window may invoke this R2 text diagnostic."""
    subject = ROOT / 'subject'
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in subject.iterdir() if p.is_file()}
    spec = importlib.util.spec_from_file_location('r2_generator', subject / 'generate.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    result = {'claim': 'R2_PURE_TEXT_ONLY_NO_SQL_OR_NATIVE_EXECUTION', 'cases': [], 'mutations': []}
    originals = {}
    try:
        for case in ['ordinary'] + ['max-' + str(n) for n in TOTALS]:
            sql, oracle = generator.prepare(PREREQS, case)
            result['cases'].append(independent(sql, oracle, case))
            (ROOT / 'generated' / (case + '.sql')).write_text(sql)
            (ROOT / 'generated' / (case + '.json')).write_text(json.dumps(oracle, indent=2) + '\n')
        sql, oracle = generator.prepare(PREREQS)
        originals = {ROOT / 'working.sql': sql.encode(),
                     ROOT / 'working.json': (json.dumps(oracle, indent=2) + '\n').encode()}
        for path, data in originals.items():
            path.write_bytes(data)
        independent(sql.replace('Review and admit separately before SQL execution.', 'Review before admitted SQL execution.'), oracle, 'ordinary')
        result['mutations'].append({'name': 'harmless-comment', 'outcome': 'SURVIVED'})
        mutations = [
            ('spend-cent', 'emission-money-project_spend_entries', sql.replace("'1.00','SYNTHETIC spend'", "'1.01','SYNTHETIC spend'", 1), deepcopy(oracle)),
            ('lost-child', 'nested-line-identities', sql, deepcopy(oracle)),
            ('uuid-order', 'uuid-order-deliverables', sql, deepcopy(oracle)),
            ('rounded-total', 'literal-cents', sql, deepcopy(oracle)),
            ('sentinel-included', 'uuid-order-invoices', sql, deepcopy(oracle)),
            ('issued-before-lines', 'line-parent-must-be-draft', sql.replace("'draft','0.00','0.00'", "'sent','0.00','0.00'", 1), deepcopy(oracle)),
            ('void-before-lines', 'line-parent-must-be-draft', sql.replace("'SYNTHETIC-excluded-void','draft'", "'SYNTHETIC-excluded-void','void'", 1), deepcopy(oracle)),
            ('draft-direct-paid', 'header-legal-status-transition', sql.replace("SET status='sent',sent_date=", "SET status='paid',sent_date=", 1), deepcopy(oracle)),
            ('header-loses-cent', 'draft-header-line-total', sql.replace("subtotal_amount='3605.00'", "subtotal_amount='3604.99'", 1), deepcopy(oracle)),
        ]
        for name, label, altered_sql, altered in mutations:
            case = altered['cases']['ordinary']
            if name == 'lost-child':
                next(v for v in case['linesByInvoice'].values() if len(v) > 1).pop()
            elif name == 'uuid-order':
                case['deliverables'].reverse()
            elif name == 'rounded-total':
                case['cents']['billedToDate'] = '600499'
            elif name == 'sentinel-included':
                case['invoices'].append(case['excluded'][0]['invoice'])
            failure = None
            try:
                (ROOT / 'working.sql').write_text(altered_sql)
                (ROOT / 'working.json').write_text(json.dumps(altered, indent=2) + '\n')
                independent((ROOT / 'working.sql').read_text(), json.loads((ROOT / 'working.json').read_text()), 'ordinary')
            except AssertionError as error:
                failure = str(error)
            finally:
                for path, data in originals.items():
                    path.write_bytes(data)
            insist(failure == label, 'wrong-or-missing-fault-reason-' + name)
            result['mutations'].append({'name': name, 'outcome': 'KILLED', 'reason': failure})
        rows = emitted_rows(sql)
        for table, key, label in [('project_deliverables', 'deliverables', 'foreign-deliverable-leak'),
                                  ('project_spend_entries', 'spendEntries', 'foreign-spend-leak')]:
            # Deliberately omit the project predicate in a PURE supplied readback.
            failure = None
            try:
                check_project_projection(oracle['cases']['ordinary'][key], rows[table], label)
            except AssertionError as error:
                failure = str(error)
            insist(failure == label, 'foreign-predicate-control-did-not-fail')
            result['mutations'].append({'name': label, 'outcome': 'KILLED', 'reason': failure,
                                        'boundary': 'supplied text readback, not SQL19 mutation'})
        independent(sql, oracle, 'ordinary')
        result['restoredBaseline'] = True
    finally:
        for path, data in originals.items():
            path.write_bytes(data)
        result['privateWorkingBytesRestoredExact'] = all(p.read_bytes() == b for p, b in originals.items())
        result['privateSubjectRestoredExact'] = before == {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in subject.iterdir() if p.is_file()}
        (ROOT / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
        insist(result['privateWorkingBytesRestoredExact'], 'private-working-bytes-not-restored')
        insist(result['privateSubjectRestoredExact'], 'private-subject-bytes-changed')
    print(json.dumps({'cases': len(result['cases']), 'mutations': result['mutations'], 'restored': True}))


if __name__ == '__main__':
    main()
