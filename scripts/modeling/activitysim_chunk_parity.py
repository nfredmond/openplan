"""Compare complete exported model tables exactly, including floating values."""
from pathlib import Path
import hashlib
import pandas as pd


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for data in iter(lambda: f.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def compare_tables(reference, candidate):
    """Require the same table census and exact values; never use a tolerance."""
    reference, candidate = Path(reference), Path(candidate)
    left = {p.name: p for p in reference.glob('final_*.csv')}
    right = {p.name: p for p in candidate.glob('final_*.csv')}
    required = {'final_land_use.csv', 'final_accessibility.csv', 'final_households.csv',
                'final_persons.csv', 'final_tours.csv', 'final_trips.csv', 'final_joint_tour_participants.csv'}
    if set(left) != required or set(right) != required:
        raise AssertionError('Final model table census differs from the declared seven tables')
    result = []
    for name in sorted(left):
        a = pd.read_csv(left[name], float_precision='round_trip')
        b = pd.read_csv(right[name], float_precision='round_trip')
        try:
            pd.testing.assert_frame_equal(a, b, check_exact=True, check_dtype=True)
        except AssertionError as exc:
            raise AssertionError(f'Exact final-table parity failed: {name}\n{exc}') from exc
        result.append({'table': name, 'rows': len(a), 'columns': len(a.columns),
                       'reference_sha256': digest(left[name]), 'candidate_sha256': digest(right[name]),
                       'byte_identical': digest(left[name]) == digest(right[name]), 'value_identical': True})
    return result
