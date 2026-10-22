"""Parent-only, single-use REST replacement. No SQL writes or other helper actions."""
import json
import re
import sys

import rest_uri_recovery_01_launcher as l

p = l.p
OLD_ID = 'cb8cfc278c910f934f495007a85748a740e3b274f977e00e12fe3cc2fa7add16'
RETAINED_NAME = 'openplan-combined-final-rest-64be34b53235-failed-uri-recovery-01'
ENV_FILE = l.RECOVERY / 'rest-v1-private.env'


def projection(info):
    """Bind creation-time inputs and network identity, excluding transient IPs."""
    return {**{k: info[k] for k in ['Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts']},
            'networks': {k: v['NetworkID'] for k, v in info['NetworkSettings']['Networks'].items()}}


def old_check(*, running, renamed):
    baseline = l.read('rest-uri-recovery-01/old-rest-inspect-private.json')
    actual = l.inspect(OLD_ID)
    expected = projection(baseline)
    if renamed:
        expected['Name'] = '/' + RETAINED_NAME
    p.exact(expected, projection(actual), 'retained-rest')
    p.exact({'Running': running, 'StartedAt': baseline['State']['StartedAt'], 'RestartCount': baseline['RestartCount']},
            {**actual['State'], 'RestartCount': actual['RestartCount']}, 'retained-rest-state')
    return actual


def create_args(receipt):
    args = ['docker', 'create', '--pull', 'never', '--name', receipt['name'], '--network', p.NETWORK,
            '--memory', str(p.LIMIT), '--memory-swap', str(p.LIMIT), '--cpus', '0.5',
            '--pids-limit', '128', '--env-file', str(ENV_FILE)]
    for key, value in receipt['labels'].items():
        args += ['--label', key + '=' + value]
    return args + [p.IMAGES['rest']]


def names():
    data = l.run(['docker', 'container', 'ls', '-a', '--no-trunc', '--format', '{{json .}}'])
    rows = [json.loads(line) for line in data.decode().splitlines() if line]
    return {row['Names']: row['ID'] for row in rows}


def collision_check(*, original_present):
    found = names()
    original = l.read('service-receipts-private.json')['rest']['name']
    p.exact({'retained': OLD_ID if not original_present else None,
             'original': OLD_ID if original_present else None},
            {'retained': found.get(RETAINED_NAME), 'original': found.get(original)}, 'recovery-names')


def unchanged_other_helpers():
    receipts = l.read('service-receipts-private.json')
    envs = l.read('envs-private.json')
    for kind in ['auth', 'storage', 'gateway']:
        receipt = receipts[kind]
        p.service(l.expected_service(kind, receipt, envs[kind]), l.observed_service(kind, receipt))
        before = l.read('rest-uri-recovery-01/' + kind + '-inspect-private.json')
        now = l.inspect(receipt['id'])
        p.exact(projection(before), projection(now), 'unchanged-' + kind)
        p.exact({'StartedAt': before['State']['StartedAt'], 'RestartCount': before['RestartCount']},
                {**now['State'], 'RestartCount': now['RestartCount']}, 'unchanged-' + kind + '-state')


def preflight():
    l.pinned_files(); l.db_check(); l.target_check()
    # The existing immutable source guard and prior-helper/Storage guards remain.
    l.source_check(); l.unchanged_inputs()
    receipt = l.read('service-receipts-private.json')['rest']
    p.exact({'id': OLD_ID}, receipt, 'recovery-old-id')
    old_check(running=True, renamed=False)
    p.service(l.expected_service('rest', receipt, l.read('envs-private.json')['rest']),
              l.observed_service('rest', receipt))
    collision_check(original_present=True)
    unchanged_other_helpers()
    return receipt


def allowed_command(argv, receipt, new_id=None):
    """No prefixes, shell commands, DB writes, remove, or global operations."""
    allowed = argv in [['docker', 'stop', '--time', '10', OLD_ID],
                       ['docker', 'rename', OLD_ID, RETAINED_NAME], create_args(receipt)]
    if new_id is not None:
        allowed = allowed or argv == ['docker', 'start', new_id]
        allowed = allowed and bool(re.fullmatch('[0-9a-f]{64}', new_id)) and new_id != OLD_ID
    p.exact({'allowed': True}, {'allowed': allowed}, 'recovery-command')


def mutate(stage, argv, receipt, new_id=None):
    allowed_command(argv, receipt, new_id)
    # Exclusive file exists before the command. Lost acknowledgement never retries.
    l.write(stage + '-intent-private.json', {'argv': argv})
    result = l.run(argv, log=stage + '-private.log')
    l.write(stage + '-ack-private.json', {'stdout': result.decode().strip()})
    return result


def transition():
    receipt = preflight()
    l.write('transition-intent-private.json', {'oldId': OLD_ID, 'retainedName': RETAINED_NAME,
            'target': receipt['database'], 'targetOid': l.read('target-identity.json')['oid']})
    # Recheck after owning the exclusive intent, immediately before touching REST.
    l.pinned_files(); l.target_check(); old_check(running=True, renamed=False)
    collision_check(original_present=True); unchanged_other_helpers()
    mutate('stop', ['docker', 'stop', '--time', '10', OLD_ID], receipt)
    old_check(running=False, renamed=False)
    mutate('rename', ['docker', 'rename', OLD_ID, RETAINED_NAME], receipt)
    old_check(running=False, renamed=True)
    collision_check(original_present=False); l.target_check(); l.pinned_files()
    identity = mutate('create', create_args(receipt), receipt).decode().strip()
    p.exact({'valid': True}, {'valid': bool(re.fullmatch('[0-9a-f]{64}', identity)) and identity != OLD_ID}, 'replacement-id')
    replacement = {**receipt, 'id': identity}
    l.write('replacement-receipt-private.json', replacement)
    # Persist exact ID before any inspection or startup. Start can never use a name.
    env = l.read('rest-uri-recovery-01/envs-v1-private.json')['rest']
    p.created_service(l.expected_service('rest', replacement, env), l.observed_service('rest', replacement))
    old_check(running=False, renamed=True); l.target_check(); l.pinned_files(); unchanged_other_helpers()
    mutate('start', ['docker', 'start', identity], receipt, identity)
    p.service(l.expected_service('rest', replacement, env), l.observed_service('rest', replacement))
    l.write('replacement-started-private.json', {'id': identity, 'running': True})
    active = {**l.read('service-receipts-private.json'), 'rest': replacement}
    l.write('active-service-receipts-private.json', active)
    l.write('active-binding-private.json', {'id': identity, 'receiptSha256': l.sha(l.ACTIVE_RECEIPTS),
            'createdSha256': l.sha(l.RECOVERY / 'replacement-receipt-private.json'),
            'startedSha256': l.sha(l.RECOVERY / 'replacement-started-private.json')})
    # Active selection is identity evidence. Actual HTTP 200 is a separate gate.
    l.active_receipts(); old_check(running=False, renamed=True); unchanged_other_helpers()
    l.source_check(); l.unchanged_inputs()
    print('Replacement ID retained. Run active-check; readiness is not established.')


def main():
    l.os.umask(0o077)
    p.exact({'root': p.ROOT}, {'root': str(l.Path(__file__).resolve().parent)}, 'controller-root')
    operation = sys.argv[1] if len(sys.argv) == 2 else 'refuse'
    try:
        if operation == 'preflight': preflight()
        elif operation == 'transition': transition()
        else: raise ValueError('recovery-disabled:operation')
    except BaseException as error:
        l.write('controller-failure-' + l.secrets.token_hex(6) + '.json',
                {'operation': operation, 'type': type(error).__name__,
                 'reason': str(error) if isinstance(error, ValueError) else 'See private evidence; no retry or cleanup.'})
        print('REFUSED recovery; preserve all intents and inspect before any new plan.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
