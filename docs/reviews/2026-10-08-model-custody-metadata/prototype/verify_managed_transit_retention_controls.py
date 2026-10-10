"""Exercise the actual count-preparation function under targeted mutations."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
tree=ast.parse(source)
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='retain_managed_selected_transit')
constant=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='_GTFS_VERSION_SELECT' for t in n.targets))
body=ast.get_source_segment(source,constant)+'\n'+ast.get_source_segment(source,node)
cases=[('baseline',body,None,None),('harmless',body+'\n# Harmless comment.\n',None,None),
 ('omit-registration',body.replace('writer.record_artifact(', '(lambda *args, **kwargs: None)('),'test_lost_registration_keeps_bytes_and_stops_without_handoff','FAIL: '),
 ('allow-foreign-output',body.replace('if writer.files is None or not Path(out_dir).resolve(strict=True).is_relative_to(writer.files.path):','if False:'),'test_foreign_output_refused_before_source_loading','FAIL: '),
 ('wrong-workspace',body.replace('selection.feed_version_id, writer.context.workspace_id',"selection.feed_version_id, 'foreign'"),'test_foreign_workspace_feed_refused_without_substitution','FAIL: '),
 ('omit-ownership-projection',body.replace('id,feed_id,workspace_id,source_kind','id,feed_id,source_kind'),'test_selected_feed_projection_includes_workspace_ownership','FAIL: '),
 ('restored',body,None,None)]
runner='''
import sys,unittest
from pathlib import Path
from test_model_skip_dispatch import aeq
exec(compile(Path(sys.argv[1]).read_text(),'main.py','exec'),vars(aeq))
name='test_managed_transit_retention'+('.ManagedTransitTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual selected-feed loader and parent retained artifact adapter, real bytes/journal, projection-aware mocked feed HTTP. No native database registration, channel handoff, acquisition containment or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'managed-transit-retention-controls.json').write_text(content);print(content)
