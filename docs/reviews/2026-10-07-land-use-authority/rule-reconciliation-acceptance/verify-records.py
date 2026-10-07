"""Check recorded synthetic observations without replaying database or HTTP writes."""
import copy
import hashlib
import json
from pathlib import Path


def verify(first, continuation):
    assert first['applicationCommit'] == continuation['applicationCommit'], 'build identity'
    assert first['state'] == 'interrupted' and 'OP409' in first['failure'], 'preserved interruption'
    assert continuation['state'] == 'verified', 'completed continuation'
    assert continuation['membershipChange'] == 'owner restored', 'membership restored'
    observed = first['requests']
    assert len(observed) == 17, 'first request count'
    assert [row['status'] for row in observed] == [201, 200, 200, 201, 200, 403, 403, 403, 403, 409, 409, 200, 201, 200, 200, 200, 409], 'creation and refusal statuses'
    assert len(continuation['requests']) == 13, 'continuation request count'
    assert continuation['requests'][1]['status'] == 403, 'current permission before replay'
    for row in observed + continuation['requests']:
        if row['path'].endswith('/reconcile-rules'):
            assert row['privateNoStore'] is True, 'private reconciliation response'
    assert observed[12]['bodySha256'] == observed[13]['bodySha256'] == observed[15]['bodySha256'], 'exact-byte explicit retry'
    dropped = observed[12]['droppedReply']
    receipt = continuation['observations']['firstReceipt']
    assert dropped['replayed'] is False and receipt['replayed'] is True, 'fresh and replay receipt'
    assert {k: v for k, v in dropped.items() if k != 'replayed'} == {k: v for k, v in receipt.items() if k != 'replayed'}, 'same native result on retry'
    before = continuation['observations']['before']['nodes']
    assert len(before) == 2 and any(row['node_kind'] == 'policy' and row['requirement_key'] == 'locally_defined' for row in before), 'real edited source content'
    for stage in ['afterFirst', 'afterDuplicate', 'final']:
        nodes = continuation['observations'][stage]['nodes']
        assert len(nodes) == len(before) + 1, 'one added section per operation'
        assert len([node for node in nodes if node['node_kind'] == 'section' and node['requirement_key'] == 'locally_defined']) == 1, 'keyed section count'
        for node in before:
            assert next((item for item in nodes if item['id'] == node['id']), None) == node, 'authored content retained'
    assert sorted(row['status'] for row in continuation['observations']['duplicateReplies']) == [201, 409], 'duplicate serialization observed'
    assert sorted(row['status'] for row in continuation['observations']['competingReplies']) == [201, 409], 'competing revision conflict'
    native = continuation['observations']['nativeCommands']
    assert len(native) == 3, 'native command count'
    for row in native:
        assert row['command_text'] in [item['commandText'] for item in continuation['commands']], 'native exact command custody'
        command = json.loads(row['command_text'])
        assert row['command_id'] == command['commandId'], 'native command identity'
        assert row['plan_id'] == continuation['planId'] and row['version_id'] == continuation['versionId'], 'native plan scope'
        assert row['actor_id'] == continuation['actorId'] and row['workspace_id'] == continuation['workspaceId'], 'native actor scope'
        assert row['receipt']['previousDraftRevision'] == command['expectedDraftRevision'], 'native revision binding'


if __name__ == '__main__':
    directory = Path(__file__).resolve().parent
    first = json.loads((directory / 'reconciliation-native-http-private.json').read_text())
    continuation = json.loads((directory / 'reconciliation-native-http-continuation-private.json').read_text())
    verify(first, continuation)
    harmless = copy.deepcopy(continuation)
    harmless['reviewNote'] = 'No behavioral change.'
    verify(first, harmless)
    faults = [
        ('build identity', lambda a, b: b.update(applicationCommit='0' * 40)),
        ('preserved interruption', lambda a, b: a.update(failure='hidden')),
        ('completed continuation', lambda a, b: b.update(state='starting')),
        ('membership restored', lambda a, b: b.update(membershipChange='viewer')),
        ('first request count', lambda a, b: a['requests'].pop()),
        ('creation and refusal statuses', lambda a, b: a['requests'][5].update(status=201)),
        ('continuation request count', lambda a, b: b['requests'].pop()),
        ('current permission before replay', lambda a, b: b['requests'][1].update(status=200)),
        ('private reconciliation response', lambda a, b: a['requests'][12].update(privateNoStore=False)),
        ('exact-byte explicit retry', lambda a, b: a['requests'][13].update(bodySha256='0' * 64)),
        ('fresh and replay receipt', lambda a, b: b['observations']['firstReceipt'].update(replayed=False)),
        ('same native result on retry', lambda a, b: b['observations']['firstReceipt'].update(draftRevision=999)),
        ('real edited source content', lambda a, b: next(n for n in b['observations']['before']['nodes'] if n['node_kind'] == 'policy').update(node_kind='section')),
        ('one added section per operation', lambda a, b: b['observations']['final']['nodes'].pop()),
        ('keyed section count', lambda a, b: next(n for n in b['observations']['final']['nodes'] if n['requirement_key'] == 'locally_defined' and n['node_kind'] == 'section').update(requirement_key='wrong')),
        ('authored content retained', lambda a, b: next(n for n in b['observations']['final']['nodes'] if n['id'] == b['observations']['before']['nodes'][0]['id']).update(body='changed')),
        ('duplicate serialization observed', lambda a, b: b['observations']['duplicateReplies'][1].update(status=201)),
        ('competing revision conflict', lambda a, b: b['observations']['competingReplies'][1].update(status=201)),
        ('native command count', lambda a, b: b['observations']['nativeCommands'].pop()),
        ('native exact command custody', lambda a, b: b['observations']['nativeCommands'][0].update(command_text='{}')),
        ('native command identity', lambda a, b: b['observations']['nativeCommands'][0].update(command_id='wrong')),
        ('native plan scope', lambda a, b: b['observations']['nativeCommands'][0].update(plan_id='wrong')),
        ('native actor scope', lambda a, b: b['observations']['nativeCommands'][0].update(actor_id='wrong')),
        ('native revision binding', lambda a, b: b['observations']['nativeCommands'][0]['receipt'].update(previousDraftRevision=999)),
    ]
    report = {'baseline': 'pass', 'harmless': 'pass', 'faults': [], 'boundary': 'Faults alter recorded observations, not the running product. These controls validate record checking only. Native production behavior comes from the original one-shot runs and existing implementation fault controls.'}
    for name, fault in faults:
        a, b = copy.deepcopy(first), copy.deepcopy(continuation)
        fault(a, b)
        try:
            verify(a, b)
        except AssertionError as error:
            assert str(error) == name, (name, str(error))
            report['faults'].append({'fault': name, 'result': 'detected'})
        else:
            raise AssertionError('Fault survived: ' + name)
    report['sources'] = {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in ['reconciliation-native-http-private.json', 'reconciliation-native-http-continuation-private.json']}
    (directory / 'reconciliation-record-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
