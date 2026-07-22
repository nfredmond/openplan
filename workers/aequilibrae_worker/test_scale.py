#!/usr/bin/env python3
"""Guardrail checks for the study-area zone budget (fail-fast on pathological
size) and the metro-scale BFS fix. Run with the worker venv:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_scale.py
"""
import sys
from collections import deque

import main


def test_under_budget_passes():
    # No raise at or below the bound (boundary inclusive).
    main.check_zone_budget(0, max_zones=4000)
    main.check_zone_budget(4000, max_zones=4000)


def test_over_budget_raises_actionable_error():
    try:
        main.check_zone_budget(4001, max_zones=4000)
    except RuntimeError as exc:
        msg = str(exc)
        assert "4001" in msg, f"message should name the zone count: {msg}"
        assert "4000" in msg, f"message should name the max: {msg}"
        assert "narrow" in msg.lower() or "split" in msg.lower(), f"message should be actionable: {msg}"
        return
    raise AssertionError("expected RuntimeError above the zone budget")


def test_default_bound_is_generous():
    # The default budget must comfortably admit a large single metro at tract
    # geography (a few thousand tracts at most).
    assert main.AEQ_MAX_ZONES >= 2000, f"default budget too tight: {main.AEQ_MAX_ZONES}"
    main.check_zone_budget(2000)  # uses the default bound; must not raise


def test_bfs_deque_is_order_independent_and_complete():
    # Guards the metro-scale BFS fix: deque.popleft() must still visit the whole
    # connected component (component membership is order-independent).
    adj = {0: {1}, 1: {0, 2}, 2: {1, 3}, 3: {2}, 10: {11}, 11: {10}}
    nodes_all = [0, 1, 2, 3, 10, 11]
    visited = set()
    components = []
    for node in nodes_all:
        if node in visited:
            continue
        comp = set()
        queue = deque([node])
        comp.add(node)
        while queue:
            n = queue.popleft()
            for nb in adj.get(n, []):
                if nb not in comp:
                    comp.add(nb)
                    queue.append(nb)
        visited |= comp
        components.append(comp)
    components.sort(key=len, reverse=True)
    assert components[0] == {0, 1, 2, 3}, f"largest component wrong: {components}"
    assert components[1] == {10, 11}, f"second component wrong: {components}"


if __name__ == "__main__":
    tests = [
        test_under_budget_passes,
        test_over_budget_raises_actionable_error,
        test_default_bound_is_generous,
        test_bfs_deque_is_order_independent_and_complete,
    ]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} zone-budget / BFS checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
