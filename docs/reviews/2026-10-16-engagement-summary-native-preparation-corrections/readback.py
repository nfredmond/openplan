"""PREPARED ONLY, UNRUN. Independent finite scalar/raw-row receipt reader.

No production/emitter imports. Does not establish receipt provenance or transport.
The future recorder must bind allocation, actor, request, bytes and commit first.
"""
import argparse
import json
from pathlib import Path
import re


def require(condition, name):
    if not condition:
        raise AssertionError(name)


def cents(text):
    require(isinstance(text, str) and re.fullmatch(r'\d+(?:\.\d{1,2})?', text) is not None, 'money-text')
    whole, _, fraction = text.partition('.')
    return int(whole) * 100 + int((fraction + '00')[:2])


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate-json-key')
        result[key] = value
    return result


def decode(path):
    with path.open('rb') as stream:
        raw = stream.read(1048577)
    require(0 < len(raw) <= 1048576, 'body-limit')
    return json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique)


def expected_id(digit, kind, index):
    # Independent spelling, rather than importing the generator's identity helper.
    return '20261016-0020-400' + str(digit) + '-8000-' + str(kind).zfill(4) + str(index).zfill(8)


def scalar(data, oracle, scope):
    case = oracle[scope['case']]
    digit = case['caseDigit']
    first = expected_id(digit, 10, 0)
    exclusion = scope['excludeInvoiceId']
    require(scope['workspaceLabel'] in ('A', 'B'), 'workspace-label')
    require(exclusion in (None, first), 'finite-exclusion')
    require(data['version'] == 1 and type(data['version']) is int, 'version')
    require(data['complete'] is True and data['error'] is None, 'source-complete')
    require(data['workspace_id'] == scope['workspaceId'] and data['engagement_id'] == scope['engagementId'] and
            data['exclude_invoice_id'] == exclusion, 'scope-echo')
    # A workspace has the primary and other-project engagement. B has one.
    indexes = [2] if scope['workspaceLabel'] == 'B' else [0, 1]
    if scope['engagementId'] is not None:
        indexes = [i for i in indexes if expected_id(digit, 3, i) == scope['engagementId']]
    require(bool(indexes), 'requested-visible-identity')
    rows = data['data']
    require(isinstance(rows, list) and len(rows) == len(indexes), 'summary-count')
    found = [row['engagement_id'] for row in rows]
    require(len(set(found)) == len(found), 'duplicate-engagement')
    require(sorted(found) == sorted(expected_id(digit, 3, i) for i in indexes), 'scope-identities')
    for i in indexes:
        row = next(row for row in rows if row['engagement_id'] == expected_id(digit, 3, i))
        ceiling = row['not_to_exceed_amount']
        require((ceiling is None) if i == 1 else cents(ceiling) == (1000 if i == 0 else 0), 'ceiling-zero-absence')
        billed = case['excludedFirstCents'] if exclusion == first else case['billedCents']
        for name, wanted in [('billed', int(billed) if i == 0 else (777 if i == 1 else 888)),
                             ('draft', 203 if i == 0 else 0)]:
            bucket = row[name]
            require(bucket['missing'] == '0' and bucket['invalid'] == '0', 'source-counts')
            require(cents(bucket['amount']) == wanted, 'literal-' + name + '-cents')
    return 'SCALAR_READBACK_MATCH_ONLY'


def fixture_rows(rows, oracle, case_name, actors):
    case = oracle[case_name]
    digit, count = case['caseDigit'], case['eligible']
    require(isinstance(rows, list) and len(rows) == case['rawInvoices'], 'invoice-row-count')
    expected = {expected_id(digit, 10, i) for i in range(count + 4)}
    require(len({r['id'] for r in rows}) == len(rows) and {r['id'] for r in rows} == expected, 'invoice-identities')
    sent, paid = 0, 0
    for i in range(count + 4):
        row = next(r for r in rows if r['id'] == expected_id(digit, 10, i))
        n = 0 if i < count + 2 else i - count - 1
        require(row['workspace_id'] == actors['workspaceA' if n < 2 else 'workspaceB'] and
                row['engagement_id'] == expected_id(digit, 3, n) and row['project_id'] == expected_id(digit, 1, n), 'row-scope')
        state = ('sent' if i % 2 == 0 else 'paid') if i < count else ['draft', 'void', 'sent', 'sent'][i - count]
        require(row['status'] == state, 'row-status')
        wanted = int(case['rowCents']) if i < count else [203, 90000, 777, 888][i - count]
        require(cents(row['subtotal_amount']) == wanted, 'row-gross-cents')
        retained = 1 if case_name == 'ordinary501' and i < count else 0
        require(cents(row['retention_amount']) == retained and cents(row['total_amount']) == wanted - retained, 'row-gross-retention-net')
        require(row['invoice_date'] == '2026-10-16', 'row-calendar-tie')
        if i < count:
            sent += state == 'sent'
            paid += state == 'paid'
    require((sent, paid) == (case['sent'], case['paid']), 'eligible-status-count')
    return 'ROW_READBACK_MATCH_ONLY'


def fixture_lines(rows, oracle, case_name):
    case = oracle[case_name]
    digit, count = case['caseDigit'], case['eligible']
    require(isinstance(rows, list) and len(rows) == count + 4, 'line-row-count')
    expected = {expected_id(digit, 11, i) for i in range(count + 4)}
    require(len({r['id'] for r in rows}) == len(rows) and {r['id'] for r in rows} == expected, 'line-identities')
    for i in range(count + 4):
        row = next(r for r in rows if r['id'] == expected_id(digit, 11, i))
        require(row['invoice_id'] == expected_id(digit, 10, i) and row['position'] == 0, 'line-parent')
        wanted = int(case['rowCents']) if i < count else [203, 90000, 777, 888][i - count]
        require(cents(row['amount']) == wanted, 'line-gross-cents')
        require(row['deliverable_id'] is None and row['milestone_id'] is None, 'no-fabricated-line-link')
    return 'LINE_READBACK_MATCH_ONLY'


def tokens(text):
    pattern = r"NULL|'(?:[^']|'')*'"
    parts = re.findall(pattern, text)
    require(','.join(parts) == text, 'literal-only-grammar')
    return [None if part == 'NULL' else part[1:-1].replace("''", "'") for part in parts]


def seed_text(path, oracle, context):
    # This recognizes only this packet's literal statement grammar, not PostgreSQL.
    with path.open('rb') as stream:
        raw = stream.read(4194305)
    require(0 < len(raw) <= 4194304, 'seed-byte-limit')
    tables = {name: {} for name in ('projects', 'invoicing_clients', 'invoicing_engagements',
                                   'client_invoices', 'client_invoice_line_items')}
    case = oracle[context['case']]
    digit = case['caseDigit']
    for line in raw.decode('utf-8', errors='strict').splitlines():
        if line.startswith('--') or line in ('BEGIN;', 'COMMIT;', 'SELECT txid_current() AS fixture_transaction;'):
            continue
        if line.startswith('SET LOCAL ') or line.startswith('DO $identity$ '):
            continue  # Identity/settings belong to the external admission recorder.
        match = re.fullmatch(r'INSERT INTO public\.(\w+) \(([^)]+)\) VALUES \((.*)\);', line)
        if match:
            table, fields, values = match.groups()
            require(table in tables, 'known-fixture-table')
            names, data = fields.split(','), tokens(values)
            require(len(names) == len(data) and len(set(names)) == len(names), 'insert-projection')
            row = dict(zip(names, data))
            require(row['id'] not in tables[table], 'unique-insert-identity')
            if table == 'client_invoices':
                require(row['status'] == 'draft' and cents(row['subtotal_amount']) == 0 and cents(row['total_amount']) == 0, 'draft-parent-insert')
                require(row['created_at'] == '2026-10-16T00:00:00Z', 'created-at-tie')
            if table == 'client_invoice_line_items':
                parent = tables['client_invoices'].get(row['invoice_id'])
                require(parent is not None and parent['status'] == 'draft', 'line-parent-must-be-draft')
                row['position'] = int(row['position'])
                row['deliverable_id'] = row.get('deliverable_id')
                row['milestone_id'] = row.get('milestone_id')
            tables[table][row['id']] = row
            continue
        match = re.fullmatch(r"UPDATE public\.client_invoices SET (.*) WHERE id='([^']+)' AND status='([^']+)';", line)
        require(match is not None, 'known-fixture-statement')
        assignments, identity, old = match.groups()
        fields = {}
        for item in assignments.split(','):
            name, value = item.split('=', 1)
            require(name not in fields, 'unique-update-field')
            fields[name] = tokens(value)[0]
        row = tables['client_invoices'][identity]
        require(row['status'] == old, 'update-matches-old-status')
        target = fields.get('status', old)
        require(target in {'draft': ('draft', 'sent', 'void'), 'sent': ('paid',)}.get(old, ()), 'legal-status-transition')
        if old != 'draft':
            require(set(fields) <= {'status', 'paid_date'}, 'issued-header-immutable')
        row.update(fields)
        children = [r for r in tables['client_invoice_line_items'].values() if r['invoice_id'] == identity]
        require(len(children) == 1, 'one-line-per-parent')
        require(cents(row['subtotal_amount']) == sum(cents(r['amount']) for r in children), 'draft-header-line-total')
        require(cents(row['total_amount']) + cents(row['retention_amount']) == cents(row['subtotal_amount']), 'header-retention-total')
    fixture_rows(list(tables['client_invoices'].values()), oracle, context['case'], context)
    fixture_lines(list(tables['client_invoice_line_items'].values()), oracle, context['case'])
    for table, kind in [('projects', 1), ('invoicing_clients', 2), ('invoicing_engagements', 3)]:
        require(set(tables[table]) == {expected_id(digit, kind, i) for i in range(3)}, 'parent-identities-' + table)
        for i in range(3):
            row = tables[table][expected_id(digit, kind, i)]
            require(row['workspace_id'] == context['workspaceA' if i < 2 else 'workspaceB'], 'parent-workspace')
            if table == 'invoicing_engagements':
                require(row['client_id'] == expected_id(digit, 2, i) and row['project_id'] == expected_id(digit, 1, i), 'engagement-links')
                require(row['not_to_exceed_amount'] == ['10.00', None, '0.00'][i], 'engagement-ceiling')
    return 'EMITTED_TEXT_MATCH_ONLY_NOT_SQL_ACCEPTANCE'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['scalar', 'rows', 'lines', 'seed'], required=True)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--oracle', type=Path, required=True)
    parser.add_argument('--context', type=Path, required=True)
    args = parser.parse_args()
    oracle, context = decode(args.oracle), decode(args.context)
    if args.mode == 'seed':
        result = seed_text(args.raw, oracle, context)
    elif args.mode == 'scalar':
        result = scalar(decode(args.raw), oracle, context)
    elif args.mode == 'rows':
        result = fixture_rows(decode(args.raw), oracle, context['case'], context)
    else:
        result = fixture_lines(decode(args.raw), oracle, context['case'])
    print(result)


if __name__ == '__main__':
    main()
