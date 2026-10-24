"""Compare complete exported model tables exactly, including floating values."""
from pathlib import Path
import hashlib
import re
import pandas as pd


def chunk_evidence(log):
    """Require actual split execution and refuse an unplanned training fallback."""
    if 'chunk_training_mode falling back to' in log:
        raise AssertionError('Production fell back to training')
    chunks = [int(v) for v in re.findall(r'Running chunk (\d+) of', log)]
    if not chunks or max(chunks) < 2:
        raise AssertionError('No actual chooser split appears in the chunk log')
    return {'chunk_log_records': len(chunks), 'largest_chunk_ordinal': max(chunks)}


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
    identities = {'final_land_use.csv': 'zone_id', 'final_accessibility.csv': 'zone_id',
                  'final_households.csv': 'household_id', 'final_persons.csv': 'person_id',
                  'final_tours.csv': 'tour_id', 'final_trips.csv': 'trip_id',
                  'final_joint_tour_participants.csv': 'participant_id'}
    required = set(identities)
    if set(left) != required or set(right) != required:
        raise AssertionError('Final model table census differs from the declared seven tables')
    result = []
    for name in sorted(left):
        a = pd.read_csv(left[name], float_precision='round_trip')
        b = pd.read_csv(right[name], float_precision='round_trip')
        key = identities[name]
        if (key not in a or key not in b or a[key].isna().any() or b[key].isna().any()
                or not a[key].is_unique or not b[key].is_unique):
            raise AssertionError(f'Final table lacks an unambiguous row identity: {name}')
        a = a.sort_values(key).reset_index(drop=True)
        b = b.sort_values(key).reset_index(drop=True)
        try:
            pd.testing.assert_frame_equal(a, b, check_exact=True, check_dtype=True)
        except AssertionError as exc:
            raise AssertionError(f'Exact final-table parity failed: {name}\n{exc}') from exc
        result.append({'table': name, 'rows': len(a), 'columns': len(a.columns),
                       'reference_sha256': digest(left[name]), 'candidate_sha256': digest(right[name]),
                       'byte_identical': digest(left[name]) == digest(right[name]), 'value_identical': True})
    return result
