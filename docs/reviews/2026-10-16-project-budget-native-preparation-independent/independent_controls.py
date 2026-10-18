"""Pure emitted-text/oracle checks. No SQL parser, transport, subprocess or native action.

Run only under a separately admitted finite window, using private subject copies.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path('/home/nathaniel/.local/state/openplan/project-budget-native-preparation-independent-20261016')
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
        actual_rows = rows[table]
        insist([r['id'] for r in actual_rows] == ids and all(r['project_id'] == project for r in actual_rows), 'emission-ids-' + table)
        insist(all(r[money_key] == amount for r in actual_rows), 'emission-money-' + table)
    insist(all(r['updated_at'] == '2026-10-16T00:00:00Z' and r['percent_complete'] == '50.00'
               and r['assignee_user_id'] == PREREQS['assignee'] for r in rows['project_deliverables']), 'deliverable-ties-fields')
    insist(all(r['entry_date'] == '2026-10-16' and r['deliverable_id'] == ds[i]
               for i, r in enumerate(rows['project_spend_entries'])), 'spend-ties-links')
    expected_lines = {uid(case, 'line', i): (inv[i], ds[i], '999999999999.99' if maximum else '2.00') for i in range(n)}
    if not maximum:
        expected_lines.update({uid(case, 'extra-line', i): (inv[0], ds[-1], '3.00') for i in range(n)})
    native_lines = {r['id']: (r['invoice_id'], r.get('deliverable_id'), r['amount'])
                    for r in rows['client_invoice_line_items'] if r['invoice_id'] in inv}
    insist(native_lines == expected_lines, 'emission-line-links-money')
    expected_nested = {i: sorted(k for k, v in expected_lines.items() if v[0] == i) for i in sorted(inv)}
    insist(actual['linesByInvoice'] == expected_nested, 'nested-line-identities')
    parents = {r['id']: r for r in rows['client_invoices']}
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
    insist(sql.startswith('-- SYNTHETIC PREPARATION.') and '\nBEGIN;\n' in sql and
           sql.endswith('SELECT txid_current() AS fixture_transaction;\nCOMMIT;\n'), 'transaction-text')
    return {'case': case, 'count': n, 'eligibleLines': len(expected_lines),
            'cents': expected_cents, 'project': project, 'firstInvoice': inv[0], 'lastDeliverable': ds[-1]}


def incompatible_lines(sql):
    rows = emitted_rows(sql)
    parents = {r['id']: r['status'] for r in rows['client_invoices']}
    return [r['id'] for r in rows['client_invoice_line_items'] if parents[r['invoice_id']] != 'draft']


def main():
    subject = ROOT / 'subject'
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in subject.iterdir()}
    spec = importlib.util.spec_from_file_location('generate', subject / 'generate.py')
    generator = importlib.util.module_from_spec(spec)
    sys.modules['generate'] = generator
    spec.loader.exec_module(generator)
    spec2 = importlib.util.spec_from_file_location('author_controls', subject / 'controls.py')
    controls = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(controls)
    working_originals = {}
    result = {'claim': 'PURE_TEXT_ONLY_NO_SQL_OR_NATIVE_EXECUTION', 'cases': [], 'mutations': []}
    try:
        result['authorControls'] = controls.proposed_controls(PREREQS)
        for case in ['ordinary'] + ['max-' + str(n) for n in TOTALS]:
            sql, oracle = generator.prepare(PREREQS, case)
            result['cases'].append(independent(sql, oracle, case))
            (ROOT / 'generated' / (case + '.sql')).write_text(sql)
            (ROOT / 'generated' / (case + '.json')).write_text(json.dumps(oracle, indent=2) + '\n')
            result['cases'][-1]['lifecycleIncompatibleLineCount'] = len(incompatible_lines(sql))
        sql, oracle = generator.prepare(PREREQS)
        working_originals = {ROOT / 'working.sql': sql.encode(), ROOT / 'working.json': (json.dumps(oracle, indent=2) + '\n').encode()}
        for path, content in working_originals.items(): path.write_bytes(content)
        independent(sql.replace('Review and admit separately before SQL execution.', 'Review before admitted SQL execution.'), oracle, 'ordinary')
        result['mutations'].append({'name': 'harmless-comment', 'result': 'SURVIVED'})
        mutations = [
            ('spend-cent', 'emission-money-project_spend_entries', sql.replace("'1.00','SYNTHETIC spend'", "'1.01','SYNTHETIC spend'", 1), deepcopy(oracle)),
            ('lost-child', 'nested-line-identities', sql, deepcopy(oracle)),
            ('uuid-order', 'uuid-order-deliverables', sql, deepcopy(oracle)),
            ('rounded-total', 'literal-cents', sql, deepcopy(oracle)),
            ('sentinel-included', 'uuid-order-invoices', sql, deepcopy(oracle)),
        ]
        for name, label, altered_sql, altered in mutations:
            c = altered['cases']['ordinary']
            if name == 'lost-child':
                next(v for v in c['linesByInvoice'].values() if len(v) > 1).pop()
            elif name == 'uuid-order': c['deliverables'].reverse()
            elif name == 'rounded-total': c['cents']['billedToDate'] = '600499'
            elif name == 'sentinel-included': c['invoices'].append(c['excluded'][0]['invoice'])
            failure = None
            try:
                (ROOT / 'working.sql').write_text(altered_sql)
                (ROOT / 'working.json').write_text(json.dumps(altered, indent=2) + '\n')
                independent((ROOT / 'working.sql').read_text(), json.loads((ROOT / 'working.json').read_text()), 'ordinary')
            except AssertionError as error: failure = str(error)
            insist(failure == label, 'wrong-or-missing-fault-reason-' + name)
            result['mutations'].append({'name': name, 'result': 'KILLED', 'reason': failure})
        # This check inventories a known source-level incompatibility. It does not run the trigger.
        insist(len(incompatible_lines(sql)) == 2404, 'lifecycle-original-text-count')
        harmless = sql + '\n-- lifecycle annotation\n'
        insist(incompatible_lines(harmless) == incompatible_lines(sql), 'lifecycle-harmless')
        one_bad = sql.replace("'draft','900.00','900.00'", "'void','900.00','900.00'", 1)
        insist(len(incompatible_lines(one_bad)) == 2405, 'lifecycle-named-fault')
        result['lifecycleControl'] = {'harmless': 'SURVIVED', 'draft-sentinel-to-void': 'DETECTED_ONE_ADDITIONAL_LINE',
                                      'blindCategory': 'Text order/status only. Trigger execution and catalogs untested.'}
        independent(sql, oracle, 'ordinary')
        result['restoredBaseline'] = True
    finally:
        for path, content in working_originals.items(): path.write_bytes(content)
        result['privateWorkingBytesRestoredExact'] = all(path.read_bytes() == content for path, content in working_originals.items())
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in subject.iterdir()}
        result['privateSubjectRestoredExact'] = before == after
        (ROOT / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
        insist(before == after, 'private-subject-bytes-changed')
        insist(result['privateWorkingBytesRestoredExact'], 'private-working-bytes-not-restored')
    print(json.dumps({'cases': len(result['cases']), 'mutations': result['mutations'], 'restored': True}))


if __name__ == '__main__':
    main()
