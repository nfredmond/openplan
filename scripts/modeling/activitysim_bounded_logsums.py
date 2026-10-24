"""Bound location-logsum preprocessing without splitting a person's alternatives."""
from functools import wraps
import inspect
import numpy as np


def group_slices(index, max_rows):
    """Retain row order and complete contiguous chooser groups in each slice."""
    if not isinstance(max_rows, int) or isinstance(max_rows, bool) or max_rows < 1:
        raise ValueError('Positive integer row bound required')
    values = np.asarray(index)
    if not len(values):
        return []
    boundaries = np.r_[0, np.flatnonzero(values[1:] != values[:-1]) + 1, len(values)]
    ids = values[boundaries[:-1]]
    if len(set(ids)) != len(ids):
        raise ValueError('Chooser groups must be contiguous')
    result = []
    start = end = 0
    for next_end in boundaries[1:]:
        next_end = int(next_end)
        if end > start and next_end - start > max_rows:
            result.append(slice(start, end))
            start = end
        end = next_end
    if end > start:
        result.append(slice(start, end))
    return result


def bounded_location_logsums(original, *, max_rows=20000):
    """Wrap the installed function and preserve positional duplicate-index joins.

    Native admission must verify the selected stock preprocessor and RNG state.
    This wrapper does not claim every third-party specification is separable.
    """
    signature = inspect.signature(original)
    @wraps(original)
    def run(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        frame = bound.arguments['location_sample_df']
        pieces = group_slices(frame.index, max_rows)
        if not pieces:
            return original(*args, **kwargs)
        # Keep the original frame and every non-logsum column untouched.
        output = np.empty(len(frame), dtype=np.float64)
        for span in pieces:
            local = frame.iloc[span].copy()
            bound.arguments['location_sample_df'] = local
            result = original(*bound.args, **bound.kwargs)
            if not result.index.equals(local.index) or len(result) != len(local):
                raise ValueError('Location-logsum function changed chooser order')
            output[span] = result['mode_choice_logsum'].to_numpy()
        frame['mode_choice_logsum'] = output
        return frame
    return run
