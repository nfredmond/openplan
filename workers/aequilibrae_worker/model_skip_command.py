"""Bind a blocked-stage observation to one retained command, without execution."""
from pathlib import Path
from uuid import UUID, uuid5
import model_command_client as client
import model_command_journal as journal

NAMESPACE = UUID('2702f534-c0e2-45f3-b154-739d558c28f9')


def deliver(directory, *, stage, blocker, workspace_id, base_url, deployment_id, service_key, post=None):
    """Reuse the request for the same observation; changed rows get a new decision."""
    arguments = {'workspace_id': workspace_id, 'run_id': stage['run_id'], 'stage_id': stage['id'],
                 'blocker_id': blocker['id'], 'blocker_status': blocker['status']}
    client._timestamp(stage['updated_at'])
    client._timestamp(blocker['updated_at'])
    bound = client.destination(base_url, deployment_id)
    identity = str(uuid5(NAMESPACE, journal.canonical({'destination': bound, 'arguments': arguments,
        'stage_updated_at': stage['updated_at'], 'blocker_updated_at': blocker['updated_at']})))
    command = {'request_id': identity, 'destination': bound, 'operation': 'skip_blocked_model_stage',
               'arguments': arguments}
    return client.deliver(Path(directory), command, base_url=base_url, deployment_id=deployment_id,
                          service_key=service_key, post=post)
