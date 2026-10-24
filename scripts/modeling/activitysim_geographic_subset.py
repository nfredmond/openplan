"""Derive an explicit geographic runtime subset without altering parent inputs."""
import csv
import hashlib
import json
import shutil
from pathlib import Path


def descriptor(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return {'sha256': digest.hexdigest(), 'bytes': Path(path).stat().st_size}


def subset_bundle(parent, destination, excluded_zone_ids, *, reason, source):
    """Remove whole resident households and destinations, preserving matrix order.

    The parent is an MTC bundle with positional OMX matrices and land-use row
    order. This derivative is for the direct CLI, not a worker upload manifest.
    """
    import numpy as np
    import openmatrix as omx

    parent, destination = Path(parent), Path(destination)
    excluded = set(map(int, excluded_zone_ids))
    if not reason or not source:
        raise ValueError('Exclusion reason and source required')
    if destination.exists():
        raise ValueError('Destination already exists')
    with (parent / 'land_use.csv').open(newline='') as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = list(reader)
    zone_ids = [int(row['zone_id']) for row in rows]
    zone_set = set(zone_ids)
    if len(zone_set) != len(zone_ids):
        raise ValueError('Duplicate parent zones')
    if not excluded <= zone_set:
        raise ValueError('Unknown excluded zones')
    positions = [i for i, zone in enumerate(zone_ids) if zone not in excluded]
    if not positions:
        raise ValueError('All zones excluded')
    destination.mkdir(parents=True)
    with (destination / 'land_use.csv').open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fields)
        writer.writeheader()
        writer.writerows(rows[i] for i in positions)
    households = {}
    kept_households = set()
    parent_people = kept_people = 0
    with (parent / 'households.csv').open(newline='') as inp, (destination / 'households.csv').open('w', newline='') as out:
        reader = csv.DictReader(inp)
        writer = csv.DictWriter(out, reader.fieldnames)
        writer.writeheader()
        for row in reader:
            hid, home, size = int(row['household_id']), int(row['home_zone_id']), int(row['hhsize'])
            if hid in households or home not in zone_set or size < 1:
                raise ValueError('Invalid household identity, home zone or size')
            households[hid] = size
            if home not in excluded:
                kept_households.add(hid)
                writer.writerow(row)
    seen_people = set()
    with (parent / 'persons.csv').open(newline='') as inp, (destination / 'persons.csv').open('w', newline='') as out:
        reader = csv.DictReader(inp)
        writer = csv.DictWriter(out, reader.fieldnames)
        writer.writeheader()
        for row in reader:
            pid, hid = int(row['person_id']), int(row['household_id'])
            if pid in seen_people or hid not in households:
                raise ValueError('Invalid person identity or household')
            seen_people.add(pid)
            households[hid] -= 1
            parent_people += 1
            if hid in kept_households:
                kept_people += 1
                writer.writerow(row)
    if any(households.values()):
        raise ValueError('Household person counts differ')
    if not kept_households:
        raise ValueError('No resident households remain')
    shutil.copytree(parent / 'configs', destination / 'configs')
    (destination / 'skims').mkdir()
    matrices = 0
    with omx.open_file(str(parent / 'skims/mtc_skims.omx'), 'r') as inp, omx.open_file(str(destination / 'skims/mtc_skims.omx'), 'w') as out:
        if inp.list_mappings():
            raise ValueError('Expected positional parent OMX without mappings')
        for name in inp.list_matrices():
            if inp[name].shape != (len(zone_ids), len(zone_ids)):
                raise ValueError('Matrix shape differs from zone order')
            out[name] = inp[name][:][np.ix_(positions, positions)]
            matrices += 1
    record = {
        'schema': 'activitysim_geographic_subset_v1',
        'claim': 'Direct CLI derivative; parent common population remains full geography',
        'reason': reason, 'source': source,
        'parent_manifest': descriptor(parent / 'manifest.json'),
        'parent_zone_ids': zone_ids, 'retained_zone_ids': [zone_ids[i] for i in positions],
        'retained_matrix_positions': positions, 'excluded_zone_ids': sorted(excluded),
        'zones': {'parent': len(zone_ids), 'retained': len(positions), 'excluded': len(excluded)},
        'households': {'parent': len(households), 'retained': len(kept_households), 'excluded': len(households) - len(kept_households)},
        'persons': {'parent': parent_people, 'retained': kept_people, 'excluded': parent_people - kept_people},
        'matrices': matrices,
        'parent_files': {str(p.relative_to(parent)): descriptor(p) for p in sorted(parent.rglob('*')) if p.is_file()},
        'files': {str(p.relative_to(destination)): descriptor(p) for p in sorted(destination.rglob('*')) if p.is_file()},
        'survey_records_accessed': False,
    }
    (destination / 'manifest.json').write_text(json.dumps(record, indent=2) + '\n')
    return record
