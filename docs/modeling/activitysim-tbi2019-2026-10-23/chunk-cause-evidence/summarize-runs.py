"""Summarize retained native health without reading any survey source."""
import csv
import json
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3] / 'data/_screening_cache/tbi2019-chunk-cause'
rows = []
for path in sorted(E.glob('r[23]-*.run.json')):
    record = json.loads(path.read_text())
    name = record['name']
    group = name.rsplit('-', 1)[1]
    output = ROOT / (name if group == 'reference' else name.rsplit('-', 1)[0] + '-hybrid')
    health = record.get('health', {})
    row = {'name': name, 'completed': record['exit_code'] == 0,
           'elapsed_seconds': health.get('elapsed_seconds'),
           'peak_scope_bytes': health.get('scope', {}).get('memory.peak'),
           'peak_process_rss_kib': health.get('peak_child_rss_kib'),
           'scope_limit_bytes': health.get('scope', {}).get('memory.max'),
           'scope_swap_max_bytes': health.get('scope', {}).get('memory.swap.max'),
           'memory_events': health.get('scope', {}).get('memory.events'),
           'final_table_rows': None, 'outcomes_accessed': False}
    if group != 'prefix' and record['exit_code'] == 0:
        counts = {}
        for table in output.glob('final_*.csv'):
            with table.open() as stream:
                counts[table.name] = sum(1 for _ in csv.DictReader(stream))
        row['final_table_rows'] = counts
    rows.append(row)
(E / 'subset-run-health.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2))
