"""Mutation evidence for retained comparison identity checks."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_validation_core_v5.py'
original=source.read_bytes()
mutations=[
 ('bundle','if hashlib.sha256(input_bytes[bundle_path]).hexdigest() != prepared_context.input_bundle_sha256:','test_bundle_hash'),
 ('basis','if hashlib.sha256(input_bytes[basis_path]).hexdigest() != prepared_context.comparison_basis_sha256:','test_basis_hash'),
 ('identity','if basis.get("model_run_id") != prepared_context.model_run_id or basis.get("method") != prepared_context.method:','test_cross_run_or_method'),
 ('invalid','if not isinstance(prepared_context.model_run_id, str) or not prepared_context.model_run_id.strip() or prepared_context.method not in {"aequilibrae", "activitysim"}:','test_invalid_context'),
]
cases=[]
try:
 variants=[('harmless',original+b'\n# Harmless context control.\n',None)]
 for name,before,test in mutations:
  assert original.count(before.encode())==1
  variants.append((name,original.replace(before.encode(),b'if False:'),test))
 variants.append(('restored',original,None))
 for name,content,test in variants:
  source.write_bytes(content)
  command=[sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_validation_prepared_context.py')]
  if test:command.append('PreparedContextTests.'+test)
  result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
  detail=result.stdout+result.stderr
  if test:assert result.returncode!=0 and test in detail and 'AssertionError' in detail,detail
  else:assert result.returncode==0,detail
  cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_bytes(original)
main=ROOT/'workers/aequilibrae_worker/main.py'
main_original=main.read_bytes()
try:
 before=b'model_run_id=expected_model_run_id, method=expected_method,'
 assert main_original.count(before)==1
 main.write_bytes(main_original.replace(before,b'model_run_id="wrong-run", method=expected_method,'))
 result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/modeling/tests/test_structural_preparation_files.py'),'PreparationFilesTests.test_valid_compressed_and_plain'],cwd=ROOT,capture_output=True,text=True)
 detail=result.stdout+result.stderr
 assert result.returncode!=0 and 'test_valid_compressed_and_plain' in detail and 'AssertionError' in detail,detail
 cases.append({'control':'wrapper-wrong-run','returncode':result.returncode,'expected_behavior_observed':True})
finally:main.write_bytes(main_original)
report={'cases':cases,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Synthetic exact-file evaluation and wrapper forwarding', 'No admitted preparation producer, independent timing, source validity or scientific acceptance']}
Path(__file__).with_name('prepared-context-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
