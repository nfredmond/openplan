"""Read retained WAC counts without converting absent tracts to zero."""
import csv
import gzip
from pathlib import Path

SECTORS = {'total_jobs': 'C000', 'retail_jobs': 'CNS07',
           'health_jobs': 'CNS16', 'education_jobs': 'CNS15',
           'accommodation_jobs': 'CNS18', 'govt_jobs': 'CNS20'}


def aggregate_wac(path: Path, geoids: set[str]) -> tuple[dict, dict]:
    """Require complete tract coverage and conserve the published sector sum."""
    totals = {}
    seen = set()
    selected_blocks = 0
    outside_jobs = 0
    with gzip.open(path, 'rt', newline='') as handle:
        reader = csv.DictReader(handle)
        fields = {'w_geocode', 'C000', *[f'CNS{i:02d}' for i in range(1, 21)]}
        if not fields <= set(reader.fieldnames or []):
            raise ValueError('WAC columns missing')
        for row in reader:
            block = row['w_geocode']
            if len(block) != 15 or not block.isdigit() or block in seen:
                raise ValueError('Invalid or duplicate WAC block')
            seen.add(block)
            counts = {key: int(row[key]) for key in fields - {'w_geocode'}}
            if any(value < 0 for value in counts.values()):
                raise ValueError('Negative WAC count')
            if sum(counts[f'CNS{i:02d}'] for i in range(1, 21)) != counts['C000']:
                raise ValueError('WAC sector conservation failed')
            tract = block[:11]
            if tract not in geoids:
                outside_jobs += counts['C000']
                continue
            selected_blocks += 1
            result = totals.setdefault(tract, dict.fromkeys(SECTORS, 0))
            for name, field in SECTORS.items():
                result[name] += counts[field]
    if set(totals) != geoids:
        raise ValueError('WAC tract coverage incomplete; absence is not zero')
    return totals, {'selected_tracts': len(totals), 'selected_blocks': selected_blocks,
                    'selected_jobs': sum(t['total_jobs'] for t in totals.values()),
                    'outside_jobs': outside_jobs, 'source_blocks': len(seen)}
