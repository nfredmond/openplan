"""Harmless and faulty controls for the declared dependency catalog, not publication."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT/'workers/aequilibrae_worker/model_validation_source_catalog.py'
original = source.read_text()
mutations = [
 ('context', "if basis.get('model_run_id') != context['model_run_id'] or basis.get('method') != context['method']:", 'if False:'),
 ('document-bytes', "if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:", 'if False:'),
 ('binding-hash', "binding['sha256'] != expected or ", ''),
 ('missing-role', "problems.append(role + ': missing binding'); return", 'return'),
 ('execution-phase', "(['modeled_quantity','expansion_chain','run_summary_sha256'], 'execution'),", "(['modeled_quantity','expansion_chain','run_summary_sha256'], 'preparation'),"),
 ('unverified-bytes', "'stored_source_bytes_verified':False", "'stored_source_bytes_verified':True"),
 ('compressed-logical-hash', "if logical is not None: entry['logical_source'] = logical", "if logical is not None: entry['logical_source'] = {**logical, 'sha256': expected}"),
 ('output-alias', "problems.append('preparation source aliases model output reference')", 'pass'),
 ('duplicate-json', "if key in value: raise ValueError('Duplicate document key')", "if False: raise ValueError('Duplicate document key')"),
 ('unavailable-status', "if isinstance(binding, dict) and binding.get('status', 'available') != 'available':", 'if False:'),
]
variants = [('harmless', original+'\n# Harmless formatting control.\n')]
for name,before,after in mutations:
    assert original.count(before) == 1, name
    variants.append((name,original.replace(before,after)))
variants.append(('restored',original))
cases=[]
try:
    for name,content in variants:
        source.write_text(content)
        result=subprocess.run([sys.executable,'-B','workers/aequilibrae_worker/test_model_validation_source_catalog.py'],cwd=ROOT,capture_output=True,text=True,timeout=30)
        detail=result.stdout+result.stderr
        if name in ('harmless','restored'): assert result.returncode == 0,detail
        else: assert result.returncode != 0 and 'AssertionError' in detail,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original)
report={'source_sha256':hashlib.sha256(original.encode()).hexdigest(),'cases':cases,
    'limits':'In-memory synthetic documents and producer-supplied binding metadata. Source bytes, filesystem aliases, native custody authority, publication, recovery and scientific acceptance are not established.'}
Path(__file__).with_name('source-catalog-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
