"""Read the declared screening producer for a bound ActivitySim consumer."""
from contextlib import ExitStack, closing
from model_predecessor_inputs import select

STAGE_PROJECTION = 'id,run_id,stage_name,sort_order,status,attempt_managed,active_attempt_id'
ARTIFACT_PROJECTION = 'id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json,model_run_stages!inner(id,run_id,status,attempt_managed,active_attempt_id)'
KINDS = ('skim_matrix', 'zone_attributes', 'network_setup_summary')


def read_screening_artifacts(writer, run_id):
    """Confirm consumer ownership and completed producer identity before file use.

    Separate reads are not a database lease. File-copy verification and fenced
    publication remain necessary after this snapshot.
    """
    writer.read_run(run_id)
    get = writer.get
    if get is None:
        import requests
        get = requests.get
    headers = {'apikey': writer.service_key, 'Authorization': 'Bearer ' + writer.service_key}
    with ExitStack() as stack:
        def read(table, projection):
            response = stack.enter_context(closing(get(writer.base_url.rstrip('/') + '/rest/v1/' + table,
                headers=headers, params={'run_id': 'eq.' + writer.context.run_id, 'select': projection},
                timeout=(5, 30), allow_redirects=False)))
            if response.status_code != 200:
                raise ValueError('Managed handoff read did not succeed')
            return response.json()
        stages = read('model_run_stages', STAGE_PROJECTION)
        artifacts = read('model_run_artifacts', ARTIFACT_PROJECTION)
        selected = [select(writer.context, stages, artifacts, kind) for kind in KINDS]
        writer.read_run(run_id)
        return selected
