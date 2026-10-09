"""Prove malformed readiness cannot disappear before output access."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_validation_core_v5.py'
original=source.read_bytes()
mutations=(
 ('drop-partial', 'raise ContractError("readiness artifact omitted its exact path or hash")', 'return []', 'test_partial_records_are_not_silently_dropped'),
 ('drop-empty', 'raise ContractError("readiness input contains an empty record")', 'return []', 'test_empty_record_is_not_silently_dropped'),
 ('drop-scalar', 'raise ContractError("readiness input must contain artifact records")', 'return []', 'test_scalar_record_is_not_silently_dropped'),
 ('ignore-size', 'if "bytes" in record and len(payload) != record["bytes"]:', 'if False:', 'test_declared_size_is_checked'),
 ('conflate-size-type', 'if "bytes" in record and (type(record["bytes"]) is not int or record["bytes"] < 0):', 'if False:', 'test_size_type_is_checked'),
)
cases=[]
try:
 variants=[('harmless',original+b'\n# Harmless readiness control.\n',None)]
 for name,before,after,test in mutations:
  # The partial-record error also belongs to the existing value validator.
  # Mutate only the first occurrence inside record traversal.
  assert original.count(before.encode())==(2 if name=='drop-partial' else 1),name
  variants.append((name,original.replace(before.encode(),after.encode(),1),test))
 variants.append(('restored',original,None))
 for name,content,test in variants:
  source.write_bytes(content)
  command=[sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_validation_readiness_records.py')]
  if test:command.append('ReadinessRecordsTests.'+test)
  result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
  detail=result.stdout+result.stderr
  if test:assert result.returncode!=0 and test in detail and 'AssertionError' in detail,detail
  else:assert result.returncode==0,detail
  cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
 source.write_bytes(original)
report={'cases':cases,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Synthetic readiness records and instrumented model-output read', 'No source validity, complete readiness coverage, immutable filesystem or scientific acceptance proof']}
Path(__file__).with_name('readiness-record-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
