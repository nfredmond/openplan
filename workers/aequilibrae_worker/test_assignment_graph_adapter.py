"""Real installed compressor controls. No assignment or skimmer executes."""
import ast
import copy
import logging
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from aequilibrae.paths import Graph
from aequilibrae.paths.cython.graph_building import create_compressed_link_network_mapping
import model_assignment_graph_adapter as adapter
import model_assignment_compact_graph as compact


LOGGER = logging.getLogger('compact-controls')


def frame(a=(1, 2), b=(2, 3), directions=(0, 0), ids=None):
    n = len(a)
    return pd.DataFrame({'link_id': list(ids or range(1, n + 1)), 'a_node': a, 'b_node': b,
                         'direction': directions, 'travel_time_ab': np.arange(1, n + 1, dtype=float) * 2 + .25,
                         'travel_time_ba': np.arange(1, n + 1, dtype=float) * 7 + .5,
                         'distance': np.arange(1, n + 1, dtype=float) * 11.5, 'modes': ['c'] * n})


def build(net=None, centroids=(1, 3), cls=adapter.AssignmentGraph):
    graph = cls(logger=LOGGER); graph.network = frame() if net is None else net.copy(deep=True)
    graph.mode = 'c'; graph.prepare_graph(np.array(centroids, dtype=np.int64)); graph.set_blocked_centroid_flows(True)
    return graph


def sink_net():
    # Valid component first in centroid order avoids the separately fenced fs[0] defect.
    return frame((1, 2, 4), (2, 3, 5), (1, -1, 0), ids=(19, 7, 31))


def paths(graph):
    result = []
    for row in graph.compact_graph.itertuples():
        edges = graph.graph[graph.graph['__compressed_id__'] == row.id]
        outgoing = {int(graph.all_nodes[r.a_node]): (int(graph.all_nodes[r.b_node]), int(r.link_id), int(r.direction))
                    for r in edges.itertuples()}
        start = int(graph.compact_all_nodes[row.a_node]); end = int(graph.compact_all_nodes[row.b_node])
        node = start; path = []
        while node in outgoing:
            node, link, direction = outgoing.pop(node); path.append((link, direction))
            if node == end: break
        result.append((start, end, tuple(path)))
    return sorted(result)


class RealCompressorTests(unittest.TestCase):
    def test_coherent_chains_and_native_aggregation(self):
        for directions in ((0, 0), (1, 1), (0, 1)):
            with self.subTest(directions=directions):
                graph = build(frame(directions=directions))
                self.assertEqual(compact.verify(graph)['status'], 'matched')
                self.assertIn((1, 3, ((1, 1), (2, 1))), paths(graph))
                adapter.verify_before_skimming(graph, ['travel_time', 'distance'])
                for row in graph.compact_graph.itertuples():
                    mask = graph.graph['__compressed_id__'] == row.id
                    self.assertAlmostEqual(graph.compact_cost[row.id], graph.graph.loc[mask, 'travel_time'].sum())
                if directions == (0, 0):
                    self.assertNotEqual(graph.compact_cost[0], graph.compact_cost[1])
                self.assertEqual(graph.exclusion_proof['newly_proved_exclusions'], [])

    def test_reversed_storage_shuffled_rows_and_ids(self):
        original = frame(directions=(0, 1), ids=(13, 4))
        reversed_net = original.copy(); reversed_net[['a_node', 'b_node']] = original[['b_node', 'a_node']].to_numpy()
        reversed_net['direction'] *= -1
        reversed_net[['travel_time_ab', 'travel_time_ba']] = original[['travel_time_ba', 'travel_time_ab']].to_numpy()
        graph = build(reversed_net.iloc[::-1])
        self.assertIn((1, 3, ((13, -1), (4, -1))), paths(graph))
        adapter.verify_before_skimming(graph, ['travel_time', 'distance'])
        self.assertAlmostEqual(graph.compact_cost[0], 6.5)

    def test_incoming_omission_exact_delta_and_disconnected_component(self):
        graph = build(sink_net(), (4, 5, 1, 3))
        self.assertEqual(graph.exclusion_proof['newly_proved_exclusions'], [[7, -1], [19, 1]])
        self.assertEqual(graph.exclusion_proof['previously_excluded_count'], 0)
        self.assertEqual(graph.omissions[0]['endpoint_traversals'], [False, False])
        self.assertEqual(set(map(tuple, graph.omissions[0]['signed_source_directions'])), {(19, 1), (7, -1)})
        self.assertEqual(paths(graph), [(4, 5, ((31, 1),)), (5, 4, ((31, -1),))])
        self.assertEqual(compact.verify(graph)['excluded_direction_equivalence'], 'unassessed')
        self.assertEqual(compact.verify(graph)['producer_correction']['omissions'], graph.omissions)

    def test_empty_and_auxiliary_defects_remain_refusals(self):
        with self.assertRaisesRegex(ValueError, 'empty compact topology'):
            build(frame(directions=(1, -1)))
        with self.assertRaisesRegex(ValueError, 'forward star'):
            build(frame(directions=(-1, -1)))
        with self.assertRaisesRegex(ValueError, 'preparation refused'):
            build(frame(directions=(-1, 1)))
        with self.assertRaisesRegex(ValueError, 'empty original'):
            build(frame().iloc[:0])
        # Reverse orientation is supported when node zero has outgoing adjacency.
        graph = build(frame((1, 2, 4), (2, 3, 5), (-1, -1, 0)), (4, 5, 1, 3))
        self.assertIn((3, 1, ((2, -1), (1, -1))), paths(graph))
        outward = build(frame((1, 2, 4), (2, 3, 5), (-1, 1, 0)), (4, 5, 1, 3))
        self.assertEqual(outward.exclusion_proof['previously_excluded_count'], 2)
        self.assertEqual(outward.exclusion_proof['previously_excluded_equivalence'], 'unassessed')

    def test_centroid_and_escape_branch_retain_incoming_routes(self):
        graph = build(frame(directions=(1, -1)), (1, 2, 3))
        self.assertEqual(graph.omissions, [])
        self.assertIn((1, 2, ((1, 1),)), paths(graph))
        self.assertIn((3, 2, ((2, -1),)), paths(graph))
        branch = build(frame((1, 2, 2), (2, 3, 4), (1, -1, 1)), (1, 3, 4))
        self.assertEqual(branch.omissions, [])
        self.assertIn((1, 2, ((1, 1),)), paths(branch))
        self.assertIn((2, 4, ((3, 1),)), paths(branch))
        # Native dead-end pruning can hide a branch. Full source incidence must refuse it.
        pruned = frame((1, 2, 2, 5), (2, 3, 8, 6), (1, -1, 0, 0))
        with self.assertRaisesRegex(ValueError, 'proof failed.*branch'):
            build(pruned, (5, 6, 1, 3))

    def test_longer_chain_and_full_incidence_safety(self):
        net = frame((1, 2, 3, 5), (2, 3, 4, 6), (1, 0, -1, 0))
        graph = build(net, (5, 6, 1, 4))
        self.assertEqual(len(graph.omissions[0]['signed_source_directions']), 4)
        # The proof itself must refuse even if native pruning would hide the escape.
        with self.assertRaisesRegex(ValueError, 'interior centroid'):
            adapter.prove_omission(net, 1, 4, {1, 2, 4, 5, 6})
        extra = pd.concat([net, frame((2,), (8,), (1,), ids=(27,))])
        with self.assertRaisesRegex(ValueError, 'branch'):
            adapter.prove_omission(extra, 1, 4, {1, 4, 5, 6})
        loop = pd.concat([net, frame((2,), (2,), (0,), ids=(28,))])
        with self.assertRaisesRegex(ValueError, 'branch'):
            adapter.prove_omission(loop, 1, 4, {1, 4, 5, 6})
        self.assertEqual(build(loop, (5, 6, 1, 4)).omissions, [])
        with self.assertRaisesRegex(ValueError, 'endpoint traversal'):
            adapter.prove_omission(frame(), 1, 3, {1, 3})

    def test_parallel_cycle_and_ambiguous_marker(self):
        net = frame((1, 2, 1, 4), (2, 3, 4, 3), (0, 0, 0, 0))
        graph = build(net)
        self.assertEqual(len(paths(graph)), 4)
        incoming = net.copy(); incoming['direction'] = [1, -1, 1, -1]
        with self.assertRaisesRegex(ValueError, 'ambiguous physical chain'):
            build(incoming)
        cycle = frame((1, 2, 3, 5), (2, 3, 1, 6), (0, 0, 0, 0))
        graph = build(cycle, (5, 6))
        self.assertEqual(graph.omissions, [])
        self.assertEqual(compact.verify(graph)['status'], 'matched')
        with self.assertRaisesRegex(ValueError, 'endpoints coincide'):
            adapter.prove_omission(cycle, 1, 1, {5, 6})

    def test_dense_indices_reprepare_cache_and_fresh_costs(self):
        graph = build(sink_net(), (4, 5, 1, 3))
        create_compressed_link_network_mapping(graph)
        old_cache = graph.compressed_link_network_mapping_idx
        self.assertIsNotNone(old_cache)
        prior = paths(graph)
        graph.network['travel_time_ab'] *= 3.7
        graph.network['travel_time_ba'] *= 2.3
        graph.prepare_graph(graph.centroids)
        self.assertIsNone(graph.compressed_link_network_mapping_idx)
        self.assertIsNone(graph.compressed_link_network_mapping_data)
        self.assertIsNone(graph.network_compressed_node_mapping)
        graph.set_blocked_centroid_flows(True)
        # Accepted factors affect actual directed fields after final prep.
        graph.graph['travel_time'] *= 1.7
        adapter.verify_before_skimming(graph, ['travel_time', 'distance'])
        self.assertEqual(paths(graph), prior)
        self.assertTrue(np.array_equal(graph.compact_graph.id, np.arange(graph.compact_num_links)))
        self.assertTrue(np.array_equal(graph.compact_fs, np.r_[0, np.cumsum(np.bincount(graph.compact_graph.a_node, minlength=graph.compact_num_nodes))]))
        create_compressed_link_network_mapping(graph)
        self.assertIsNot(graph.compressed_link_network_mapping_idx, old_cache)
        # Synthetic loads test crosswalk indices and sentinel, without assignment.
        loads = np.r_[np.arange(1., graph.compact_num_links + 1), 0.]
        expanded = loads[graph.graph['__compressed_id__']]
        self.assertTrue(np.all(expanded[graph.graph.link_id.isin([7, 19])] == 0))
        bad = copy.deepcopy(graph); bad.compact_fs[0] = -1
        with self.assertRaisesRegex(ValueError, 'stage=before first skimmer.*forward star'): adapter.verify_before_skimming(bad, ['travel_time'])
        bad = copy.deepcopy(graph); bad.graph.loc[0, '__compressed_id__'] = graph.compact_num_links
        with self.assertRaisesRegex(ValueError, 'chain|exclusion delta'): bad._verify_prepared()
        graph.graph['travel_time'] *= 2
        with patch.object(graph, 'set_graph', lambda *_: None):
            with self.assertRaisesRegex(ValueError, 'cost aggregation'): adapter.verify_before_skimming(graph, ['travel_time'])

    def test_postpreparation_proof_and_correspondence_invariants(self):
        graph = build(sink_net(), (4, 5, 1, 3))
        bad = copy.deepcopy(graph); bad._baseline_excluded.add((9999, 1))
        with self.assertRaisesRegex(ValueError, 'exclusion delta'):
            bad._verify_prepared()
        bad = copy.deepcopy(graph); bad._omitted.remove((19, 1))
        with self.assertRaisesRegex(ValueError, 'exclusion delta'):
            bad._verify_prepared()
        bad = copy.deepcopy(graph); bad.compact_nodes_to_indices[4] = 1
        with self.assertRaisesRegex(ValueError, 'node inverse'):
            bad._verify_prepared()
        parallel = build(frame((1, 1), (3, 3), (0, 0)))
        crosswalk = parallel.graph['__compressed_id__'].copy()
        # Swap same-endpoint groups: chain verification alone cannot see wrong physical identity.
        for direction in (-1, 1):
            one = parallel.graph[(parallel.graph.link_id == 1) & (parallel.graph.direction == direction)].index[0]
            two = parallel.graph[(parallel.graph.link_id == 2) & (parallel.graph.direction == direction)].index[0]
            parallel.graph.loc[one, '__compressed_id__'] = crosswalk[two]
            parallel.graph.loc[two, '__compressed_id__'] = crosswalk[one]
        self.assertEqual(compact.verify(parallel)['status'], 'matched')
        with self.assertRaisesRegex(ValueError, 'native crosswalk differs'):
            parallel._verify_prepared()

    def test_unknown_directions_identity_and_callshape_refuse(self):
        for directions in ((-999, 1), (257, 1), (True, False), (1., 0.), (0.5, 0.), ('1', '0')):
            net = frame(); net['direction'] = list(directions)
            with self.subTest(directions=directions), self.assertRaisesRegex(ValueError, 'validated integers'):
                build(net)
        with patch.dict(adapter.SOURCE_PINS, {'graph.py': 'unknown'}):
            with self.assertRaisesRegex(ValueError, 'unsupported engine'): build()
        with patch.object(adapter.importlib.metadata, 'version', return_value='unknown'):
            with self.assertRaisesRegex(ValueError, 'unsupported engine'): build()
        graph = build()
        with self.assertRaisesRegex(ValueError, 'call shape'): graph._build_directed_graph(graph.network, graph.centroids)
        with self.assertRaisesRegex(ValueError, 'call shape'): graph.prepare_graph(graph.centroids, remove_dead_ends=False)

    def test_generated_unknown_direction_and_refusal_context(self):
        original = adapter._directions
        def inject(network, allowed, phase):
            if phase == 'generated':
                network.loc[:, 'direction'] = -998
            return original(network, allowed, phase)
        with patch.object(adapter, '_directions', side_effect=inject):
            with self.assertRaisesRegex(ValueError, 'generated directions'):
                build()
        graph = build()
        graph.graph.loc[0, '__compressed_id__'] = graph.compact_num_links
        with self.assertRaises(ValueError) as caught:
            compact.verify(graph, stage='context control')
        message = str(caught.exception)
        for field in ('stage=context control', 'compact_id', 'compact_link_id', 'compact_direction',
                      'compact_indices', 'original_endpoints', 'stop_node', 'mapped_source_directions', 'residue_count'):
            self.assertIn(field, message)

    def test_car_loader_matches_native_projection_modes_and_coordinates(self):
        conn = sqlite3.connect(':memory:')
        conn.execute('create table links(link_id integer,a_node integer,b_node integer,direction integer,modes text,travel_time real,distance real,name text,geometry blob,ogc_fid integer)')
        conn.executemany('insert into links values(?,?,?,?,?,?,?,?,?,?)', [(1,1,2,0,'c',2.,4.,'ignored',None,1),(2,2,3,1,'c',3.,5.,'ignored',None,2),(3,4,5,0,'w',8.,9.,'ignored',None,3)])
        conn.execute('create table nodes(node_id integer,is_centroid integer)')
        conn.executemany('insert into nodes values(?,?)', [(1,1),(2,0),(3,1),(4,0),(5,0)])
        lonlat = pd.DataFrame({'node_id':[1,2,3,4,5], 'lon':[-100.,-99.,-98.,-97.,-96.], 'lat':[40.,41.,42.,43.,44.]})
        def network(): return SimpleNamespace(project=SimpleNamespace(db_connection=conn,logger=LOGGER),nodes=SimpleNamespace(lonlat=lonlat),graphs={})
        owned = network(); native = network()
        graph = adapter.build_car_graph(owned)
        adapter.native_network.Network.build_graphs(native, modes=['c'])
        other = native.graphs['c']
        pd.testing.assert_frame_equal(graph.network, other.network)
        pd.testing.assert_frame_equal(graph.lonlat_index, other.lonlat_index)
        self.assertIs(graph.logger, LOGGER)
        self.assertEqual(graph.mode, 'c')
        self.assertNotIn('name', graph.network.columns)
        self.assertTrue(np.array_equal(graph.centroids, other.centroids))
        self.assertEqual(paths(graph), paths(other))
        conn.close()

    def test_early_guard_precedes_spy_skimmer_and_later_guard_remains(self):
        tree = ast.parse(Path(__file__).with_name('main.py').read_text())
        stage = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'stage_assignment')
        scope = next(node for node in ast.walk(stage) if isinstance(node, ast.With) and any(isinstance(x.context_expr, ast.Call) and isinstance(x.context_expr.func,ast.Name) and x.context_expr.func.id=='project_scope' for x in node.items))
        selected = []
        for node in scope.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id in ('build_car_graph','NetworkSkimming'):
                selected.append(node)
            if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call):
                call=node.value
                if (isinstance(call.func,ast.Attribute) and isinstance(call.func.value,ast.Name) and call.func.value.id=='graph' and call.func.attr in ('prepare_graph','set_blocked_centroid_flows')) or (isinstance(call.func,ast.Name) and call.func.id=='verify_before_skimming'):
                    selected.append(node)
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='skimming' for t in node.targets):break
        code=compile(ast.Module(body=selected,type_ignores=[]),'<actual stage graph boundary>','exec')
        events=[]; graph=build()
        def verify(g,fields): events.append('early guard'); adapter.verify_before_skimming(g,fields)
        def skimmer(g): events.append('skimmer construction'); self.assertEqual(events,['early guard','skimmer construction'])
        env={'np':np,'project':SimpleNamespace(network=object()),'build_car_graph':lambda _:graph,'assignment_centroids':[1,3], 'skim_fields':['travel_time'], 'verify_before_skimming':verify,'NetworkSkimming':skimmer}
        exec(code,env)
        self.assertEqual(events,['early guard','skimmer construction'])
        # A refusal reaches no skimmer, including when the check raises outside diagnostics.
        events.clear(); env['verify_before_skimming']=lambda *_: (_ for _ in ()).throw(ValueError('early refusal'))
        with self.assertRaisesRegex(ValueError,'early refusal'):exec(code,env)
        self.assertEqual(events,[])
        retained=ast.parse(Path(__file__).with_name('model_assignment_input_snapshot.py').read_text())
        function=next(n for n in retained.body if isinstance(n,ast.FunctionDef) and n.name=='retain_and_execute')
        guard=next(n for n in ast.walk(function) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='verify_network_graph')
        execute=next(n for n in ast.walk(function) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='execute')
        self.assertLess(guard.lineno,execute.lineno)
        graph_source=Path(__file__).with_name('model_assignment_network_graph.py').read_text()
        self.assertIn("'compact_paths':verify_compact(record['graph'])",graph_source)


if __name__ == '__main__': unittest.main()
