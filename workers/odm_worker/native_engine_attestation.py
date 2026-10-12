"""Observe one original Linux NodeODM container without changing its daemon.

Only the cached native image and explicit launch profile are supported. A match
is not a writer fence, draft-content reconciliation or processing permission.
"""
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import selectors
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from draft_http import Transport as DraftTransport, exact_input, finite_deadline, watch_parent
from engine_effects import encoded, engine_identity, same

IMAGE = 'sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2'
INSPECTION_LIMIT = 1024 * 1024
CONFIGURATION_LIMIT = 64 * 1024
WIRE_LIMIT = 4096
PROFILE = ['-e', "process.umask(0o077);require('/var/www/index.js');", '--', 'native-nodeodm']


def checked_json(raw, limit):
    if not isinstance(raw, bytes) or not raw or len(raw) > limit:
        raise ValueError('Native engine observation byte limit differs')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Native engine observation has duplicate keys')
            result[key] = value
        return result
    def constant(_value):
        raise ValueError('Native engine observation has a nonfinite number')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def process_identity(raw, pid):
    try:
        if not isinstance(raw, bytes) or len(raw) > WIRE_LIMIT:
            raise ValueError()
        head, separator, tail = raw.rpartition(b') ')
        fields = tail.split()
        if not separator or int(head.split(b' (', 1)[0]) != pid or fields[0] in (b'Z', b'X', b'x') or not fields[19].isdigit() or int(fields[19]) <= 0:
            raise ValueError()
        return pid, int(fields[19])
    except (ValueError, IndexError):
        raise ValueError('Native engine process identity differs') from None


def process_configuration(container, *, proc_root='/proc'):
    """Read the regular configuration through the actual running process root."""
    state = container.get('State')
    if not isinstance(state, dict) or state.get('Running') is not True or type(state.get('Pid')) is not int or state['Pid'] <= 0:
        raise ValueError('Native engine process is unavailable')
    pid = state['Pid'];process_fd = root_fd = file_fd = None
    def identity():
        descriptor = os.open('stat', os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=process_fd)
        try:
            return process_identity(os.read(descriptor, WIRE_LIMIT + 1), pid)
        finally:
            os.close(descriptor)
    try:
        process_fd = os.open(str(Path(proc_root) / str(pid)), os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        original = identity()
        root_fd = os.open('root', os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC, dir_fd=process_fd)
        file_fd = os.open('proof-config.json', os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=root_fd)
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= CONFIGURATION_LIMIT:
            raise ValueError('Native engine process configuration is not bounded regular bytes')
        data = bytearray()
        while len(data) <= CONFIGURATION_LIMIT:
            part = os.read(file_fd, min(8192, CONFIGURATION_LIMIT + 1 - len(data)))
            if not part:
                break
            data.extend(part)
        after = os.fstat(file_fd)
        stamp = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(data) != before.st_size or stamp(before) != stamp(after) or identity() != original:
            raise ValueError('Native engine process configuration changed while reading')
        return bytes(data), original
    finally:
        for descriptor in (file_fd, root_fd, process_fd):
            if descriptor is not None:
                os.close(descriptor)


def inspect_projection(value, data):
    """Validate the narrow native launch before hashing its actual configuration."""
    if not isinstance(value, dict) or value.get('Image') != IMAGE:
        raise ValueError('Native engine image is unsupported')
    config, host, mounts = value.get('Config'), value.get('HostConfig'), value.get('Mounts')
    if not isinstance(config, dict) or not isinstance(host, dict) or not isinstance(mounts, list):
        raise ValueError('Native engine launch inspection differs')
    command = config.get('Cmd')
    if config.get('Entrypoint') != ['/usr/bin/node'] or not isinstance(command, list) or len(command) != 6 or command[:4] != PROFILE or command[5] != '--config=/proof-config.json':
        raise ValueError('Native engine launch profile is unsupported')
    match = re.fullmatch(r'--port=([0-9]{1,5})', command[4]) if isinstance(command[4], str) else None
    if match is None or not 1024 <= int(match[1]) <= 65535:
        raise ValueError('Native engine launch port differs')
    environment = config.get('Env')
    if not isinstance(environment, list) or any(not isinstance(item, str) or item.split('=', 1)[0] in {'NODE_OPTIONS', 'NODE_PATH'} for item in environment):
        raise ValueError('Native engine launch environment differs')
    if host.get('ReadonlyRootfs') is not True or host.get('Privileged') is not False or host.get('CapAdd') not in (None, []) or host.get('Devices') not in (None, []) or host.get('PidMode') != '' or host.get('PortBindings') not in (None, {}) or host.get('PublishAllPorts') is not False:
        raise ValueError('Native engine launch isolation differs')
    paths = {}
    for mount in mounts:
        if not isinstance(mount, dict) or mount.get('Type') != 'bind' or type(mount.get('RW')) is not bool:
            raise ValueError('Native engine mount profile is unsupported')
        destination, source = mount.get('Destination'), mount.get('Source')
        if destination not in {'/var/www/tmp', '/var/www/data', '/proof-config.json'} or destination in paths or not isinstance(source, str) or not Path(source).is_absolute():
            raise ValueError('Native engine mount scope differs')
        if mount['RW'] is not (destination != '/proof-config.json'):
            raise ValueError('Native engine mount access differs')
        paths[destination] = source
    if set(paths) != {'/var/www/tmp', '/var/www/data', '/proof-config.json'}:
        raise ValueError('Native engine original mounts are required')
    if checked_json(data, CONFIGURATION_LIMIT) != {'logger': {'logDirectory': '/tmp', 'level': 'error'}}:
        raise ValueError('Native engine configuration profile is unsupported')
    mounts = sorted(mounts, key=lambda mount: mount['Destination'])
    projection = {'format': 'openplan.odm-native-launch.v1', 'Config': config, 'HostConfig': host,
        'Mounts': mounts, 'configurationFile': {'destination': '/proof-config.json',
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}
    return hashlib.sha256(encoded(projection, canonical=True).encode()).hexdigest(), int(match[1])


def observed_identity(engine, container, network, configuration, port):
    state = container.get('State')
    if container.get('Id') != engine['instanceId'] or container.get('Image') != engine['imageId'] or configuration != engine['configurationSha256']:
        raise ValueError('Native engine original identity differs')
    if not isinstance(state, dict) or state.get('Running') is not True or state.get('Paused') is not False or state.get('Restarting') is not False or state.get('Dead') is not False or state.get('Status') != 'running' or type(state.get('Pid')) is not int or state['Pid'] <= 0:
        raise ValueError('Native engine original is not running')
    settings = container.get('NetworkSettings')
    networks = settings.get('Networks') if isinstance(settings, dict) else None
    if not isinstance(networks, dict) or len(networks) != 1 or not isinstance(network, dict):
        raise ValueError('Native engine original network differs')
    attached = next(iter(networks.values()))
    if not isinstance(attached, dict) or network.get('Id') != attached.get('NetworkID') or network.get('Driver') != 'bridge' or network.get('Internal') is not True:
        raise ValueError('Native engine original bridge differs')
    members = network.get('Containers')
    member = members.get(engine['instanceId']) if isinstance(members, dict) else None
    if not isinstance(member, dict) or not isinstance(attached.get('EndpointID'), str) or not attached['EndpointID'] or member.get('EndpointID') != attached['EndpointID']:
        raise ValueError('Native engine original network membership differs')
    try:
        address = ipaddress.IPv4Address(attached['IPAddress'])
        member_address = ipaddress.IPv4Interface(member['IPv4Address']).ip
    except (KeyError, ValueError, TypeError):
        raise ValueError('Native engine original address differs') from None
    endpoint = urlsplit(engine['endpoint'])
    if not address.is_private or address.is_loopback or address.is_unspecified or address.is_multicast or address != member_address or endpoint.scheme != 'http' or endpoint.hostname != str(address) or endpoint.port != port or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment:
        raise ValueError('Native engine original endpoint differs')
    return {'format': 'openplan.odm-native-observation.v1', 'engine': engine,
        'configurationSha256': configuration, 'networkId': network['Id'], 'running': True}


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path, uid, deadline):
        super().__init__('localhost', timeout=max(.001, deadline - time.monotonic()))
        self.path = path;self.uid = uid;self.deadline = deadline

    def connect(self):
        finite_deadline(self.deadline)
        handle = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            handle.settimeout(max(.001, self.deadline - time.monotonic()))
            handle.connect(self.path)
            _pid, uid, _gid = struct.unpack('3i', handle.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != self.uid:
                raise ValueError('Native engine daemon peer differs')
            self.sock = handle
        except BaseException:
            handle.close()
            raise


def daemon_bytes(path, uid, deadline, resource, limit):
    finite_deadline(deadline)
    connection = UnixConnection(path, uid, deadline)
    try:
        connection.request('GET', '/v1.51/' + resource, headers={'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        if response.status != 200 or response.getheader('Content-Encoding') not in (None, 'identity'):
            raise ValueError('Native engine daemon observation is unavailable')
        raw = bytearray()
        while True:
            finite_deadline(deadline)
            part = response.read(min(8192, limit + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
            if len(raw) > limit:
                raise ValueError('Native engine daemon response exceeds its bound')
        finite_deadline(deadline)
        return bytes(raw)
    finally:
        connection.close()


def daemon_get(path, uid, deadline, resource):
    result = checked_json(daemon_bytes(path, uid, deadline, resource, INSPECTION_LIMIT), INSPECTION_LIMIT)
    if not isinstance(result, dict):
        raise ValueError('Native engine daemon response shape differs')
    return result


class Attestor:
    def __init__(self, engine, socket_path, daemon_uid):
        if sys.platform != 'linux' or not isinstance(socket_path, str) or not Path(socket_path).is_absolute() or len(os.fsencode(socket_path)) > 107 or type(daemon_uid) is not int or daemon_uid < 0:
            raise ValueError('Explicit Linux native daemon configuration is required')
        self.engine = engine_identity(engine)
        if not re.fullmatch('[0-9a-f]{64}', self.engine['instanceId']) or self.engine['imageId'] != IMAGE:
            raise ValueError('Native engine original container and supported image are required')
        self.socket_path = socket_path;self.daemon_uid = daemon_uid

    @staticmethod
    def _check(deadline, owned):
        if not callable(owned):
            raise ValueError('Native engine ownership callback is required')
        decision = owned()
        if type(decision) is not bool:
            raise ValueError('Native engine ownership must return a boolean')
        if decision is not True:
            raise InterruptedError('Native engine observation owner ended')
        finite_deadline(deadline)

    def __call__(self, engine, deadline, *, owned):
        self._check(deadline, owned)
        if not same(engine_identity(engine), self.engine):
            raise ValueError('Native engine configured original differs')
        metadata = encoded({'engine': self.engine, 'socketPath': self.socket_path,
            'daemonUid': self.daemon_uid, 'deadline': deadline}).encode()
        if len(metadata) > WIRE_LIMIT:
            raise ValueError('Native engine observer input exceeds its bound')
        self._check(deadline, owned)
        lifetime_read, lifetime_write = os.pipe();process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--child', str(lifetime_read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True,
                pass_fds=(lifetime_read,), bufsize=0, env={k:v for k,v in os.environ.items() if k in {'PATH', 'LANG', 'LC_ALL'}})
            os.close(lifetime_read);lifetime_read = None
            pending = struct.pack('!I', len(metadata)) + metadata;output = bytearray();errors = bytearray()
            with selectors.DefaultSelector() as selector:
                for name, handle, event in [('input', process.stdin, selectors.EVENT_WRITE), ('output', process.stdout, selectors.EVENT_READ), ('error', process.stderr, selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(), False);selector.register(handle, event, name)
                while selector.get_map():
                    self._check(deadline, owned)
                    for key, _event in selector.select(min(.05, max(0, deadline - time.monotonic()))):
                        self._check(deadline, owned)
                        if key.data == 'input':
                            try:
                                written = os.write(key.fd, pending)
                            except BlockingIOError:
                                continue
                            pending = pending[written:]
                            if not pending:
                                selector.unregister(key.fileobj);key.fileobj.close()
                        else:
                            try:
                                data = os.read(key.fd, 8192)
                            except BlockingIOError:
                                continue
                            if not data:
                                selector.unregister(key.fileobj);key.fileobj.close();continue
                            target = output if key.data == 'output' else errors
                            if len(target) + len(data) > WIRE_LIMIT:
                                raise ValueError('Native engine observer output exceeds its bound')
                            target.extend(data)
            self._check(deadline, owned)
            if process.wait(timeout=max(.001, deadline - time.monotonic())) != 0 or errors:
                raise ValueError('Native engine observation refused')
            observation = checked_json(bytes(output), WIRE_LIMIT)
            if not isinstance(observation, dict) or set(observation) != {'format', 'engine', 'configurationSha256', 'networkId', 'running'} or observation['format'] != 'openplan.odm-native-observation.v1' or not same(observation['engine'], self.engine) or observation['configurationSha256'] != self.engine['configurationSha256'] or not isinstance(observation['networkId'], str) or not re.fullmatch('[0-9a-f]{64}', observation['networkId']) or observation['running'] is not True:
                raise ValueError('Native engine observer receipt differs')
            self._check(deadline, owned)
            return True
        finally:
            os.close(lifetime_write)
            if lifetime_read is not None:
                os.close(lifetime_read)
            if process is not None:
                DraftTransport._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if not handle.closed:
                        handle.close()


def child(lifetime):
    threading.Thread(target=watch_parent, args=(lifetime,), daemon=True).start()
    size = struct.unpack('!I', exact_input(4))[0]
    if size > WIRE_LIMIT:
        raise ValueError('Native engine observer input exceeds its bound')
    metadata = checked_json(exact_input(size), WIRE_LIMIT)
    if not isinstance(metadata, dict) or set(metadata) != {'engine', 'socketPath', 'daemonUid', 'deadline'}:
        raise ValueError('Native engine observer input shape differs')
    adapter = Attestor(metadata['engine'], metadata['socketPath'], metadata['daemonUid'])
    engine = adapter.engine;deadline = metadata['deadline']
    finite_deadline(deadline)
    info = os.lstat(metadata['socketPath'])
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != metadata['daemonUid']:
        raise ValueError('Native engine daemon socket differs')
    container = daemon_get(metadata['socketPath'], metadata['daemonUid'], deadline, 'containers/' + engine['instanceId'] + '/json')
    data, process = process_configuration(container)
    configuration, port = inspect_projection(container, data)
    networks = container.get('NetworkSettings', {}).get('Networks')
    if not isinstance(networks, dict) or len(networks) != 1:
        raise ValueError('Native engine original network differs')
    attached = next(iter(networks.values()));network_id = attached.get('NetworkID') if isinstance(attached, dict) else None
    if not isinstance(network_id, str) or not re.fullmatch('[0-9a-f]{64}', network_id):
        raise ValueError('Native engine original network ID differs')
    network = daemon_get(metadata['socketPath'], metadata['daemonUid'], deadline, 'networks/' + network_id)
    finite_deadline(deadline)
    current = daemon_get(metadata['socketPath'], metadata['daemonUid'], deadline, 'containers/' + engine['instanceId'] + '/json')
    data, current_process = process_configuration(current)
    current_configuration, port = inspect_projection(current, data)
    if current_process != process or current_configuration != configuration:
        raise ValueError('Native engine original changed during observation')
    result = observed_identity(engine, current, network, current_configuration, port)
    sys.stdout.buffer.write(encoded(result).encode());sys.stdout.buffer.flush()


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--child':
        raise SystemExit('Native engine observer is an explicit adapter')
    try:
        child(int(sys.argv[2]))
    except Exception:
        print('Native engine observation refused', file=sys.stderr)
        raise SystemExit(1) from None
