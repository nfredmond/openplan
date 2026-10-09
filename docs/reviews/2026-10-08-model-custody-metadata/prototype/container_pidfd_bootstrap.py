"""Experimental PID-namespace supervisor; not connected to production execution."""
import array
import os
import select
import socket
import subprocess
import sys


def run():
    if os.getpid() != 1:
        raise ValueError('A private container PID namespace is required')
    channel = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    channel.settimeout(5)
    channel.connect('/control/gate.sock')
    received, ancillary, flags, _ = channel.recvmsg(1, socket.CMSG_SPACE(2 * array.array('i').itemsize))
    descriptors = array.array('i')
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            descriptors.frombytes(data)
    if received != b'G' or flags & socket.MSG_CTRUNC or len(descriptors) != 2:
        raise ValueError('Two original live process descriptors required')
    poller = select.poll()
    for descriptor in descriptors:
        if os.readlink(f'/proc/self/fd/{descriptor}') != 'anon_inode:[pidfd]':
            raise ValueError('Non-process descriptor refused')
        os.set_inheritable(descriptor, False)
        poller.register(descriptor, select.POLLIN)
    if poller.poll(0):
        raise ValueError('Owner or controller already exited')
    child = subprocess.Popen(sys.argv[1:], close_fds=True)
    channel.close()
    while child.poll() is None:
        if poller.poll(20):
            # Exiting PID 1 makes the kernel terminate every remaining process
            # in this private namespace, including detached descendants.
            os._exit(125)
    return child.returncode


if __name__ == '__main__':
    sys.exit(run())
