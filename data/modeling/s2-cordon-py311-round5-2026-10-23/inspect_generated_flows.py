"""Summarize the new execution's units before interpreting its county scores."""
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent
lock = json.loads((HERE / 'lock.json').read_text())
registry = json.loads((HERE / 'inputs.json').read_text())
execution = Path(lock['scratch_directory'])


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def distribution(values):
    ordered = sorted(values)
    positive = [value for value in ordered if value > 0]
    return {'links': len(ordered), 'zero': sum(value == 0 for value in ordered),
            'positive': len(positive), 'finite': all(math.isfinite(value) for value in ordered),
            'negative': sum(value < 0 for value in ordered),
            'minimum_positive': min(positive) if positive else None,
            'median_positive': statistics.median(positive) if positive else None,
            'p95_positive': positive[round(.95 * (len(positive) - 1))] if positive else None,
            'maximum': max(ordered) if ordered else None}


paths = []
for geography in registry['geographies']:
    arms = ('baseline', 'candidate', 'repeat') if geography['id'] == registry['repeat_geography'] else ('baseline', 'candidate')
    for arm in arms:
        paths.extend(execution / geography['id'] / arm / name for name in
                     ('assignment.json', 'diagnostic.json', 'link_volumes.csv'))
precheck = [{'path': str(path), 'exists': path.is_file()} for path in paths]
(HERE / 'sanity-input-precheck.json').write_text(json.dumps(precheck, indent=2) + '\n')
if not all(row['exists'] for row in precheck):
    raise SystemExit('Incomplete new-execution output set; no interpretation')

records = []
for geography in registry['geographies']:
    county = geography['id']
    arms = ('baseline', 'candidate', 'repeat') if county == registry['repeat_geography'] else ('baseline', 'candidate')
    for arm in arms:
        directory = execution / county / arm
        assignment = json.loads((directory / 'assignment.json').read_text())
        diagnostic = json.loads((directory / 'diagnostic.json').read_text())
        with (directory / 'link_volumes.csv').open() as stream:
            links = list(csv.DictReader(stream))
        factor = assignment['demand']['peak_hour_factor']
        daily = [float(row['PCE_tot']) for row in links]
        class_daily = [float(row['demand_tot']) / factor for row in links]
        ratio_daily = [max(float(row['VOC_AB']), float(row['VOC_BA'])) / factor for row in links]
        matched = [row for row in diagnostic['raw_records'] if row['match_status'] == 'matched']
        ratios = [row['modeled_daily_pce'] / row['observed_volume'] for row in matched]
        road_classes = {}
        for kind in sorted({row.get('matched_link_type') or 'unknown' for row in matched}):
            group = [row for row in matched if (row.get('matched_link_type') or 'unknown') == kind]
            road_classes[kind] = {'stations': len(group), 'median_modeled_to_observed_ratio':
                statistics.median(row['modeled_daily_pce'] / row['observed_volume'] for row in group)}
        directional_errors = {direction: max(abs(float(row[f'PCE_{direction}']) -
            float(row[f'demand_{direction.lower()}']) / factor) for row in links) for direction in ('AB', 'BA')}
        records.append({'geography': county, 'arm': arm, 'peak_hour_factor': factor,
            'class_pce': assignment['convergence']['assignment_profile']['class_pce'],
            'output_hashes': {name: sha(directory / name) for name in ('assignment.json', 'diagnostic.json', 'link_volumes.csv')},
            'daily_vehicle_flow': distribution(daily), 'period_class_flow': distribution([float(row['demand_tot']) for row in links]),
            'pce_minus_class_daily_max_absolute': max(abs(a - b) for a, b in zip(daily, class_daily)),
            'directional_pce_minus_class_daily_max_absolute': directional_errors,
            'daily_pce_equals_class_flow': all(math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-7) for a, b in zip(daily, class_daily)),
            'capacity_ratio_div_peak': distribution(ratio_daily),
            'matched_stations': len(matched), 'median_modeled_to_observed_ratio': statistics.median(ratios),
            'ratio_definition': 'Median of modeled daily corridor vehicle flow divided by published count, all matched stations including zero flows',
            'road_classes': road_classes})
(HERE / 'flow-sanity.json').write_text(json.dumps({'lock_sha256': sha(HERE / 'lock.json'),
    'records': records, 'all_outputs_keep_vehicle_flow_units': all(r['daily_pce_equals_class_flow'] for r in records),
    'limits': ['Units and scale check only; does not prove model accuracy', 'Model day and year remain unknown',
               'Source-supported observation intervals remain unavailable']}, indent=2) + '\n')
for row in records:
    print(row['geography'], row['arm'], 'daily positive median/max', row['daily_vehicle_flow']['median_positive'],
          row['daily_vehicle_flow']['maximum'], 'PCE/class error', row['pce_minus_class_daily_max_absolute'],
          'median modeled/observed', row['median_modeled_to_observed_ratio'])
