"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_zone_geometry.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('reverse-order',source.replace('key=lambda item: item[1]', 'key=lambda item: -item[1]'),'test_graph_order_and_original_coordinates_survive'),
 ('round-identifiers',source.replace('return operator.index(value)', 'return int(value)'),'test_fractional_and_boolean_identifiers_refused'),
 ('allow-invalid-coordinates',source.replace('if not np.isfinite(values).all()', 'if False and not np.isfinite(values).all()').replace(' or (np.abs(values', ' and (np.abs(values').replace(' or (values[:, 2]', ' and (values[:, 2]'),'test_missing_and_nonfinite_coordinates_do_not_become_zero'),
 ('accept-duplicate-nodes',source.replace(' or len(set(converted.values())) != len(converted)', ''),'test_ambiguous_mapping_and_rows_refused'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_zone_geometry',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_zone_geometry'+('.ZoneGeometryTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Synthetic CSV and owned package fixtures. No complete assignment, child geometry handoff, original producer manifest authority or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'zone-geometry-controls.json').write_text(content);print(content)
