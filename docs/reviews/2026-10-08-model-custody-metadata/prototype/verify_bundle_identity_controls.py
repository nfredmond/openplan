"""Prove that bundle identity cannot be relabeled by a caller."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'scripts/modeling/validation_instrument_v2.py'
original=source.read_bytes()
mutations=(
    ('empty-identity', 'if not isinstance(study_id, str) or not study_id.strip() or not isinstance(geography_id, str) or not geography_id.strip():', 'test_empty_identity_is_refused'),
    ('study-binding', "if not isinstance(registry, Mapping) or registry.get('study_id') != study_id or package.get('study_id') != study_id:", 'test_requested_study_cannot_relabel_package'),
    ('geography-binding', "if not isinstance(geography, Mapping) or geography.get('geography_id') != geography_id:", 'test_requested_geography_cannot_relabel_package'),
    ('audit-geography', "if not isinstance(audit.get('geography'), Mapping) or canonical_json_bytes(audit['geography']) != canonical_json_bytes(geography):", 'test_audit_descriptor_must_match_package'),
    ('registry-binding', "if not isinstance(package_registry, Mapping) or package_registry.get('sha256') != sha256_file(registry_path):", 'test_package_registry_hash_must_match'),
)
cases=[]
try:
    variants=[('harmless',original+b'\n# Harmless identity control.\n',None)]
    for name, before, test in mutations:
        assert original.count(before.encode())==1,name
        variants.append((name,original.replace(before.encode(),b'if False:'),test))
    variants.append(('restored',original,None))
    for name,content,test in variants:
        source.write_bytes(content)
        command=[sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_validation_bundle_identity.py')]
        if test:command.append('BundleIdentityTests.'+test)
        result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
        detail=result.stdout+result.stderr
        if test:assert result.returncode!=0 and test in detail and 'AssertionError' in detail,detail
        else:assert result.returncode==0,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
    source.write_bytes(original)
report={'cases':cases,'source_sha256':hashlib.sha256(original).hexdigest(),
        'limits':['Synthetic identities and exact file bindings', 'No registry membership, authority applicability, boundary validity, source quality or filesystem-race acceptance']}
Path(__file__).with_name('bundle-identity-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
