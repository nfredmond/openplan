"""Use one retained household population before constructing engine demand.

The worker's parent supplies a scoped source decision. This module validates
and transforms local inputs; it grants no cross-run or database authority.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import stat
import sys
from pathlib import Path


def population_library():
    """Find the shared source in repository and shared-model image layouts."""
    directory = Path(__file__).resolve().parents[2] / 'scripts' / 'modeling'
    if not (directory / 'common_population.py').is_file():
        raise RuntimeError('This worker lacks shared population sources; use the repository modeling worker or shared-models image')
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
    import common_population
    return common_population


def apply_realized_counts(zones, population):
    """Replace demand marginals by zone identity, retaining published totals."""
    common = population_library()
    rows = zones.to_dict('records')
    if common.selected_zone_map(rows) != common.selected_zone_map(
            json.loads((Path(population['directory']) / 'selected_zones.json').read_bytes())):
        raise ValueError('Common population differs from the package selected zones')
    totals = common.aequilibrae_zone_totals(population)
    result = zones.copy()
    for field in ('est_population', 'households', 'worker_residents'):
        if field in result:
            result['source_' + field] = result[field]
        result[field] = [totals[int(zone)][field] for zone in result['zone_id']]
    result['population_universe'] = common.UNIVERSE
    return result


def identity(population):
    """Name verified raw inputs without claiming scientific acceptance."""
    basis = population['basis']
    payload = {
        'schema': 'openplan.common-population-identity.v1',
        'manifest': population['manifest'],
        'source_profile': basis['source_profile'],
        'universe': basis['universe'],
        'exclusions': basis['exclusions'],
        'selected_zone_map': basis['selected_zone_map'],
        'realized_zone_counts': basis['realized_zone_counts'],
        'source_manifest': basis['files']['source_manifest'],
    }
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    return {'population_basis': payload, 'population_basis_payload_json': raw,
            'population_basis_digest': hashlib.sha256(raw.encode('utf-8')).hexdigest()}


def validate_selection_coverage(note):
    """Retain the producer's actual selection coverage, not the next launch's read."""
    if not isinstance(note, dict):
        raise ValueError('Retained population lacks its original demographic selection coverage')
    note = json.loads(json.dumps(note, allow_nan=False))
    for key in ('candidate_tracts', 'matched_tracts', 'unmatched_tracts'):
        if key in note and (type(note[key]) is not int or note[key] < 0):
            raise ValueError('Invalid original demographic selection counts')
    if all(key in note for key in ('candidate_tracts', 'matched_tracts', 'unmatched_tracts')):
        if note['matched_tracts'] + note['unmatched_tracts'] != note['candidate_tracts']:
            raise ValueError('Original demographic selection counts disagree')
    if 'geography_index_truncated' in note and type(note['geography_index_truncated']) is not bool:
        raise ValueError('Invalid original demographic truncation flag')
    return note


def prepare_generated_population(zones, output_dir, prepared, *, coverage_note, census_api_key=None, synthesize=None):
    """Fit once using the explicit source profile, then verify retained bytes."""
    common = population_library()
    from synthetic_population import synthesize_study_area

    if prepared.get('mode') != 'generate':
        raise ValueError('Population generation requires its scoped generate decision')
    profile = common.validate_source_profile(prepared['source_profile'])
    key = census_api_key if census_api_key is not None else os.getenv('CENSUS_API_KEY', '')
    if not isinstance(key, str) or not key:
        raise ValueError('Common population needs a Census key on the modeling worker; no scaffold fallback is allowed')
    output = Path(output_dir)
    source = output / 'population_source.json'
    source_record = {**prepared['source_record'], 'source_profile': profile,
                     'selection_coverage': validate_selection_coverage(coverage_note)}
    with source.open('x', encoding='utf-8') as handle:
        json.dump(source_record, handle, sort_keys=True, allow_nan=False)
        handle.write('\n')
    source_zones = output / 'population_source_zones.csv'
    zones.to_csv(source_zones, index=False)
    rows = zones.to_dict('records')
    result = (synthesize or synthesize_study_area)(rows, census_api_key=key,
        source_profile=profile, include_school_enrollment=True)
    directory = output / 'common_population'
    manifest = common.retain_population(directory, rows, result,
        source_manifest_path=source, zone_attributes_path=source_zones, source_profile=profile)
    population = common.read_common_population(directory, expected_manifest=manifest, zone_rows=rows)
    # MTC-bound runs refuse absent source cells now, rather than fetching a
    # different enrollment table later in a comparison consumer.
    common.retained_school_enrollment(population)
    return population


def prepare_reused_population(output_dir, prepared):
    """Copy a parent-authorized exact realization, never fetch or refit it."""
    common = population_library()
    if prepared.get('mode') != 'reuse':
        raise ValueError('Population reuse requires its scoped source decision')
    population = prepared['population']
    directory = Path(output_dir) / 'common_population'
    common.copy_retained_population(population, directory)
    return common.read_common_population(directory,
        expected_manifest=population['manifest'], zone_rows=prepared['zone_rows'])


def retained_zone_frame(prepared):
    """Read the exact original source map before demand, without TIGER refetch."""
    import pandas as pd
    common = population_library()
    population = prepared['population']
    source = Path(population['directory']) / common.ROLES['source_zone_attributes']
    # Recheck every companion, including this CSV, immediately before parsing.
    common.read_common_population(Path(population['directory']),
        expected_manifest=population['manifest'], zone_rows=prepared['zone_rows'])
    zones = pd.read_csv(source, dtype={'GEOID': str})
    required = {'zone_id', 'GEOID', 'est_population', 'households', 'total_jobs',
                'centroid_lon', 'centroid_lat', 'area_sq_mi', 'jobs_source'}
    if not required.issubset(zones.columns):
        raise ValueError('Retained source zone table lacks package fields')
    for field in ('zone_id', 'est_population', 'households', 'total_jobs', 'centroid_lon', 'centroid_lat', 'area_sq_mi'):
        if any(isinstance(value, bool) or not math.isfinite(float(value)) for value in zones[field]):
            raise ValueError('Retained source zone table has invalid numeric fields')
    return zones


def read_package_population(package_directory):
    """Validate retained rosters and the demographics actually passed to assignment."""
    directory = Path(package_directory)
    manifest_path = directory / 'manifest.json'
    if not manifest_path.exists():
        return {}
    manifest = json.loads(manifest_path.read_bytes())
    record = manifest.get('common_population')
    if record is None:
        return {}
    if not isinstance(record, dict) or record.get('directory') != 'common_population':
        raise ValueError('Package population directory is not the fixed retained role')
    common = population_library()
    retained = directory / 'common_population'
    with (retained / common.ROLES['source_zone_attributes']).open(newline='') as handle:
        source_rows = list(csv.DictReader(handle))
    population = common.read_common_population(retained, expected_manifest=record['manifest'], zone_rows=source_rows)
    metadata = identity(population)
    custody = record.get('custody')
    if custody not in ('managed_attempt', 'legacy_stage_snapshot') or population['source_manifest'].get('custody') != custody:
        raise ValueError('Package population custody differs from its retained source')
    if any(record.get(key) != value for key, value in metadata.items()):
        raise ValueError('Package population identity differs from retained inputs')
    with (directory / 'zone_attributes.csv').open(newline='') as handle:
        rows = list(csv.DictReader(handle))
    internal = [row for row in rows if (row.get('zone_kind') or 'internal') not in common.EXTERNAL_KINDS]
    if common.selected_zone_map(internal) != common.selected_zone_map(source_rows):
        raise ValueError('Assignment zone map differs from the retained population')
    totals = common.aequilibrae_zone_totals(population)
    for row in rows:
        external = (row.get('zone_kind') or 'internal') in common.EXTERNAL_KINDS
        for field in ('est_population', 'households', 'worker_residents'):
            expected = 0 if external else totals[int(row['zone_id'])][field]
            if field not in row or float(row[field]) != expected:
                raise ValueError('Assignment demographics differ from realized population: ' + field)
    return {**metadata, 'population_custody': custody}


def package_inventory(package_directory, *, durable=False):
    """Pin completed package bytes without treating their existence as authority."""
    common = population_library()
    directory = Path(package_directory).absolute()
    if directory.resolve(strict=True) != directory:
        raise ValueError('Population package cannot use path aliases')
    names = ['manifest.json', 'zone_attributes.csv', 'od_trip_matrix.csv',
             'common_population/' + common.MANIFEST_NAME,
             *['common_population/' + name for name in common.ROLES.values()]]
    receipts = {}
    root = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in names:
            parent = os.dup(root)
            try:
                parts = Path(name).parts
                for part in parts[:-1]:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                    os.close(parent)
                    parent = child
                descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(descriptor, 'rb') as stream:
                    before = os.fstat(stream.fileno())
                    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                        raise ValueError('Population package requires private regular files')
                    digest = hashlib.sha256()
                    length = 0
                    while data := stream.read(1024 * 1024):
                        digest.update(data)
                        length += len(data)
                    after = os.fstat(stream.fileno())
                    named = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
                    if any(getattr(before, field) != getattr(after, field)
                           or getattr(after, field) != getattr(named, field) for field in fields):
                        raise ValueError('Population package file changed during read')
                    if durable:
                        os.fsync(stream.fileno())
                receipts[name] = {'path': name, 'sha256': digest.hexdigest(), 'bytes': length}
                if durable:
                    os.fsync(parent)
            finally:
                os.close(parent)
        current = directory.stat()
        pinned = os.fstat(root)
        if directory.resolve(strict=True) != directory or (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise ValueError('Population package directory changed during read')
        if durable:
            os.fsync(root)
            parent = os.open(directory.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
    finally:
        os.close(root)
    return receipts


def publication_payloads(package_directory, *, run_id, stage_id):
    """Build the seven fixed output slots from the checked package itself."""
    common = population_library()
    directory = Path(package_directory)
    metadata = read_package_population(directory)
    if not metadata:
        raise ValueError('Common population publication requires its verified package')
    manifest = common._json((directory / 'manifest.json').read_bytes())
    record = manifest['common_population']
    basis = common._json((directory / 'common_population' / common.MANIFEST_NAME).read_bytes())
    roles = [('common_population', common.MANIFEST_NAME, record['manifest']),
             *[('common_population_' + role, name, basis['files'][role]) for role, name in common.ROLES.items()]]
    return {kind: {'run_id': run_id, 'stage_id': stage_id, 'artifact_type': kind,
        'file_url': 'local://' + str(directory / 'common_population' / name),
        'file_size_bytes': receipt['bytes'], 'content_hash': receipt['sha256'],
        'metadata_json': {'schema': common.SCHEMA, 'custody': record['custody'],
                         **{key: value for key, value in metadata.items() if key != 'population_custody'},
                         'origin': record.get('origin'), 'scientific_acceptance': 'unassessed'}}
        for kind, name, receipt in roles}
