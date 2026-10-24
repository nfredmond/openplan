"""Release unused allocator memory before an unchanged engine call."""
from functools import wraps


def reclaim_before(original, reclaim):
    """Call the supplied reclamation hook, then preserve arguments and return value."""
    @wraps(original)
    def run(*args, **kwargs):
        reclaim()
        return original(*args, **kwargs)
    return run
