"""Compare retained observations; this cannot establish rendering or human acceptance."""
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def check(records):
    original = records['lost-reply']['posts'][-1]
    replay = records['replayed']['posts']
    assert len(replay) == 1 and replay[0]['body'] == original['body'], 'retry body differs'
    assert original['status'] == replay[0]['status'] == 200, 'permission reply failed'
    assert original['response'] == replay[0]['response'], 'original receipt differs'
    receipt = original['response']
    assert hashlib.sha256(receipt['intentText'].encode()).hexdigest() == receipt['intentSha256'], 'intent hash differs'
    assert records['restored-before-retry']['posts'] == [], 'automatic recovery POST'
    before = records['before-custody']['results']
    after = records['after-custody']['results']
    assert len(before) == len(after) == 3, 'missing stage inventory'
    root = next(row for row in after if row['stage'] == 'segment')
    old_root = next(row for row in before if row['stage'] == 'segment')
    assert all(old_root[key] == [] for key in ['grants', 'attempts', 'dispatches', 'outputs']), 'dirty baseline'
    assert root['requestId'] == receipt['requestId'], 'wrong request'
    assert root['grants'] == [{'id': receipt['id'], 'intent_sha256': receipt['intentSha256']}], 'duplicate or different authority'
    assert [len(root[key]) for key in ['attempts', 'dispatches', 'outputs']] == [4, 4, 4], 'incomplete execution'
    assert {a['task_index'] for a in root['attempts']} == {0, 1, 2, 3}, 'task coverage differs'
    attempt_ids = {a['id'] for a in root['attempts']}
    assert all(a['authorization_id'] == receipt['id'] for a in root['attempts']), 'different authority used'
    assert {a['attempt_id'] for a in root['dispatches']} == attempt_ids, 'dispatch custody differs'
    assert {a['attempt_id'] for a in root['outputs']} == attempt_ids, 'output custody differs'
    normalize = lambda rows: sorted(rows, key=lambda row: row['stage'])
    assert normalize(after) == normalize(records['restart-custody']['results']), 'worker restart changes custody'
    assert normalize(after) == normalize(records['after-browser-replay-custody']['results']), 'browser replay changes custody'
    assert normalize([r for r in before if r['stage'] != 'segment']) == normalize([r for r in after if r['stage'] != 'segment']), 'historical stages changed'
    assert records['restart-provider-requests']['requests'] == [], 'restart contacts provider'
    calls = records['provider-calls']['calls']
    summary = records['verified-output-summary']
    assert len(calls) == 4 and {c['taskSha256'] for c in calls} == {e['taskSha256'] for e in summary['entries']}, 'provider task coverage differs'
    assert len(summary['entries']) == 4 and all(e['disposition'] == 'validated_output' for e in summary['entries']), 'output not validated'
    assert summary['inventory']['status'] == 'ready_for_record_consolidation' and summary['inventory']['interpretation'] == 'not_assessed', 'interpretation promoted'
    mobile = records['mobile-reload']
    assert mobile['restored'] and mobile['width'] == mobile['documentWidth'] == 390, 'mobile restoration differs'
    assert 0 <= mobile['retry']['left'] < mobile['retry']['right'] <= 390, 'mobile retry clipped'


if __name__ == '__main__':
    names = ['lost-reply', 'replayed', 'restored-before-retry', 'before-custody', 'after-custody',
             'restart-custody', 'after-browser-replay-custody', 'restart-provider-requests',
             'provider-calls', 'verified-output-summary', 'mobile-reload']
    data = {name: json.loads((ROOT / f'{name}.json').read_text()) for name in names}
    check(data)
    harmless = copy.deepcopy(data)
    harmless['after-custody']['results'].reverse()
    check(harmless)
    mutations = [
        ('changed retry', 'retry body differs', lambda d: d['replayed']['posts'][0].update(body='{}')),
        ('automatic resend', 'automatic recovery POST', lambda d: d['restored-before-retry']['posts'].append({})),
        ('duplicate authority', 'duplicate or different authority', lambda d: d['after-custody']['results'][0]['grants'].append({})),
        ('missing output', 'incomplete execution', lambda d: d['after-custody']['results'][0]['outputs'].pop()),
        ('repeated request', 'restart contacts provider', lambda d: d['restart-provider-requests']['requests'].append({'method': 'POST'})),
        ('promoted meaning', 'interpretation promoted', lambda d: d['verified-output-summary']['inventory'].update(interpretation='accepted')),
        ('clipped retry', 'mobile retry clipped', lambda d: d['mobile-reload']['retry'].update(right=535)),
    ]
    outcomes = []
    for name, reason, mutate in mutations:
        broken = copy.deepcopy(data)
        mutate(broken)
        try:
            check(broken)
        except AssertionError as failure:
            assert str(failure) == reason, f'{name}: unexpected failure {failure}'
            outcomes.append({'mutation': name, 'rejected': True, 'reason': reason})
        else:
            raise AssertionError(f'{name}: fault survived')
    print(json.dumps({'baseline': 'pass', 'harmless_reordering': 'pass', 'mutations': outcomes,
                      'blind_category': 'No independent rendering, access policy, semantics or human acceptance.'}, indent=2))
