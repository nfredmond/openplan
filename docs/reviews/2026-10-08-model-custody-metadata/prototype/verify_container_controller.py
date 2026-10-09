"""Run the worker controller with actual owner loss and retained command logs."""
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

from verify_created_container_identity import ROOT, docker
sys.path.insert(0, str(ROOT / 'workers/activitysim_worker'))
from container_identity import ContainerPlan
from container_supervision import run_container_command
from container_transport import LocalDocker

IMAGE = os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE']
WORK = """import subprocess,sys,time
from pathlib import Path
print('command entered', flush=True)
subprocess.Popen([sys.executable,'-c',"import time;from pathlib import Path;Path('/work/child-ready').touch()\\nwhile not Path('/work/release').exists():time.sleep(.03)\\nPath('/work/child-completed').touch()"], start_new_session=True)
Path('/work/parent-completed').touch()
"""


def child(root):
    image = json.loads(docker('--host', 'unix:///run/docker.sock', 'image', 'inspect', IMAGE))[0]
    with LocalDocker(Path('/run/docker.sock')) as client:
        daemon = client.daemon_id
    plan = ContainerPlan(daemon_id=daemon, image_id=image['Id'], request_id=uuid.uuid4().hex,
        command=('python', '-c', WORK), entrypoint=(), environment=tuple(image['Config']['Env']),
        user=f'{os.getuid()}:{os.getgid()}', working_dir='/work', memory_bytes=67108864,
        tasks=16, network='none', mounts=((str(root / 'output'), '/work', False),))
    connections = []
    if root.name in ('changed-artifact', 'wrong-peer'):
        original_create = LocalDocker.create_reserved
        def inject(client, creation, **kwargs):
            result = original_create(client, creation, **kwargs)
            if root.name == 'changed-artifact':
                artifact = root / 'records/bootstrap.py'
                artifact.chmod(0o600)
                artifact.write_bytes(artifact.read_bytes() + b'\n# Changed after creation.\n')
            else:
                source = next(source for source, target, _ in creation.plan.mounts if target == '/control')
                connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                connection.connect(str(Path(source) / 'gate.sock'))
                connections.append(connection)
            return result
        LocalDocker.create_reserved = inject
    result = run_container_command(plan, socket_path=Path('/run/docker.sock'),
                                   records=root / 'records', log_path=root / 'command.log')
    (root / 'return.json').write_text(json.dumps({'returncode': result.returncode}))


def case(root, lose_owner):
    root.mkdir(mode=0o700); (root / 'output').mkdir()
    with (root / 'controller.log').open('wb') as stream:
        process = subprocess.Popen([sys.executable, '-B', __file__, '--child', str(root)], stdout=stream, stderr=subprocess.STDOUT)
    descriptor = os.pidfd_open(process.pid)
    container = None
    try:
        if root.name in ('changed-artifact', 'wrong-peer'):
            deadline = time.monotonic() + 15
            while process.poll() is None:
                assert not (root / 'output/child-ready').exists(), 'Rejected startup reached workload'
                assert time.monotonic() < deadline, 'Rejected startup did not settle'
                time.sleep(.03)
            reason = 'Retained bootstrap bytes changed' if root.name == 'changed-artifact' else 'Socket peer differs'
            assert process.returncode != 0 and reason in (root / 'controller.log').read_text(), 'Wrong controller refusal reason'
            assert not (root / 'records/creation/bootstrap-ready.json').exists()
            return {'case': root.name, 'startup_refused': True, 'workload_not_started': True}
        deadline = time.monotonic() + 15
        while not (root / 'output/child-ready').exists():
            if process.poll() is not None or time.monotonic() > deadline:
                raise AssertionError('Controller ended before child readiness: ' + (root / 'controller.log').read_text())
            time.sleep(.03)
        records = root / 'records/creation'
        created = json.loads((records / 'created.json').read_text())
        container = created['identity']['container_id']
        assert (root / 'output/parent-completed').exists()
        assert not (records / 'observed-exit.json').exists()
        assert 'command entered' in (root / 'command.log').read_text(), 'Command log missing'
        if lose_owner:
            signal.pidfd_send_signal(descriptor, signal.SIGKILL); process.wait(timeout=5)
            deadline = time.monotonic() + 8
            while True:
                observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
                if not observed['State']['Running'] or time.monotonic() > deadline:
                    break
                time.sleep(.05)
            assert observed['State']['Status'] == 'exited' and observed['State']['ExitCode'] == 125, 'Owner loss did not stop container'
            assert not (root / 'output/child-completed').exists()
            assert not (records / 'observed-exit.json').exists()
        else:
            (root / 'output/release').touch()
            assert process.wait(timeout=10) == 0, (root / 'controller.log').read_text()
            assert (root / 'output/child-completed').exists()
            exit_record = json.loads((records / 'observed-exit.json').read_text())
            assert exit_record['returncode'] == 0 and exit_record['oom_killed'] is False
            assert exit_record['log_sha256'] == hashlib.sha256((root / 'command.log').read_bytes()).hexdigest()
            assert json.loads((records / 'removed.json').read_text())['removal_acknowledged'] is True
            container = None
        return {'owner_lost': lose_owner, 'command_log_retained': True, 'detached_completion_handled': True,
                'exit_record_retained': not lose_owner, 'expected_behavior_observed': True}
    finally:
        if process.poll() is None:
            signal.pidfd_send_signal(descriptor, signal.SIGKILL); process.wait(timeout=5)
        os.close(descriptor)
        # The killed controller cannot acknowledge cleanup. This proof reconciles
        # only the exact ID and request label from its private creation record.
        receipt = root / 'records/creation/created.json'
        if container is None and receipt.exists() and not (root / 'records/creation/removed.json').exists():
            container = json.loads(receipt.read_text())['identity']['container_id']
        if container:
            observed = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
            identity = json.loads(receipt.read_text())['identity']
            assert observed['Id'] == identity['container_id']
            assert observed['Config']['Labels']['openplan.execution-request'] == identity['request_id']
            if observed['State']['Running']:
                killed = subprocess.run(['docker', '--host', 'unix:///run/docker.sock', 'kill', container], capture_output=True, text=True)
                if killed.returncode:
                    settled = json.loads(docker('--host', 'unix:///run/docker.sock', 'inspect', container))[0]
                    assert settled['Id'] == container and settled['State']['Running'] is False and settled['State']['Status'] == 'exited', killed.stderr
            docker('--host', 'unix:///run/docker.sock', 'rm', container)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--child':
        child(Path(sys.argv[2])); sys.exit(0)
    root = Path(os.environ['OPENPLAN_CONTROLLER_PROOF']); root.mkdir(mode=0o700, parents=True, exist_ok=False)
    selected = os.environ.get('OPENPLAN_CONTROLLER_CASE')
    results = [case(root / name, lost) for name, lost in [('normal', False), ('owner-loss', True), ('changed-artifact', False), ('wrong-peer', False)] if not selected or name == selected]
    report = {'cases': results, 'all_owned_containers_removed': True,
              'sources': {name: hashlib.sha256((ROOT / 'workers/activitysim_worker' / name).read_bytes()).hexdigest()
                          for name in ('container_supervision.py', 'container_bootstrap.py', 'container_peer.py', 'container_transport.py')},
              'limits': ['Actual worker controller with synthetic Python command and detached child',
                         'No runtime.py dispatch, native ActivitySim, database admission or scientific acceptance']}
    text = json.dumps(report, indent=2) + '\n'; (root / 'result.json').write_text(text); print(text)
