import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(name):
    return json.loads((ROOT / name).read_text())


def verify(data):
    records = data['replay']['records']
    assert len(records) == 2, 'exactly two explicit POSTs required'
    first, retry = records
    assert first['status'] == retry['status'] == 200, 'both native saves must succeed'
    assert first['withheld'] is True, 'first committed reply must be withheld'
    assert first['body'] == retry['body'], 'retry command bytes changed'
    assert first['response'] == retry['response'], 'retry receipt changed'
    command = json.loads(first['body'])
    receipt = first['response']
    assert receipt['id'] == command['authorizationId'], 'receipt authorization differs'
    assert receipt['intentText'] == command['intentText'], 'receipt allowance differs'
    assert hashlib.sha256(command['intentText'].encode()).hexdigest() == receipt['intentSha256'], 'allowance hash differs'
    assert data['restored']['postCount'] == 1, 'reload sent an automatic POST'
    assert data['download']['postCount'] == 2, 'preservation or download sent a POST'
    downloads = data['download']['downloads']
    assert len(downloads) == 1, 'one generated recovery Blob required'
    raw = downloads[0]['raw']
    assert len(raw.encode()) == downloads[0]['size'], 'download byte count differs'
    envelope = json.loads(raw)
    assert envelope['command'] == {k: command[k] for k in ('authorizationId', 'intentText')}, 'download command differs'
    for key in ('requestId', 'sourceId', 'sourceSha256', 'requestIntentSha256', 'stage'):
        assert envelope[key] == command[key], f'download scope differs: {key}'
    before = {row['stage']: row for row in data['before']['results']}
    after = {row['stage']: row for row in data['after']['results']}
    assert set(before) == set(after) == {'segment', 'context', 'thematic'}, 'stage inventory incomplete'
    expected_grant = {'id': receipt['id'], 'intent_sha256': receipt['intentSha256']}
    sort = lambda rows: sorted(rows, key=lambda row: json.dumps(row, sort_keys=True))
    for stage in before:
        old, new = before[stage], after[stage]
        assert old['requestId'] == new['requestId'], 'native request identity differs'
        expected = old['grants'] + ([expected_grant] if stage == 'segment' else [])
        assert sort(new['grants']) == sort(expected), f'unexpected native allowance change: {stage}'
        for kind in ('attempts', 'dispatches', 'outputs'):
            assert sort(new[kind]) == sort(old[kind]), f'native execution changed: {stage}/{kind}'
    assert after['segment']['requestId'] == command['requestId'], 'native and browser request differ'
    assert all(after['segment'][key] == [] for key in ('attempts', 'dispatches', 'outputs')), 'target already executed'


data = {
    'replay': load('openplan-execution-browser-00b849-replayed.json'),
    'restored': load('openplan-execution-browser-00b849-restored.json'),
    'download': load('openplan-execution-browser-00b849-download.json'),
    'before': load('openplan-execution-browser-a0-before-custody.json'),
    'after': load('openplan-execution-browser-a0-after-custody.json'),
}
verify(data)
harmless = copy.deepcopy(data)
harmless['after']['results'].reverse()
for row in harmless['after']['results']:
    row['grants'].reverse()
verify(harmless)
mutations = [
    ('changed retry bytes', 'retry command bytes changed', lambda d: d['replay']['records'][1].update(body=d['replay']['records'][1]['body'] + ' ')),
    ('automatic reload save', 'reload sent an automatic POST', lambda d: d['restored'].update(postCount=2)),
    ('duplicate allowance', 'unexpected native allowance change: segment', lambda d: d['after']['results'][0]['grants'].append(copy.deepcopy(d['after']['results'][0]['grants'][0]))),
    ('new execution attempt', 'native execution changed: segment/attempts', lambda d: d['after']['results'][0]['attempts'].append({'id': 'synthetic-unexpected-attempt'})),
    ('changed download command', 'download command differs', lambda d: d['download']['downloads'][0].update(raw=d['download']['downloads'][0]['raw'].replace('11e52d39', '11e52d38'))),
]
controls = []
for name, expected, mutate in mutations:
    broken = copy.deepcopy(data)
    mutate(broken)
    try:
        verify(broken)
    except AssertionError as error:
        assert str(error) == expected, f'{name} failed for an unintended reason: {error}'
        controls.append({'mutation': name, 'failure': str(error)})
    else:
        raise AssertionError(f'mutation survived: {name}')
result = {
    'status': 'pass', 'harmless': 'inventory ordering changes survive', 'mutations': controls,
    'blindCategory': 'Compares captured synthetic native receipts, counts and application-generated Blob bytes. Does not establish independent screenshot correctness, download file delivery, another actor, practitioner acceptance, worker execution or scientific validity.',
}
(ROOT / 'openplan-execution-browser-00b849-evidence-check.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
