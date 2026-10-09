"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_transit_execution.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('ignore-deadline',source.replace("deadline = prepared['deadline']", 'deadline = None'),'test_deadline_prevents_feed_consumption'),
 ('replace-settings',source.replace('settings=settings, deadline=deadline', 'settings=gtfs_skim.skim_settings(), deadline=deadline'),'test_exact_geometry_settings_and_bytes_drive_skim'),
 ('replace-coordinates',source.replace("np.asarray(geometry['lons'], dtype=float)", "np.zeros(len(geometry['lons']))"),'test_exact_geometry_settings_and_bytes_drive_skim'),
 ('erase-unavailable-status',source.replace("'transit_status': prepared['transit_status']", "'transit_status': 'no_local_feed'"),'test_unavailable_remains_unavailable_without_feed_read'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_transit_execution',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_transit_execution'+('.TransitExecutionTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real retained synthetic feed and geometry computation. No full native assignment, external catalog coverage, recovery or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-execution-controls.json').write_text(content);print(content)
