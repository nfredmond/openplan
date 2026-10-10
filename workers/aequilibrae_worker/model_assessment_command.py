"""Prepare one retained command for an already-persisted assessment identity.

Callers must load the original assessment identity after interruption. Rebuilding
an assessment with a new identity is a new operation, not recovery. This module
neither dispatches a request nor resumes a model stage.
"""
import json
from uuid import UUID, uuid5
import model_command_client as client
import model_command_journal as journal

# Fixed namespace for this operation; payload changes must not change its key.
NAMESPACE = UUID('2688c257-60f8-44be-95e7-41e3dd70bca7')


def prepare(directory, assessment_id, payload, *, base_url, deployment_id):
    client._uuid(assessment_id)
    bound = client.destination(base_url, deployment_id)
    request = str(uuid5(NAMESPACE, journal.canonical({'destination': bound, 'assessment_id': assessment_id})))
    command = {'request_id': request, 'destination': bound, 'operation': 'record_legacy_model_assessment',
               'arguments': {'run_id': payload['p_model_run_id'], 'stage_id': payload['p_stage_id'],
                             'track': payload['p_track'], 'payload': payload}}
    command = json.loads(journal.canonical(command))
    client.validate_command(command)
    # prepare compares the entire saved request even after receipt resolution.
    return journal.prepare(directory, command)['command']
