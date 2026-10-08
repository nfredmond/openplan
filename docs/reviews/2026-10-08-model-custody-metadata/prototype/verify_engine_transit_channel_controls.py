"""Parent transit channel and selected-feed refusal boundaries."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_engine_channel.py').read_text();main=(WORKER/'main.py').read_text()
node=next(n for n in ast.parse(main).body if isinstance(n,ast.FunctionDef) and n.name=='prepare_managed_selected_transit_for_engine')
body=ast.get_source_segment(main,node)
cases=[('baseline',source,body,''),('harmless',source+'\n# Harmless comment.\n',body,''),
 ('allow-child-version',source.replace('set(request) != fields','not fields.issubset(request)'),body,'test_child_cannot_override_selected_version'),
 ('allow-repeat',source.replace('if self.transit_preparation_started:', 'if False:'),body,'test_repeat_refused_before_second_preparation'),
 ('skip-parent-preparation',source.replace("response['result'] = self._prepare_inputs(self.transit_preparer)","response['result'] = {'status':'unavailable','no_feed_reason':'fake'}"),body,'test_child_consumes_registered_bytes_and_skims'),
 ('downgrade-uncertain-write',source,body.replace('except gtfs_skim.SelectedFeedError as error:','except Exception as error:').replace('error.no_feed_reason',"getattr(error, 'no_feed_reason', 'fake')"),'test_uncertain_write_not_reported_as_feed_unavailable'),
 ('restored',source,body,'')]
runner='''
import importlib.util,sys,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('model_engine_channel',str(Path(sys.argv[1])/'channel.py'))
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
from test_model_skip_dispatch import aeq
exec(compile((Path(sys.argv[1])/'adapter.py').read_text(),'adapter.py','exec'),vars(aeq))
name='test_engine_transit_channel'+('.TransitChannelTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 for name,channel,adapter,target in cases:
  (Path(directory)/'channel.py').write_text(channel);(Path(directory)/'adapter.py').write_text(adapter)
  r=subprocess.run([sys.executable,'-B','-c',runner,directory,target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'channel_sha256':hashlib.sha256(source.encode()).hexdigest(),'adapter_sha256':hashlib.sha256(body.encode()).hexdigest(),'controls':records,'limits':'Real reserved child, retained synthetic GTFS and numerical skim; mocked feed/database transports. Selected-feed path only. No native registration recovery, full assignment, provider containment or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'engine-transit-channel-controls.json').write_text(content);print(content)
