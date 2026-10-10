"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_transit_skim.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('restore-false-absence',source.replace("return {'transit_status': 'feed_unavailable', 'no_feed_reason': reason", "return {'transit_status': 'no_local_feed', 'no_feed_reason': reason"),'test_actual_assignment_miss_branch_uses_shared_refusal'),
 ('erase-catalog-failure',source.replace("reason = 'feed_catalog_unavailable'", "reason = 'feed_has_no_stops_in_study_area'"),'test_catalog_failure_and_selected_refusal_keep_distinct_reasons'),
 ('skip-coverage',source.replace('if not gtfs_skim.feed_covers(los, lons, lats, buffer_miles=settings.access_miles):','if False:'),'test_every_loaded_origin_miss_remains_unavailable'),
 ('mark-covered-unavailable',source.replace("return {'transit_status': 'modeled'", "return {'transit_status': 'feed_unavailable'"),'test_covered_origins_compute_and_preserve_provenance'),
 ('accept-unknown-origin',source.replace("raise ValueError('Unknown retained transit feed origin')", "reason = 'feed_has_no_stops_in_study_area'\n        message = 'Unknown origin'"),'test_unknown_origin_is_not_given_a_coverage_claim'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_transit_skim',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_transit_coverage_outcomes'+('.CoverageOutcomeTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real synthetic GTFS skims and executed actual assignment coverage-miss AST block. Not full assignment, general child channel, native registration, external catalog completeness or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-coverage-controls.json').write_text(content);print(content)
