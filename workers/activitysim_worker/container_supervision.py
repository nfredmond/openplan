"""Retained local Docker execution, gated by a private PID-namespace bootstrap.

This controller is not yet wired into runtime.py or database attempt dispatch.
"""
import array
from dataclasses import replace
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

from container_creation import ContainerCreation
from container_identity import ContainerPlan, verify_created_container
from container_peer import pin_bootstrap_peer
from container_transport import LocalDocker, API_VERSION
from model_engine_owner_guard import OwnerGuard


def run_container_command(plan: ContainerPlan, *, socket_path: Path, records: Path,
                          log_path: Path) -> subprocess.CompletedProcess:
    """Execute one caller-owned command; records cannot reconstruct this call."""
    if not isinstance(plan, ContainerPlan) or plan.user != f'{os.getuid()}:{os.getgid()}':
        raise ValueError('Local owner user and explicit container plan required')
    records = Path(records).absolute()
    for source, _, read_only in plan.mounts:
        if not read_only and records.resolve().is_relative_to(Path(source).resolve()):
            raise ValueError('Execution records cannot be inside a writable mount')
    records.mkdir(mode=0o700)
    parent = os.open(records.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    artifact = records / 'bootstrap.py'
    content = Path(__file__).with_name('container_bootstrap.py').read_bytes()
    descriptor = os.open(artifact, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(content); stream.flush(); os.fsync(stream.fileno())
    directory = os.open(records, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    log_path = Path(log_path).absolute()
    log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(log_fd)
    control = Path(tempfile.mkdtemp(prefix='op-gate-'))
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    guard = client = creation = None
    owner_fd = guard_fd = peer_fd = None
    try:
        listener.bind(str(control / 'gate.sock')); listener.listen(1); listener.settimeout(10)
        guard = OwnerGuard()
        owner_fd = os.pidfd_open(os.getpid())
        guard_fd = os.pidfd_open(guard.process.pid)
        client = LocalDocker(socket_path)
        if plan.daemon_id != client.daemon_id:
            raise ValueError('Execution daemon differs from retained plan')
        command = (*plan.entrypoint, *plan.command)
        wrapped = replace(plan, entrypoint=('python',), command=('-B', '/openplan-bootstrap.py', '/openplan-command.log', *command),
            mounts=(*plan.mounts, (str(artifact), '/openplan-bootstrap.py', True),
                    (str(control), '/control', True), (str(log_path), '/openplan-command.log', False)))
        creation = ContainerCreation(records / 'creation', wrapped, client.endpoint_sha256)
        bootstrap_hash = hashlib.sha256(content).hexdigest()
        creation._write('controller.json', {'schema': 'openplan.container-controller.v1',
            'bootstrap_sha256': bootstrap_hash, 'owner_pid': os.getpid(), 'owner_guard': guard.identity,
            'database_status_changed': False})
        identity = client.create_reserved(creation, bootstrap=True)
        container_id = identity['container_id']
        guard.require_alive()
        creation.verify_intent()
        verify_created_container(wrapped, client.daemon_id, client.inspect(container_id))
        creation._write('start-requested.json', {'container_id': container_id, 'intent_sha256': creation.intent_hash})
        client._json('POST', f'/v{API_VERSION}/containers/{container_id}/start', status=204, expected_type=None)
        connection, _ = listener.accept()
        with connection:
            observed = client.inspect(container_id)
            startup = creation.observe_bootstrap(client.daemon_id, observed)
            peer_fd = pin_bootstrap_peer(connection, observed, container_id, os.getuid())
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != bootstrap_hash:
                raise ValueError('Retained bootstrap bytes changed')
            guard.require_alive()
            creation._write('bootstrap-ready.json', {'identity': startup, 'bootstrap_sha256': bootstrap_hash})
            connection.sendmsg([b'G'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [owner_fd, guard_fd]))])
        listener.close()
        while True:
            guard.require_alive()
            observed = client.inspect(container_id)
            if observed.get('Id') != container_id:
                raise ValueError('Container identity changed during execution')
            state = observed.get('State', {})
            if state.get('Running') is False:
                break
            time.sleep(.05)
        if (state.get('Status') != 'exited' or type(state.get('Pid')) is not int or state['Pid'] != 0
                or type(state.get('ExitCode')) is not int or not 0 <= state['ExitCode'] <= 255
                or type(state.get('OOMKilled')) is not bool
                or any(state.get(key) is not False for key in ('Paused', 'Restarting', 'Dead'))):
            raise ValueError('Container exit is unconfirmed')
        creation.verify_intent()
        with log_path.open('rb') as stream:
            log_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
            os.fsync(stream.fileno())
        creation._write('observed-exit.json', {'container_id': container_id, 'returncode': state['ExitCode'],
            'oom_killed': state['OOMKilled'], 'log_sha256': log_hash, 'log_bytes': log_path.stat().st_size,
            'database_status_changed': False})
        client._json('DELETE', f'/v{API_VERSION}/containers/{container_id}', status=204, expected_type=None)
        creation._write('removed.json', {'container_id': container_id, 'removal_acknowledged': True})
        return subprocess.CompletedProcess(list(command), state['ExitCode'])
    finally:
        # Closing the independent guard also cancels work when this call raises
        # while the original Python owner remains alive. PID 1 observes its exit.
        try:
            if guard is not None:
                guard.stop()
        finally:
            for descriptor in (owner_fd, guard_fd, peer_fd):
                if descriptor is not None:
                    os.close(descriptor)
            listener.close()
            if creation is not None:
                creation.close()
            if client is not None:
                client.close()
            shutil.rmtree(control)
