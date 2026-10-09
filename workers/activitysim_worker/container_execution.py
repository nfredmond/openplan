"""Adapt existing runtime mounts and command arguments to local supervision."""
import os
from pathlib import Path
from urllib.parse import quote
import uuid

from container_identity import ContainerPlan
from container_supervision import run_container_command
from container_transport import LocalDocker, API_VERSION


def run_supervised_execution(execution: dict, *, socket_path: str, records: Path, log_path: Path):
    engine = execution['engine_command']
    if len(engine) != 1 or Path(engine[0]).name != 'docker':
        raise ValueError('Supervised execution requires a plain local Docker engine command')
    if not Path(socket_path).is_absolute():
        raise ValueError('Supervised execution requires an absolute Docker socket path')
    with LocalDocker(Path(socket_path)) as client:
        image = client._json('GET', f'/v{API_VERSION}/images/{quote(execution["image"], safe="")}/json')
        config = image.get('Config')
        if not isinstance(config, dict) or not isinstance(config.get('Env'), list):
            raise ValueError('Container image environment is unconfirmed')
        environment = config['Env']
        if any(not isinstance(value, str) or '=' not in value for value in environment):
            raise ValueError('Container image environment is invalid')
        environment = tuple(value for value in environment if not value.startswith('HOME=')) + (
            'HOME=' + execution['container_paths']['home_dir'],)
        plan = ContainerPlan(daemon_id=client.daemon_id, image_id=image.get('Id'), request_id=uuid.uuid4().hex,
            command=tuple(execution['inner_command']), entrypoint=tuple(config.get('Entrypoint') or []),
            environment=environment, user=f'{os.getuid()}:{os.getgid()}',
            working_dir=execution['container_paths']['working_dir'],
            memory_bytes=execution['resource_limits']['memory_bytes'], tasks=execution['resource_limits']['tasks'],
            network=execution['network_mode'] or 'default',
            mounts=tuple((mount['source'], mount['target'], mount['read_only']) for mount in execution['mounts']))
    result = run_container_command(plan, socket_path=Path(socket_path), records=records, log_path=log_path)
    return result, {'command': list(result.args), 'container_supervision': 'owned_linux_pid_namespace',
                    'resolved_container_image': plan.image_id, 'container_custody_dir': str(records)}
