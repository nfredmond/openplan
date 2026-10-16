"""UNEXECUTED preparation generator. Emits files only; no transport or SQL execution.

Future: python3 -B generate.py --prerequisites <root UUID manifest> --out <NEW dir>
The prerequisite target and synthetic role fixtures require separate root admission.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid

NAMESPACE = uuid.UUID('d36e75ef-8336-48eb-a71e-7f34993fdce0')
STAMP = '2026-10-16T00:00:00Z'
LITERALS = {
    33: '3299999999999967', 79: '7899999999999921',
    89: '8899999999999911', 90: '8999999999999910',
    101: '10099999999999899', 1001: '100099999999998999',
}


def identity(case, kind, index=0):
    return str(uuid.uuid5(NAMESPACE, f'{case}/{kind}/{index}'))


def quote(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def insert(table, columns, rows):
    return (f'INSERT INTO public.{table} ({",".join(columns)}) VALUES\n' +
            ',\n'.join('(' + ','.join(map(quote, row)) + ')' for row in rows) + ';\n')


def update_invoices(ids, assignments, old_status):
    """Emit bounded ordinary header updates while the retained lifecycle stays active."""
    if not ids:
        return ''
    return ('UPDATE public.client_invoices SET ' +
            ','.join(key + '=' + quote(value) for key, value in assignments.items()) +
            ' WHERE id IN (' + ','.join(map(quote, ids)) + ') AND status=' + quote(old_status) + ';\n')


def finish_invoices(records):
    """Reconcile draft headers after all their lines, then issue through legal states."""
    sql = []
    amounts = {}
    for invoice, amount, _ in records:
        amounts.setdefault(amount, []).append(invoice)
    for amount, ids in amounts.items():
        sql.append(update_invoices(ids, {'subtotal_amount': amount, 'retention_percent': '0.00',
                                        'retention_amount': '0.00', 'total_amount': amount}, 'draft'))
    sql.append(update_invoices([i for i, _, status in records if status in ('sent', 'paid')],
                               {'status': 'sent', 'sent_date': '2026-10-16'}, 'draft'))
    sql.append(update_invoices([i for i, _, status in records if status == 'paid'],
                               {'status': 'paid', 'paid_date': '2026-10-16'}, 'sent'))
    sql.append(update_invoices([i for i, _, status in records if status == 'void'],
                               {'status': 'void'}, 'draft'))
    return ''.join(sql)


def prepare(prerequisites, selected="ordinary"):
    # This manifest contains UUIDs and an exact allocated target name, no credentials.
    values = {k: str(uuid.UUID(prerequisites[k])) for k in
              ('workspaceA', 'workspaceB', 'owner', 'assignee')}
    target = prerequisites['database']
    if not isinstance(target, str) or not target:
        raise ValueError('Root-assigned NEW target identity is required')
    sql = ["-- SYNTHETIC PREPARATION. Review and admit separately before SQL execution.\nBEGIN;\n",
           "SET LOCAL application_name='project-budget-native-synthetic';\n",
           "SET LOCAL statement_timeout='10s';\nSET LOCAL lock_timeout='3s';\n",
           "DO $proof$ BEGIN IF current_database() <> " + quote(target) +
           " THEN RAISE EXCEPTION 'Allocated database mismatch'; END IF; END $proof$;\n",
           "-- Root supplies NEW workspaces, auth users and role memberships beforehand.\n"]
    cases = {}
    specs = dict([('ordinary', 1201)] + [('max-' + str(n), n) for n in LITERALS])
    if selected not in specs:
        raise ValueError('Select one declared finite case')
    for case, count in [(selected, specs[selected])]:
        project = identity(case, 'project')
        client = identity(case, 'client')
        ds = [identity(case, 'deliverable', i) for i in range(count)]
        ss = [identity(case, 'spend', i) for i in range(count)]
        invoices = [identity(case, 'invoice', i) for i in range(count)]
        lines = [identity(case, 'line', i) for i in range(count)]
        maximum = case != 'ordinary'
        amount = '999999999999.99' if maximum else '1.00'
        budget = amount if maximum else '1000.00'
        line_amount = amount if maximum else '2.00'
        sql.append(insert('projects', ['id', 'workspace_id', 'name', 'budget_amount', 'created_by'],
                          [(project, values['workspaceA'], 'SYNTHETIC budget ' + case,
                            None if maximum else '9999.00', values['owner'])]))
        sql.append(insert('invoicing_clients', ['id', 'workspace_id', 'name', 'created_by'],
                          [(client, values['workspaceA'], 'SYNTHETIC client ' + case, values['owner'])]))
        sql.append(insert('project_deliverables', ['id', 'project_id', 'title', 'status',
                         'budget_amount', 'percent_complete', 'assignee_user_id', 'created_at', 'updated_at'],
                         [(ds[i], project, 'SYNTHETIC deliverable', 'in_progress', budget, '50.00',
                           values['assignee'], STAMP, STAMP) for i in range(count)]))
        sql.append(insert('project_spend_entries', ['id', 'project_id', 'deliverable_id',
                         'entry_date', 'amount', 'description', 'created_at'],
                         [(ss[i], project, ds[i], '2026-10-16', amount, 'SYNTHETIC spend', STAMP)
                          for i in range(count)]))
        sql.append(insert('client_invoices', ['id', 'workspace_id', 'client_id', 'project_id',
                         'invoice_number', 'status', 'subtotal_amount', 'total_amount'],
                         [(invoices[i], values['workspaceA'], client, project,
                           'SYNTHETIC-' + case + '-' + str(i), 'draft', '0.00', '0.00')
                          for i in range(count)]))
        line_rows = [(lines[i], invoices[i], ds[i], '0', 'SYNTHETIC line', line_amount)
                     for i in range(count)]
        parent_children = {i: [l] for i, l in zip(invoices, lines)}
        if not maximum:
            for i in range(count):
                line = identity(case, 'extra-line', i)
                line_rows.append((line, invoices[0], ds[-1], str(i + 1), 'SYNTHETIC extra', '3.00'))
                parent_children[invoices[0]].append(line)
        sql.append(insert('client_invoice_line_items', ['id', 'invoice_id', 'deliverable_id',
                         'position', 'description', 'amount'], line_rows))
        sql.append(finish_invoices([(invoices[i], '3605.00' if i == 0 and not maximum else line_amount,
                                     'sent' if i % 2 == 0 else 'paid') for i in range(count)]))
        excluded = []
        if not maximum:
            for kind in ('draft', 'void', 'foreign'):
                invoice = identity(case, kind + '-invoice')
                line = identity(case, kind + '-line')
                other_project = project
                workspace = values['workspaceA']
                if kind == 'foreign':
                    other_project = identity(case, 'foreign-project')
                    workspace = values['workspaceB']
                    sql.append(insert('projects', ['id', 'workspace_id', 'name'],
                                      [(other_project, workspace, 'SYNTHETIC foreign')]))
                # Foreign sentinel uses a B-owned client rather than an inconsistent link.
                sentinel_client = client
                if kind == 'foreign':
                    sentinel_client = identity(case, 'foreign-client')
                    sql.append(insert('invoicing_clients', ['id', 'workspace_id', 'name'],
                                      [(sentinel_client, workspace, 'SYNTHETIC foreign client')]))
                    sql.append(insert('project_deliverables', ['id', 'project_id', 'title', 'status',
                                     'budget_amount', 'percent_complete', 'created_at', 'updated_at'],
                                     [(identity(case, 'foreign-deliverable'), other_project,
                                       'SYNTHETIC foreign deliverable', 'in_progress', '777.77',
                                       '25.00', STAMP, STAMP)]))
                    sql.append(insert('project_spend_entries', ['id', 'project_id', 'deliverable_id',
                                     'entry_date', 'amount', 'description', 'created_at'],
                                     [(identity(case, 'foreign-spend'), other_project,
                                       identity(case, 'foreign-deliverable'), '2026-10-16', '888.88',
                                       'SYNTHETIC foreign spend', STAMP)]))
                sql.append(insert('client_invoices', ['id', 'workspace_id', 'client_id', 'project_id',
                                 'invoice_number', 'status', 'subtotal_amount', 'total_amount'],
                                 [(invoice, workspace, sentinel_client, other_project,
                                   'SYNTHETIC-excluded-' + kind, 'draft', '0.00', '0.00')]))
                sql.append(insert('client_invoice_line_items', ['id', 'invoice_id', 'description', 'amount'],
                                  [(line, invoice, 'SYNTHETIC excluded sentinel', '900.00')]))
                sql.append(finish_invoices([(invoice, '900.00', 'sent' if kind == 'foreign' else kind)]))
                excluded.append({'invoice': invoice, 'line': line, 'reason': kind})
        expected_total = LITERALS[count] if maximum else '120100'
        cases[case] = {
            'project': project, 'deliverables': sorted(ds), 'spendEntries': sorted(ss),
            'invoices': sorted(invoices),
            'linesByInvoice': {i: sorted(parent_children[i]) for i in sorted(invoices)},
            'excluded': excluded, 'count': count, 'lineCount': count if maximum else 2402,
            'cents': {'deliverableBudgetTotal': expected_total if maximum else '120100000',
                      'spendToDate': expected_total, 'actualToDate': expected_total,
                      'billedToDate': expected_total if maximum else '600500',
                      'statedBudget': None if maximum else '999900',
                      'remainingAgainstStatedBudget': None if maximum else '879800'},
            'lastDeliverable': ds[-1],
            'lastDeliverableBilledCents': None if maximum else '360500',
            'maxResponseBytes': 8388608,
            'foreignExclusions': None if maximum else {
                'project': identity(case, 'foreign-project'), 'workspace': values['workspaceB'],
                'deliverables': [identity(case, 'foreign-deliverable')],
                'spendEntries': [identity(case, 'foreign-spend')],
                'deliverableBudgetCents': '77777', 'spendCents': '88888',
                'visibilityRequired': 'same dual A/B ordinary caller can see these rows separately',
            },
        }
    sql.append("SELECT txid_current() AS fixture_transaction;\nCOMMIT;\n")
    return ''.join(sql), {'status': 'PREPARED_NOT_EXECUTED', 'namespace': str(NAMESPACE),
                          'prerequisites': values, 'database': target, 'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prerequisites', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--case', default='ordinary', choices=['ordinary'] + ['max-' + str(n) for n in LITERALS])
    args = parser.parse_args()
    sql, oracle = prepare(json.loads(args.prerequisites.read_text()), args.case)
    args.out.mkdir(mode=0o700)  # Deliberately refuse any existing output directory.
    for name, data in [('seed.sql', sql), ('oracle.json', json.dumps(oracle, indent=2) + '\n')]:
        path = args.out / name
        path.write_text(data)
        path.chmod(0o600)
    (args.out / 'generated-seals.json').write_text(json.dumps({
        p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
        for p in args.out.iterdir()}, indent=2) + '\n')
    (args.out / 'generated-seals.json').chmod(0o600)


if __name__ == '__main__':
    main()
