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
from container_peer_gate import pin_bootstrap_peer
from container_identity import ContainerPlan, verify_created_container, verify_bootstrap_container
from dataclasses import replace
from container_creation import ContainerCreation
from container_transport import LocalDocker

BOOTSTRAP = Path(__file__).with_name('container_pidfd_bootstrap.py')
IMAGE = os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE']
WORK = """import subprocess,sys,time
from pathlib import Path
subprocess.Popen([sys.executable,'-c',"import time;from pathlib import Path\\nwhile True: Path('/work/child-heartbeat').write_text(str(time.monotonic()));time.sleep(.03)"], start_new_session=True)
Path('/work/started').touch()
while not Path('/work/release').exists():time.sleep(.03)
"""

WORK_COMPLETION = 'import subprocess,sys;from pathlib import Path;subprocess.Popen([sys.executable,\'-c\',"import time;from pathlib import Path;Path(\'/work/child-heartbeat\').touch()\\nwhile not Path(\'/work/release\').exists():time.sleep(.03)\\nPath(\'/work/child-completed\').touch()"],start_new_session=True);Path(\'/work/parent-completed\').touch()'


def container_logs(container):
    result = subprocess.run(['docker', '--host', 'unix:///run/docker.sock', 'logs', container],
                            capture_output=True, text=True, check=True)
    return result.stdout + result.stderr


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
    creation = client = None
    try:
        image = json.loads(docker('--host', 'unix:///run/docker.sock', 'image', 'inspect', IMAGE))[0]
        client = LocalDocker(Path('/run/docker.sock'))
        daemon_id = client.daemon_id
        plan = ContainerPlan(daemon_id=daemon_id, image_id=image['Id'], request_id=token,
            command=('-B', '/bootstrap.py', 'python', '-c', WORK_COMPLETION if victim == 3 else WORK),
            entrypoint=('python',), environment=tuple(image['Config']['Env']),
            user=f'{os.getuid()}:{os.getgid()}', working_dir='/work', memory_bytes=67108864,
            tasks=16, network='none', mounts=((str(script), '/bootstrap.py', True),
                (str(control), '/control', True), (str(output), '/work', False)))
        creation = ContainerCreation(root / 'custody', plan, client.endpoint_sha256)
        creation.begin_create()
        container = docker('--host', 'unix:///run/docker.sock', 'create', '--label', 'openplan.pidfd-proof=' + token,
            '--label', 'openplan.execution-request=' + token, '--workdir', '/work',
            '--memory', '64m', '--memory-swap', '64m', '--pids-limit', '16', '--cpus', '.25',
            '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', f'{os.getuid()}:{os.getgid()}', '--restart', 'no',
            '--mount', f'type=bind,src={script},dst=/bootstrap.py,readonly',
            '--mount', f'type=bind,src={control},dst=/control,readonly',
            '--mount', f'type=bind,src={output},dst=/work', '--entrypoint', 'python',
            IMAGE, '-B', '/bootstrap.py', 'python', '-c', WORK_COMPLETION if victim == 3 else WORK).strip()
        initial = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
        created_identity = creation.record_created(daemon_id, initial)
        docker('--host', 'unix:///run/docker.sock', 'start', container)
        connection, _ = listener.accept()
        with connection:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            bootstrap_identity = creation.observe_bootstrap(daemon_id, observed)
            assert bootstrap_identity['policy_sha256'] == created_identity['policy_sha256']
            try:
                verify_bootstrap_container(replace(plan, command=('unplanned',)), daemon_id, observed, container)
            except ValueError:
                pass
            else:
                raise AssertionError('Changed bootstrap command was accepted')
            pinned_peer = pin_bootstrap_peer(connection, observed, container, os.getuid())
            os.close(pinned_peer)
            # A live local connector must not receive descriptors intended for
            # the daemon-confirmed bootstrap, even with the same user ID.
            unrelated = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            unrelated.connect(str(control / 'gate.sock'))
            unexpected, _ = listener.accept()
            with unrelated, unexpected:
                try:
                    pin_bootstrap_peer(unexpected, observed, container, os.getuid())
                except ValueError:
                    pass
                else:
                    raise AssertionError('Unrelated socket peer accepted')
            if victim == -1:
                signal.pidfd_send_signal(descriptors[0], signal.SIGKILL)
                processes[0].wait(timeout=3)
            send_descriptors = descriptors[:1] if victim == 5 else descriptors
            invalid = os.open('/dev/null', os.O_RDONLY) if victim == 4 else None
            try:
                if invalid is not None:
                    send_descriptors = [invalid, descriptors[1]]
                connection.sendmsg([b'G'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', send_descriptors))])
            finally:
                if invalid is not None:
                    os.close(invalid)
        deadline = time.monotonic() + 8
        while victim not in (-1, 4, 5) and not (output / 'child-heartbeat').exists():
            if time.monotonic() > deadline:
                raise AssertionError('Workload did not reach child readiness: ' + container_logs(container))
            time.sleep(.03)
        if victim in (0, 1):
            signal.pidfd_send_signal(descriptors[victim], signal.SIGKILL)
            processes[victim].wait(timeout=3)
        elif victim == 2:
            docker('--host', 'unix:///run/docker.sock', 'kill', container)
        if victim == 3:
            time.sleep(.15)
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            assert observed['State']['Running'], 'Detached child killed before release'
            assert (output / 'parent-completed').exists() and not (output / 'child-completed').exists()
            (output / 'release').touch()
        deadline = time.monotonic() + 3
        while True:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            if not observed['State']['Running'] or time.monotonic() > deadline:
                break
            time.sleep(.05)
        if victim in (-1, 4, 5):
            assert observed['State']['Status'] == 'exited' and observed['State']['ExitCode'] == 1, 'Startup rejection did not exit with refusal'
            assert not (output / 'started').exists() and not (output / 'child-heartbeat').exists()
            reason = {-1: 'Owner or controller already exited', 4: 'Non-process descriptor refused', 5: 'Two original live process descriptors required'}[victim]
            assert reason in container_logs(container), 'Wrong startup refusal reason'
        elif victim == 3:
            assert observed['State']['Status'] == 'exited' and observed['State']['Pid'] == 0
            assert observed['State']['ExitCode'] == 0 and (output / 'child-completed').exists()
        elif omit_watch:
            assert observed['State']['Running'], 'Broken watchdog unexpectedly stopped workload'
            before = (output / 'child-heartbeat').read_text()
            time.sleep(.1)
            assert (output / 'child-heartbeat').read_text() != before
        else:
            assert observed['State']['Status'] == 'exited' and observed['State']['Pid'] == 0
            assert observed['State']['ExitCode'] == (137 if victim == 2 else 125)
            before = (output / 'child-heartbeat').read_bytes()
            time.sleep(.1)
            assert (output / 'child-heartbeat').read_bytes() == before
        return {'case': name, 'lost_process': {-1: 'owner-before-start', 0: 'owner', 1: 'controller', 2: 'bootstrap', 3: 'none', 4: 'invalid-descriptor', 5: 'missing-descriptor'}[victim],
                'fault_omitted_watch': omit_watch, 'container_stopped': not observed['State']['Running'],
                'expected_behavior_observed': True, 'bootstrap_peer_verified': True,
                'unrelated_peer_refused': True, 'creation_plan_reverified': True, 'live_creation_receipt_verified': True, 'changed_command_refused': True, 'exit_code': observed['State']['ExitCode'],
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
        if creation is not None:
            creation.close()
        if client is not None:
            client.close()


if __name__ == '__main__':
    root = Path(os.environ['OPENPLAN_CONTAINER_PIDFD_PROOF'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    results = []
    for name, victim, broken, harmless in [('owner-loss',0,False,False), ('controller-loss',1,False,False),
        ('owner-before-start',-1,False,False), ('bootstrap-loss',2,False,False),
        ('detached-completion',3,False,False), ('invalid-descriptor',4,False,False), ('missing-descriptor',5,False,False),
        ('harmless',0,False,True), ('omitted-watch',0,True,False), ('restored',0,False,False)]:
        if os.environ.get('OPENPLAN_PROOF_CASE') and name != os.environ['OPENPLAN_PROOF_CASE']:
            continue
        result = case(root / name, name, victim, broken, harmless)
        results.append(result)
        (root / name / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    report = {'cases': results, 'all_owned_containers_removed': True,
        'source_sha256': hashlib.sha256(BOOTSTRAP.read_bytes()).hexdigest(),
        'peer_gate_sha256': hashlib.sha256(BOOTSTRAP.with_name('container_peer_gate.py').read_bytes()).hexdigest(),
        'limits': ['Synthetic Python work with a detached child in a private Docker PID namespace',
                   'Prototype descriptor delivery is performed by the proof process after live peer verification',
                   'No production startup integration, database admission or native ActivitySim evidence']}
    text = json.dumps(report, indent=2) + '\n'
    (root / 'result.json').write_text(text)
    print(text)
