"""Bind reviewed bytes to one new private identity. Never run operational phases."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-6bf6371f')
REPORT = Path(__file__).resolve().parent
HEAD = '06a108010ab39aa42eed4c2bcda3e1371b8aa813'
PRIOR_HEAD = 'b4dbcac21a58f61bd480ccade4dec69383dacbc7'
REVIEWED = 'a72f012ced074cadbfeb8981e2944e056e6373d2'
INDEPENDENT = 'ce93566f4f0daf2234f6ef5424a9f5393e404484'
PRIOR_PURPOSE = 'project-combined-preview-cors-20261015'
PURPOSE = 'project-geography-preview-final-20261015'
BASE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
OLD = BASE / PRIOR_PURPOSE
ROOT = BASE / PURPOSE
TEMPLATE_PATH = 'docs/reviews/2026-10-15-combined-preview-cors-correction/templates/'
NAMES = ['launcher.py', 'policy.py', 'controls.py', 'mutation_controls.py']
ANCHOR = '82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547'
PRIOR_ROOTS = [BASE / name for name in [
    'project-combined-preview-20261015', 'project-combined-preview-configured-20261015',
    PRIOR_PURPOSE, 'stage-a-main323-preview-20261015', 'm3-corrected-main-preview-20261013',
    'm3-joined-preview-20261014', 'm3-main-preview-20261013', 'project-map-integration-20261015']]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])


def read(root, name):
    return json.loads((root / name).read_bytes())


def write(root, name, value):
    with (root / name).open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    (root / name).chmod(0o600)


def inventory(roots):
    """Hash regular bytes, symlink text and modes without following symlinks."""
    result = {}
    for root in roots:
        entries = {}
        for path in [root, *sorted(root.rglob('*'))]:
            mode = path.lstat().st_mode
            row = {'mode': mode & 0o7777}
            if path.is_symlink():
                row.update(kind='symlink', target=os.readlink(path))
            elif path.is_file():
                row.update(kind='file', sha256=sha(path.read_bytes()))
            elif path.is_dir():
                row.update(kind='directory')
            else:
                raise AssertionError('custody:unsupported-file-kind')
            entries[str(path.relative_to(root))] = row
        result[str(root)] = entries
    return result


def template_bytes(name):
    original = git('show', REVIEWED + ':' + TEMPLATE_PATH + name)
    data = original
    if name == 'launcher.py':
        before = b"REPO = '/home/nathaniel/.t3/worktrees/openplan/t3-162825d6'"
        assert data.count(before) == 1, 'template:repository-anchor'
        data = data.replace(before, ('REPO = ' + repr(str(REPO))).encode())
    if name == 'policy.py':
        for before, after in [(PRIOR_HEAD, HEAD), (PRIOR_PURPOSE, PURPOSE)]:
            assert data.count(before.encode()) == 1, 'template:identity-anchor'
            data = data.replace(before.encode(), after.encode())
    return original, data


def token(secret, role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
    now = int(time.time())
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
        'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 7 * 86400})
    return body + '.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip('=')


def prepare():
    os.umask(0o077)
    assert git('rev-parse', 'HEAD').decode().strip() == HEAD, 'assigned:head'
    # Only the owned new public folder may be untracked during preparation.
    status = git('status', '--porcelain', '--untracked-files=all').decode().splitlines()
    assert all(row[3:].startswith(str(REPORT.relative_to(REPO)) + '/') for row in status), 'assigned:scope'
    private_bindings = read(OLD, 'private-bindings.json')
    for name, expected in private_bindings.items():
        assert sha((OLD / name).read_bytes()) == expected, 'reviewed-private:' + name
    for name, expected in read(OLD, 'template-binding.json').items():
        assert sha((OLD / name).read_bytes()) == expected, 'reviewed-template:' + name
        assert (OLD / name).read_bytes() == git('show', REVIEWED + ':' + TEMPLATE_PATH + name), 'reviewed-git:' + name
    migration_binding = (OLD / 'candidate-migrations.json').read_bytes()
    migrations = json.loads(migration_binding)
    paths = git('ls-tree', '-r', '--name-only', HEAD, '--', 'openplan/supabase/migrations').decode().splitlines()
    assert len(paths) == len(migrations) == 419 and set(paths) == set(migrations), 'migrations:set'
    assert all(sha(git('show', HEAD + ':' + path)) == expected for path, expected in migrations.items()), 'migrations:bytes'
    frozen = read(OLD, 'source-binding-private.json')
    assert frozen['sha256'] == ANCHOR, 'source:anchor'
    before = inventory(PRIOR_ROOTS)
    ROOT.mkdir(mode=0o700, exist_ok=False)
    write(ROOT, 'prior-files-before-private.json', before)
    for name in private_bindings:
        with (ROOT / name).open('xb') as stream:
            stream.write((OLD / name).read_bytes())
        (ROOT / name).chmod(0o600)
    for name in NAMES:
        _, data = template_bytes(name)
        with (ROOT / name).open('xb') as stream:
            stream.write(data)
        (ROOT / name).chmod(0o600)
        (REPORT / 'templates' / name).write_bytes(data)
    plan = read(ROOT, 'plan-private.json')
    old_target, old_names = plan['target'], plan['names']
    target = 'openplan_project_combined_preview_' + secrets.token_hex(12)
    names = {kind: 'openplan-combined-final-' + kind + '-' + secrets.token_hex(6) for kind in old_names}
    plan.update(head=HEAD, root=str(ROOT), target=target, names=names)
    envs, kong, app, acl = [read(ROOT, name) for name in ['envs-private.json', 'kong-private.json', 'app-env-private.json', 'acl-private.json']]
    secret = secrets.token_hex(32)
    anon, service = token(secret, 'anon'), token(secret, 'service_role')
    replacements = {old_target: target, **{old_names[k]: names[k] for k in names},
        envs['rest']['PGRST_JWT_SECRET']: secret,
        app['NEXT_PUBLIC_SUPABASE_ANON_KEY']: anon, app['SUPABASE_SERVICE_ROLE_KEY']: service}

    def replace(value):
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        if isinstance(value, list):
            return [replace(item) for item in value]
        if isinstance(value, str):
            for before_value, after_value in replacements.items():
                value = value.replace(before_value, after_value)
        return value

    app = replace(app)
    app.update(OPENPLAN_COMMIT_SHA=HEAD, OPENPLAN_GTFS_PARSER_BUILD=HEAD)
    for name, value in [('plan-private.json', plan), ('envs-private.json', replace(envs)),
                        ('kong-private.json', replace(kong)), ('app-env-private.json', app),
                        ('acl-private.json', replace(acl))]:
        # These five files are new owned copies. Earlier packets remain untouched.
        (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')
    provenance = dict(reviewedCommit=REVIEWED, independentCommit=INDEPENDENT, candidate=HEAD,
        repository=str(REPO), purpose=PURPOSE, root=str(ROOT), priorRoot=str(OLD),
        priorPrivateManifestSha256=sha((OLD / 'private-bindings.json').read_bytes()),
        target=target, names=names, sourceAnchor=ANCHOR,
        migrationBindingSha256=sha(migration_binding), all419MigrationBytesMatch=True,
        localJwtApiKeysFresh=True, noOperationalPhaseExecuted=True)
    write(ROOT, 'final-binding-provenance-private.json', provenance)
    write(ROOT, 'template-binding.json', {name: sha((ROOT / name).read_bytes()) for name in NAMES})
    new_bindings = {name: sha((ROOT / name).read_bytes()) for name in [
        *private_bindings, 'prior-files-before-private.json', 'final-binding-provenance-private.json']}
    write(ROOT, 'private-bindings.json', new_bindings)
    assert inventory(PRIOR_ROOTS) == before, 'custody:preparation'
    print('New identity packet prepared; 419 migration files match. No operational phase executed.')


if __name__ == '__main__':
    prepare()
