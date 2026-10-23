"""Exercise successor preparation and sealed native execution on invented data only."""
import copy
from importlib import metadata
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

import numpy as np
import pandas as pd
from aequilibrae.matrix import AequilibraeMatrix

sys.path.insert(0, str(Path(__file__).parent))
import evaluate_successor as evaluate
sys.path.insert(0, str(evaluate.ROOT / 'scripts/research'))
import sealed_study

IDS = [7, 19, 31, 47]
NODES = [104, 101, 103, 102]
TIMES = np.array([[0., 10., 2., 30.], [10., 0., 30., 2.],
                  [2., 30., 0., 20.], [30., 2., 20., 0.]])


def fixture(root):
    """Create every allowlisted input, with shuffled OMX, zone and centroid axes."""
    source = root / 'source'
    source.mkdir()
    zones = pd.DataFrame({'zone_id': IDS, 'zone_kind': ['internal'] * 2 + ['external'] * 2,
                          'est_population': [100., 300., 0., 0.], 'total_jobs': [60., 40., 0., 0.]})
    gateways = [{'zone_id': i, 'name': 'Synthetic route', 'daily_in': 100., 'daily_out': 100.}
                for i in IDS[2:]]
    base = evaluate.runtime.build_external_gateway_matrix(gateways, zones)
    base[:2, :2] = [[3., 5.], [7., 11.]]
    expected, _ = evaluate.distribution.condition_external_demand(
        base, TIMES, np.array([False, False, True, True]), setting=evaluate.distribution.CANDIDATE)
    geographies = [{'id': 'synthetic-a', 'split': 'diagnosis'}, {'id': 'synthetic-b', 'split': 'evaluation'}]
    for geography in geographies:
        directory = source / geography['id']
        for part in ('package', 'work/aeq_project', 'counts', 'run_output'):
            (directory / part).mkdir(parents=True)
        zones.iloc[[3, 1, 0, 2]].to_csv(directory / 'package/zone_attributes.csv', index=False)
        pd.DataFrame(base, index=IDS, columns=IDS).to_csv(directory / 'package/od_trip_matrix.csv')
        evaluate.write(directory / 'work/network_setup_summary.json',
                       {'centroid_map': dict(zip(IDS, NODES)), 'gateways': gateways,
                        'network_source': 'invented synthetic network'})
        matrix = AequilibraeMatrix()
        matrix.create_empty(zones=4, matrix_names=['travel_time'], memory_only=True)
        shuffle = [3, 0, 1, 2]
        matrix.index[:] = np.array(NODES)[shuffle]
        matrix.matrix['travel_time'][:] = TIMES[np.ix_(shuffle, shuffle)]
        matrix.export(str(directory / 'run_output/travel_time_skims.omx'))
        matrix.close()
        connection = evaluate.runtime.connect_spatialite(directory / 'work/aeq_project/project_database.sqlite')
        connection.execute('''CREATE TABLE links (link_id INTEGER, a_node INTEGER, b_node INTEGER,
            direction INTEGER, distance REAL, modes TEXT, speed_ab REAL, speed_ba REAL,
            travel_time_ab REAL, capacity_ab REAL, capacity_ba REAL, link_type TEXT, name TEXT, geometry BLOB)''')
        stations = []
        for link_id, (a, b) in enumerate(((0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)), 1):
            name = f'Synthetic road {link_id}'
            connection.execute('INSERT INTO links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,GeomFromText(?,4326))',
                (link_id, NODES[a], NODES[b], 0, 1000., 'c', 30., 30., TIMES[a, b],
                 10000., 10000., 'primary', name, f'LINESTRING({a * .01} 0, {b * .01} .01)'))
            stations.append({'station_id': f'synthetic-{link_id}', 'facility_name': name,
                             'candidate_model_names': name, 'candidate_link_types': 'primary',
                             'observed_volume': 100., 'bbox_min_lon': -1, 'bbox_max_lon': 1,
                             'bbox_min_lat': -1, 'bbox_max_lat': 1})
        connection.commit()
        connection.close()
        pd.DataFrame(stations).to_csv(directory / 'counts/published_counts.csv', index=False)
    archive = root / 'synthetic.zip'
    members = []
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as handle:
        for path in sorted(source.rglob('*')):
            if path.is_file():
                member = path.relative_to(source).as_posix()
                handle.write(path, member)
                members.append({'member': member, 'bytes': path.stat().st_size, 'sha256': evaluate.digest(path)})
    registry = {'archive': {'path': str(archive), 'sha256': evaluate.digest(archive)},
                'members': members, 'geographies': geographies, 'repeat_geography': 'synthetic-b',
                'runtime_versions': {name: metadata.version(name) for name in
                                     ('aequilibrae', 'numpy', 'pandas', 'scipy', 'openmatrix')}}
    return registry, base, expected


def synthetic_lock(root, registry):
    """Keep the real runner and validator while replacing every source with a fixture."""
    original = json.loads((evaluate.ROOT / 'data/modeling/s2-cordon-impedance-2026-10-23/lock.json').read_text())
    old_root = original['working_directory']
    old_scratch = original['scratch_directory']
    scratch = root / 'execution'
    scratch.mkdir()
    registry_path = root / 'inputs.json'
    evaluate.write(registry_path, registry)
    lock = copy.deepcopy(original)
    lock.update(study_id=evaluate.STUDY, working_directory=str(evaluate.ROOT),
                scratch_directory=str(scratch), lease_path=str(root / 'lease'),
                receipt_path=str(root / 'receipt.json'), candidate_result_path=str(scratch / 'candidate.json'),
                aggregate_result_path=str(root / 'result.json'))
    for kind in ('evaluator', 'validator'):
        def remap(value):
            return value.replace(old_root, str(evaluate.ROOT)).replace(old_scratch, str(scratch)).replace(
                's2_cordon/evaluate.py', 's2_cordon/evaluate_successor.py').replace(
                str(evaluate.ROOT / 'data/modeling/s2-cordon-impedance-2026-10-23/inputs.json'), str(registry_path))
        lock[kind]['command'] = [remap(value) for value in lock[kind]['command']]
        lock[kind]['files'] = [{'path': remap(row['path']), 'sha256': evaluate.digest(remap(row['path']))}
                              for row in lock[kind]['files']]
        lock[kind]['closure_sha256'] = sealed_study.canonical_sha256(lock[kind]['files'])
    lock['sources'] = [{'name': 'invented-only', **registry['archive'],
                        'selected_members': [row['member'] for row in registry['members']]}]
    path = root / 'lock.json'
    evaluate.write(path, lock)
    return path


class SuccessorTests(unittest.TestCase):
    def test_native_preparation_reads_omx_and_preserves_order(self):
        with tempfile.TemporaryDirectory(prefix='s2-successor-synthetic-') as temp:
            root = Path(temp)
            registry, base, expected = fixture(root)
            try:
                cases = evaluate.prepare(registry, root / 'prepared')
            except Exception as error:
                self.fail(f'Complete synthetic preparation must succeed: {type(error).__name__}: {error}')
            self.assertEqual(len(cases), 2, 'Both synthetic preparations must complete')
            for case in cases:
                np.testing.assert_array_equal(case['base'], base)
                np.testing.assert_allclose(case['candidate'], expected, rtol=0, atol=1e-10,
                                           err_msg='OMX centroid ordering must preserve the expected candidate')
                audit = json.loads((root / 'prepared' / f"{case['geography']}-pre-output-audit.json").read_text())
                self.assertEqual(audit['ordered_centroid_nodes'], NODES)
                self.assertFalse(audit['assignment_output_opened'])
                self.assertEqual(case['match_ids'], [1, 2, 3, 4, 5, 6])
                self.assertGreater(audit['external_distribution']['changed_cells'], 0)
            self.assertEqual(len(list((root / 'prepared/inputs').rglob('*.*'))), 12)
            self.assertFalse((root / 'prepared/progress.json').exists())

    def test_complete_sealed_synthetic_native_execution(self):
        with tempfile.TemporaryDirectory(prefix='s2-successor-sealed-') as temp:
            root = Path(temp)
            registry, _, _ = fixture(root)
            lock = synthetic_lock(root, registry)
            result = sealed_study.run(lock)
            # A runner failure retains hashes only. This assertion makes a failure visible.
            self.assertNotEqual(result['decision'], 'inconclusive',
                                f'Synthetic sealed execution must complete: {result}')
            self.assertTrue((root / 'receipt.json').is_file())
            self.assertEqual(json.loads((root / 'result.json').read_text()), result)
            self.assertFalse((root / 'execution/candidate.json').exists())
            assignments = sorted((root / 'execution').glob('synthetic-*/*/assignment.json'))
            self.assertEqual(len(assignments), 5, 'All five synthetic assignments must finish')
            for assignment in assignments:
                record = json.loads(assignment.read_text())
                self.assertTrue(record['convergence']['converged'])
                self.assertEqual(record['network']['zones'], 4)
                self.assertEqual(record['network']['missing_centroids_in_graph'], [])
                self.assertGreater(record['loaded_links'], 0)
                self.assertTrue((assignment.parent / 'link_volumes.csv').is_file())
                self.assertTrue((assignment.parent / 'diagnostic.json').is_file())
            first = root / 'execution/synthetic-b/candidate/diagnostic.json'
            repeat = root / 'execution/synthetic-b/repeat/diagnostic.json'
            self.assertEqual(first.read_bytes(), repeat.read_bytes(), 'Synthetic repeat diagnostics must match')


if __name__ == '__main__':
    unittest.main()
