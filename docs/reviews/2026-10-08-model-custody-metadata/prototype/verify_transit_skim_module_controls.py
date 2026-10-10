"""Exercise moved numerical code, its import boundary and expiry call guard."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_transit_skim.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('mutate-input-meta',source.replace('meta = dict(prepared_meta)','meta = prepared_meta'),'test_prepared_feed_skim.PreparedFeedTests.test_prepared_skim_preserves_input_and_ingest_facts_without_loading'),
 ('overwrite-ingest',source.replace('meta.update(_from_ingest)','pass'),'test_prepared_feed_skim.PreparedFeedTests.test_prepared_skim_preserves_input_and_ingest_facts_without_loading'),
 ('skip-coverage',source.replace('if not gtfs_skim.feed_covers(los, lons, lats):','if False:'),'test_prepared_feed_skim.PreparedFeedTests.test_prepared_feed_outside_area_keeps_selected_feed_refusal'),
 ('credential-import',source.replace('    meta = dict(prepared_meta)','    import dotenv\n    meta = dict(prepared_meta)'),'test_transit_skim_module.TransitModuleTests.test_fresh_process_skims_without_worker_or_transport_import'),
 ('omit-expiry-call',source.replace('log = _feed_expiry_log_note(meta)',"log = ''"),'expiry-guard'),
 ('wrong-worker-export',source,'test_transit_skim_module.TransitModuleTests.test_worker_exports_the_shared_numerical_implementation'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_transit_skim',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
import test_transit_feed_handoff as handoff
if sys.argv[3]=='wrong-worker-export':handoff.main._transit_feed_summary=lambda los:{}
if sys.argv[2]=='expiry-guard':
 suite=unittest.TestSuite([unittest.FunctionTestCase(handoff.test_the_transit_stage_prints_the_expiry_note_for_the_workers_OWN_feed_too)])
elif sys.argv[2]:suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[2])
else:
 suite=unittest.defaultTestLoader.loadTestsFromNames(['test_prepared_feed_skim','test_transit_skim_module'])
 suite.addTest(unittest.FunctionTestCase(handoff.test_the_transit_stage_prints_the_expiry_note_for_the_workers_OWN_feed_too))
r=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target,name],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL:' not in r.stderr:raise AssertionError(name+': '+r.stderr)
   if name=='credential-import' and 'Forbidden worker or transport import: dotenv' not in r.stderr:raise AssertionError('Wrong import failure')
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Synthetic real GTFS parsing/skimming, mocked parent source reads, clean child imports blocked for main/dotenv/requests with socket-connect audit. Not OS sandboxing, all-transitive no-egress, explicit setting transfer, retained archive handoff or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-skim-module-controls.json').write_text(content);print(content)
