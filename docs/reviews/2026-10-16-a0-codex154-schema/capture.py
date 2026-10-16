"""Capture version-specific schema from a retained CLI with profiles hidden."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import isolation

PACKAGE = Path('/home/nathaniel/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def record(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2); stream.write('\n')
        stream.flush(); os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def command(root, name, arguments):
    args = isolation.offline(PACKAGE, root) + ['/tool/bin/codex'] + arguments
    record(root/(name+'-intent.json'), {'argv':args,'providerGeneration':False})
    start = time.monotonic()
    with (root/(name+'-stdout.bin')).open('xb') as out, (root/(name+'-stderr.bin')).open('xb') as err:
        proc = subprocess.Popen(args, stdout=out, stderr=err, env={'PATH':'/usr/bin:/bin'})
        record(root/(name+'-process.json'), {'pid':proc.pid})
        status = proc.wait(timeout=30)
        out.flush(); os.fsync(out.fileno()); err.flush(); os.fsync(err.fileno())
    result = {'returncode':status,'seconds':time.monotonic()-start,
              'stdoutSHA256':sha(root/(name+'-stdout.bin')),
              'stderrSHA256':sha(root/(name+'-stderr.bin'))}
    record(root/(name+'-exit.json'), result)
    if status != 0: raise RuntimeError('native-command-failed:'+name)
    return result


def main(root):
    os.umask(0o077)
    metadata = json.loads((PACKAGE/'codex-package.json').read_text())
    if metadata.get('version') != '0.154.0' or metadata.get('target') != 'x86_64-unknown-linux-musl' or metadata.get('entrypoint') != 'bin/codex':
        raise ValueError('cached-package-identity')
    before = {'binarySHA256':sha(PACKAGE/'bin/codex'),
              'metadataSHA256':sha(PACKAGE/'codex-package.json')}
    record(root/'package-before.json', before)
    version = command(root, 'version', ['--version'])
    if (root/'version-stdout.bin').read_text().strip() != 'codex-cli 0.154.0':
        raise ValueError('native-version-mismatch')
    command(root, 'schema-help', ['app-server','generate-json-schema','--help'])
    command(root, 'schema', ['app-server','generate-json-schema','--out','/proof/schemas'])
    inventory = {}; total = 0
    for path in sorted((root/'schemas').rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError('schema-output-kind')
        if path.is_file():
            total += path.stat().st_size
            if total > 64*1024**2: raise ValueError('schema-output-byte-bound')
            inventory[str(path.relative_to(root/'schemas'))] = {'bytes':path.stat().st_size,'sha256':sha(path)}
    if not inventory: raise ValueError('schema-output-empty')
    after = {'binarySHA256':sha(PACKAGE/'bin/codex'),
             'metadataSHA256':sha(PACKAGE/'codex-package.json')}
    record(root/'package-after.json', after)
    if before != after: raise ValueError('cached-package-changed')
    group = Path('/sys/fs/cgroup')/next(x.split(':',2)[2].lstrip('/') for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
    resources = {key:(group/key).read_text().strip() for key in ['memory.max','memory.swap.max','memory.peak','memory.events','cpu.max']}
    record(root/'capture-result.json', {'version':'0.154.0','package':before,'schemaFiles':inventory,'bytes':total,
           'resources':resources,'noProviderGeneration':True,'scope':'Version/schema commands in a private network/profile namespace. No native account, model turn or quota observation.'})
    print(json.dumps({'version':'0.154.0','schemaFiles':len(inventory),'bytes':total}))


if __name__ == '__main__': main(Path(sys.argv[1]))
