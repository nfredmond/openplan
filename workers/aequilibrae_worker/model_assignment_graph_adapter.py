"""Bounded AequilibraE 1.6.2 pre-expansion correction for proved sink chains.

Native preparation owns compact IDs, forward stars, crosswalks and caches.
Older native exclusions remain unassessed. No source direction is changed.
"""
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path

import numpy as np
import pandas as pd
from aequilibrae.paths import Graph
from aequilibrae.paths import graph as native_graph
from aequilibrae.paths.cython import graph_building
from aequilibrae.project.network import network as native_network


SOURCE_PINS = {
    'graph.py': '516494488f953c330dfa749a7c75bbb8162f87253741e4fdc1d6ed9eedb291c3',
    'graph_building.pyx': '12d9a465e2b244e0555f34c041a1a63e33192169f092005965a5110302a13f8e',
    'network.py': '29a1ce967dd4b0228a46d0a2607932922348e008e5767c9a02d75d9e1e0e260e',
    'graph_building.so': '1c2fd56f44fb5c261b8abe366868a124d1556ae6e2e98bb97397e34c91637264',
}


def supported_engine():
    """Bind the private hook to reviewed Python, compiler source and binary bytes."""
    files = {'graph.py': Path(native_graph.__file__),
             'graph_building.pyx': Path(graph_building.__file__).with_name('graph_building.pyx'),
             'network.py': Path(native_network.__file__),
             'graph_building.so': Path(graph_building.__file__)}
    pins = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()}
    if importlib.metadata.version('aequilibrae') != '1.6.2' or pins != SOURCE_PINS:
        raise ValueError('Assignment graph adapter unsupported engine/source identity')
    return pins


def _directions(frame, allowed, phase):
    values = frame['direction'].to_numpy()
    if values.dtype.kind not in 'iu' or not np.isin(values, allowed).all():
        raise ValueError(f'Assignment graph {phase} directions must be validated integers {allowed}')


def _topology(frame, nodes=None):
    return sorted((int(r.link_id), int(r.direction),
                   int(r.a_node) if nodes is None else int(nodes[r.a_node]),
                   int(r.b_node) if nodes is None else int(nodes[r.b_node])) for r in frame.itertuples())


def _physical(frame):
    rows = {}; incidence = {}
    for row in frame.itertuples():
        link, a, b, direction = map(int, (row.link_id, row.a_node, row.b_node, row.direction))
        if link in rows:
            raise ValueError('Assignment graph duplicate physical link identity')
        rows[link] = (a, b, direction)
        incidence.setdefault(a, []).append(link)
        incidence.setdefault(b, []).append(link)
    return rows, incidence


def _physical_chains(frame, start, end, centroids):
    """Enumerate maximal degree-two chains using complete supplied incidence.

    Every interior incidence must be consumed by the chain. Full eligible source
    incidence is mandatory for omission proof, even where native dead ends burn.
    """
    rows, incidence = _physical(frame)
    candidates = []; failures = []
    if start == end:
        raise ValueError('physical chain endpoints coincide (cycle)')
    for first in incidence.get(start, []):
        node = start; link = first; visited = {start}; path = []; interior = []
        while True:
            a, b, direction = rows[link]
            sign = 1 if a == node else -1
            nxt = b if sign == 1 else a
            path.append((link, sign, direction))
            if nxt == end:
                candidates.append((path, interior)); break
            if nxt in visited:
                failures.append({'stop_node': nxt, 'reason': 'cycle residue'}); break
            visited.add(nxt)
            if nxt in centroids:
                failures.append({'stop_node': nxt, 'reason': 'interior centroid'}); break
            if len(incidence.get(nxt, [])) != 2:
                failures.append({'stop_node': nxt, 'reason': 'interior branch or incomplete incidence',
                                 'incident_links': incidence.get(nxt, [])[:20]}); break
            interior.append(nxt)
            other = [item for item in incidence[nxt] if item != link]
            if len(other) != 1:
                failures.append({'stop_node': nxt, 'reason': 'parallel/self-loop residue'}); break
            node, link = nxt, other[0]
    return candidates, failures


def physical_chain(frame, start, end, centroids):
    candidates, failures = _physical_chains(frame, start, end, centroids)
    if len(candidates) != 1:
        raise ValueError('unprovable/ambiguous physical chain: ' + json.dumps(
            {'endpoints': [start, end], 'candidates': len(candidates), 'failures': failures[:20]}))
    path, interior = candidates[0]
    return path, interior


def prove_omission(frame, start, end, centroids):
    path, interior = physical_chain(frame, start, end, centroids)
    forward = all(direction in (0, sign) for _, sign, direction in path)
    reverse = all(direction in (0, -sign) for _, sign, direction in path)
    if len(path) < 2 or forward or reverse:
        raise ValueError('omission requires neither endpoint traversal on a contracted physical chain')
    # A simple chain with no interior centroid/escape has no other entry/exit.
    signed = sorted((link, direction) for link, _, permitted in path
                    for direction in (-1, 1) if permitted in (0, direction))
    return {'endpoints': [start, end], 'interior_nodes': interior,
            'ordered_chain': [[link, sign] for link, sign, _ in path],
            'signed_source_directions': [list(item) for item in signed],
            'centroids': sorted(map(int, centroids)),
            'endpoint_traversals': [forward, reverse],
            'proof': 'unique simple full-incidence chain; no interior centroid/branch/residue; neither endpoint traversal'}


class AssignmentGraph(Graph):
    """Own only the pre-expansion hook and explicit preparation phase boundary."""
    def __init__(self, logger=None):
        super().__init__(logger=logger)
        self._phase = 'idle'
        self.omission_history = []
        self.omissions = []
        self.exclusion_proof = None

    def prepare_graph(self, centroids=None, remove_dead_ends=True):
        pins = supported_engine()
        if self._phase != 'idle' or remove_dead_ends is not True or self.mode != 'c':
            raise ValueError('Assignment graph unsupported preparation phase/call shape')
        _directions(self.network, (-1, 0, 1), 'original before int8 cast')
        if centroids is None or len(centroids) == 0 or self.network.empty:
            raise ValueError('Assignment graph empty original topology or centroid set before preparation')
        self._source = self.network.copy(deep=True)
        self._source_pins = pins
        self._source_identity = hashlib.sha256(json.dumps(_topology(self._source)).encode()).hexdigest()
        self.omissions = []; self.exclusion_proof = None
        self._phase = 'original'
        try:
            super().prepare_graph(centroids, remove_dead_ends=remove_dead_ends)
            if self._phase != 'finished':
                raise ValueError('Assignment graph unexpected native preparation call sequence')
            self._verify_prepared()
        except Exception as exc:
            raise ValueError(f'Assignment graph preparation refused phase={self._phase}: {exc}') from exc
        finally:
            self._phase = 'idle'

    def _build_directed_graph(self, network, centroids):
        caller = inspect.currentframe().f_back.f_code.co_name
        if not np.array_equal(centroids, self.centroids):
            raise ValueError('Assignment graph unexpected builder centroid identity')
        if self._phase == 'original':
            if network is not self.network or caller != 'prepare_graph':
                raise ValueError('Assignment graph unexpected original builder call shape')
            _directions(network, (-1, 0, 1), 'original')
            properties = super()._build_directed_graph(network, centroids)
            self._original_topology = _topology(properties[4], properties[0])
            self._phase = 'generated'
            return properties
        if self._phase != 'generated' or network is self.network or caller != '__build_compressed_graph':
            raise ValueError('Assignment graph unexpected generated builder call shape')
        if list(network.columns) != ['id', 'link_id', 'a_node', 'b_node', 'direction']:
            raise ValueError('Assignment graph unexpected generated columns')
        _directions(network, (-999, -1, 0, 1), 'generated')
        source_rows, _ = _physical(self._source)
        eligible = self._source[self._source.modes.str.contains('c')]
        reduced = eligible[~eligible.link_id.isin(self.dead_end_links) & (eligible.a_node != eligible.b_node)]
        universe = {(link, direction) for link, direction, _, _ in self._original_topology}
        baseline_retained = set(); expected = {}; omitted = set(); synthetic = {}
        for row in network.itertuples():
            link, start, end, direction = map(int, (row.link_id, row.a_node, row.b_node, row.direction))
            if link in source_rows:
                if source_rows[link] != (start, end, direction):
                    raise ValueError('Assignment graph generated row collides with source identity')
                path = [(link, 1, direction)]
            else:
                # Compare parallel chains collectively, without assigning synthetic IDs
                # by arithmetic or row order. Exact per-edge paths are checked later.
                key = (min(start, end), max(start, end))
                oriented = direction if start == key[0] or direction in (0, -999) else -direction
                synthetic.setdefault(key, []).append(oriented)
                candidates, _ = _physical_chains(reduced, start, end, set(map(int, centroids)))
                paths = [candidate[0] for candidate in candidates if len(candidate[0]) > 1]
                def signature(candidate):
                    ab = all(d in (0, sign) for _, sign, d in candidate)
                    ba = all(d in (0, -sign) for _, sign, d in candidate)
                    return 0 if ab and ba else 1 if ab else -1 if ba else -999
                paths = [candidate for candidate in paths if signature(candidate) == direction]
                if not paths:
                    raise ValueError('Assignment graph generated direction has no physical chain')
                path = paths[0]
            if link in source_rows:
                paths = [path]
            if direction == -999:
                try:
                    proof = prove_omission(eligible, start, end, set(map(int, centroids)))
                except ValueError as exc:
                    raise ValueError(f'pre-expansion marker=-999 link={link} endpoints={[start,end]} proof failed: {exc}') from exc
                if proof['ordered_chain'] != [[lid, sign] for lid, sign, _ in path]:
                    raise ValueError('Assignment graph full-incidence/native chain correspondence differs')
                signed = set(map(tuple, proof['signed_source_directions']))
                if omitted & signed:
                    raise ValueError('Assignment graph overlapping omission proofs')
                omitted |= signed
                proof.update({'generated_link_id': link, 'marker': -999,
                              'source_topology_sha256': self._source_identity, 'engine_source_pins': self._source_pins})
                self.omissions.append(proof)
            for orientation in (-1, 1):
                if direction not in (0, orientation, -999):
                    continue
                alternatives = [{(lid, orientation * sign) for lid, sign, permitted in candidate
                                 if permitted in (0, orientation * sign)} for candidate in paths]
                for mapped in alternatives:
                    baseline_retained |= mapped
                if direction != -999:
                    expected[(link, orientation)] = alternatives
        for (start, end), signatures in synthetic.items():
            candidates, _ = _physical_chains(reduced, start, end, set(map(int, centroids)))
            if sorted(signature(path) for path, _ in candidates if len(path) > 1) != sorted(signatures):
                raise ValueError(f'Assignment graph generated chain inventory differs from physical topology endpoints={[start,end]} generated={signatures} physical={[signature(path) for path,_ in candidates if len(path)>1]}')
        self._baseline_excluded = universe - baseline_retained
        self._omitted = omitted
        self._expected_groups = expected
        filtered = network.loc[network.direction != -999].copy()
        if filtered.empty:
            raise ValueError('empty compact topology after proved omissions; no skimming/assignment permitted')
        properties = super()._build_directed_graph(filtered, centroids)
        self._phase = 'finished'
        return properties

    def _verify_prepared(self):
        if _topology(self.graph, self.all_nodes) != self._original_topology:
            raise ValueError('Assignment graph original directed topology changed')
        expected_fs = np.r_[0, np.cumsum(np.bincount(self.graph.a_node, minlength=self.num_nodes))]
        if not np.array_equal(self.fs, expected_fs) or not np.array_equal(np.sort(self.graph.id), np.arange(self.num_links)):
            raise ValueError('Assignment graph original dense IDs/forward star differ')
        for prefix in ('', 'compact_'):
            nodes = getattr(self, prefix + 'all_nodes')
            inverse = getattr(self, prefix + 'nodes_to_indices')
            if not np.array_equal(inverse[nodes], np.arange(len(nodes))):
                raise ValueError('Assignment graph node inverse differs: ' + prefix)
        from model_assignment_compact_graph import verify
        verify(self, stage='adapter final preparation')
        count = self.compact_num_links
        actual_excluded = set()
        groups = {}
        for row in self.graph.itertuples():
            signed = (int(row.link_id), int(row.direction))
            compact_id = int(self.graph.loc[row.Index, '__compressed_id__'])
            if compact_id == count:
                actual_excluded.add(signed)
            else:
                groups.setdefault(compact_id, set()).add(signed)
        if (self._baseline_excluded & self._omitted or
                actual_excluded != self._baseline_excluded | self._omitted or
                actual_excluded - self._baseline_excluded != self._omitted):
            raise ValueError('Assignment graph exclusion delta differs from independently proved omissions')
        for row in self.compact_graph.itertuples():
            if groups.get(int(row.id), set()) not in self._expected_groups[(int(row.link_id), int(row.direction))]:
                raise ValueError('Assignment graph native crosswalk differs from physical correspondence')
        self.exclusion_proof = {'previously_excluded_count': len(self._baseline_excluded),
                                'previously_excluded_equivalence': 'unassessed',
                                'newly_proved_exclusions': [list(item) for item in sorted(self._omitted)],
                                'exact_exclusion_delta': 'matched', 'original_directed_topology': 'unchanged'}
        self.omission_history.append({'omissions': self.omissions, 'exclusion_proof': self.exclusion_proof})


def build_car_graph(network):
    """Match native build_graphs(fields=None, modes=['c'], limit_to_area=None).

    Coordinates come from native Nodes.lonlat (ST_X/ST_Y, no reprojection).
    No alternate fields, spatial filter, projection or mode is admitted here.
    """
    supported_engine()
    with network.project.db_connection as conn:
        fields = [row[1] for row in conn.execute('PRAGMA table_info(links);')
                  if row[1] not in ('ogc_fid', 'geometry')]
        centroids = np.array([row[0] for row in conn.execute(
            'select node_id from nodes where is_centroid=1 order by node_id;')], np.uint32)
        with pd.option_context('future.no_silent_downcasting', True):
            df = pd.read_sql('select ' + ','.join(fields) + ' from links', conn).fillna(value=np.nan).infer_objects(False)
    _directions(df, (-1, 0, 1), 'loader source')
    valid_fields = list(df.select_dtypes(np.number).columns) + ['modes']
    net = pd.DataFrame(df[valid_fields], copy=True)
    net.loc[~net.modes.str.contains('c'), 'b_node'] = net.loc[~net.modes.str.contains('c'), 'a_node']
    graph = AssignmentGraph(logger=network.project.logger)
    graph.mode = 'c'; graph.network = net
    graph.prepare_graph(centroids)
    graph.set_blocked_centroid_flows(True)
    graph.lonlat_index = network.nodes.lonlat.set_index('node_id').loc[graph.all_nodes]
    network.graphs['c'] = graph
    return graph


def verify_before_skimming(graph, skim_fields):
    """Refresh actual native cost/skim arrays after final prep and accepted factors."""
    from model_assignment_compact_graph import verify
    from model_assignment_network_graph import _verify_centroids
    verify(graph, stage='before first skimmer')
    _verify_centroids(graph)
    graph.set_graph('travel_time')
    graph.set_skimming(skim_fields)
    crosswalk = graph.graph['__compressed_id__'].to_numpy()
    expected_cost = np.bincount(crosswalk, weights=graph.graph['travel_time'], minlength=graph.compact_num_links + 1)
    if not np.array_equal(graph.cost, graph.graph['travel_time'].to_numpy()) or not np.allclose(graph.compact_cost, expected_cost, rtol=1e-14, atol=0):
        raise ValueError('Assignment graph refreshed native cost aggregation differs')
    for index, field in enumerate(skim_fields):
        expected = np.bincount(crosswalk, weights=graph.graph[field], minlength=graph.compact_num_links + 1)
        if not np.array_equal(graph.skims[:, index], graph.graph[field]) or not np.allclose(graph.compact_skims[:, index], expected, rtol=1e-14, atol=0):
            raise ValueError('Assignment graph refreshed native skim aggregation differs')
