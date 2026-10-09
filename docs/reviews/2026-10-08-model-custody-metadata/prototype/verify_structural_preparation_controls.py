"""Targeted controls for the actual worker structural-file gate."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT/'workers/aequilibrae_worker/model_structural_input_audit.py'
original = source.read_bytes()
mutations = [
 ('audit-hash', 'if hashlib.sha256(payload).hexdigest() != expected_audit_sha256:', 'test_audit_hash'),
 ('method', 'if audit.get("method") != expected_method:', 'test_method'),
 ('geography', 'if not isinstance(expected_geography, Mapping) or not expected_geography or canonical_json(audit.get("geography")) != canonical_json(expected_geography):', 'test_geography'),
 ('sources', 'if not isinstance(expected_sources, Mapping) or not expected_sources or canonical_json(audit["source_hashes"]) != canonical_json(expected_sources):', 'test_sources'),
 ('stored', 'if hashlib.sha256(stored).hexdigest() != record["stored_sha256"]:', 'test_stored_bytes'),
 ('logical', 'if len(logical) != record["bytes"] or hashlib.sha256(logical).hexdigest() != record["sha256"]:', 'test_logical_bytes'),
 ('path', 'if logical_name != record["path"]:', 'test_logical_path'),
 ('alias', 'if aliases:', 'test_output_alias'),
]
cases=[]
try:
 variants=[('harmless', original+b'\n# Harmless structural preparation control.\n', None)]
 for name,before,test in mutations:
  assert original.count(before.encode())==1,name
  variants.append((name,original.replace(before.encode(),b'if False:'),test))
 variants.append(('restored',original,None))
 for name,content,test in variants:
  source.write_bytes(content)
  command=[sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_structural_preparation_files.py')]
  if test: command.append('PreparationFilesTests.'+test)
  result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
  detail=result.stdout+result.stderr
  if test: assert result.returncode!=0 and test in detail and 'AssertionError' in detail,detail
  else: assert result.returncode==0,detail
  cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally: source.write_bytes(original)
main = ROOT/'workers/aequilibrae_worker/main.py'
main_original = main.read_bytes()
try:
 before=b'model_structural_input_audit.verify_structural_input_files('
 assert main_original.count(before)==1
 main.write_bytes(main_original.replace(before,b'(lambda *args, **kwargs: None)('))
 result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_structural_preparation_files.py'),'PreparationFilesTests.test_audit_hash'],cwd=ROOT,capture_output=True,text=True)
 detail=result.stdout+result.stderr
 assert result.returncode!=0 and 'test_audit_hash' in detail and 'AssertionError' in detail,detail
 cases.append({'control':'wrapper-bypass','returncode':result.returncode,'expected_behavior_observed':True})
finally: main.write_bytes(main_original)
report={'source_sha256':hashlib.sha256(original).hexdigest(),'cases':cases,
 'limits':['Actual wrapper with synthetic audit and sources; evaluator replaced by sentinel',
 'No admitted run preparation, independent timing, filesystem race fence, native Storage or scientific acceptance']}
Path(__file__).with_name('structural-preparation-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
