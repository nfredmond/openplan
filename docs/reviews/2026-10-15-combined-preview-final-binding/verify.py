"""File and synthetic checks only. Live operations remain parent-owned."""
import ast
import base64
import collections
import copy
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch
from urllib.parse import urlsplit

import prepare as prep

sys.path.insert(0, str(prep.ROOT))
import launcher as l
import policy as p
import controls as c
import mutation_controls as m


def require(expected, actual, scope):
    p.exact(expected, actual, scope)


def packet_files():
    return {path.name: path.read_bytes() for path in prep.ROOT.iterdir() if path.is_file()}


def audit(files):
    """Audit bytes through real pinned_files, then check the declared identity delta."""
    get = lambda name: json.loads(files[name])
    with patch.object(l, 'read', side_effect=get), patch.object(l, 'sha', side_effect=lambda path: prep.sha(files[path.name])):
        plan = l.pinned_files()
    for name in prep.NAMES:
        _, expected = prep.template_bytes(name)
        require({'bytes': expected}, {'bytes': files[name]}, 'reviewed-template:' + name)
    require(dict(head=prep.HEAD, root=str(prep.ROOT), purpose=prep.PURPOSE, repository=str(prep.REPO)),
        dict(head=p.HEAD, root=p.ROOT, purpose=p.PURPOSE, repository=l.REPO), 'loaded-identity')
    provenance = get('final-binding-provenance-private.json')
    require(dict(candidate=prep.HEAD, root=str(prep.ROOT), purpose=prep.PURPOSE, repository=str(prep.REPO),
        reviewedCommit=prep.REVIEWED, independentCommit=prep.INDEPENDENT, sourceAnchor=prep.ANCHOR), provenance, 'provenance')
    require({'target': provenance['target'], 'names': provenance['names']}, plan, 'helper-identity')
    old_plan = prep.read(prep.OLD, 'plan-private.json')
    require({'fresh': True}, {'fresh': plan['target'] != old_plan['target'] and
        all(plan['names'][k] != old_plan['names'][k] for k in p.IMAGES)}, 'new-identities')
    old_env, old_app, old_kong, old_acl = [prep.read(prep.OLD, name) for name in [
        'envs-private.json', 'app-env-private.json', 'kong-private.json', 'acl-private.json']]
    env, app, kong, acl = [get(name) for name in ['envs-private.json', 'app-env-private.json', 'kong-private.json', 'acl-private.json']]
    secret = env['rest']['PGRST_JWT_SECRET']
    replacements = {old_plan['target']: plan['target'],
        **{old_plan['names'][k]: plan['names'][k] for k in p.IMAGES},
        old_env['rest']['PGRST_JWT_SECRET']: secret,
        old_app['NEXT_PUBLIC_SUPABASE_ANON_KEY']: app['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
        old_app['SUPABASE_SERVICE_ROLE_KEY']: app['SUPABASE_SERVICE_ROLE_KEY']}

    def transform(value):
        if isinstance(value, dict):
            return {key: transform(item) for key, item in value.items()}
        if isinstance(value, list):
            return [transform(item) for item in value]
        if isinstance(value, str):
            for before, after in replacements.items():
                value = value.replace(before, after)
        return value

    expected_app = transform(old_app)
    expected_app.update(OPENPLAN_COMMIT_SHA=prep.HEAD, OPENPLAN_GTFS_PARSER_BUILD=prep.HEAD)
    for name, expected, actual in [('environments', transform(old_env), env), ('gateway', transform(old_kong), kong),
                                  ('app', expected_app, app), ('acl', transform(old_acl), acl)]:
        require({'value': expected}, {'value': actual}, 'identity-delta:' + name)
    for kind, key in p.URI_KEYS.items():
        old_uri, uri = urlsplit(old_env[kind][key]), urlsplit(env[kind][key])
        require({'credentials': old_uri._replace(path='')}, {'credentials': uri._replace(path='')}, 'engine:' + kind)
        require({'database': '/' + plan['target']}, {'database': uri.path}, 'engine-target:' + kind)
    require({'fresh': True}, {'fresh': secret != old_env['rest']['PGRST_JWT_SECRET']}, 'jwt-secret')
    for key, role in [('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'), ('SUPABASE_SERVICE_ROLE_KEY', 'service_role')]:
        header, payload, signature = app[key].split('.')
        decode = lambda text: base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
        require({'signature': hmac.new(secret.encode(), (header + '.' + payload).encode(), hashlib.sha256).digest()},
            {'signature': decode(signature)}, 'jwt:' + role)
        claims = json.loads(decode(payload))
        require({'role': role, 'issuer': 'supabase', 'future': True, 'fresh': True},
            {'role': claims['role'], 'issuer': claims['iss'], 'future': claims['exp'] > time.time(),
             'fresh': app[key] != old_app[key]}, 'jwt-claims:' + role)
    unchanged = set(prep.read(prep.OLD, 'private-bindings.json')) - {
        'plan-private.json', 'envs-private.json', 'kong-private.json', 'app-env-private.json', 'acl-private.json'}
    for name in sorted(unchanged):
        require({'bytes': (prep.OLD / name).read_bytes()}, {'bytes': files[name]}, 'unchanged:' + name)
    frozen = get('source-binding-private.json')
    p.source_fingerprint(frozen, frozen['snapshot'])
    migrations = get('candidate-migrations.json')
    paths = prep.git('ls-tree', '-r', '--name-only', prep.HEAD, '--', 'openplan/supabase/migrations').decode().splitlines()
    require({'count': 419, 'paths': sorted(migrations)}, {'count': len(paths), 'paths': sorted(paths)}, 'migrations')
    for name, expected in migrations.items():
        require({'sha256': expected}, {'sha256': prep.sha(prep.git('show', prep.HEAD + ':' + name))}, 'migration:' + name)
    for name in ['clone-intent.json', 'services-intent.json', 'build-intent.json', 'preview-start.json',
                 'source-private.dump', 'clone-ready.json', 'service-receipts-private.json']:
        require({'absent': True}, {'absent': name not in files}, 'operational:' + name)
    require({'absent': True}, {'absent': not (prep.ROOT / 'candidate').exists()}, 'operational:candidate')
    return dict(bindingChecks=True, reviewedBehaviorUnchanged=True, all419MigrationBytesMatch=True,
        optionalValuesAndSourceHashUnchanged=True, engineCredentialsUnchanged=True, freshLocalJwtVerified=True,
        sourceAnchorUnchanged=True, operationsAbsent=True)


def challenges(files):
    baseline = audit(files)
    rows = []
    functions = (l.pinned_files, l.checkout, l.main, p.configuration, p.exact)

    def trial(label, mutate, reason=None, rebind=False):
        changed = copy.deepcopy(files)
        mutate(changed)
        if rebind:
            bindings = json.loads(changed['private-bindings.json'])
            changed['private-bindings.json'] = json.dumps({name: prep.sha(changed[name]) for name in bindings}).encode()
        try:
            audit(changed)
        except ValueError as error:
            if reason is None or str(error) != reason:
                raise AssertionError('identity-trial:' + label + ':wrong-reason') from None
            rows.append(dict(mutation=label, outcome='intended_refusal', reason=reason))
        else:
            if reason is not None:
                raise AssertionError('identity-trial:' + label + ':survived')
            rows.append(dict(mutation=label, outcome='survived'))
        require({'audit': baseline}, {'audit': audit(files)}, 'identity-restoration')
        assert functions == (l.pinned_files, l.checkout, l.main, p.configuration, p.exact), 'function-restoration'

    def edit(name, key, value):
        def mutate(data):
            obj = json.loads(data[name]); obj[key] = value
            data[name] = json.dumps(obj).encode()
        return mutate

    trial('harmless-manifest-whitespace', lambda data: data.update({'private-bindings.json':
        json.dumps(json.loads(data['private-bindings.json']), indent=4).encode()}))
    trial('private-manifest-hash', lambda data: data.update({'app-env-private.json': data['app-env-private.json'] + b' '}),
        'files:app-env-private.json')
    for key, value in [('head', prep.PRIOR_HEAD), ('root', str(prep.OLD)), ('source', 'foreign'), ('dbId', 'b' * 64)]:
        trial('plan-' + key, edit('plan-private.json', key, value), 'plan:' + key, True)
    names = json.loads(files['plan-private.json'])['names']
    trial('helper-name-upstream-mismatch', edit('plan-private.json', 'names', {**names, 'rest': 'foreign-helper'}),
        'configuration:upstreams', True)
    trial('foreign-valid-target', edit('plan-private.json', 'target', 'openplan_project_combined_preview_' + 'f' * 24),
        'configuration:endpoints', True)
    trial('app-head', edit('app-env-private.json', 'OPENPLAN_COMMIT_SHA', prep.PRIOR_HEAD), 'configuration:appHead', True)
    trial('source-bytes', lambda data: data.update({'source-binding-private.json': data['source-binding-private.json'] + b' '}),
        'files:source-binding-private.json')
    trial('operational-intent', lambda data: data.update({'clone-intent.json': b'{}'}), 'operational:clone-intent.json:absent')
    for name, before, after in [('launcher.py', str(prep.REPO), '/foreign/repository'),
        ('policy.py', prep.PURPOSE, prep.PRIOR_PURPOSE), ('policy.py', prep.HEAD, prep.PRIOR_HEAD)]:
        def mutate(data, name=name, before=before, after=after):
            data[name] = data[name].replace(before.encode(), after.encode())
        trial('bound-template-' + before.split('/')[-1], mutate, 'files:' + name)

    # Reach the real entry guard. No operational callback runs in this trial.
    with patch.object(l, '__file__', '/foreign/launcher.py'), patch.object(l.sys, 'argv', ['launcher.py', 'check']):
        try:
            l.main()
        except ValueError as error:
            assert str(error) == 'launcher-root:root', 'launcher-root:wrong-reason'
            rows.append(dict(mutation='actual-launcher-root', outcome='intended_refusal', reason=str(error)))
        else:
            raise AssertionError('actual-launcher-root:survived')
    # Reach real checkout argument construction, replacing all effects and files.
    class StopCheckout(Exception):
        pass
    def stop_run(args, **kwargs):
        require({'argv': ['git', '-C', str(prep.REPO), 'worktree', 'add', '--detach',
            str(prep.ROOT / 'candidate'), prep.HEAD]}, {'argv': args}, 'checkout-command')
        raise StopCheckout()
    with patch.object(l, 'pinned_files'), patch.object(l, 'run', side_effect=stop_run):
        try:
            l.checkout()
        except StopCheckout:
            rows.append(dict(mutation='checkout-command-baseline', outcome='survived'))
        with patch.object(l, 'REPO', '/foreign/repository'):
            try:
                l.checkout()
            except ValueError as error:
                assert str(error) == 'checkout-command:argv'
                rows.append(dict(mutation='checkout-repository', outcome='intended_refusal', reason=str(error)))
            else:
                raise AssertionError('checkout-repository:survived')
    require({'audit': baseline}, {'audit': audit(files)}, 'final-restoration')
    require({'files': files}, {'files': packet_files()}, 'file-restoration')
    rows.append(dict(mutation='exact-restoration', outcome='survived'))
    return rows


def run():
    os.umask(0o077)
    files = packet_files()
    result = audit(files)
    result['identityChallenges'] = challenges(files)
    submitted = m.run()
    baseline = c.run()
    old = json.loads((prep.OLD / 'health-mutation-result-private.json').read_bytes())
    require({'rows': old['controls']['controls']}, {'rows': baseline['controls']}, 'all607-rows')
    result.update(controls=dict(total=len(baseline['controls']), outcomes=dict(collections.Counter(
        row['outcome'] for row in baseline['controls'])), exactReviewedRows=True),
        healthMutations=submitted['mutations'], restoration=submitted['restoration'])
    before = json.loads(files['prior-files-before-private.json'])
    require({'inventory': before}, {'inventory': prep.inventory(prep.PRIOR_ROOTS)}, 'prior-custody')
    for path in prep.ROOT.rglob('*'):
        require({'mode': 0o600, 'regular': True}, {'mode': path.stat().st_mode & 0o777,
            'regular': path.is_file() and not path.is_symlink()}, 'private-file:' + path.name)
    require({'mode': 0o700}, {'mode': prep.ROOT.stat().st_mode & 0o777}, 'private-root')
    for name in prep.NAMES:
        ast.parse(files[name])
    result.update(priorPacketsByteModeUnchanged=True, privateModes=True, noBytecode=True, operationallyProved=False)
    prep.write(prep.ROOT, 'final-verification-private.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    run()
