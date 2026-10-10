"""Explicit numerical settings and the existing deadline forwarding guard."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
g=(WORKER/'gtfs_skim.py').read_text();t=(WORKER/'model_transit_skim.py').read_text()
prefix='test_transit_skim_settings.TransitSettingsTests.'
cases=[('baseline',g,t,''),('harmless',g+'\n# Harmless comment.\n',t,''),
 ('allow-bool',g.replace('type(value) not in (int, float) or ',''),t,prefix+'test_record_refuses_missing_extra_nonfinite_and_invalid_numbers'),
 ('ignore-access',g.replace('if d <= settings.access_miles:', 'if d <= GTFS_ACCESS_MILES:'),t,prefix+'test_explicit_access_changes_served_pairs'),
 ('ignore-transfer',g.replace('iv + settings.transfer_penalty_min + b_walk','iv + GTFS_TRANSFER_PENALTY_MIN + b_walk'),t,prefix+'test_transfer_penalty_changes_selected_itinerary'),
 ('omit-settings-metadata',g,t.replace('"skim_settings": settings.to_record()', '"skim_settings": {}'),prefix+'test_child_uses_record_despite_different_environment'),
 ('ignore-fare',g.replace('fare[i, j] = settings.flat_fare_usd','fare[i, j] = GTFS_FLAT_FARE'),t,prefix+'test_child_uses_record_despite_different_environment'),
 ('ignore-walk',g.replace('d / settings.walk_mph * 60.0','d / WALK_MPH * 60.0'),t,prefix+'test_child_uses_record_despite_different_environment'),
 ('ignore-coverage-setting',g,t.replace('buffer_miles=settings.access_miles','buffer_miles=None'),prefix+'test_explicit_access_controls_prepared_coverage'),
 ('drop-deadline',g,t.replace('deadline=deadline, settings=settings','deadline=None, settings=settings'),'budget'),
 ('restored',g,t,'')]
runner='''
import importlib.util,sys,unittest
from pathlib import Path
for name in ('gtfs_skim','model_transit_skim'):
 spec=importlib.util.spec_from_file_location(name,str(Path(sys.argv[1])/(name+'.py')))
 m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m)
import test_transit_feed_handoff as handoff
budget=unittest.FunctionTestCase(handoff.test_the_budget_reaches_the_skim_itself_and_not_only_the_check_before_it)
if sys.argv[2]=='budget':suite=unittest.TestSuite([budget])
elif sys.argv[2]:suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[2])
else:
 suite=unittest.defaultTestLoader.loadTestsFromName('test_transit_skim_settings');suite.addTest(budget)
r=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 for name,gs,ts,target in cases:
  (Path(directory)/'gtfs_skim.py').write_text(gs);(Path(directory)/'model_transit_skim.py').write_text(ts)
  r=subprocess.run([sys.executable,'-B','-c',runner,directory,target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL:' not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'gtfs_sha256':hashlib.sha256(g.encode()).hexdigest(),'transit_module_sha256':hashlib.sha256(t.encode()).hexdigest(),'controls':records,'limits':'Synthetic feed and transfer network, real separate-process numerical comparison, mocked parent feed metadata/storage. No retained archive authority, full assignment handoff, all optional provider paths or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-settings-controls.json').write_text(content);print(content)
