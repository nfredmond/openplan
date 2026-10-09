"""Observe original owners and retain command logs inside a private PID namespace."""
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
    log = open(sys.argv[1], 'ab', buffering=0)
    child = subprocess.Popen(sys.argv[2:], close_fds=True, stdout=log, stderr=subprocess.STDOUT)
    log.close()
    channel.close()
    command_code = None
    while True:
        if poller.poll(20):
            # Exiting PID 1 makes the kernel terminate every remaining process
            # in this private namespace, including detached descendants.
            os._exit(125)
        try:
            exited, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            if command_code is None:
                raise RuntimeError('Original command exit status was not observed')
            return command_code if command_code >= 0 else 128 - command_code
        if exited == child.pid:
            command_code = os.waitstatus_to_exitcode(status)
            child.returncode = command_code
        # PID 1 adopts detached descendants. Continue observing the owner and
        # reaping until the kernel confirms no child processes remain.


if __name__ == '__main__':
    sys.exit(run())
