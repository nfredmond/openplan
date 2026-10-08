"""Exercise the actual count-preparation function under targeted mutations."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
nodes=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in ('skim_selected_feed_version','skim_prepared_feed_version')]
body='\n\n'.join(ast.get_source_segment(source,n) for n in nodes)
cases=[('baseline',body,None,None),('harmless',body+'\n# Harmless comment.\n',None,None),
 ('mutate-input-meta',body.replace('meta = dict(prepared_meta)','meta = prepared_meta'),'test_prepared_skim_preserves_input_and_ingest_facts_without_loading','FAIL: '),
 ('overwrite-ingest',body.replace('meta.update(_from_ingest)','pass'),'test_prepared_skim_preserves_input_and_ingest_facts_without_loading','FAIL: '),
 ('skip-coverage',body.replace('if not gtfs_skim.feed_covers(los, lons, lats):','if False:'),'test_prepared_feed_outside_area_keeps_selected_feed_refusal','FAIL: '),
 ('drop-deadline',body.replace('deadline=deadline, feed_origin=feed_origin','deadline=None, feed_origin=feed_origin'),'test_existing_entrypoint_delegates_loaded_feed_and_options','FAIL: '),
 ('restored',body,None,None)]
runner='''
import sys,unittest
from pathlib import Path
from test_transit_feed_handoff import main as aeq
exec(compile(Path(sys.argv[1]).read_text(),'main.py','exec'),vars(aeq))
name='test_prepared_feed_skim'+('.PreparedFeedTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp)/'candidate.py'
 for name,candidate,target,kind in cases:
  p.write_text(candidate)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or kind+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real synthetic GTFS parsing and skimming, mocked feed metadata and storage transport. Loaded-feed split only; main import still loads operator settings. No child process isolation, retained archive handoff or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'prepared-feed-skim-controls.json').write_text(content);print(content)
