"""Check the configured AequilibraE objects immediately before initial execution."""
import numpy as np

from assignment_settings import (
    canonical_assignment_profile, assignment_profile_digest,
    installed_assignment_engine_version,
)


def verify(assignment, profile):
    """Read effective settings, including the internal solver's copied fields.

    This is a profile check, not a comparison with a prepared network or a
    validation of demand, observation independence or resulting accuracy.
    """
    expected = canonical_assignment_profile(profile)
    if installed_assignment_engine_version() != expected['engine_version']:
        raise ValueError('Live assignment engine version differs from profile')
    solver = assignment.assignment
    attributes = {'algorithm': 'algorithm', 'rgap_target': 'target_gap',
                  'max_iter': 'max_iterations', 'cores': 'cores', 'time_field': 'time_field'}
    for target in (assignment, solver):
        for attribute, key in attributes.items():
            if getattr(target, attribute) != expected[key]:
                raise ValueError('Live assignment settings differ from profile: ' + attribute)
        field = 'capacity_field' if target is assignment else 'cap_field'
        if getattr(target, field) != expected['capacity_field'] or target.vdf.function != expected['vdf']:
            raise ValueError('Live assignment fields or VDF differ from profile')
        parameters = target.vdf_parameters
        if len(parameters) != 2:
            raise ValueError('Live assignment VDF parameter inventory differs')
        for values, key in zip(parameters, ('alpha', 'beta')):
            array = np.asarray(values)
            if array.ndim != 1 or array.size == 0 or not np.all(array == expected['vdf_parameters'][key]):
                raise ValueError('Live assignment VDF parameter values differ from profile')
    classes = list(assignment.classes)
    if len(solver.traffic_classes) != len(classes) or any(a is not b for a, b in zip(classes, solver.traffic_classes)):
        raise ValueError('Live assignment solver classes differ')
    for item in classes:
        if item.pce != expected['class_pce']:
            raise ValueError('Live assignment PCE differs from profile')
        if item.results.cores != expected['cores'] or item._aon_results.cores != expected['cores']:
            raise ValueError('Live assignment class core count differs from profile')
        graph = item.graph.graph
        indices = np.asarray(graph['__supernet_id__'])
        if indices.ndim != 1 or indices.dtype.kind not in 'iu' or len(np.unique(indices)) != len(indices):
            raise ValueError('Live assignment network index invalid')
        for target in (assignment, solver):
            for attribute, field in (('capacity', 'capacity_field'), ('free_flow_tt', 'time_field')):
                array = np.asarray(getattr(target, attribute))
                if (array.ndim != 1 or array.size != len(indices) or np.any(indices < 0)
                        or np.any(indices >= array.size)
                        or not np.array_equal(array[indices], np.asarray(graph[expected[field]]))):
                    raise ValueError('Live assignment network field values differ: ' + attribute)
            if any(np.asarray(values).shape != (len(indices),) for values in target.vdf_parameters):
                raise ValueError('Live assignment VDF parameter shape differs from graph')
    return {'scope': 'initial_assignment_profile_fields',
            'canonical_profile_sha256': assignment_profile_digest(expected),
            'engine_version': expected['engine_version'], 'status': 'matched'}
