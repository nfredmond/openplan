"""Shared settings for baseline and road-class-adjusted assignment networks."""
import math
from assignment_settings import AssignmentSettingsError


def assignment_network_settings(road_class_factors=None):
    # None selects the builder's baseline default; persisted records are stricter.
    if road_class_factors is None:
        road_class_factors={}
    if not isinstance(road_class_factors,dict):
        raise AssignmentSettingsError('Network calibration factors must be an object')
    factors={}
    for road_class,raw_factor in road_class_factors.items():
        if isinstance(raw_factor,bool):
            raise AssignmentSettingsError('Network calibration factors cannot be boolean')
        try: factor=float(raw_factor)
        except (TypeError,ValueError,OverflowError) as error:
            raise AssignmentSettingsError('Network calibration factors must be numeric') from error
        if not isinstance(road_class,str) or not road_class or not math.isfinite(factor) or factor<=0:
            raise AssignmentSettingsError('Network calibration factors must have a name and be finite and positive')
        factors[road_class]=factor
    return {'schema_version':'openplan.network-calibration.v1',
        'road_class_factors':dict(sorted(factors.items())),
        'application':{'travel_time':'baseline_travel_time / factor','capacity':'baseline_capacity * factor'},
        'excludes':['trip_based_od_adjustments']}


def canonical_network_settings(settings):
    if not isinstance(settings,dict):
        raise AssignmentSettingsError('Network settings are missing')
    if set(settings)!={'schema_version','road_class_factors','application','excludes'}:
        raise AssignmentSettingsError('Network settings fields do not match the v1 schema')
    if not isinstance(settings['road_class_factors'],dict):
        raise AssignmentSettingsError('Persisted network calibration factors must be an object')
    canonical=assignment_network_settings(settings.get('road_class_factors'))
    if settings.get('schema_version')!=canonical['schema_version']:
        raise AssignmentSettingsError('Unsupported network-settings schema')
    if settings.get('application')!=canonical['application']:
        raise AssignmentSettingsError('Network-settings application semantics do not match v1')
    if settings.get('excludes')!=canonical['excludes']:
        raise AssignmentSettingsError('Network-settings exclusions do not match v1')
    return canonical
