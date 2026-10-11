"""Preserve the mounted Vault root key for the owned local restore drill."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time


KEY_MOUNT = '/etc/postgresql-custom/pgsodium_root.key'


def inspect_binding(service: dict) -> dict:
    """A recorded container identity must still own this exact regular key file."""
    context = os.environ.get('DOCKER_CONTEXT')
    host = os.environ.get('DOCKER_HOST')
    if context or not host:
        command = ['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']
        if context:
            command.append(context)
        endpoint = subprocess.check_output(command, text=True).strip()
    else:
        endpoint = host
    if not endpoint.startswith('unix://'):
        raise ValueError('Mounted-key transfer requires the local Unix Docker endpoint')
    info = json.loads(subprocess.check_output(['docker', 'inspect', service['name']], text=True))[0]
    if (info['Id'] != service['id'] or info['Image'] != service['imageId']
            or info['Config']['Labels'].get('com.supabase.cli.project') != service['project']
            or service['name'] != 'supabase_db_' + service['project']):
        raise ValueError('Database key container ownership differs')
    mounts = [m for m in info['Mounts'] if m['Destination'] == KEY_MOUNT]
    if len(mounts) != 1 or mounts[0]['Type'] != 'bind' or mounts[0]['RW']:
        raise ValueError('Database key requires one read-only file bind')
    path = Path(mounts[0]['Source'])
    if not path.is_absolute() or path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('Database key bind is not a canonical regular file')
    metadata = path.stat()
    return {'path': str(path), 'device': metadata.st_dev, 'inode': metadata.st_ino,
            'uid': metadata.st_uid, 'gid': metadata.st_gid, 'mode': stat.S_IMODE(metadata.st_mode)}


def binding_matches(recorded: dict, current: dict, incoming: bytes) -> bool:
    if current == recorded:
        return True
    # An atomic replacement may commit before its restart is acknowledged.
    # Accept its new inode only with the exact incoming bytes and other metadata.
    return ({k: v for k, v in current.items() if k != 'inode'}
            == {k: v for k, v in recorded.items() if k != 'inode'}
            and read_key(Path(current['path'])) == incoming)


def read_key(path: Path, private=False) -> bytes:
    metadata = path.lstat()
    if (path.resolve() != path or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size not in (64, 65)):
        raise ValueError('Database root key file is invalid')
    if private and metadata.st_mode & 0o077:
        raise ValueError('Captured database key must be private')
    content = path.read_bytes()
    if not re.fullmatch(rb'[0-9a-fA-F]{64}\n?', content):
        raise ValueError('Database root key bytes are invalid')
    return content


def preserve_key(path: Path, content: bytes):
    if path.exists():
        if read_key(path, private=True) != content:
            raise ValueError('Captured database key differs; original is retained')
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def read_intent(path: Path) -> dict:
    """Read only the private regular intent retained beside the key archives."""
    if (path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode)
            or path.stat().st_mode & 0o077):
        raise ValueError('Database key recovery intent must be private and regular')
    return json.loads(path.read_text())


def require_mounted_bytes(service: dict, expected: bytes):
    """A host path cannot stand in for bytes retained by an existing bind."""
    mounted = subprocess.check_output(['docker', 'exec', service['id'], 'cat', KEY_MOUNT])
    if mounted != expected:
        raise ValueError('Database mounted key differs from captured host bytes')


def prepare_database_key_restore(source: dict, target: dict, destination: Path) -> dict:
    """Capture both keys and a checked intent before changing the fresh target."""
    if destination.resolve() != destination or destination.stat().st_mode & 0o077:
        raise ValueError('Database key custody directory must be canonical and private')
    source_binding = inspect_binding(source)
    target_binding = inspect_binding(target)
    if source['id'] == target['id'] or (source_binding['device'], source_binding['inode']) == (target_binding['device'], target_binding['inode']):
        raise ValueError('Database key target must be independent')
    incoming = read_key(Path(source_binding['path']))
    require_mounted_bytes(source, incoming)
    source_archive = destination / 'database-root-private.key'
    before_archive = destination / 'target-root-before-private.key'
    record_path = destination / 'database-key-custody-private.json'
    preserve_key(source_archive, incoming)
    if record_path.exists():
        record = read_intent(record_path)
        before = read_key(before_archive, private=True)
        if not binding_matches(record['binding'], target_binding, incoming):
            raise ValueError('Database key recovery binding differs')
    else:
        before = read_key(Path(target_binding['path']))
        require_mounted_bytes(target, before)
        preserve_key(before_archive, before)
        record = None
    expected = {'sourceId': source['id'], 'targetId': target['id'], 'targetImageId': target['imageId'],
                'targetName': target['name'], 'targetProject': target['project'],
                'binding': record['binding'] if record is not None else target_binding, 'incomingSha256': hashlib.sha256(incoming).hexdigest(),
                'beforeSha256': hashlib.sha256(before).hexdigest()}
    if record is not None and record != expected:
        raise ValueError('Database key recovery intent differs')
    if record is None:
        with record_path.open('x') as handle:
            os.chmod(record_path, 0o600)
            handle.write(json.dumps(expected, indent=2) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
    directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return expected


def apply_database_key_restore(target: dict, plan: dict, destination: Path) -> dict:
    """Restart only the recorded target so its backend loads the retained key."""
    record_path = destination / 'database-key-custody-private.json'
    if read_intent(record_path) != plan:
        raise ValueError('Database key recovery intent differs')
    incoming = read_key(destination / 'database-root-private.key', private=True)
    before = read_key(destination / 'target-root-before-private.key', private=True)
    if (plan['targetId'] != target['id'] or plan['targetImageId'] != target['imageId']
            or plan['targetName'] != target['name'] or plan['targetProject'] != target['project']
            or hashlib.sha256(incoming).hexdigest() != plan['incomingSha256']
            or hashlib.sha256(before).hexdigest() != plan['beforeSha256']):
        raise ValueError('Database key recovery payload differs')
    binding = inspect_binding(target)
    if not binding_matches(plan['binding'], binding, incoming):
        raise ValueError('Database key target binding changed')
    path = Path(binding['path'])
    if read_key(path) not in (incoming, before):
        raise ValueError('Database key target has unrelated bytes')
    subprocess.run(['docker', 'stop', target['id']], check=True, stdout=subprocess.DEVNULL)
    if inspect_binding(target) != binding:
        raise ValueError('Database key binding changed while stopping')
    if read_key(path) not in (incoming, before):
        raise ValueError('Database key bytes changed while stopping')
    fd, temporary_name = tempfile.mkstemp(prefix='.openplan-restore-key-', dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, 'wb') as handle:
            os.fchown(handle.fileno(), binding['uid'], binding['gid'])
            os.fchmod(handle.fileno(), binding['mode'])
            handle.write(incoming)
            handle.flush()
            os.fsync(handle.fileno())
        if inspect_binding(target) != binding:
            raise ValueError('Database key file identity changed')
        if read_key(path) not in (incoming, before):
            raise ValueError('Database key bytes changed before replacement')
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)
    # Restart creates a new bind mount and loads the replaced file, including
    # after a previous run committed its bytes but lost the restart outcome.
    if read_key(path) != incoming:
        raise ValueError('Database key write is unconfirmed')
    subprocess.run(['docker', 'start', target['id']], check=True, stdout=subprocess.DEVNULL)
    for _ in range(60):
        ready = subprocess.run(['docker', 'exec', target['id'], 'pg_isready', '-h', '/var/run/postgresql', '-U', 'supabase_admin'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            actual = subprocess.check_output(['docker', 'exec', target['id'], 'cat', KEY_MOUNT])
            if actual != incoming:
                raise ValueError('Database mounted key differs after restart')
            return {'archiveFile': 'database-root-private.key', 'captured': True, 'targetRestarted': True,
                    'mountedBytesVerified': True, 'previousTargetKeyRetained': True}
        time.sleep(1)
    raise RuntimeError('Database key target did not become ready after restart')


def recover_target_key(destination: Path) -> dict:
    """Recover only a previously captured disposable target's key restart."""
    if destination.resolve() != destination or destination.stat().st_mode & 0o077:
        raise ValueError('Database key custody directory must be canonical and private')
    plan = read_intent(destination / 'database-key-custody-private.json')
    if not re.fullmatch(r'openplan-restore-target-[0-9]+', plan['targetProject']):
        raise ValueError('Key recovery requires an owned disposable restore target')
    target = {'id': plan['targetId'], 'imageId': plan['targetImageId'],
              'name': plan['targetName'], 'project': plan['targetProject']}
    return apply_database_key_restore(target, plan, destination)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--recover-target-key':
        raise SystemExit('Usage: database_key_custody.py --recover-target-key /private/capture/directory')
    print(json.dumps(recover_target_key(Path(sys.argv[2]))))
