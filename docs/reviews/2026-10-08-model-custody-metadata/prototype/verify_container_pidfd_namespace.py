"""Measure container-internal owner/controller observation with synthetic work."""
import array
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import uuid

from verify_created_container_identity import docker

BOOTSTRAP = Path(__file__).with_name('container_pidfd_bootstrap.py')
IMAGE = os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE']
WORK = """import subprocess,sys,time
from pathlib import Path
subprocess.Popen([sys.executable,'-c',"import time;from pathlib import Path\\nwhile True: Path('/work/child-heartbeat').write_text(str(time.monotonic()));time.sleep(.03)"], start_new_session=True)
Path('/work/started').touch()
while not Path('/work/release').exists():time.sleep(.03)
"""


def case(root, name, victim, omit_watch=False, harmless=False):
    root.mkdir(mode=0o700)
    output = root / 'output'; output.mkdir()
    control = root / 'control'; control.mkdir()
    script = root / 'bootstrap.py'
    source = BOOTSTRAP.read_text()
    if omit_watch:
        source = source.replace('if poller.poll(20):', 'if False:')
    if harmless:
        source += '\n# Harmless comment in the proof copy.\n'
    script.write_text(source)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(control / 'gate.sock')); listener.listen(1); listener.settimeout(10)
    processes = [subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)']) for _ in range(2)]
    descriptors = [os.pidfd_open(process.pid) for process in processes]
    token = uuid.uuid4().hex
    container = None
    try:
        container = docker('--host', 'unix:///run/docker.sock', 'create', '--label', 'openplan.pidfd-proof=' + token,
            '--memory', '64m', '--memory-swap', '64m', '--pids-limit', '16', '--cpus', '.25',
            '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', f'{os.getuid()}:{os.getgid()}', '--restart', 'no',
            '--mount', f'type=bind,src={script},dst=/bootstrap.py,readonly',
            '--mount', f'type=bind,src={control},dst=/control,readonly',
            '--mount', f'type=bind,src={output},dst=/work', '--entrypoint', 'python',
            IMAGE, '-B', '/bootstrap.py', 'python', '-c', WORK).strip()
        docker('--host', 'unix:///run/docker.sock', 'start', container)
        connection, _ = listener.accept()
        with connection:
            connection.sendmsg([b'G'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', descriptors))])
        deadline = time.monotonic() + 8
        while not (output / 'child-heartbeat').exists():
            if time.monotonic() > deadline:
                raise AssertionError(docker('--host', 'unix:///run/docker.sock', 'logs', container))
            time.sleep(.03)
        signal.pidfd_send_signal(descriptors[victim], signal.SIGKILL)
        processes[victim].wait(timeout=3)
        deadline = time.monotonic() + 3
        while True:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            if not observed['State']['Running'] or time.monotonic() > deadline:
                break
            time.sleep(.05)
        if omit_watch:
            assert observed['State']['Running'], 'Broken watchdog unexpectedly stopped workload'
            before = (output / 'child-heartbeat').read_text()
            time.sleep(.1)
            assert (output / 'child-heartbeat').read_text() != before
        else:
            assert observed['State']['Status'] == 'exited' and observed['State']['Pid'] == 0
            assert observed['State']['ExitCode'] == 125
            before = (output / 'child-heartbeat').read_bytes()
            time.sleep(.1)
            assert (output / 'child-heartbeat').read_bytes() == before
        return {'case': name, 'lost_process': 'owner' if victim == 0 else 'controller',
                'fault_omitted_watch': omit_watch, 'container_stopped': not observed['State']['Running'],
                'expected_behavior_observed': True, 'exit_code': observed['State']['ExitCode'],
                'container_id': container, 'bootstrap_sha256': hashlib.sha256(script.read_bytes()).hexdigest()}
    finally:
        if container:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            assert observed['Id'] == container and observed['Config']['Labels']['openplan.pidfd-proof'] == token
            if observed['State']['Running']:
                docker('--host', 'unix:///run/docker.sock', 'kill', container)
            docker('--host', 'unix:///run/docker.sock', 'rm', container)
        for process, descriptor in zip(processes, descriptors):
            if process.poll() is None:
                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                process.wait(timeout=3)
            os.close(descriptor)
        listener.close()


if __name__ == '__main__':
    root = Path(os.environ['OPENPLAN_CONTAINER_PIDFD_PROOF'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    results = []
    for name, victim, broken, harmless in [('owner-loss',0,False,False), ('controller-loss',1,False,False),
        ('harmless',0,False,True), ('omitted-watch',0,True,False), ('restored',0,False,False)]:
        result = case(root / name, name, victim, broken, harmless)
        results.append(result)
        (root / name / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    report = {'cases': results, 'all_owned_containers_removed': True,
        'source_sha256': hashlib.sha256(BOOTSTRAP.read_bytes()).hexdigest(),
        'limits': ['Synthetic Python work with a detached child in a private Docker PID namespace',
                   'Prototype descriptor delivery is performed by the proof process',
                   'No production startup handshake, peer authentication, database admission or native ActivitySim evidence']}
    text = json.dumps(report, indent=2) + '\n'
    (root / 'result.json').write_text(text)
    print(text)
