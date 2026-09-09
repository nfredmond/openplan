"""Choose unused drill ports outside the kernel's outbound ephemeral range."""
from contextlib import ExitStack
from pathlib import Path
import random
import socket

OFFSETS = (1, 2, 0, 3, 4, 7)


def ephemeral_range():
    """Read the Linux range so outbound database/API connections cannot take drill ports."""
    values = Path('/proc/sys/net/ipv4/ip_local_port_range').read_text().split()
    if len(values) != 2:
        raise RuntimeError('Cannot determine ephemeral port range')
    return tuple(map(int, values))


def choose_ports(candidates=None, excluded=(), ephemeral=None):
    """Probe the entire block; never stop or reuse a service that owns one of its ports."""
    low, high = ephemeral if ephemeral is not None else ephemeral_range()
    bases = list(candidates) if candidates is not None else list(range(20000, 32000, 20))
    if candidates is None:
        random.SystemRandom().shuffle(bases)
    for base in bases:
        ports = tuple(base + offset for offset in OFFSETS)
        if any(p in excluded or low <= p <= high or not 1024 <= p <= 65535 for p in ports):
            continue
        try:
            with ExitStack() as held:
                for port in ports:
                    probe = held.enter_context(socket.socket(socket.AF_INET, socket.SOCK_STREAM))
                    probe.bind(('0.0.0.0', port))
                return ports
        except OSError:
            continue
    raise RuntimeError('No unused restore-drill port block is available')


if __name__ == '__main__':
    import sys
    print(' '.join(map(str, choose_ports(excluded=tuple(map(int, sys.argv[1:]))))))
