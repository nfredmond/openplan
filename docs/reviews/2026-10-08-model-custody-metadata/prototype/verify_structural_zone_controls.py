"""Exercise structural zone guards in isolated module copies."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[4]
worker=ROOT/'workers/aequilibrae_worker'
source=(worker/'model_structural_input_audit.py').read_text()
checks=[
 ('harmless',None,None,None,None),
 ('binary-rounding','return int(number)','return int(float(number))','test_large_zone_ids_remain_distinct','OD matrix must have unique zone ids'),
 ('fraction-truncation','if not number.is_finite() or number != number.to_integral_value():','if not number.is_finite():','test_fractional_or_nonfinite_identifiers_are_refused','StructuralAuditRefused not raised'),
 ('duplicate-matrix','if len(set(origin_ids)) != len(origin_ids) or len(set(destination_ids)) != len(destination_ids):','if False:','test_duplicate_matrix_ids_are_refused','StructuralAuditRefused not raised'),
 ('duplicate-table','if not ids or len(set(ids)) != len(ids):','if not ids:','test_duplicate_zone_table_is_refused_before_audit_computation','Invalid zones reached demand computation'),
 ('empty-table','if not ids or len(set(ids)) != len(ids):','if len(set(ids)) != len(ids):','test_empty_or_missing_zone_column_is_refused','StructuralAuditRefused not raised'),
 ('blank-matrix-row','except (TypeError, ValueError, IndexError) as exc:','except (TypeError, ValueError) as exc:','test_empty_matrix_row_has_a_structural_refusal','IndexError'),
 ('restored',None,None,None,None),
]
results=[]
for name,old,new,test,reason in checks:
 candidate=source
 if old:
  assert candidate.count(old)==1,name
  candidate=candidate.replace(old,new)
 elif name=='harmless':candidate+='\n# Harmless source comment.\n'
 with tempfile.TemporaryDirectory(prefix='openplan-zone-control-') as tmp:
  (Path(tmp)/'model_structural_input_audit.py').write_text(candidate)
  target='test_structural_zone_identity'+('.ZoneIdentityTests.'+test if test else '')
  code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];suite=unittest.defaultTestLoader.loadTestsFromName({target!r});result=unittest.TextTestRunner().run(suite);raise SystemExit(not result.wasSuccessful())"
  result=subprocess.run([sys.executable,'-B','-c',code],text=True,capture_output=True,timeout=30)
  log=result.stdout+result.stderr
  passed=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':name,'returncode':result.returncode,'expected_failure':reason,'matched':passed})
  if not passed:raise AssertionError(f'{name}: {log}')
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
 'limits':'Parser and actual audit-entry refusal tests over synthetic files. No native engine, geographic acceptance, scientific accuracy or launch-order proof.'}
(Path(__file__).parent/'structural-zone-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
