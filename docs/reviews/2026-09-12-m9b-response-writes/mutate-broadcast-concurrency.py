"""Install candidate functions only in the non-serving clone, then restore them."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('broadcast_concurrency', ROOT / 'prove-broadcast-concurrency.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
query = probe.probe.query
signature = "'public.claim_engagement_response_email(uuid)'::regprocedure"
original = query('SELECT pg_get_functiondef(' + signature + ');')
source = (ROOT.parents[2] / 'openplan/supabase/migrations/20261014000005_engagement_delivery_authority_locks.sql').read_text()
scenarios = ['two-workers-one-message', 'claim-before-unsubscribe', 'unsubscribe-before-claim', 'closure-before-claim']
variants = [
    ('baseline', source, scenarios, None),
    ('harmless-comment', source + '\n-- Harmless concurrency control.\n', scenarios, None),
    ('missing-subscription-lock', source.replace('AND s.email=outbox.to_email FOR SHARE)', 'AND s.email=outbox.to_email)'), ['unsubscribe-before-claim'], 'Claim ignored a pending authority change'),
    ('missing-campaign-lock', source.replace('FOR SHARE OF e,c)', 'FOR SHARE OF e)'), ['closure-before-claim'], 'Claim ignored a pending authority change'),
    ('missing-skip-locked', source.replace('FOR UPDATE SKIP LOCKED', 'FOR UPDATE'), ['two-workers-one-message'], 'Second worker did not skip the held claim'),
]
results = []
try:
    for name, definition, cases, expected in variants:
        if expected is not None:
            assert definition != source, 'Mutation did not alter its target'
        query(definition)
        outcomes, error = [], None
        try:
            for case in cases:
                outcomes.append({'case': case, **probe.scenario(case)})
        except (AssertionError, RuntimeError, TimeoutError) as failure:
            error = str(failure)
        matched = error is None if expected is None else error is not None and expected in error
        row = {'name': name, 'matched': matched, 'outcome': 'survived' if error is None else 'killed', 'expected': expected, 'diagnostic': error, 'evidence': outcomes, 'definitionSha256': hashlib.sha256(definition.encode()).hexdigest()}
        results.append(row)
        (ROOT / 'broadcast-concurrency-mutations.json').write_text(json.dumps({'database': probe.probe.DATABASE, 'results': results}, indent=2) + '\n')
        print(name, row['outcome'], matched, error or '', flush=True)
        assert matched, row
finally:
    query(original)
    restored = query('SELECT pg_get_functiondef(' + signature + ');')
    assert restored == original, 'Original clone definition was not restored'
    (ROOT / 'broadcast-concurrency-restoration.json').write_text(json.dumps({'database': probe.probe.DATABASE, 'restored': True, 'originalDefinitionSha256': hashlib.sha256(original.encode()).hexdigest()}, indent=2) + '\n')
