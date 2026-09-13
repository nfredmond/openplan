"""Change only prototype functions in the explicitly named cloned database."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('concurrency', root / 'prove-concurrency.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
source = (root / 'response-write-transaction.sql').read_text() + '\n' + (root / 'response-write-guards.sql').read_text()
functions = '\n'.join(re.findall(
    r'CREATE FUNCTION public\.(?:write_engagement_response|withdraw_engagement_source_responses)\(.*?END \$\$;',
    source, flags=re.DOTALL)).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
assert functions.count('CREATE OR REPLACE FUNCTION') == 2
mutex = "PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:' || p_campaign::text, 0));"
cases = [
    ('harmless-comment', functions + '\n-- Harmless concurrency control.\n', lambda: probe.source_race(True), None),
    ('missing-campaign-lock', functions.replace(mutex, 'NULL;'), lambda: probe.source_race(True),
     'Concurrent parent withdrawal left a newly created response published'),
    ('unsafe-snapshot', functions.replace("IF current_setting('transaction_isolation') <> 'read committed' THEN", 'IF false THEN'),
     probe.stale_withdrawal_snapshot, 'Unsafe snapshot withdrawal was accepted'),
]
results = []
try:
    for name, changed, test, expected in cases:
        probe.query('BEGIN;\n' + changed + '\nCOMMIT;')
        try:
            evidence = test()
            diagnostic = None
        except (AssertionError, RuntimeError, TimeoutError) as error:
            evidence = None
            diagnostic = str(error)
        matched = diagnostic is None if expected is None else diagnostic is not None and expected in diagnostic
        results.append({'name': name, 'matched': matched, 'outcome': 'survived' if diagnostic is None else 'killed',
                        'expected': expected, 'diagnostic': diagnostic, 'evidence': evidence,
                        'functionsSha256': hashlib.sha256(changed.encode()).hexdigest()})
        (root / 'concurrency-mutations.json').write_text(json.dumps({'database': probe.DATABASE, 'results': results}, indent=2) + '\n')
        print(name, results[-1]['outcome'], matched, flush=True)
        assert matched, diagnostic
finally:
    probe.query('BEGIN;\n' + functions + '\nCOMMIT;')
print('Original prototype functions restored in the clone', flush=True)
