"""Read retained development evidence without assigning or rescoring a study."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np
import pandas as pd
from aequilibrae.matrix import AequilibraeMatrix

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/aequilibrae_worker'))
from assignment_runtime import require_assignment_python


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def distribution(values):
    positive = values[values > 0]
    return {'count': len(values), 'zero': int((values == 0).sum()),
            'sum': float(values.sum()), 'maximum': float(values.max()),
            'median_positive': float(positive.median()) if len(positive) else None,
            'p95_positive': float(positive.quantile(.95)) if len(positive) else None}


def trace(execution, earlier, county, output):
    require_assignment_python()
    if county not in {'06047', '06069', '06107', '08014', '08101'}:
        raise ValueError('Only the five exposed development counties are eligible')
    inputs = execution / 'inputs' / county
    files = []

    def retained(path):
        files.append(path)
        return path

    od = pd.read_csv(retained(inputs / 'package/od_trip_matrix.csv'), index_col=0)
    setup = json.loads(retained(inputs / 'work/network_setup_summary.json').read_text())
    audit = json.loads(retained(execution / f'{county}-pre-output-audit.json').read_text())
    counts = pd.read_csv(retained(inputs / 'counts/published_counts.csv'))
    skim_path = retained(inputs / 'run_output/travel_time_skims.omx')
    skim = AequilibraeMatrix()
    skim.load(str(skim_path))
    times = skim.get_matrix('travel_time', copy=True)
    skim_record = {'cores': skim.names, 'read_core': 'travel_time', 'units': 'minutes',
                   'shape': list(times.shape), 'positive_cells': int((times > 0).sum()),
                   'index': [int(x) for x in skim.index], 'demand_core': False}
    skim.close()
    arms = {}
    for arm in ('baseline', 'candidate', 'repeat'):
        directory = execution / county / arm
        if not directory.exists():
            continue
        assignment = json.loads(retained(directory / 'assignment.json').read_text())
        diagnostic = json.loads(retained(directory / 'diagnostic.json').read_text())
        links = pd.read_csv(retained(directory / 'link_volumes.csv')).set_index('link_id')
        demand_file = retained(directory / 'demand.omx')
        # run_assignment writes native AEM bytes despite the .omx suffix. The
        # engine's native loader opens r+, so load a disposable copy only.
        with tempfile.TemporaryDirectory(prefix='s2-demand-read-copy-') as temp:
            copy = Path(temp) / 'demand.aem'
            shutil.copyfile(demand_file, copy)
            matrix = AequilibraeMatrix()
            matrix.load(str(copy))
            data = matrix.get_matrix('demand', copy=True)
            demand = {'container': 'AEM (retained filename ends .omx)', 'cores': matrix.names,
                      'assigned_core': 'demand', 'period_total': float(data.sum()),
                      'implied_daily_total': float(data.sum() / .1), 'shape': list(data.shape)}
            matrix.close()
        matched = [r for r in diagnostic['raw_records'] if r['match_status'] == 'matched']
        selected = links.loc[[r['link_id'] for r in matched]]
        arms[arm] = {
            'demand': demand, 'assignment_demand_record': assignment['demand'],
            'distributions': {key: distribution(links[key]) for key in ('demand_tot', 'PCE_tot')},
            'pce_minus_voc_div_peak_max_abs': {direction: float(np.max(np.abs(
                links[f'PCE_{direction}'] - links[f'VOC_{direction}'] / .1))) for direction in ('AB', 'BA')},
            'pce_minus_class_daily_flow_max_abs': float(np.max(np.abs(links.PCE_tot - links.demand_tot / .1))),
            'matched': len(matched), 'unmatched_or_excluded': diagnostic['unmatched_or_excluded'],
            'matched_primary_link_zero_class_flow': int((selected.demand_tot == 0).sum()),
            'matched_zero_corridor_volume': sum(r['modeled_daily_pce'] == 0 for r in matched),
            'paired_corridor_stations': sum(r['carriageways_summed'] == 2 for r in matched),
            'station_rows': [{**{key: row[key] for key in ('station_id', 'link_id', 'observed_volume',
                              'modeled_daily_pce', 'carriageways_summed')},
                              'primary_link_period_class_flow': float(links.loc[row['link_id'], 'demand_tot']),
                              'primary_link_retained_pce': float(links.loc[row['link_id'], 'PCE_tot'])} for row in matched],
            'network_daily_vmt_recorded': assignment['network_daily_vehicle_miles'],
            'example_link_14233': links.loc[14233].to_dict() if 14233 in links.index else None}
    old_links = pd.read_csv(retained(earlier / 'run_output/link_volumes.csv'))
    old_summary = json.loads(retained(earlier / 'run_summary.json').read_text())
    old_validation = json.loads(retained(earlier / 'validation/validation_summary.json').read_text())
    layer = json.loads(retained(earlier / 'package/demand_layers.json').read_text())
    same_inputs = {}
    for relative in ('package/od_trip_matrix.csv', 'package/zone_attributes.csv',
                     'work/network_setup_summary.json', 'work/aeq_project/project_database.sqlite',
                     'run_output/travel_time_skims.omx', 'counts/published_counts.csv'):
        left, right = retained(inputs / relative), retained(earlier / relative)
        same_inputs[relative] = sha(left) == sha(right)
    identities = {str(path): sha(path) for path in sorted(set(files))}
    result = {
        'scope': 'read-only diagnosis; no assignment, no regrading, no experiment', 'county': county,
        'baseline_csv_daily_trips': float(od.to_numpy().sum()), 'baseline_csv_units': 'daily vehicle trips',
        'baseline_csv_core': 'not OMX; labeled OD CSV', 'skim': skim_record,
        'zone_order': list(map(int, od.index)), 'centroid_map': setup['centroid_map'],
        'input_audit': audit, 'arms': arms,
        'observations': {'stations': len(counts), 'count_type': counts.count_type.value_counts().to_dict(),
                         'direction': counts.direction.value_counts().to_dict(),
                         'year': {str(k): int(v) for k, v in counts.count_year.value_counts().items()},
                         'agency': counts.source_agency.value_counts().to_dict()},
        'earlier': {'path': str(earlier), 'versions_recorded': old_summary['engine_versions'],
                    'same_retained_inputs_now': same_inputs, 'demand_layers': layer,
                    'distributions': {key: distribution(old_links[key]) for key in ('demand_tot', 'PCE_tot')},
                    'pce_minus_class_daily_flow_max_abs': float(np.max(np.abs(old_links.PCE_tot - old_links.demand_tot / .1))),
                    'raw_median_ape_recorded': old_validation['metrics']['median_absolute_percent_error'],
                    'stations_matched_recorded': old_validation['stations_matched'],
                    'comparison_limit': 'Historical matching and runtime differ; no old outcome regraded or used as acceptance.'},
        'read_file_sha256': identities,
    }
    output.write_text(json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    trace(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]))
