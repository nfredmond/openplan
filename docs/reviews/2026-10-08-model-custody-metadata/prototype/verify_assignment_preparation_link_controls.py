"""Isolated controls for parent preparation provenance; no scientific claims."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
worker = ROOT / 'workers/aequilibrae_worker'
names = ('model_assignment_preparation_link.py', 'model_assignment_input_publication.py')
original = {name: (worker / name).read_text() for name in names}
checks = [
    ('baseline', None, None, None, None, None),
    ('harmless', None, None, None, None, None),
    ('omit-link', names[1], 'preparation_link=retained_preparation(writer,method)', "preparation_link={'status':'not_retained','solver_input_equivalence':'unassessed'}", 'test_parent_links_confirmed_consumption_before_solver', 'AssertionError'),
    ('changed-source', names[0], "if actual['sha256'] != record['sha256'] or actual['bytes'] != record['bytes']:", 'if False:', 'test_changed_source_stops_before_snapshot_registration_or_solver', 'ValueError not raised'),
    ('changed-manifest', names[0], "if record['sha256'] != expected_hash or record['bytes'] != expected_size:", 'if False:', 'test_changed_preserved_documents_refuse', 'ValueError not raised'),
    ('wrong-method', names[0], "or metadata.get('demand_method') != method", "or False", 'test_wrong_method_is_not_treated_as_missing', None),
    ('duplicate', names[0], 'if len(selected) != 1:', 'if False:', 'test_duplicate_consumption_refuses', 'ValueError not raised'),
    ('unchecked-receipt', names[0], "receipt = client.checked_receipt(saved['command'], saved['response'])", "receipt = saved['response']", 'test_corrupt_saved_receipt_refuses', 'DeliveryUnconfirmed not raised'),
    ('foreign-attempt', names[0], "('run_id', 'stage_id', 'attempt_id')", "('run_id', 'stage_id')", 'test_other_attempt_cannot_supply_this_assignments_link', 'DeliveryUnconfirmed'),
    ('restored', None, None, None, None, None),
]
# Method also determines the fixed directory; removing one redundant condition
# must survive. Other controls deliberately break the only asserted boundary.
results = []
for control, name, old, new, test, reason in checks:
    sources = dict(original)
    if name:
        assert sources[name].count(old) == 1, control
        sources[name] = sources[name].replace(old, new)
    elif control == 'harmless':
        sources[names[0]] += '\n# Harmless custody comment.\n'
    with tempfile.TemporaryDirectory(prefix='openplan-preparation-link-control-') as tmp:
        for filename, source in sources.items(): (Path(tmp) / filename).write_text(source)
        target = 'test_assignment_preparation_link' + ('.PreparationLinkTests.' + test if test else '')
        code = f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
        result = subprocess.run([sys.executable, '-B', '-c', code], capture_output=True, text=True, timeout=30)
        log = result.stdout + result.stderr
        matched = result.returncode == 0 if reason is None else result.returncode != 0 and reason in log
        results.append({'control': control, 'returncode': result.returncode, 'expected_failure': reason, 'matched': matched})
        if not matched: raise AssertionError(f'{control}: {log}')
report = {'source_sha256': {name: hashlib.sha256(source.encode()).hexdigest() for name, source in original.items()},
          'controls': results, 'limits': 'Real files and command journals; injected database responses and synthetic solver. Custody does not prove solver-input equivalence or scientific acceptance.'}
(Path(__file__).parent / 'assignment-preparation-link-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
