"""Choice-level execution parity; tolerance applies only to logsums and utilities."""
import math
from pathlib import Path
import pandas as pd
from activitysim_chunk_parity import digest, chunk_evidence

IDENTITIES = {'land_use': 'zone_id', 'accessibility': 'zone_id',
              'households': 'household_id', 'persons': 'person_id',
              'tours': 'tour_id', 'trips': 'trip_id',
              'joint_tour_participants': 'participant_id'}


class ParityFailure(AssertionError):
    def __init__(self, records, tables=None):
        self.records = records
        self.tables = tables
        super().__init__(str(records))


def auxiliary(column):
    return column in {'logsum', 'utility'} or column.endswith(('_logsum', '_utility', '_utilities'))


def compare_choices(reference, candidate):
    """Compare every field, reporting exact identities for all differing cells."""
    reference, candidate = Path(reference), Path(candidate)
    expected = {f'final_{name}.csv' for name in IDENTITIES}
    if any({p.name for p in root.glob('final_*.csv')} != expected for root in (reference, candidate)):
        raise ParityFailure([{'error': 'Final table census differs'}])
    results, failures = [], []
    for table, key in IDENTITIES.items():
        name = f'final_{table}.csv'
        a, b = [pd.read_csv(root/name, float_precision='round_trip') for root in (reference, candidate)]
        if any(key not in frame or frame[key].isna().any() or not frame[key].is_unique for frame in (a,b)):
            raise ParityFailure([{'table': name, 'error': 'Ambiguous row identity'}])
        a, b = [frame.sort_values(key).reset_index(drop=True) for frame in (a,b)]
        if list(a.columns) != list(b.columns) or not a[key].equals(b[key]):
            raise ParityFailure([{'table': name, 'error': 'Schema or row identities differ',
                                  'reference_ids': a[key].tolist(), 'candidate_ids': b[key].tolist()}])
        tolerated = []
        for column in a:
            for i in a.index[~(a[column].eq(b[column]) | (a[column].isna() & b[column].isna()))]:
                x, y = a.at[i,column], b.at[i,column]
                record = {'table': name, 'id': str(a.at[i,key]), 'column': column,
                          'reference': str(x), 'candidate': str(y)}
                if auxiliary(column) and pd.api.types.is_numeric_dtype(a[column]) and pd.api.types.is_numeric_dtype(b[column]):
                    x, y = float(x), float(y)
                    if math.isfinite(x) and math.isfinite(y):
                        tolerance = max(4*max(math.ulp(x),math.ulp(y)),1e-12*max(abs(x),abs(y)))
                        if abs(x-y) <= tolerance:
                            record.update(absolute_difference=abs(x-y), tolerance=tolerance,
                                          ulp_distance=abs(x-y)/max(math.ulp(x),math.ulp(y)))
                            tolerated.append(record)
                            continue
                failures.append(record)
        results.append({'table': name, 'rows': len(a), 'columns': list(a.columns),
                        'reference_sha256': digest(reference/name), 'candidate_sha256': digest(candidate/name),
                        'tolerated_auxiliary_differences': tolerated})
    if failures:
        raise ParityFailure(failures, results)
    return results
