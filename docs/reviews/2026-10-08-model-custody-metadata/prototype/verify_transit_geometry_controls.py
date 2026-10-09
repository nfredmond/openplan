"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
full_source=(WORKER/'main.py').read_text()
source=full_source[full_source.index('def managed_assignment_transit_preparer('):full_source.index('def resolve_transit_feed_plan(')]
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('mutable-setup',source.replace('setup = copy.deepcopy(setup_result)', 'setup = setup_result'),'test_callback_uses_owned_coordinates_and_frozen_zone_order'),
 ('omit-deadline',source.replace('lats=np.asarray(geometry["lats"], dtype=float), deadline=deadline,', 'lats=np.asarray(geometry["lats"], dtype=float), deadline=None,'),'test_deadline_is_forwarded_with_owned_geometry'),
 ('wrong-longitudes',source.replace('out_dir, lons=np.asarray(geometry["lons"], dtype=float),', 'out_dir, lons=np.zeros(len(geometry["lons"])), '),'test_callback_uses_owned_coordinates_and_frozen_zone_order'),
 ('omit-registration',source.replace('writer.record_artifact({', '(lambda *args, **kwargs: None)({'),'test_real_child_consumes_registered_geometry'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
from test_model_skip_dispatch import aeq
exec(compile(open(sys.argv[1]).read(),sys.argv[1],'exec'),aeq.__dict__)
name='test_managed_transit_geometry'+('.TransitGeometryTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Synthetic CSV and owned package fixtures. Real child geometry handoff with synthetic no-match discovery and mocked registration. No general modeled child transit, full native assignment, original producer authority or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-geometry-controls.json').write_text(content);print(content)
