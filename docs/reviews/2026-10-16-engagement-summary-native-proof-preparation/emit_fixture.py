"""PREPARED ONLY, UNRUN. Stdlib text emitter; never connects or executes SQL.

Requires a future root allocation manifest and separate finite execution grant.
This file does not provide a native controller or establish admission itself.
"""
import argparse
import json
from pathlib import Path
import uuid

CASES = {'ordinary501': (1, 501, '1.01'),
         'maximum90': (2, 90, '999999999999.99'),
         'maximum1001': (3, 1001, '999999999999.99')}
STAMP = '2026-10-16T00:00:00Z'


def ident(case, kind, index=0):
    return f'20261016-0020-400{CASES[case][0]}-8000-{kind:04d}{index:08d}'


def literal(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def insert(table, fields, values):
    return f'INSERT INTO public.{table} ({",".join(fields)}) VALUES (' + ','.join(map(literal, values)) + ');'


def update(invoice, old, fields):
    return ('UPDATE public.client_invoices SET ' + ','.join(k + '=' + literal(v) for k, v in fields.items()) +
            ' WHERE id=' + literal(invoice) + ' AND status=' + literal(old) + ';')


def allocation(manifest):
    # This check refuses unknown inputs. It does not verify a live target or grant.
    target = manifest['target']
    for key in ('clusterSystemId', 'databaseName', 'allocationReceiptSha256'):
        value = target[key]
        if not isinstance(value, str) or not value or any(s in value.upper() for s in ('PENDING', 'UNKNOWN', 'UNALLOCATED')):
            raise ValueError('target-not-allocated:' + key)
    if type(target['databaseOid']) is not int or target['databaseOid'] <= 0:
        raise ValueError('target-not-allocated:databaseOid')
    if target['databaseOid'] in (6072103, 6212363, 6227945) or target.get('exclusiveSynthetic') is not True:
        raise ValueError('target-protected-or-not-exclusive')
    if manifest['sourceCommit'] != 'cddcccde756ec8103175d32a0d9a554ba50bb13c' or manifest['appTree'] != '2b1916349d7379c96bf97b1708b3e4016d37384d':
        raise ValueError('source-binding')
    ids = {k: str(uuid.UUID(manifest[k])) for k in ('workspaceA', 'workspaceB', 'writer')}
    if ids['workspaceA'] == ids['workspaceB']:
        raise ValueError('workspace-distinct')
    return target, ids


def render(manifest, case):
    target, actors = allocation(manifest)
    _, count, amount = CASES[case]
    a, b, writer = (actors[k] for k in ('workspaceA', 'workspaceB', 'writer'))
    sql = ['-- SYNTHETIC. UNEXECUTED. Requires separate target/source/admission checks.',
           'BEGIN;', "SET LOCAL statement_timeout='10s';", "SET LOCAL lock_timeout='3s';",
           "SET LOCAL idle_in_transaction_session_timeout='30s';",
           'DO $identity$ BEGIN IF current_database() <> ' + literal(target['databaseName']) +
           ' OR (SELECT oid FROM pg_database WHERE datname=current_database()) <> ' + str(target['databaseOid']) +
           " THEN RAISE EXCEPTION 'fixture-target-mismatch'; END IF; END $identity$;"]
    # Root supplies authenticated ordinary dual-workspace writer and existing users.
    # No auth users, membership, role, grants, baseline, time or contract source links.
    for n, workspace in ((0, a), (1, a), (2, b)):
        sql.append(insert('projects', ['id', 'workspace_id', 'name', 'created_by'],
                          [ident(case, 1, n), workspace, 'SYNTHETIC SQL20 project', writer]))
        sql.append(insert('invoicing_clients', ['id', 'workspace_id', 'name', 'created_by'],
                          [ident(case, 2, n), workspace, 'SYNTHETIC SQL20 client', writer]))
        sql.append(insert('invoicing_engagements', ['id', 'workspace_id', 'client_id', 'project_id', 'title', 'not_to_exceed_amount', 'created_by'],
                          [ident(case, 3, n), workspace, ident(case, 2, n), ident(case, 1, n),
                           'SYNTHETIC SQL20 engagement', ['10.00', None, '0.00'][n], writer]))
    specs = [(i, 0, 'sent' if i % 2 == 0 else 'paid', amount) for i in range(count)]
    specs += [(count, 0, 'draft', '2.03'), (count + 1, 0, 'void', '900.00'),
              (count + 2, 1, 'sent', '7.77'), (count + 3, 2, 'sent', '8.88')]
    # Reverse emission order makes numeric insertion order an unusable row oracle.
    for i, n, status, gross in reversed(specs):
        sql.append(insert('client_invoices', ['id', 'workspace_id', 'client_id', 'engagement_id', 'project_id',
                          'invoice_number', 'status', 'subtotal_amount', 'retention_percent', 'retention_amount',
                          'total_amount', 'currency_code', 'invoice_date', 'created_at', 'created_by'],
                          [ident(case, 10, i), a if n < 2 else b, ident(case, 2, n), ident(case, 3, n), ident(case, 1, n),
                           f'SYNTHETIC-SQL20-{case}-{i}', 'draft', '0.00', '0.00', '0.00', '0.00',
                           'USD', '2026-10-16', STAMP, writer]))
    for i, _, _, gross in reversed(specs):
        sql.append(insert('client_invoice_line_items', ['id', 'invoice_id', 'position', 'description', 'amount', 'created_at'],
                          [ident(case, 11, i), ident(case, 10, i), '0', 'SYNTHETIC SQL20 line', gross, STAMP]))
    for i, _, status, gross in reversed(specs):
        retained = case == 'ordinary501' and i < count
        sql.append(update(ident(case, 10, i), 'draft', {
            'subtotal_amount': gross, 'retention_percent': '1.00' if retained else '0.00',
            'retention_amount': '0.01' if retained else '0.00', 'total_amount': '1.00' if retained else gross}))
        if status in ('sent', 'paid'):
            sql.append(update(ident(case, 10, i), 'draft', {'status': 'sent', 'sent_date': '2026-10-16'}))
        if status == 'paid':
            sql.append(update(ident(case, 10, i), 'sent', {'status': 'paid', 'paid_date': '2026-10-16'}))
        if status == 'void':
            sql.append(update(ident(case, 10, i), 'draft', {'status': 'void'}))
    sql += ['SELECT txid_current() AS fixture_transaction;', 'COMMIT;']
    return '\n'.join(sql) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allocation', type=Path, required=True)
    parser.add_argument('--case', choices=CASES, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    text = render(json.loads(args.allocation.read_text(encoding='utf-8')), args.case)
    args.out.mkdir(mode=0o700)  # Existing output is a refusal, not an overwrite.
    path = args.out / 'seed.sql'
    with path.open('x', encoding='utf-8') as stream:
        stream.write(text)
    path.chmod(0o600)


if __name__ == '__main__':
    main()
