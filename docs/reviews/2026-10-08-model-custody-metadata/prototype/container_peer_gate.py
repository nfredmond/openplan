"""Experimental local Linux/systemd Docker bootstrap peer verification."""
import os
from pathlib import Path
import re
import select
import socket
import struct

# Linux asm-generic/socket.h. Fail closed when this option is unsupported.
SO_PEERPIDFD = 77


def pin_bootstrap_peer(connection, observed, expected_id, expected_uid):
    if not re.fullmatch(r'[0-9a-f]{64}', expected_id) or observed.get('Id') != expected_id:
        raise ValueError('Exact container identity required')
    state = observed.get('State', {})
    pid = state.get('Pid')
    if (type(pid) is not int or pid <= 0 or state.get('Running') is not True
            or state.get('Paused') is not False or state.get('Restarting') is not False):
        raise ValueError('Live bootstrap required')
    descriptor = connection.getsockopt(socket.SOL_SOCKET, SO_PEERPIDFD)
    try:
        os.set_inheritable(descriptor, False)
        credentials = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        info = dict(line.split(':', 1) for line in Path(f'/proc/self/fdinfo/{descriptor}').read_text().splitlines())
        if credentials[0] != pid or credentials[1] != expected_uid or int(info['Pid']) != pid:
            raise ValueError('Socket peer differs from Docker bootstrap')
        if Path(f'/proc/{pid}/cgroup').read_text() != f'0::/system.slice/docker-{expected_id}.scope\n':
            raise ValueError('Bootstrap is outside its declared Docker cgroup')
        poller = select.poll(); poller.register(descriptor, select.POLLIN)
        if poller.poll(0):
            raise ValueError('Bootstrap exited before descriptor delivery')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise
