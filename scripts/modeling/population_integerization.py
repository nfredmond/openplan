"""Round whole seed households subject to unchanged published control margins."""
import numpy as np
from population_synthesis import PopulationSynthesisError, integerize_weights


def controlled_counts(patterns, inverse, weights, controls, targets, margins):
    """Minimize pattern-count rounding error, then preserve within-pattern shares.

    This explicit study option uses integer programming, without a time limit or
    sampling. The fractional population fit remains a separate admission gate.
    """
    from scipy.optimize import milp, Bounds, LinearConstraint
    from scipy.sparse import csc_matrix, eye, hstack, vstack
    if margins is None:
        raise PopulationSynthesisError('Controlled integerization needs published margins.')
    keys = [(c.name, cat) for c in controls for cat in c.categories]
    target = np.array([targets[c][cat] for c, cat in keys], dtype=float)
    margin = np.array([margins[c][cat] for c, cat in keys], dtype=float)
    if not np.isfinite(margin).all() or (margin < 0).any():
        raise PopulationSynthesisError('Controlled integerization margins must be finite and nonnegative.')
    household_controls = [c for c in controls if c.level == 'household']
    if not household_controls:
        raise PopulationSynthesisError('Controlled integerization needs a household total.')
    total = sum(targets[household_controls[0].name].values())
    if not np.isfinite(total) or total < 0 or total != round(total):
        raise PopulationSynthesisError('Published household total must be a nonnegative integer.')
    weights = np.asarray(weights, dtype=float)
    grouped = np.bincount(inverse, weights=weights, minlength=len(patterns))
    n = len(grouped)
    ident = eye(n, format='csc')
    zero = csc_matrix((len(keys) + 1, n))
    controls_matrix = vstack([csc_matrix(patterns.T), csc_matrix(np.ones((1, n)))], format='csc')
    matrix = vstack([hstack([controls_matrix, zero]), hstack([ident, -ident]), hstack([-ident, -ident])], format='csc')
    lower = np.maximum(0, target - margin)
    upper = target + margin
    constraints = LinearConstraint(matrix,
        np.r_[lower, total, np.full(2*n, -np.inf)],
        np.r_[upper, total, grouped, -grouped])
    bounds = Bounds(np.zeros(2*n), np.r_[np.where(grouped > 0, np.inf, 0), np.full(n, np.inf)])
    result = milp(np.r_[np.zeros(n), np.ones(n)], integrality=np.r_[np.ones(n), np.zeros(n)],
                  bounds=bounds, constraints=constraints, options={'mip_rel_gap': 0.0})
    if not result.success:
        raise PopulationSynthesisError('Controlled integerization failed: ' + result.message)
    rounded = np.rint(result.x[:n]).astype(np.int64)
    actual = patterns.T @ rounded
    if (rounded < 0).any() or int(rounded.sum()) != int(total) or (actual < lower).any() or (actual > upper).any():
        raise PopulationSynthesisError('Integer solution violates the unchanged published bounds.')
    counts = np.zeros(len(weights), dtype=np.int64)
    for pattern, count in enumerate(rounded):
        if count == 0:
            continue
        positions = np.flatnonzero(inverse == pattern)
        allocated = integerize_weights((weights[positions] * (count / grouped[pattern])).tolist())
        counts[positions] = allocated
    # Actual whole-household rows, not optimizer status, establish conservation.
    if not np.array_equal(np.bincount(inverse, weights=counts, minlength=n), rounded):
        raise PopulationSynthesisError('Within-pattern household allocation differs from solved counts.')
    return counts.tolist()
