"""Reconstruct synthetic overlapping OWP cycles without application calculators."""
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import urllib.request


def request(path, body=None):
    key = os.environ['RESTORE_SERVICE_KEY']
    req = urllib.request.Request(os.environ['RESTORE_API_URL'] + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'apikey': key, 'Authorization': 'Bearer '+key,
                 'Content-Type': 'application/json', 'Prefer': 'count=exact'})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.load(response)
        if isinstance(data, list):
            total = response.headers.get('Content-Range', '').split('/')[-1]
            if not total.isdigit() or int(total) != len(data):
                raise ValueError('Incomplete source query; do not reconstruct a truncated ledger')
        return data


def reconstruct(fixture, old, successor, physical):
    expected = fixture['expected']
    assert fixture['synthetic'] is True
    records = old['records']
    original = next(row for row in records if row['id'] == fixture['originalApproval'])
    current = next(row for row in records if row['id'] == fixture['correctedApproval'])
    assert original['state'] == current['state'] == 'approved'
    assert records[-1]['id'] == current['id']
    assert [row['version'] for row in records] == [1, 2, 3, 4, 5]
    assessment = current['content']['assessment']
    initial = original['content']['assessment']
    assert initial['work'][0]['allocations'][0]['amount'] == expected['originalCarryover']
    assert assessment['work'][0]['allocations'][0]['amount'] == expected['currentCarryover']
    mapping = assessment['work'][0]['allocations'][0]
    assert mapping['successorRevisionId'] == fixture['next']['revision']['id']
    assert mapping['successorElementId'] == fixture['next']['element']
    assert mapping['sourceFundId'] == fixture['old']['funds'][0]
    assert mapping['successorFundId'] == fixture['next']['funds'][0]
    assert old['closures'][-1]['kind'] == 'close_period'
    assert old['closures'][-1]['reconciliation_id'] == current['id']
    for data, cycle in [(old, fixture['old']), (successor, fixture['next'])]:
        assert data['source']['report']['snapshot']['baseline']['content_sha256'] == cycle['revision']['content_sha256']
    old_baseline = old['source']['report']['snapshot']['baseline']['content_json']
    next_baseline = successor['source']['report']['snapshot']['baseline']['content_json']
    assert old_baseline['periodStart'] < next_baseline['periodStart'] <= old_baseline['periodEnd'] < next_baseline['periodEnd']
    source_actuals = {row['id']: row for row in old['source']['actuals']}
    row = assessment['claims'][0]
    assert row['claimId'] == fixture['oldClaim']['claimId'] and row['evidence']
    receipt_entries, refund_entries = set(), set()
    for field, entries in [('receipts', receipt_entries), ('refundPayments', refund_entries)]:
        for match in row[field]:
            source = source_actuals[match['actualVersionId']]
            assert source['kind'] == 'payment' and source['status'] == 'approved'
            assert Decimal('0') < Decimal(match['amount']) <= Decimal(str(source['amount']))
            entries.add(source['entry_id'])
    assert receipt_entries.isdisjoint(refund_entries)
    requested = lambda data, claim: Decimal(next(packet for packet in data['source']['reimbursement']['reports'] if packet['id'] == claim['packetId'])['snapshot']['reimbursement']['reimbursementTotal'])
    prior_unpaid = requested(old, fixture['oldClaim']) - sum((Decimal(match['amount']) for match in row['receipts']), Decimal(0))
    new_unpaid = requested(successor, fixture['nextClaim'])
    refund_remaining = Decimal(row['refundDue']) - sum((Decimal(match['amount']) for match in row['refundPayments']), Decimal(0))
    outstanding = Decimal(assessment['commitments'][0]['outstandingAmount'])
    obligation = source_actuals[assessment['commitments'][0]['actualVersionId']]
    assert obligation['kind'] == 'commitment' and Decimal(0) <= outstanding <= Decimal(str(obligation['amount']))
    old_costs = [row for row in old['source']['report']['snapshot']['actuals'] if row['kind'] in ('labor', 'expense') and row['status'] == 'approved']
    new_costs = [row for row in successor['source']['report']['snapshot']['actuals'] if row['kind'] in ('labor', 'expense') and row['status'] == 'approved']
    assert len(old_costs) == len(new_costs) == 1
    assert {row['entry_id'] for row in old_costs}.isdisjoint(row['entry_id'] for row in new_costs)
    incurred = sum((Decimal(str(row['amount'])) for row in old_costs+new_costs), Decimal(0))
    assert len(physical) == expected['physicalEntries']
    assert len({row['entry_id'] for row in physical}) == len(physical)
    assert len({row['source_key'] for row in physical}) == len(physical)
    result = {name: format(value, '.2f') for name, value in [
        ('priorUnpaidClaim', prior_unpaid), ('successorUnpaidClaim', new_unpaid),
        ('refundRemaining', refund_remaining), ('outstandingCommitment', outstanding),
        ('incurredAcrossCycles', incurred)]}
    for name, value in result.items():
        assert value == expected[name], f'{name}: expected {expected[name]}, reconstructed {value}'
    retained = {'old': old, 'successor': successor, 'physical': physical}
    result['retainedRecordsSha256'] = hashlib.sha256(json.dumps(retained, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    result.update({'physicalEntries': len(physical), 'originalApproval': original['id'], 'currentApproval': current['id'],
                   'originalCarryover': expected['originalCarryover'], 'currentCarryover': expected['currentCarryover'],
                   'overlappingCycles': True, 'oldPeriodClosed': True})
    return result


def main(fixture_path, destination):
    fixture = json.loads(Path(fixture_path).read_text())
    def closeout(cycle, period):
        return request('/rest/v1/rpc/read_work_program_closeout', {'p_program_id': cycle['program'],
            'p_actor_id': fixture['owner'], 'p_report_id': period['reportId']})
    old = closeout(fixture['old'], fixture['oldReport'])
    successor = closeout(fixture['next'], fixture['nextReport'])
    old['closures'] = request('/rest/v1/work_program_period_closures?program_id=eq.'+fixture['old']['program']+'&order=version')
    successor['closures'] = request('/rest/v1/work_program_period_closures?program_id=eq.'+fixture['next']['program']+'&order=version')
    programs = ','.join(fixture[cycle]['program'] for cycle in ('old', 'next'))
    physical = request('/rest/v1/work_program_actual_versions?select=id,entry_id,source_key,version,kind,amount&program_id=in.('+programs+')&order=id')
    Path(destination).with_suffix('.inputs.json').write_text(json.dumps({'fixture': fixture, 'old': old, 'successor': successor, 'physical': physical}, sort_keys=True)+'\n')
    result = reconstruct(fixture, old, successor, physical)
    Path(destination).write_text(json.dumps(result, indent=2)+'\n')
    print('[restore-drill] independently reconstructed two cycles, old approvals, unpaid claims, commitment and refund')


if __name__ == '__main__':
    import sys
    main(*sys.argv[1:])
