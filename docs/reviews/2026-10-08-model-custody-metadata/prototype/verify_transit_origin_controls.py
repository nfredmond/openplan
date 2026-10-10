"""Actual parent feed policy, provenance and registration controls."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
names={'_owned_transit_writer','_confirm_managed_transit_bundle','resolve_transit_feed_plan','prepare_managed_transit_for_engine'}
body='\n\n'.join(ast.get_source_segment(source,n) for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in names)
cases=[('baseline',body,''),('harmless',body+'\n# Harmless comment.\n',''),
 ('omit-registration',body.replace('writer.record_artifact(', '(lambda *args, **kwargs: None)('),'test_uncertain_registration_is_not_feed_unavailable'),
 ('wrong-extent',body.replace('float(lons.min())','float(lons.max())'),'test_discovered_feed_uses_exact_centroid_extent'),
 ('lose-catalog-failure',body.replace('"fallback_after_catalog_failure": plan.fallback_after_catalog_failure','"fallback_after_catalog_failure": False'),'test_catalog_failure_retains_fallback_disclosure'),
 ('ignore-selected-feed',body.replace('selection=feed_selection','selection=None'),'test_selected_feed_outranks_operator_and_catalog'),
 ('ignore-no-match',body.replace('if not plan.load:', 'if False:'),'test_catalog_no_match_does_not_substitute_bundle'),
 ('drop-deadline',body.replace('gtfs_skim.check_deadline(deadline, "preparing the retained transit archive")','pass'),'test_deadline_refusal_does_not_register_archive'),
 ('restored',body,'')]
runner='''
import sys,unittest
from pathlib import Path
from test_model_skip_dispatch import aeq
exec(compile(Path(sys.argv[1]).read_text(),'candidate.py','exec'),vars(aeq))
name='test_managed_transit_origins'+('.TransitOriginTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,candidate,target in cases:
  p.write_text(candidate)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual parent policy and retained bundle, real synthetic archive/files/journal; mocked catalog, download, source DB and registration. Coordinates supplied by trusted parent fixture. General child channel, coverage outcome, live providers, hard deadlines, containment and scientific acceptance remain open.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-origin-controls.json').write_text(content);print(content)
