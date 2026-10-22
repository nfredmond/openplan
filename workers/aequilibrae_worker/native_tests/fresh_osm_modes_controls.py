"""Actual supported OSM mode producer, persistence and prepared-graph controls.

No OSM download, project creation, skimmer or assignment runs. Native preparation
uses a three-link synthetic chain. Separate processes vary Python's hash seed.
The explicit --seed-campaign entry includes the in-process check and needs
capacity for a supervisor and one child process. The existing TasksMax=1 graph
runner remains separate and does not discover this process-spawning cohort.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


WORKER = Path(__file__).resolve().parents[1]
HELPER = WORKER / 'model_fresh_osm_modes.py'
SEEDS = (0, 1, 2, 3)
RESULT_PREFIX = 'FRESH_OSM_PROBE='


def probe(helper_path):
    """Use the installed producer with fixed parameters and no network access."""
    import logging
    import sqlite3
    from types import SimpleNamespace
    from unittest.mock import patch

    sys.path.insert(0, str(WORKER))
    from run_compact_graph import verify_environment
    verify_environment()
    import numpy as np
    import pandas as pd
    from aequilibrae.project.network.osm import osm_builder as native
    import model_assignment_graph_adapter as adapter
    import model_assignment_network_source as source

    if helper_path.resolve() == HELPER.resolve():
        import model_fresh_osm_modes as helper
    else:
        spec = importlib.util.spec_from_file_location('fresh_osm_modes_probe', helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
    helper.install()
    helper.install()

    parameters = {'network': {'osm': {'modes': {
        # Repeated parameter membership is legitimate, unlike a malformed
        # duplicate in the native producer's emitted mode string.
        'car': {'link_types': ['primary', 'primary', 'residential'], 'unknown_tags': True},
        'bicycle': {'link_types': ['primary'], 'unknown_tags': True},
        'transit': {'link_types': ['primary'], 'unknown_tags': True},
        'walk': {'link_types': ['primary'], 'unknown_tags': True},
    }}}}
    frame = pd.DataFrame({'link_id': [1, 2, 3], 'a_node': [1, 2, 3], 'b_node': [2, 3, 4],
        'direction': [0, 0, 0], 'link_type': ['primary', 'residential', 'unmapped'],
        'distance': [10.25, 20.5, 30.75], 'travel_time_ab': [1.25, 2.5, 3.75],
        'travel_time_ba': [4.5, 5.25, 6.5], 'capacity_ab': [1000., 1100., 1200.],
        'capacity_ba': [1300., 1400., 1500.]})
    builder = object.__new__(native.OSMBuilder)
    with sqlite3.connect(':memory:') as connection:
        connection.execute('CREATE TABLE modes(mode_name TEXT,mode_id TEXT)')
        connection.executemany('INSERT INTO modes VALUES(?,?)',
            [('car', 'c'), ('bicycle', 'b'), ('transit', 't'), ('walk', 'w')])
        with patch.object(native, 'Parameters', return_value=SimpleNamespace(parameters=parameters)):
            generated = getattr(builder, helper.METHOD)(connection, frame)
    if generated['modes'].tolist()[1:] != ['c', 'bctw']:
        raise AssertionError('Fresh producer changed registered membership or fallback codes')
    if 'modes' in frame.columns:
        raise AssertionError('Fresh producer changed the incoming raw OSM frame')
    pd.testing.assert_frame_equal(generated.drop(columns='modes'), frame)

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory)
        parquet = path / 'links.parquet'
        generated.to_parquet(parquet, index=False, engine='pyarrow')
        pd.testing.assert_frame_equal(
            pd.read_parquet(parquet, engine='pyarrow', use_threads=False, pre_buffer=False), generated)
        database = path / 'network.sqlite'
        with sqlite3.connect(database) as connection:
            pd.DataFrame({'node_id': [1, 2, 3, 4], 'is_centroid': [1, 0, 0, 1]}).to_sql(
                'nodes', connection, index=False)
            generated.to_sql('links', connection, index=False)
            stored = [row[0] for row in connection.execute('SELECT modes FROM links ORDER BY link_id')]
            if stored != generated['modes'].tolist():
                raise AssertionError('Persisted fresh modes differ from producer output')
        retained_source = source.identity(database)
        persisted = {'parquet': hashlib.sha256(parquet.read_bytes()).hexdigest(),
                     'sqlite': hashlib.sha256(database.read_bytes()).hexdigest()}

    graph = adapter.AssignmentGraph(logger=logging.getLogger('fresh-osm-controls'))
    graph.mode = 'c'
    graph.network = generated.drop(columns='link_type').copy()
    graph.prepare_graph(np.array([1, 4], dtype=np.int64))
    graph.set_blocked_centroid_flows(True)
    adapter.verify_before_skimming(graph, ['travel_time', 'distance'])

    def atom(value):
        if isinstance(value, np.generic):
            value = value.item()
        return ['float', value.hex()] if isinstance(value, float) else [type(value).__name__, value]

    def frame_identity(value):
        return {'columns': list(value.columns),
                'rows': [[atom(item) for item in row] for row in value.itertuples(index=False, name=None)]}

    prepared = {'graph': frame_identity(graph.graph), 'compact_graph': frame_identity(graph.compact_graph)}
    for name in ('all_nodes', 'nodes_to_indices', 'fs', 'centroids', 'cost', 'compact_all_nodes',
                 'compact_nodes_to_indices', 'compact_fs', 'compact_cost', 'skims', 'compact_skims'):
        value = np.asarray(getattr(graph, name))
        prepared[name] = {'dtype': value.dtype.str, 'shape': list(value.shape),
                          'values': [atom(item) for item in value.flat]}
    return {'modes': generated['modes'].tolist(), 'source': retained_source,
            'persisted': persisted, 'prepared': prepared}


def records(helper_path):
    results = []
    for seed in SEEDS:
        environment = dict(os.environ, PYTHONHASHSEED=str(seed), PYTHONDONTWRITEBYTECODE='1',
            OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1', NUMEXPR_NUM_THREADS='1')
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()), '--probe', str(helper_path)],
            capture_output=True, text=True, env=environment, timeout=90)
        if result.returncode != 0:
            raise AssertionError('Native fresh-mode probe failed before comparison:\n' + result.stderr)
        lines = [line[len(RESULT_PREFIX):] for line in result.stdout.splitlines() if line.startswith(RESULT_PREFIX)]
        if len(lines) != 1:
            raise AssertionError('Native fresh-mode probe did not return one receipt')
        results.append(json.loads(lines[0]))
    return results


def require_repeatable(results):
    for index, result in enumerate(results[1:], start=1):
        if result != results[0]:
            raise AssertionError(f'Fresh OSM producer differs across hash seeds {SEEDS[0]} and {SEEDS[index]}')


class NativeFreshModeTests(unittest.TestCase):
    def test_actual_native_producer_persistence_and_graph(self):
        actual = probe(HELPER)
        self.assertEqual(actual['modes'], ['bctw', 'c', 'bctw'])
        self.assertEqual(actual['source']['tables']['links']['count'], 3)
        self.assertEqual(actual['prepared']['cost']['shape'], [6])


def seed_campaign():
    """Construct process-spawning checks only for the explicit campaign entry."""
    class SeedCampaignTests(unittest.TestCase):
        def test_actual_native_producer_persistence_and_graph_repeat_across_seeds(self):
            actual = records(HELPER)
            require_repeatable(actual)
            self.assertEqual(actual[0]['modes'], ['bctw', 'c', 'bctw'])

        def test_harmless_source_annotation_survives_and_unordered_fault_fails(self):
            original = HELPER.read_text()
            marker = "return ''.join(sorted(value))"
            self.assertEqual(original.count(marker), 1)
            with tempfile.TemporaryDirectory() as directory:
                harmless = Path(directory) / 'harmless.py'
                harmless.write_text(original + '\n# Harmless mutation: producer controls remain the same.\n')
                require_repeatable(records(harmless))
                broken = Path(directory) / 'unordered.py'
                broken.write_text(original.replace(marker, 'return value'))
                with self.assertRaisesRegex(AssertionError, 'differs across hash seeds'):
                    require_repeatable(records(broken))

    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(NativeFreshModeTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(SeedCampaignTests),
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() and result.testsRun == 3 and not result.skipped else 1


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--probe':
        print(RESULT_PREFIX + json.dumps(probe(Path(sys.argv[2])), sort_keys=True, separators=(',', ':')))
    elif sys.argv[1:] == ['--seed-campaign']:
        sys.exit(seed_campaign())
    else:
        unittest.main()
