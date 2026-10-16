"""Prepare a disk-backed successor; no operating controller or native request."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OLD = Path('/home/nathaniel/.local/state/openplan/pr330-final-source-preview-20261016')
OLD_PUBLIC = Path('/home/nathaniel/.t3/worktrees/openplan/t3-439a9ccf/docs/reviews/2026-10-16-pr330-final-source-preview-preparation')
DURABLE = Path('/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-20261016')
ROOT = '/home/nathaniel/.local/state/openplan/pr330-final-disk-working-20261016'
HEAD = '607ee0895a79457181eda1d2ebbda1de4f2a4d40'
TREE = 'bed283ab0c937ead65378a2e9d26c177ceee6938'
OLD_PACKET_SHA = 'bd5d60d4514c3d4a52b362d11a0b4d0e084bde450e292764d75dc03be8191ebe'
OLD_LIST_SHA = 'c1f30205506fed4d53cf5621772f642b1e7e6b6f95f5608867b33d811fc64c72'
OLD_REVIEW = '0b363901455bb955e9f67395f9fd6a5ed40e3ccd'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def encode(value):
    return json.dumps(value, indent=2) + '\n'


def put(path, data):
    with path.open('xb') as stream:
        stream.write(data.encode() if isinstance(data, str) else data)
        stream.flush(); os.fsync(stream.fileno())
    path.chmod(0o600)


def snapshot(root):
    rows = {}
    for p in [root, *sorted(root.rglob('*'))]:
        name = str(p.relative_to(root))
        mode = p.lstat().st_mode & 0o777
        if p.is_symlink():
            rows[name] = {'mode': mode, 'target': os.readlink(p)}
        elif p.is_dir():
            rows[name] = {'mode': mode, 'kind': 'directory'}
        else:
            require(p.is_file(), 'preservation-special-file')
            rows[name] = {'mode': mode, 'bytes': p.stat().st_size, 'sha256': sha(p)}
    return rows


def main():
    os.umask(0o077)
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO).decode().strip() == HEAD,
            'preparation-head')
    require(subprocess.check_output(['git', 'rev-parse', HEAD+':openplan'], cwd=REPO).decode().strip() == TREE,
            'preparation-app-tree')
    require(not DURABLE.exists() and not DURABLE.is_symlink(), 'private-root-exclusive')
    require(not Path(ROOT).exists() and not Path(ROOT).is_symlink(), 'working-root-exclusive')
    require(sha(OLD/'packet.json') == OLD_PACKET_SHA and sha(OLD/'runtime-inputs.sha256') == OLD_LIST_SHA,
            'accepted-baseline-seals')
    before = snapshot(OLD)
    packet = json.loads((OLD/'packet.json').read_text())
    require(packet['head'] == HEAD and packet['appTree'] == TREE and len(packet['sealed']) == 42,
            'accepted-baseline-identity')
    originals = {}
    for name, expected in packet['sealed'].items():
        path = OLD/'templates'/name
        require(path.is_file() and not path.is_symlink() and
                path.stat().st_mode & 0o777 == expected['mode'] and sha(path) == expected['sha256'],
                'accepted-runtime-seal')
        originals[name] = path.read_bytes()
    DURABLE.mkdir(mode=0o700)
    for name in ['templates', 'records', 'home']:
        (DURABLE/name).mkdir(mode=0o700)
    templates = DURABLE/'templates'
    target = 'openplan_pr330_disk_'+secrets.token_hex(12)
    names = {kind: 'openplan-pr330-disk-20261016-'+kind for kind in packet['names']}
    replacements = [(packet['root'], ROOT), (str(OLD), str(DURABLE)),
        (packet['targetProposal'], target), ('openplan_pr330_final_', 'openplan_pr330_disk_'),
        ('127.74.19.14', '127.74.19.15'), ('29953', '29954'), ('3588', '3589'),
        ('openplan-pr330-final-607ee0895-', 'openplan-pr330-disk-607ee0895-'),
        ('openplan-pr330-final-preserved-web-observer', 'openplan-pr330-disk-preserved-web-observer'),
        ('pr330-final-source-preview-20261016', 'pr330-final-disk-preview-20261016'),
        ('/home/nathaniel/.t3/worktrees/openplan/t3-439a9ccf', str(REPO))]
    replacements += [(packet['names'][kind], names[kind]) for kind in names]

    def rebound(text):
        for old, new in replacements:
            text = text.replace(old, new)
        return text

    generated = {'operation-files.sha256', 'binding-private.json', 'private-bindings.json', 'template-binding.json'}
    mutable = {'plan-private.json', 'acl-private.json', 'envs-private.json', 'app-env-private.json',
        'app-v1.env', 'kong-private.json', 'helper.py', 'policy.py', 'app_binding_v1.py',
        'attest_start_v1.py', 'observer.py', 'observer_transport.py', 'run_stage.sh',
        'journal.py', 'memory_storage.py', 'storage_stage.py'}
    for name, data in originals.items():
        if name not in generated:
            put(templates/name, rebound(data.decode()) if name in mutable else data)

    def rewrite(name, text):
        (templates/name).write_text(text)

    storage = (templates/'memory_storage.py').read_text()
    start = storage.index('def mount_check('); end = storage.index('def inventory(', start)
    block = (HERE/'disk_capacity_block.py').read_text()
    functions = block[block.index('def mount_check('):]
    rewrite('memory_storage.py', storage[:start]+functions+'\n\n'+storage[end:])
    stage = (templates/'storage_stage.py').read_text()
    anchor = "approved.get('capacityAdmitted') is True and"
    require(stage.count(anchor) == 1, 'disk-admission-anchor')
    stage = stage.replace(anchor, anchor + "\n        approved.get('storage')=='disk' and approved.get('capacityModel')=='disk-v1' and\n        approved.get('reviewCommit') not in {j.HEAD,'" + OLD_REVIEW + "'} and")
    rewrite('storage_stage.py', stage)
    # Preserve the old frozen packet too, without rebinding protected paths.
    protected = json.loads(originals['preservation-files.json'])
    for name, row in before.items():
        if 'sha256' in row:
            protected[str(OLD/name)] = {'mode': row['mode'], 'sha256': row['sha256']}
    rewrite('preservation-files.json', encode(protected))
    transport = (templates/'observer_transport.py').read_text().replace(
        hashlib.sha256(originals['observer.py']).hexdigest(), sha(templates/'observer.py'))
    rewrite('observer_transport.py', transport)
    helper = (templates/'helper.py').read_text().replace(
        hashlib.sha256(originals['observer_transport.py']).hexdigest(), sha(templates/'observer_transport.py'))
    rewrite('helper.py', helper)
    app = (templates/'app_binding_v1.py').read_text()
    for name in ['helper.py', 'policy.py']:
        app = app.replace(hashlib.sha256(originals[name]).hexdigest(), sha(templates/name))
    rewrite('app_binding_v1.py', app)
    attestor = (templates/'attest_start_v1.py').read_text().replace(
        hashlib.sha256(originals['app_binding_v1.py']).hexdigest(), sha(templates/'app_binding_v1.py'))
    rewrite('attest_start_v1.py', attestor)
    binding = json.loads(originals['binding-private.json'])
    binding['files'] = {name: sha(templates/name) for name in binding['files']}
    rewrite('binding-private.json', encode(binding))
    private = json.loads(originals['private-bindings.json'])
    rewrite('private-bindings.json', encode({name: sha(templates/name) for name in private}))
    rewrite('template-binding.json', encode({name: sha(templates/name) for name in ['helper.py', 'policy.py']}))
    sealed = {p.name: {'sha256': sha(p), 'mode': p.stat().st_mode & 0o777} for p in sorted(templates.iterdir())}
    put(templates/'operation-files.sha256', ''.join(v['sha256']+'  '+ROOT+'/'+n+'\n' for n, v in sealed.items()))
    sealed['operation-files.sha256'] = {'sha256': sha(templates/'operation-files.sha256'), 'mode': 0o600}
    result = {**packet, 'root': ROOT, 'durable': str(DURABLE), 'targetProposal': target,
        'names': names, 'api': 'http://127.74.19.15:29954', 'web': 'http://127.74.19.15:3589',
        'sealed': sealed, 'storage': 'disk', 'acceptedMemoryReview': OLD_REVIEW,
        'acceptedMemoryPacketSHA256': OLD_PACKET_SHA, 'executionBlocked': True,
        'bindingState': 'disk storage candidate; new independent review and fresh capacity admission required'}
    put(DURABLE/'packet.json', encode(result)); put(HERE/'packet.json', encode(result))
    put(DURABLE/'runtime-inputs.sha256', ''.join(v['sha256']+'  '+str(templates/n)+'\n' for n, v in sealed.items()))
    recipe = rebound((OLD/'parent_recipe.sh').read_text())
    recipe = recipe.replace(OLD_PACKET_SHA, sha(DURABLE/'packet.json')).replace(OLD_LIST_SHA, sha(DURABLE/'runtime-inputs.sha256'))
    put(DURABLE/'parent_recipe.sh', recipe); put(HERE/'parent_recipe.sh', recipe)
    (HERE/'templates').mkdir()
    for name in sorted(mutable):
        if name.endswith('.py') or name.endswith('.sh'):
            text = (templates/name).read_text()
            if name.endswith('.py'):
                ast.parse(text)
            put(HERE/'templates'/name, text)
            put(HERE/(name+'.patch'), ''.join(difflib.unified_diff(originals[name].decode().splitlines(True),
                text.splitlines(True), fromfile='accepted-memory/'+name, tofile='disk/'+name, n=0)))
    after = snapshot(OLD)
    require(before == after, 'old-packet-preservation')
    require(not Path(ROOT).exists() and not (DURABLE/'admission.json').exists() and
            not (DURABLE/'journal').exists(), 'no-runtime-preparation')
    put(DURABLE/'records/old-packet-before.json', encode(before))
    put(DURABLE/'records/old-packet-after.json', encode(after))
    put(HERE/'provenance.json', encode({'oldPacketSHA256': OLD_PACKET_SHA,
        'oldListSHA256': OLD_LIST_SHA, 'oldReview': OLD_REVIEW, 'oldPacketEntriesPreserved': len(before),
        'privateInputs': len(sealed), 'sourceInventoryUnchanged': sha(templates/'source-files.json') == sha(OLD/'templates/source-files.json'),
        'oldRuntimeRootAllocated': Path(packet['root']).exists(), 'newRuntimeRootAllocated': False,
        'operatingStages': 0, 'sourceHead': HEAD, 'appTree': TREE}))
    print(encode({'preparedOnly': True, 'runtimeFiles': len(sealed), 'storage': 'disk', 'operatingStages': 0}))


if __name__ == '__main__':
    main()
