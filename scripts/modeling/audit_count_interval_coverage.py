"""Audit retained development count inputs without opening or scoring outcomes.

This is an input-only reproduction of legacy count eligibility, including its
existing shared-link rule. It does not endorse that rule as an uncertainty model.
Only the explicitly pinned registry's count CSV and network members are read.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'workers/aequilibrae_worker'), str(ROOT / 'scripts/modeling')]
import count_validation
from count_observation_uncertainty import attach_observation_interval, digest
from validation_instrument import observation_from_compatibility_row
from validate_screening_observed_counts import load_project_db_features


def eligible_station_rows(stations, features):
    """Select the same source-only keepers without calling any residual scorer."""
    if any(feature.get('volume', 0) != 0 for feature in features):
        raise ValueError('coverage audit refuses assignment volumes')
    rows = []
    for index, station in enumerate(stations):
        observed = count_validation.parse_float(station.get('observed_volume')) or 0.0
        status = 'unmatched'
        link = None
        if not count_validation.station_measures_something_the_network_contains(station):
            status = 'excluded_not_mainline'
        elif observed > 0:
            match = count_validation.match_station(station, features)
            if match is not None:
                status, link = 'matched', match['link_id']
        rows.append({'index': index, 'station_id': station.get('station_id'),
                     'observed_volume': round(observed), 'match_status': status, 'link_id': link})
    groups = defaultdict(list)
    for row in rows:
        if row['match_status'] == 'matched':
            groups[row['link_id']].append(row)
    for group in groups.values():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda row: row['observed_volume'])
        low, high = ordered[0]['observed_volume'], ordered[-1]['observed_volume']
        if low > 0 and high / low <= 1 + count_validation.DEFAULT_READY_MEDIAN_APE / 100:
            keeper = ordered[len(ordered) // 2]
            for row in group:
                if row is not keeper:
                    row['match_status'] = 'merged_into_shared_link'
        else:
            for row in group:
                row['match_status'] = 'excluded_ambiguous_link'
    return rows


def audit(registry_path: Path, registry_sha256: str):
    raw = registry_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != registry_sha256:
        raise ValueError('registry hash mismatch')
    registry = json.loads(raw)
    if registry.get('partition') != 'original five development counties only':
        raise ValueError('not the authorized development input registry')
    archive = registry['archive']
    with Path(archive['path']).open('rb') as handle:
        archive_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
    if archive_hash != archive['sha256']:
        raise ValueError('archive hash mismatch')
    members = {row['member']: row for row in registry['members']}
    counties, opened = [], []
    with zipfile.ZipFile(archive['path']) as bundle, tempfile.TemporaryDirectory(prefix='s1-count-inputs-') as temporary:
        for geography in registry['geographies']:
            identifier = geography['id']
            # A geography is a registry key, never a path or a partition selector.
            if not isinstance(identifier, str) or not identifier.isdigit():
                raise ValueError('invalid registry geography key')
            paths = [f'{identifier}/counts/published_counts.csv',
                     f'{identifier}/work/aeq_project/project_database.sqlite']
            retained = []
            for name in paths:
                record = members[name]
                payload = bundle.read(name)
                if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
                    raise ValueError('retained member mismatch')
                retained.append(payload)
                opened.append({key: record[key] for key in ('member', 'bytes', 'sha256')})
            stations = list(csv.DictReader(io.StringIO(retained[0].decode())))
            database = Path(temporary) / f'{identifier}.sqlite'
            database.write_bytes(retained[1])
            features = load_project_db_features(database, {}, 'volume')
            rows = eligible_station_rows(stations, features)
            if hashlib.sha256(database.read_bytes()).hexdigest() != members[paths[1]]['sha256']:
                raise ValueError('network input changed during read')
            matched = [row for row in rows if row['match_status'] == 'matched']
            primary, all_reasons, metadata, source_rows = Counter(), Counter(), Counter(), []
            for match in matched:
                station = stations[match['index']]
                observation = observation_from_compatibility_row(
                    station, source_id=registry['study_id'] + ':' + identifier,
                    publisher=station.get('source_agency', 'unknown'),
                    source_url='unknown: retained compatibility CSV',
                    source_artifact_sha256=members[paths[0]]['sha256'], downloaded_at='unknown',
                )
                interval = attach_observation_interval(observation)['observation_uncertainty']
                primary[interval['reason'] or 'available'] += 1
                all_reasons.update(interval['reasons'])
                if not station.get('count_year'):
                    metadata['count_year_missing'] += 1
                source_rows.append({'station_id': station['station_id'], 'source_row_sha256': digest(station),
                                    'interval_status': interval['status'], 'reasons': interval['reasons']})
            counties.append({'geography': identifier, 'retained_rows': len(stations),
                             'match_statuses': dict(sorted(Counter(row['match_status'] for row in rows).items())),
                             'matched': len(matched), 'available': primary.get('available', 0),
                             'primary_reason_counts': dict(sorted(primary.items())),
                             'all_reason_counts_nonexclusive': dict(sorted(all_reasons.items())),
                             'metadata_gaps': dict(metadata), 'matched_source_rows': source_rows})
    return {
        'schema': 'openplan.input-only-count-interval-coverage.v1',
        'study_id': registry['study_id'], 'registry_sha256': registry_sha256,
        'archive_sha256': archive_hash, 'opened_members': opened,
        'assignment_output_files_opened': 0, 'residuals_computed': 0,
        'matcher_sha256': hashlib.sha256(Path(count_validation.__file__).read_bytes()).hexdigest(),
        'counties': counties,
        'matched': sum(row['matched'] for row in counties),
        'available': sum(row['available'] for row in counties),
        'primary_reason_counts': dict(sum((Counter(row['primary_reason_counts']) for row in counties), Counter())),
        'all_reason_counts_nonexclusive': dict(sum((Counter(row['all_reason_counts_nonexclusive']) for row in counties), Counter())),
        'limits': ['Legacy matcher eligibility only, not new matching acceptance.',
                   'Input CSV custody does not recover absent publisher metadata.',
                   'No model year/day alignment or scientific claim is inferred.'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--registry-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.registry, args.registry_sha256)
    with args.output.open('x') as handle:
        json.dump(result, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write('\n')
    print(json.dumps({k: result[k] for k in ('matched', 'available', 'primary_reason_counts')}))
