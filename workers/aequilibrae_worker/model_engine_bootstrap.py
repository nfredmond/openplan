"""Wait for the owning parent to retain scope identity before executing an engine."""
import json
import os
from pathlib import Path
import socket
import sys


def main():
    descriptor=int(sys.argv[1])
    command=sys.argv[2:]
    if not command:raise ValueError('Engine command missing')
    with socket.socket(fileno=descriptor) as gate:
        gate.settimeout(30)
        ready={'pid':os.getpid(),'cgroup':Path('/proc/self/cgroup').read_text()}
        gate.sendall((json.dumps(ready,separators=(',',':'))+'\n').encode())
        if gate.recv(2)!=b'G':raise RuntimeError('Parent did not authorize engine startup')
    os.execvpe(command[0],command,os.environ)


if __name__=='__main__':main()
