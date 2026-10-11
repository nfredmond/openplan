"""Refuse an image whose numerical stack breaks synthetic graph compression."""

import json
import warnings

import numpy as np
import pandas as pd
from aequilibrae.paths import Graph
from aequilibrae.paths.results import PathResults


def verify_graph_compatibility():
    """Check dead-end removal and a two-link route without a scientific claim."""
    graph = Graph()
    graph.network = pd.DataFrame({
        "link_id": [1, 2, 3, 4],
        "a_node": [1, 2, 2, 4],
        "b_node": [2, 3, 4, 5],
        "direction": [0, 0, 0, 0],
        "distance": [1.0, 1.0, 1.0, 1.0],
    })
    with warnings.catch_warnings():
        warnings.simplefilter("error", pd.errors.ChainedAssignmentError)
        graph.prepare_graph(np.array([1, 3], dtype=np.int64))
    graph.set_graph("distance")
    route = PathResults()
    route.prepare(graph)
    route.compute_path(1, 3)
    if len(graph.compact_graph) != 2:
        raise RuntimeError("Synthetic graph compression did not remove its dead-end branch.")
    if route.path is None or route.path.tolist() != [1, 2]:
        raise RuntimeError("Synthetic graph compression changed the retained two-link route.")
    if float(route.milepost[-1]) != 2.0:
        raise RuntimeError("Synthetic route distance differs from its input link weights.")
    return {"pandas": pd.__version__, "compressed_links": 2, "route_distance": 2.0}


if __name__ == "__main__":
    print(json.dumps(verify_graph_compatibility()))
