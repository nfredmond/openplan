"""Select an explicit completed predecessor, never the newest unrelated output.

These are read-time identity checks. They do not fence a later revocation or
establish local file custody, database consistency or scientific acceptance.
"""
import uuid

PREDECESSORS = {
    'Network Assignment': 'AequilibraE Setup',
    'Artifact Extraction': 'Network Assignment',
    'ActivitySim Network Assignment': 'Network Assignment',
}


def select(context, stages, artifacts, artifact_type):
    if artifact_type not in {'model_predecessor_state', 'model_package_inputs', 'model_project_inputs', 'model_assignment_outputs'}:
        raise ValueError('Unsupported predecessor input kind')
    if not isinstance(stages, list) or not isinstance(artifacts, list):
        raise ValueError('Predecessor read must return row lists')
    consumers = [row for row in stages if row.get('id') == context.stage_id]
    if len(consumers) != 1:
        raise ValueError('Consumer stage must be unique')
    consumer = consumers[0]
    if (consumer.get('run_id') != context.run_id or consumer.get('status') != 'running'
            or consumer.get('attempt_managed') is not True or consumer.get('active_attempt_id') != context.attempt_id):
        raise ValueError('Consumer stage does not confirm this managed attempt')
    expected_name = PREDECESSORS.get(consumer.get('stage_name'))
    if expected_name is None:
        raise ValueError('Consumer has no declared predecessor handoff')
    producers = [row for row in stages if row.get('stage_name') == expected_name]
    if len(producers) != 1:
        raise ValueError('Named predecessor stage must be unique')
    producer = producers[0]
    for key in ('id', 'active_attempt_id'):
        value = producer.get(key)
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('Predecessor identity must be canonical')
    if (producer['id'] == context.stage_id or producer.get('run_id') != context.run_id
            or producer.get('status') != 'succeeded' or producer.get('attempt_managed') is not True
            or type(producer.get('sort_order')) is not int or type(consumer.get('sort_order')) is not int
            or producer['sort_order'] >= consumer['sort_order']):
        raise ValueError('Predecessor must be a completed earlier managed stage in this run')
    matches = [row for row in artifacts if row.get('artifact_type') == artifact_type
               and row.get('stage_id') == producer['id']]
    if len(matches) != 1:
        raise ValueError('Predecessor input artifact must be unique')
    selected = matches[0]
    if selected.get('run_id') != context.run_id or selected.get('attempt_id') != producer['active_attempt_id']:
        raise ValueError('Predecessor artifact differs from producer ownership')
    value = selected.get('id')
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('Predecessor artifact identity must be canonical')
    return selected


def map_package(state_input, package_input):
    """Map only the package path, preserving a separate original state object."""
    import copy
    state_producer, package_producer = state_input['producer'], package_input['producer']
    if any(state_producer.get(key) != package_producer.get(key) or not state_producer.get(key)
           for key in ('stage_id', 'attempt_id')):
        raise ValueError('State and package must belong to the same producer attempt')
    original = state_input['state']
    package = original.get('package') if isinstance(original, dict) else None
    if not isinstance(package, dict) or not isinstance(package.get('package_dir'), str):
        raise ValueError('Predecessor state has no recorded package directory')
    if package['package_dir'] != package_input['source_package_directory']:
        raise ValueError('Predecessor state and package source directory disagree')
    mapped = copy.deepcopy(original)
    mapped['package']['package_dir'] = package_input['package_directory']
    return mapped
