"""Explicit entropy balancing for mixed household and person-count controls.

The legacy IPU update applies one ratio to every touching household. For a
person-count column, overlapping contributions can cycle despite feasible
controls. Coordinate minimization of relative entropy instead multiplies a
household by exp(lambda * contribution), solving the scalar constraint exactly.
Equal control patterns can share a multiplier without changing seed proportions.
No source target or margin changes. Callers must opt into this fitting method.
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from population_synthesis import (
    Control, SeedHousehold, SeedMatrix, ZoneFit, PopulationSynthesisError,
    DEFAULT_TOLERANCE, DEFAULT_MAX_ITERATIONS, controls_outside_margin,
    find_unmet_controls, _worst_relative_deviation,
)


class EntropyFitter:
    """Prepare reusable control patterns while preserving every seed household."""

    def __init__(self, households: Sequence[SeedHousehold], controls: Sequence[Control],
                 matrix: SeedMatrix):
        self.households = households
        self.controls = tuple(controls)
        self.matrix = matrix
        contributions = np.concatenate([matrix.contributions[c.name] for c in controls], axis=1)
        if not np.isfinite(contributions).all() or (contributions < 0).any():
            raise PopulationSynthesisError('Entropy contributions must be finite and nonnegative.')
        if not np.equal(contributions, np.floor(contributions)).all():
            raise PopulationSynthesisError('Entropy contributions must be integer household/person counts.')
        self.patterns, self.inverse = np.unique(contributions, axis=0, return_inverse=True)
        self.seed_weights = np.array([h.weight for h in households], dtype=float)
        if not np.isfinite(self.seed_weights).all() or (self.seed_weights <= 0).any():
            raise PopulationSynthesisError('Entropy seed weights must be finite and positive.')
        self.initial = np.bincount(self.inverse, weights=self.seed_weights)
        self.columns = [self.patterns[:, j].astype(int) for j in range(self.patterns.shape[1])]
        self.keys = [(c.name, category) for c in controls for category in c.categories]

    def __call__(self, households, controls, targets, *, zone_id=None, seed_matrix=None,
                 margins=None, tolerance=DEFAULT_TOLERANCE, max_iterations=DEFAULT_MAX_ITERATIONS):
        if households is not self.households or tuple(controls) != self.controls or seed_matrix is not self.matrix:
            raise PopulationSynthesisError('Entropy fitter and supplied seed/control identities differ.')
        target = np.array([targets[c][cat] for c, cat in self.keys], dtype=float)
        if not np.isfinite(target).all() or (target < 0).any():
            raise PopulationSynthesisError('Entropy targets must be finite and nonnegative.')
        if tolerance <= 0 or max_iterations < 1:
            raise PopulationSynthesisError('Entropy fitting needs positive tolerance and iterations.')
        weights = self.initial.copy()
        # A published zero is a structural zero. Such households cannot reenter
        # another category and silently violate that source control.
        weights[np.any(self.patterns[:, target == 0] > 0, axis=1)] = 0
        unmet = find_unmet_controls(households, controls, targets, self.matrix)
        for j, value in enumerate(target):
            if value > 0 and not np.any((weights > 0) & (self.columns[j] > 0)):
                key = self.keys[j]
                if not any((v['control'], v['category']) == key for v in unmet):
                    unmet.append({'control': key[0], 'category': key[1], 'target': float(value),
                                  'reason': 'No seed support remains after exact zero controls.'})
        converged = False
        iterations = 0
        for iterations in range(1, max_iterations + 1):
            for column, value in zip(self.columns, target):
                if value == 0:
                    continue
                sums = np.bincount(column, weights=weights)
                counts = np.arange(len(sums), dtype=float)
                if np.dot(counts, sums) <= 0:
                    continue
                if len(sums) == 2:
                    weights[column == 1] *= value / sums[1]
                    continue
                # Solve sum(a*w*exp(lambda*a)) = target by monotone bisection.
                # Bounds are expanded from zero, with exponent clipping only
                # during root finding to prevent overflow, never on fitted weights.
                def total(lam):
                    return float(np.dot(counts * sums, np.exp(np.clip(lam * counts, -700, 700))))
                lo, hi = -1.0, 1.0
                while total(lo) > value:
                    lo *= 2
                while total(hi) < value:
                    hi *= 2
                for _ in range(48):
                    mid = (lo + hi) / 2
                    if total(mid) > value:
                        hi = mid
                    else:
                        lo = mid
                weights *= np.exp(((lo + hi) / 2) * column)
            actual = self.patterns.T @ weights
            residual = np.abs(actual - target) / np.where(target > 0, target, 1.0)
            if not unmet and float(residual.max()) <= tolerance:
                converged = True
                break
        expanded = weights[self.inverse] * (self.seed_weights / self.initial[self.inverse])
        worst, name = _worst_relative_deviation(self.matrix, expanded, controls, targets, set())
        return ZoneFit(zone_id=zone_id, weights=expanded.tolist(), iterations=iterations,
                       converged=converged and math.isfinite(worst) and worst <= tolerance,
                       worst_deviation=worst, worst_control=name, unmet_controls=unmet,
                       outside_margin=controls_outside_margin(self.matrix, expanded, controls, targets, margins) if margins else [],
                       graded_against_margins=margins is not None)
